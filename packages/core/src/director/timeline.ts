import { projectFrameScene } from '../graph/core.js';
import type {
  FrameScene,
  ProjectedVisualGraph,
  ResolvedHighlight,
  ScenePlayback,
  VisualCamera,
  VisualGraph,
} from '../../types/visual-graph.js';

/** Authored shot durations are preserved; keyframe evaluation never advances state. */
export interface Keyframe<T> {
  atSec: number;
  value: T;
  ease?: 'linear' | 'smooth' | 'hold';
}

export interface CameraKeyframe extends Keyframe<VisualCamera> {
  /** Smooth transition to this shot's target, capped at its own duration. */
  transitionSec: number;
}

export interface RevealCue {
  targetId: string;
  kind: 'node' | 'edge';
  /**
   * When the object enters the projection to stay until the frame that first
   * shows it: the start of that shot, or of a shot shorter than a frame just
   * before it.
   */
  inSec: number;
  /**
   * When a frame first no longer shows the object, if one does: the instant
   * it left the projection to stay out until that frame.
   */
  outSec?: number;
  durationSec: number;
  effect: 'fade' | 'draw' | 'grow';
}

export interface CaptionCue {
  inSec: number;
  outSec: number;
  title?: string;
  text?: string;
  fadeInSec: number;
  fadeOutSec: number;
}

export interface CompiledShot {
  startSec: number;
  endSec: number;
  domainAt: number | null;
  /** The unfolding step in effect; null when no shot has set one. */
  revealStep: number | null;
  /** Includes redacted scene prose; never includes unprojected object references. */
  scene: FrameScene;
  view: ProjectedVisualGraph;
  overlay: { nodeId: string } | null;
}

export interface FilmTimeline {
  fps: number;
  durationSec: number;
  camera: CameraKeyframe[];
  highlight: Keyframe<ResolvedHighlight>[];
  domainTime: Keyframe<number | null>[];
  /**
   * How far an unfolding has gone at each shot: reveal order, its own track
   * beside domain time, never shown as a date.
   */
  revealSteps: Keyframe<number | null>[];
  reveal: RevealCue[];
  captions: CaptionCue[];
  /** Pre-projected, safe shot payloads; no source scenes are retained. */
  shots: CompiledShot[];
}

export const NODE_REVEAL_SEC = 0.6;
export const EDGE_REVEAL_SEC = 0.8;
export const CAPTION_FADE_SEC = 0.3;

const clamp = (x: number): number => Math.max(0, Math.min(1, x));

/**
 * Compile the authoring presentation into safe, absolute-time tracks.
 *
 * Every shot is projected and redacted BEFORE its camera/highlight/caption
 * tracks are collected. Reveal cues follow the projections of the shots the
 * film has frames for (see `revealCues`), never previous rendered frames.
 * If domain time moves backward, disappearing objects simply leave the
 * projection; a later reappearance starts a new cue.
 */
export function compileTimeline(graph: VisualGraph, fps = 24): FilmTimeline {
  if (!Number.isFinite(fps) || fps <= 0) throw new RangeError('Invalid timeline fps');
  const camera: CameraKeyframe[] = [];
  const highlight: Keyframe<ResolvedHighlight>[] = [];
  const domainTime: Keyframe<number | null>[] = [];
  const revealSteps: Keyframe<number | null>[] = [];
  const reveal: RevealCue[] = [];
  const captions: CaptionCue[] = [];
  const shots: CompiledShot[] = [];
  let startSec = 0;
  let correction = 0;
  let inheritedDomainAt: number | null = null;
  let inheritedRevealStep: number | null = null;

  for (const [index, source] of graph.scenes.entries()) {
    // The same compensated summation and boundary tolerance as sceneAtSecond.
    const adjusted = source.durationSec - correction;
    const endSec = startSec + adjusted;
    correction = endSec - startSec - adjusted;
    if (source.domainAt !== undefined) inheritedDomainAt = source.domainAt;
    if (source.revealStep !== undefined) inheritedRevealStep = source.revealStep;
    // This shot and its inherited domain time are already known; do not call
    // sceneAtSecond for each shot (it would rebuild the full prefix sums).
    const state = projectFrameScene(graph, source, index, inheritedDomainAt, inheritedRevealStep);
    const scene = state.scene;
    if (!scene) throw new Error('Unable to compile a presentation shot');
    const shot: CompiledShot = {
      startSec,
      endSec,
      domainAt: inheritedDomainAt,
      revealStep: inheritedRevealStep,
      scene,
      view: state.view,
      overlay: state.overlay,
    };
    shots.push(shot);
    camera.push({
      atSec: startSec,
      value: state.camera,
      ease: 'smooth',
      transitionSec: Math.min((scene.transitionMs ?? 1200) / 1000, scene.durationSec),
    });
    highlight.push({ atSec: startSec, value: state.highlight, ease: 'smooth' });
    domainTime.push({ atSec: startSec, value: shot.domainAt, ease: 'hold' });
    revealSteps.push({ atSec: startSec, value: shot.revealStep, ease: 'hold' });
    // Count actual frame-grid samples in the half-open shot, rather than
    // rounding its duration: a fractional start can leave just one sample.
    // With no second sample to complete a fade, display the caption in full.
    const firstSampleFrame = Math.ceil(
      (startSec - 8 * Number.EPSILON * Math.max(1, Math.abs(startSec))) * fps,
    );
    const afterLastSampleFrame = Math.ceil(
      (endSec - 8 * Number.EPSILON * Math.max(1, Math.abs(endSec))) * fps,
    );
    const singleFrame = afterLastSampleFrame - firstSampleFrame <= 1;
    const captionFadeSec = singleFrame ? 0 : Math.min(CAPTION_FADE_SEC, scene.durationSec / 2);
    captions.push({
      inSec: startSec,
      outSec: endSec,
      title: scene.title,
      text: scene.narration,
      fadeInSec: captionFadeSec,
      fadeOutSec: captionFadeSec,
    });

    startSec = endSec;
  }
  // The film ends on its last caption at full opacity instead of fading it
  // away on the final frames.
  const last = captions.at(-1);
  if (last) last.fadeOutSec = 0;
  const timeline: FilmTimeline = {
    fps,
    durationSec: startSec,
    camera,
    highlight,
    domainTime,
    revealSteps,
    reveal,
    captions,
    shots,
  };
  // Which shots have frames depends only on the shot tracks compiled above,
  // so the cues can follow the frames the film is rendered with.
  reveal.push(...revealCues(timeline, frameCount(graph, fps)));
  return timeline;
}

/** Frames of the film `graph` renders at `fps`: at least one. */
export function frameCount(graph: VisualGraph, fps = 24): number {
  return Math.max(
    1,
    Math.ceil(graph.scenes.reduce((sum, scene) => sum + scene.durationSec, 0) * fps - 1e-9),
  );
}

/**
 * Reveal cues as the frames show the projections: what the first shot
 * projects is there outright; after that, each shot with frames is compared
 * with the last shot that had frames. A shot shorter than a frame has none
 * (`shotStartFrames`), so what it alone withdraws and the next shot restores
 * never leaves the screen: no `outSec`, no second cue. An object that enters
 * in such a shot and stays fades in from that shot's start, at most a frame
 * before the first frame that shows it, as any cue starting between frames.
 */
function revealCues(timeline: FilmTimeline, frames: number): RevealCue[] {
  const { shots } = timeline;
  if (!shots.length) return [];
  const starts = shotStartFrames(timeline);
  const hasFrames = (index: number): boolean =>
    (index === shots.length - 1 ? frames : starts[index + 1]) > starts[index];
  const cues: RevealCue[] = [];
  const ids = (shot: CompiledShot) => ({
    node: new Set(shot.view.nodes.map((node) => node.id)),
    edge: new Set(shot.view.edges.map((edge) => edge.id)),
  });
  // On screen: each object the last shot with frames showed, with its cue
  // (null when the first shot shows it outright).
  let previous = ids(shots[0]);
  const shown = {
    node: new Map<string, RevealCue | null>([...previous.node].map((id) => [id, null])),
    edge: new Map<string, RevealCue | null>([...previous.edge].map((id) => [id, null])),
  };
  // The start of the shot from which each object has been in (or out of)
  // the projection without a break.
  const since = { node: new Map<string, number>(), edge: new Map<string, number>() };
  for (let index = 1; index < shots.length; index += 1) {
    const shot = shots[index];
    const current = ids(shot);
    for (const kind of ['node', 'edge'] as const) {
      for (const id of current[kind])
        if (!previous[kind].has(id)) since[kind].set(id, shot.startSec);
      for (const id of previous[kind])
        if (!current[kind].has(id)) since[kind].set(id, shot.startSec);
    }
    previous = current;
    if (!hasFrames(index)) continue;
    // A prior cue stops at once when the projection withdraws its object; no
    // fade-out is produced, even on backward time jumps.
    for (const kind of ['node', 'edge'] as const)
      for (const [id, cue] of shown[kind])
        if (!current[kind].has(id)) {
          if (cue) cue.outSec = since[kind].get(id);
          shown[kind].delete(id);
        }
    for (const kind of ['node', 'edge'] as const)
      for (const id of current[kind]) {
        if (shown[kind].has(id)) continue;
        const cue: RevealCue = {
          targetId: id,
          kind,
          inSec: since[kind].get(id) ?? shot.startSec,
          durationSec: kind === 'node' ? NODE_REVEAL_SEC : EDGE_REVEAL_SEC,
          effect: kind === 'node' ? 'fade' : 'draw',
        };
        cues.push(cue);
        shown[kind].set(id, cue);
      }
  }
  return cues;
}

/**
 * When each shot settles: the first second at which its camera and highlight
 * transition (none for the first shot) and every reveal under way at its
 * start have finished, capped at the shot's end. From then until the shot
 * ends nothing on the stage moves, so what a frame shows there is what the
 * viewer has time to read (ADR 004, D1).
 */
export function shotSettledSec(timeline: FilmTimeline): number[] {
  return timeline.shots.map((shot, index) => {
    let settled = shot.startSec + (index > 0 ? timeline.camera[index].transitionSec : 0);
    for (const cue of timeline.reveal)
      if (cue.inSec <= shot.startSec && (cue.outSec === undefined || cue.outSec > shot.startSec))
        settled = Math.max(settled, cue.inSec + cue.durationSec);
    return Math.min(settled, shot.endSec);
  });
}

/**
 * The first frame on the `fps` grid at or after `second`: frame `f` shows the
 * instant `f / fps`, and an instant within the boundary tolerance of
 * `timelinePlaybackAt` counts as reached. Shot starts, reveal starts and
 * settled instants all round this way.
 */
export function frameAtOrAfter(second: number, fps: number): number {
  // `|| 0` turns the -0 that a tolerance below zero rounds to into 0.
  return Math.ceil((second - 8 * Number.EPSILON * Math.max(1, Math.abs(second))) * fps) || 0;
}

/**
 * The first frame of every shot: shot `i` shows frames `starts[i]` up to the
 * next shot's first frame, and the last shot the rest of the film. These are
 * exactly the frames `timelinePlaybackAt(timeline, frame / fps)` assigns to
 * each shot, which is how frames are rendered; a shot shorter than a frame
 * can have none (its first frame is then the next shot's).
 */
export function shotStartFrames(timeline: FilmTimeline): number[] {
  const { fps, shots, durationSec } = timeline;
  if (!shots.length) return [];
  // The instant timelinePlaybackAt evaluates for a frame.
  const timeOf = (frame: number): number => Math.max(0, Math.min(frame / fps, durationSec));
  // The shot of a frame never moves backward as frames advance, so each
  // lookup resumes from the shot of an earlier frame: one sweep, linear in
  // the shots and the few frames it inspects, however many shots are
  // shorter than a frame.
  const starts = [0];
  // `frame` is the first frame of shot index - 1 (or frame 0) and `owner`
  // the shot timelinePlaybackAt gives it.
  let frame = 0,
    owner = shotIndexAt(shots, timeOf(0));
  for (let index = 1; index < shots.length; index += 1) {
    if (owner < index) {
      // Every frame up to `frame` shows an earlier shot. The rounded start is
      // right but for instants within the tolerance of a boundary; confirm
      // it against the playback that renders the frames.
      let next = Math.max(frame + 1, frameAtOrAfter(shots[index].startSec, fps));
      while (next - 1 > frame && shotIndexAt(shots, timeOf(next - 1), owner) >= index) next -= 1;
      let at = shotIndexAt(shots, timeOf(next), owner);
      while (at < index) {
        next += 1;
        at = shotIndexAt(shots, timeOf(next), at);
      }
      frame = next;
      owner = at;
    }
    starts.push(frame);
  }
  return starts;
}

/**
 * The shot timelinePlaybackAt gives an instant already clamped to the film:
 * the first whose end it is before, within the boundary tolerance, else the
 * last. A shot an instant is past, a later instant is past too, so `from`
 * may be the answer for any earlier instant.
 */
function shotIndexAt(shots: readonly CompiledShot[], time: number, from = 0): number {
  for (let index = from; index < shots.length - 1; index += 1) {
    const end = shots[index].endSec;
    if (time < end - 8 * Number.EPSILON * Math.max(1, Math.abs(time), Math.abs(end))) return index;
  }
  return shots.length - 1;
}

/** Match the original half-open scene boundary tolerance (including final frame). */
export function timelinePlaybackAt(
  timeline: FilmTimeline,
  second: number,
): ScenePlayback<FrameScene> {
  const { shots, durationSec } = timeline;
  if (!shots.length)
    return {
      scene: null,
      index: -1,
      elapsedSec: 0,
      progress: 0,
      domainAt: null,
      revealStep: null,
      totalSec: 0,
      startSec: 0,
    };
  const time = Math.max(0, Math.min(Number.isFinite(second) ? second : 0, durationSec));
  const index = shotIndexAt(shots, time);
  const shot = shots[index];
  const elapsedSec = Math.max(0, Math.min(shot.scene.durationSec, time - shot.startSec));
  return {
    scene: shot.scene,
    index,
    elapsedSec,
    progress: clamp(elapsedSec / shot.scene.durationSec),
    domainAt: timeline.domainTime[index].value,
    revealStep: timeline.revealSteps[index].value,
    totalSec: durationSec,
    startSec: shot.startSec,
  };
}

/**
 * Reveal progress (0–1) of every node and edge in `view`, the projection at
 * `second`, in one pass over the cues. An object with an active cue takes the
 * latest cue's progress; any other projected object is fully shown, including
 * every object of a graph without shots (no presentation, a still graph).
 * Frame-local: no previous frame or renderer memory is read.
 */
export function revealStateAt(
  timeline: FilmTimeline,
  view: Pick<ProjectedVisualGraph, 'nodes' | 'edges'>,
  second: number,
): { nodes: Record<string, number>; edges: Record<string, number> } {
  const tolerance = 8 * Number.EPSILON * Math.max(1, Math.abs(second));
  const active = { node: new Map<string, number>(), edge: new Map<string, number>() };
  // Later cues overwrite earlier ones for the same object.
  for (const cue of timeline.reveal)
    if (
      cue.inSec <= second + tolerance &&
      (cue.outSec === undefined || second < cue.outSec - tolerance)
    )
      active[cue.kind].set(cue.targetId, clamp((second - cue.inSec) / cue.durationSec));
  return {
    nodes: Object.fromEntries(view.nodes.map((node) => [node.id, active.node.get(node.id) ?? 1])),
    edges: Object.fromEntries(view.edges.map((edge) => [edge.id, active.edge.get(edge.id) ?? 1])),
  };
}

/**
 * Reveal progress of one object at `second`: 0 when the object is not in that
 * second's projection. Frames should use `revealStateAt`, which evaluates all
 * objects at once.
 */
export function revealProgress(
  timeline: FilmTimeline,
  kind: RevealCue['kind'],
  targetId: string,
  second: number,
): number {
  const view = timeline.shots[timelinePlaybackAt(timeline, second).index]?.view;
  if (!view) return 0;
  const state = revealStateAt(timeline, view, second);
  const progress = kind === 'node' ? state.nodes : state.edges;
  return Object.hasOwn(progress, targetId) ? progress[targetId] : 0;
}

/** A11y includes text from fade-in start; opacity affects only pixels. */
export function captionOpacity(timeline: FilmTimeline, sceneIndex: number, second: number): number {
  const cue = timeline.captions[sceneIndex];
  if (!cue) return 0;
  // Match timelinePlaybackAt's half-open scene boundaries: decimal summation
  // can put an authored start slightly after the frame assigned to that shot.
  const tolerance =
    8 * Number.EPSILON * Math.max(1, Math.abs(second), Math.abs(cue.inSec), Math.abs(cue.outSec));
  if (second < cue.inSec - tolerance || second >= cue.outSec - tolerance) return 0;
  const fadeIn = cue.fadeInSec > 0 ? Math.max(0, second - cue.inSec) / cue.fadeInSec : 1;
  const fadeOut = cue.fadeOutSec > 0 ? (cue.outSec - second) / cue.fadeOutSec : 1;
  return clamp(Math.min(1, fadeIn, fadeOut));
}
