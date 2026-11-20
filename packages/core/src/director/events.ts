import { displayNodeText } from '../project.js';
import { frameCount } from './state.js';
import {
  compileTimeline,
  frameAtOrAfter,
  shotSettledSec,
  shotStartFrames,
  type FilmTimeline,
  type RevealCue,
} from './timeline.js';
import type { AuthoredIds, ProjectedVisualGraph, VisualGraph } from '../../types/visual-graph.js';

/**
 * Film events, `relgraph.events/1` (ADR 004, D3): when each shot, caption,
 * reveal and domain-time step happens, on the frames the film is rendered
 * with, so music and other tracks can follow the picture without parsing the
 * graph. Everything is read from `compileTimeline`, which projects each shot
 * before collecting its tracks: an object, highlight or caption appears here
 * only once the film shows it.
 */
export const EVENTS_FORMAT = 'relgraph.events/1';

/** A node the film shows at some point, with the world coordinates it is drawn at. */
export interface EventNode {
  id: string;
  /** As drawn: the project's display copy if it has one, else the node's label. */
  label: string;
  kind: string;
  group: string | null;
  x: number;
  y: number;
}

interface EventBase {
  /** The first frame that shows the event, counted from 0. */
  frame: number;
  /** The event's instant on the timeline, in seconds; `frame` is the first frame at or after it. */
  sec: number;
  /** The shot it belongs to, counted from 0. */
  shot: number;
}

/** A shot begins. */
export interface ShotEvent extends EventBase {
  type: 'shot';
  /** The shot's authored id; null for a derived storyboard or a shot redacted for spoilers. */
  id: string | null;
  title: string;
  /** Last frame of the shot, inclusive; `frame - 1` for a shot shorter than a frame. */
  lastFrame: number;
  frames: number;
  endSec: number;
  /**
   * The first frame after the camera move and the reveals under way at the
   * shot's start (`shotSettledSec`); null when the shot ends before it settles.
   */
  settledFrame: number | null;
  settledSec: number;
  /** The spoiler-safe highlight: only objects the shot shows. */
  highlight: { nodeIds: string[]; edgeIds: string[]; groupId: string | null };
  domainAt: number | null;
  revealStep: number | null;
  /** True when the shot's title, prose and id were withheld because they refer to hidden objects. */
  redacted: boolean;
}

/** A shot's caption begins to fade in; it lasts as long as the shot. Shots without frames have none. */
export interface CaptionEvent extends EventBase {
  type: 'caption';
  /** The shot's id, as in its shot event. */
  id: string | null;
  title: string;
  text: string | null;
  lastFrame: number;
  endSec: number;
  fadeInSec: number;
  fadeOutSec: number;
}

/** A node or relation enters the picture. */
export interface RevealEvent extends EventBase {
  type: 'reveal';
  /** The node's or relation's id. */
  id: string;
  object: 'node' | 'edge';
  kind: string;
  /** A node's group; for a relation, the group both its ends share, else null. */
  group: string | null;
  /** `none` for what the first shot shows outright. */
  effect: RevealCue['effect'] | 'none';
  /** How long the fade or draw-on takes; 0 for `none`. */
  durationSec: number;
  /** A relation's ends. */
  source?: string;
  target?: string;
  /** When a later shot's projection withdraws the object again (domain time going back). */
  outFrame?: number;
  outSec?: number;
}

/** Domain time is first set, or changes from what the previous frames showed. */
export interface DomainTimeEvent extends EventBase {
  type: 'domain-time';
  /** The shot's id, as in its shot event. */
  id: string | null;
  value: number | null;
  previous: number | null;
  /** The graph's unit of domain time, as authored. */
  unit?: string;
}

export type FilmEvent = ShotEvent | CaptionEvent | RevealEvent | DomainTimeEvent;

export interface FilmEvents {
  format: typeof EVENTS_FORMAT;
  fps: number;
  /** Frames of the whole film, `frameCount(graph, fps)`. */
  frameCount: number;
  durationSec: number;
  /** Every node a frame of the film shows, in document order. */
  nodes: EventNode[];
  /**
   * By frame, then shot; within a shot its start, domain time, caption and
   * reveals (nodes before relations, in document order).
   */
  events: FilmEvent[];
}

/** Seconds to the microsecond: summed decimal durations print as 7, not 6.999999999999999. */
const seconds = (value: number): number => Math.round(value * 1e6) / 1e6 || 0;

const TYPE_ORDER: Record<FilmEvent['type'], number> = {
  shot: 0,
  'domain-time': 1,
  caption: 2,
  reveal: 3,
};

type View = Pick<ProjectedVisualGraph, 'nodes' | 'edges'>;

export interface FilmEventsOptions {
  /** The compiled timeline of `graph` at `fps`, to reuse it. */
  timeline?: FilmTimeline;
  /**
   * The source's own ids (`LoadResult.authoredIds`): every id in the events
   * is written as the source writes it, so they can be read against that file.
   */
  authoredIds?: AuthoredIds;
}

/**
 * The events of the film `graph` renders at `fps`, with the node positions
 * the renderer draws (`layoutGraph(graph)`). A pure function of its inputs.
 */
export function filmEvents(
  graph: VisualGraph,
  positions: ReadonlyMap<string, { x: number; y: number }>,
  fps = 24,
  { timeline = compileTimeline(graph, fps), authoredIds }: FilmEventsOptions = {},
): FilmEvents {
  const authored =
    (kind: keyof AuthoredIds) =>
    (id: string): string =>
      authoredIds?.[kind].get(id) ?? id;
  const nodeId = authored('nodes'),
    edgeId = authored('edges'),
    groupId = authored('groups'),
    sceneId = authored('scenes');
  const groupOrNull = (id: string | null | undefined): string | null =>
    id === null || id === undefined ? null : groupId(id);
  if (timeline.fps !== fps) throw new RangeError('Timeline FPS mismatch');
  const total = frameCount(graph, fps);
  const { shots } = timeline;
  const starts = shotStartFrames(timeline);
  const lastFrameOf = (index: number): number =>
    index === shots.length - 1 ? total - 1 : starts[index + 1] - 1;
  const settled = shotSettledSec(timeline);
  // Cues start and stop at shot starts; find the shot by its exact start.
  const shotStarting = new Map<number, number>();
  for (const [index, shot] of shots.entries())
    if (!shotStarting.has(shot.startSec)) shotStarting.set(shot.startSec, index);
  const shotAt = (second: number): number => {
    const index = shotStarting.get(second);
    if (index === undefined) throw new Error('A reveal cue does not start at a shot boundary');
    return index;
  };

  // Everything a shot shows, in document order, as the projection gives it.
  // A shot shorter than a frame is never on screen (`frames: 0`): it keeps
  // its shot event, but what only it would show is not an event.
  const onScreen = shots.map((_, index) => lastFrameOf(index) >= starts[index]);
  const shown = new Map<string, ProjectedVisualGraph['nodes'][number]>();
  for (const [index, shot] of shots.entries())
    if (onScreen[index]) for (const node of shot.view.nodes) shown.set(node.id, node);
  const nodes: EventNode[] = graph.nodes.flatMap((source) => {
    const node = shown.get(source.id);
    if (!node) return [];
    const point = positions.get(node.id);
    if (!point) throw new Error(`Missing position for node ${node.id}`);
    return [
      {
        id: nodeId(node.id),
        label: displayNodeText(graph.project, node.id)?.label ?? node.label,
        kind: node.kind,
        group: groupOrNull(node.groupId),
        x: point.x,
        y: point.y,
      },
    ];
  });
  const groupOf = new Map([...shown.values()].map((node) => [node.id, node.groupId ?? null]));

  const events: FilmEvent[] = [];
  const shotId = (index: number): string | null => {
    const id = shots[index].scene.id;
    return id === undefined ? null : sceneId(id);
  };
  let previousDomainAt: number | null = null;
  for (const [index, shot] of shots.entries()) {
    const frame = starts[index],
      lastFrame = lastFrameOf(index);
    const settledFrame = Math.max(frame, frameAtOrAfter(settled[index], fps));
    const highlight = timeline.highlight[index].value;
    events.push({
      frame,
      sec: seconds(shot.startSec),
      shot: index,
      type: 'shot',
      id: shotId(index),
      title: shot.scene.title,
      lastFrame,
      frames: Math.max(0, lastFrame - frame + 1),
      endSec: seconds(shot.endSec),
      settledFrame: settledFrame <= lastFrame ? settledFrame : null,
      settledSec: seconds(settled[index]),
      highlight: {
        nodeIds: highlight.nodeIds.map(nodeId),
        edgeIds: highlight.edgeIds.map(edgeId),
        groupId: groupOrNull(highlight.groupId),
      },
      domainAt: shot.domainAt,
      revealStep: shot.revealStep,
      redacted: shot.scene.redacted,
    });
    if (!onScreen[index]) continue;
    if (shot.domainAt !== previousDomainAt) {
      events.push({
        frame,
        sec: seconds(shot.startSec),
        shot: index,
        type: 'domain-time',
        id: shotId(index),
        value: shot.domainAt,
        previous: previousDomainAt,
        ...(graph.timeline?.unit !== undefined ? { unit: graph.timeline.unit } : {}),
      });
      previousDomainAt = shot.domainAt;
    }
    const caption = timeline.captions[index];
    events.push({
      frame,
      sec: seconds(caption.inSec),
      shot: index,
      type: 'caption',
      id: shotId(index),
      title: caption.title ?? shot.scene.title,
      text: caption.text ?? null,
      lastFrame,
      endSec: seconds(caption.outSec),
      fadeInSec: seconds(caption.fadeInSec),
      fadeOutSec: seconds(caption.fadeOutSec),
    });
  }

  const reveal = (
    object: 'node' | 'edge',
    item: View['nodes'][number] | View['edges'][number],
    shot: number,
    effect: RevealEvent['effect'],
    durationSec: number,
    out: number | undefined,
  ): RevealEvent => {
    const edge = object === 'edge' ? (item as View['edges'][number]) : null;
    const group = groupOrNull(
      edge
        ? groupOf.get(edge.source) === groupOf.get(edge.target)
          ? groupOf.get(edge.source)
          : null
        : (item as View['nodes'][number]).groupId,
    );
    return {
      frame: starts[shot],
      sec: seconds(shots[shot].startSec),
      shot,
      type: 'reveal',
      id: object === 'node' ? nodeId(item.id) : edgeId(item.id),
      object,
      kind: item.kind,
      group,
      effect,
      durationSec: seconds(durationSec),
      ...(edge ? { source: nodeId(edge.source), target: nodeId(edge.target) } : {}),
      ...(out === undefined ? {} : { outFrame: starts[out], outSec: seconds(shots[out].startSec) }),
    };
  };
  // What the first shot shows needs no cue: it is there from frame 0. It stays
  // until a later projection withdraws it, as cues end in compileTimeline.
  if (shots.length) {
    const first = shots[0].view;
    const withdrawn = (object: 'node' | 'edge', id: string): number | undefined => {
      const index = shots.findIndex((shot) =>
        (object === 'node' ? shot.view.nodes : shot.view.edges).every((item) => item.id !== id),
      );
      return index < 0 ? undefined : index;
    };
    for (const [object, items] of [
      ['node', first.nodes],
      ['edge', first.edges],
    ] as const)
      for (const item of items) {
        const out = withdrawn(object, item.id);
        if (out === undefined || starts[out] > 0)
          events.push(reveal(object, item, 0, 'none', 0, out));
      }
  }
  // compileTimeline lists a shot's node cues before its relation cues.
  for (const cue of timeline.reveal) {
    const shot = shotAt(cue.inSec);
    const out = cue.outSec === undefined ? undefined : shotAt(cue.outSec);
    // Revealed and withdrawn before a frame shows it.
    if (out !== undefined && starts[out] <= starts[shot]) continue;
    const view = shots[shot].view;
    const item =
      cue.kind === 'node'
        ? view.nodes.find((node) => node.id === cue.targetId)
        : view.edges.find((edge) => edge.id === cue.targetId);
    if (!item) throw new Error(`Reveal cue for ${cue.targetId} outside its shot's projection`);
    events.push(reveal(cue.kind, item, shot, cue.effect, cue.durationSec, out));
  }

  // A stable sort keeps document and cue order within one frame and type.
  events.sort(
    (a, b) => a.frame - b.frame || a.shot - b.shot || TYPE_ORDER[a.type] - TYPE_ORDER[b.type],
  );
  return {
    format: EVENTS_FORMAT,
    fps,
    frameCount: total,
    durationSec: seconds(timeline.durationSec),
    nodes,
    events,
  };
}

/** The file text: two-space JSON with a final newline, identical for identical inputs. */
export const formatFilmEvents = (events: FilmEvents): string =>
  JSON.stringify(events, null, 2) + '\n';
