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
  inSec: number;
  /** First instant the object is no longer projected, if any. */
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
 * tracks are collected. A reveal cue is created only for an object absent
 * from the previous projection, never by observing previous rendered frames.
 * If domain time moves backward, disappearing objects simply leave the
 * projection; a later reappearance starts a new cue.
 */
export function compileTimeline(graph: VisualGraph, fps = 24): FilmTimeline {
  if (!Number.isFinite(fps) || fps <= 0) throw new RangeError('Invalid timeline fps');
  const camera: CameraKeyframe[] = [];
  const highlight: Keyframe<ResolvedHighlight>[] = [];
  const domainTime: Keyframe<number | null>[] = [];
  const reveal: RevealCue[] = [];
  const captions: CaptionCue[] = [];
  const shots: CompiledShot[] = [];
  let startSec = 0;
  let correction = 0;
  let inheritedDomainAt: number | null = null;
  let previousNodes = new Set<string>();
  let previousEdges = new Set<string>();

  for (const [index, source] of graph.scenes.entries()) {
    // The same compensated summation and boundary tolerance as sceneAtSecond.
    const adjusted = source.durationSec - correction;
    const endSec = startSec + adjusted;
    correction = endSec - startSec - adjusted;
    if (source.domainAt !== undefined) inheritedDomainAt = source.domainAt;
    // This shot and its inherited domain time are already known; do not call
    // sceneAtSecond for each shot (it would rebuild the full prefix sums).
    const state = projectFrameScene(graph, source, index, inheritedDomainAt);
    const scene = state.scene;
    if (!scene) throw new Error('Unable to compile a presentation shot');
    const shot: CompiledShot = {
      startSec,
      endSec,
      domainAt: inheritedDomainAt,
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

    const nextNodes = new Set(state.view.nodes.map((node) => node.id));
    const nextEdges = new Set(state.view.edges.map((edge) => edge.id));
    // A prior cue must stop immediately when the domain projection withdraws
    // its object; no fade-out is produced, even on backward time jumps.
    for (const cue of reveal) {
      if (cue.outSec !== undefined) continue;
      const visible = cue.kind === 'node' ? nextNodes : nextEdges;
      if (!visible.has(cue.targetId)) cue.outSec = startSec;
    }
    if (index > 0) {
      for (const id of nextNodes) {
        if (!previousNodes.has(id))
          reveal.push({
            targetId: id,
            kind: 'node',
            inSec: startSec,
            durationSec: NODE_REVEAL_SEC,
            effect: 'fade',
          });
      }
      for (const id of nextEdges) {
        if (!previousEdges.has(id))
          reveal.push({
            targetId: id,
            kind: 'edge',
            inSec: startSec,
            durationSec: EDGE_REVEAL_SEC,
            effect: 'draw',
          });
      }
    }
    previousNodes = nextNodes;
    previousEdges = nextEdges;
    startSec = endSec;
  }
  // The film ends on its last caption at full opacity instead of fading it
  // away on the final frames.
  const last = captions.at(-1);
  if (last) last.fadeOutSec = 0;
  return {
    fps,
    durationSec: startSec,
    camera,
    highlight,
    domainTime,
    reveal,
    captions,
    shots,
  };
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
      totalSec: 0,
      startSec: 0,
    };
  const time = Math.max(0, Math.min(Number.isFinite(second) ? second : 0, durationSec));
  for (const [index, shot] of shots.entries()) {
    const tolerance = 8 * Number.EPSILON * Math.max(1, Math.abs(time), Math.abs(shot.endSec));
    if (time < shot.endSec - tolerance || index === shots.length - 1) {
      const elapsedSec = Math.max(0, Math.min(shot.scene.durationSec, time - shot.startSec));
      return {
        scene: shot.scene,
        index,
        elapsedSec,
        progress: clamp(elapsedSec / shot.scene.durationSec),
        domainAt: timeline.domainTime[index].value,
        totalSec: durationSec,
        startSec: shot.startSec,
      };
    }
  }
  throw new Error('Unable to evaluate timeline shot');
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
