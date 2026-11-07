import { frameStateAt } from '../graph/core.js';
import { captionOpacity, compileTimeline, revealProgress, timelinePlaybackAt } from './timeline.js';
import type { Timeline } from './timeline.js';
import type {
  DirectorFrameState,
  FrameState,
  ProjectedVisualGraph,
  ResolvedHighlight,
  VisualCamera,
  VisualGraph,
} from '../../types/visual-graph.js';

type Position = { x: number; y: number };

/**
 * Half extents of the area the camera frames nodes into, in reference pixels
 * of the 1280×720 design (renderers multiply by their frame's type scale).
 * Core stays independent of the renderer's FrameSpec and receives only this.
 */
export interface CameraFit {
  halfWidth: number;
  halfHeight: number;
}
export interface DirectorFrameOptions {
  fit?: CameraFit;
  /** A compiled timeline reused for random-access frames; never mutated. */
  timeline?: Timeline;
}
export const DEFAULT_CAMERA_FIT: Readonly<CameraFit> = Object.freeze({
  halfWidth: 550,
  halfHeight: 195,
});

const clamp = (n: number, min = 0, max = 1): number => Math.max(min, Math.min(max, n));
const ease = (t: number): number => {
  const x = clamp(t);
  return x * x * (3 - 2 * x);
};
const mix = (a: number, b: number, t: number): number => a * (1 - t) + b * t;

function cameraFor(
  view: ProjectedVisualGraph,
  spec: VisualCamera,
  positions: ReadonlyMap<string, Position>,
  highlight: ResolvedHighlight,
  fit: CameraFit,
): { x: number; y: number; scale: number } {
  const visible = new Set(view.nodes.map((node) => node.id));
  const requested = spec.focusNodeId ? [spec.focusNodeId] : spec.fitIds || [];
  const selected = requested.filter((id) => visible.has(id));
  const ids = selected.length ? selected : view.nodes.map((node) => node.id);
  const points = ids.map((id) => positions.get(id)).filter((p): p is Position => Boolean(p));
  if (!points.length) return { x: 0, y: 0, scale: 1 };
  const minX = Math.min(...points.map((p) => p.x)),
    maxX = Math.max(...points.map((p) => p.x));
  const minY = Math.min(...points.map((p) => p.y)),
    maxY = Math.max(...points.map((p) => p.y));
  // The fit extents describe the frame's graph safe area.
  // Single-node shots include context instead of zooming into a microscopic point.
  // Half-spans avoid overflow for valid, very large finite coordinates.
  const halfWidth = Math.max(selected.length === 1 ? 350 : 140, maxX / 2 - minX / 2 + 125);
  const halfHeight = Math.max(selected.length === 1 ? 225 : 110, maxY / 2 - minY / 2 + 90);
  const x = minX / 2 + maxX / 2,
    y = minY / 2 + maxY / 2;
  let scale = Math.min(fit.halfWidth / halfWidth, fit.halfHeight / halfHeight) * (spec.zoom || 1);
  // A focus shot should not clip other explicitly highlighted nodes. Preserve
  // its center and reduce zoom only as much as the safe area requires.
  if (spec.focusNodeId && selected.length) {
    const focused = (highlight?.nodeIds || [])
      .filter((id) => visible.has(id))
      .map((id) => positions.get(id))
      .filter((p): p is Position => Boolean(p));
    if (focused.length) {
      const halfDx = Math.max(...focused.map((p) => Math.abs(p.x / 2 - x / 2))),
        halfDy = Math.max(...focused.map((p) => Math.abs(p.y / 2 - y / 2)));
      scale = Math.min(
        scale,
        fit.halfWidth / 2 / (halfDx + 40),
        fit.halfHeight / 2 / (halfDy + 35),
      );
    }
  }
  // Do not clamp away a necessary zoom-out for widely separated coordinates.
  return { x, y, scale: clamp(scale, Number.MIN_VALUE, 1.6) };
}

/** Every value comes from the requested frame and its compiled, projected tracks. */
export function directorFrameAt(
  graph: VisualGraph,
  positions: ReadonlyMap<string, Position>,
  frame: number,
  fps = 24,
  { fit = DEFAULT_CAMERA_FIT, timeline: suppliedTimeline }: DirectorFrameOptions = {},
): DirectorFrameState {
  if (!Number.isInteger(frame) || frame < 0 || !Number.isFinite(fps) || fps <= 0)
    throw new RangeError('Invalid frame or fps');
  const timeline = suppliedTimeline ?? compileTimeline(graph, fps);
  if (timeline.fps !== fps) throw new RangeError('Timeline FPS mismatch');
  const playback = timelinePlaybackAt(timeline, frame / fps);
  const shot = timeline.shots[playback.index];
  // Empty graphs have no authored presentation, but retain the legacy
  // renderer-neutral projection behavior.
  const fallback = shot ? null : frameStateAt(graph, frame, fps);
  const view = shot?.view ?? fallback?.view;
  if (!view) throw new Error('Unable to resolve frame projection');
  const cameraSpec = timeline.camera[playback.index]?.value ?? fallback?.camera ?? {};
  const highlight = timeline.highlight[playback.index]?.value ?? fallback?.highlight ?? {
    nodeIds: [],
    edgeIds: [],
    groupId: null,
  };
  const state: FrameState = {
    playback,
    view,
    camera: cameraSpec,
    highlight,
    overlay: shot?.overlay ?? fallback?.overlay ?? null,
  };
  const target = cameraFor(view, cameraSpec, positions, highlight, fit);
  let camera = target,
    transition = 1;
  let previousHighlight: ResolvedHighlight = { nodeIds: [], edgeIds: [], groupId: null };
  if (playback.index > 0 && playback.scene) {
    // The previous target is restricted to CURRENT visible IDs, so a domain
    // time reversal never targets or highlights a now-hidden future object.
    const tolerance = 8 * Number.EPSILON * Math.max(1, Math.abs(playback.startSec));
    const previousFrame = Math.max(
      0,
      Math.min(frame - 1, Math.ceil((playback.startSec - tolerance) * fps) - 1),
    );
    const previousPlayback = timelinePlaybackAt(timeline, previousFrame / fps);
    const previousShot = timeline.shots[previousPlayback.index];
    if (!previousShot) throw new Error('Missing previous compiled shot');
    const nodeIds = new Set(view.nodes.map((node) => node.id)),
      edgeIds = new Set(view.edges.map((edge) => edge.id)),
      groupIds = new Set(view.groups.map((group) => group.id));
    const priorHighlight = timeline.highlight[previousPlayback.index].value;
    const previousGroupId = priorHighlight.groupId;
    previousHighlight = {
      nodeIds: priorHighlight.nodeIds.filter((id) => nodeIds.has(id)),
      edgeIds: priorHighlight.edgeIds.filter((id) => edgeIds.has(id)),
      groupId: previousGroupId !== null && groupIds.has(previousGroupId) ? previousGroupId : null,
    };
    const previousView = {
      ...previousShot.view,
      nodes: previousShot.view.nodes.filter((node) => nodeIds.has(node.id)),
      edges: previousShot.view.edges.filter((edge) => edgeIds.has(edge.id)),
      groups: previousShot.view.groups.filter((group) => groupIds.has(group.id)),
    };
    const from = cameraFor(
      previousView,
      timeline.camera[previousPlayback.index].value,
      positions,
      previousHighlight,
      fit,
    );
    const duration = timeline.camera[playback.index].transitionSec;
    transition = duration <= 0 ? 1 : ease(playback.elapsedSec / duration);
    camera = {
      x: mix(from.x, target.x, transition),
      y: mix(from.y, target.y, transition),
      scale: mix(from.scale, target.scale, transition),
    };
  }
  const second = frame / fps;
  const reveal = {
    nodes: Object.fromEntries(
      view.nodes.map((node) => [node.id, revealProgress(timeline, 'node', node.id, second)]),
    ),
    edges: Object.fromEntries(
      view.edges.map((edge) => [edge.id, revealProgress(timeline, 'edge', edge.id, second)]),
    ),
  };
  return {
    ...state,
    cameraResolved: camera,
    transition,
    previousHighlight,
    reveal,
    captionOpacity: captionOpacity(timeline, playback.index, second),
  };
}

export function frameCount(graph: VisualGraph, fps = 24): number {
  return Math.max(
    1,
    Math.ceil(graph.scenes.reduce((sum, scene) => sum + scene.durationSec, 0) * fps - 1e-9),
  );
}
