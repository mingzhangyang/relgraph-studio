import { frameStateAt } from '../graph/core.js';
import type {
  DirectorFrameState,
  ProjectedVisualGraph,
  ResolvedHighlight,
  VisualCamera,
  VisualGraph,
} from '../../types/visual-graph.js';

type Position = { x: number; y: number };
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
  // Graph area is between the fixed title and subtitle bands of a 1280x720 frame.
  // Single-node shots include context instead of zooming into a microscopic point.
  // Half-spans avoid overflow for valid, very large finite coordinates.
  const halfWidth = Math.max(selected.length === 1 ? 350 : 140, maxX / 2 - minX / 2 + 125);
  const halfHeight = Math.max(selected.length === 1 ? 225 : 110, maxY / 2 - minY / 2 + 90);
  const x = minX / 2 + maxX / 2,
    y = minY / 2 + maxY / 2;
  let scale = Math.min(550 / halfWidth, 195 / halfHeight) * (spec.zoom || 1);
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
      scale = Math.min(scale, 275 / (halfDx + 40), 97.5 / (halfDy + 35));
    }
  }
  // Do not clamp away a necessary zoom-out for widely separated coordinates.
  return { x, y, scale: clamp(scale, Number.MIN_VALUE, 1.6) };
}

/** All transition values come from the requested frame, never previous draws. */
export function directorFrameAt(
  graph: VisualGraph,
  positions: ReadonlyMap<string, Position>,
  frame: number,
  fps = 24,
): DirectorFrameState {
  const state = frameStateAt(graph, frame, fps);
  const { playback, view } = state;
  const target = cameraFor(view, state.camera, positions, state.highlight);
  let camera = target,
    transition = 1;
  let previousHighlight: ResolvedHighlight = { nodeIds: [], edgeIds: [], groupId: null };
  if (playback.index > 0 && playback.scene) {
    // Restrict even the previous target to the current view: backward domain
    // jumps cannot aim a camera at a now-hidden future object.
    // sceneAtSecond compares boundaries with this same floating-point
    // tolerance. Pick the last frame strictly before that effective boundary.
    const tolerance = 8 * Number.EPSILON * Math.max(1, Math.abs(playback.startSec));
    const previousFrame = Math.max(
      0,
      Math.min(frame - 1, Math.ceil((playback.startSec - tolerance) * fps) - 1),
    );
    const previous = frameStateAt(graph, previousFrame, fps);
    const nodeIds = new Set(view.nodes.map((node) => node.id)),
      edgeIds = new Set(view.edges.map((edge) => edge.id)),
      groupIds = new Set(view.groups.map((group) => group.id));
    const previousGroupId = previous.highlight.groupId;
    previousHighlight = {
      nodeIds: previous.highlight.nodeIds.filter((id) => nodeIds.has(id)),
      edgeIds: previous.highlight.edgeIds.filter((id) => edgeIds.has(id)),
      groupId: previousGroupId !== null && groupIds.has(previousGroupId) ? previousGroupId : null,
    };
    const previousView = {
      ...previous.view,
      nodes: previous.view.nodes.filter((node) => nodeIds.has(node.id)),
      edges: previous.view.edges.filter((edge) => edgeIds.has(edge.id)),
      groups: previous.view.groups.filter((group) => groupIds.has(group.id)),
    };
    const from = cameraFor(previousView, previous.camera, positions, previousHighlight);
    const duration = Math.min(
      (playback.scene?.transitionMs ?? 1200) / 1000,
      playback.scene.durationSec,
    );
    transition = duration <= 0 ? 1 : ease(playback.elapsedSec / duration);
    camera = {
      x: mix(from.x, target.x, transition),
      y: mix(from.y, target.y, transition),
      scale: mix(from.scale, target.scale, transition),
    };
  }
  return { ...state, cameraResolved: camera, transition, previousHighlight };
}

export function frameCount(graph: VisualGraph, fps = 24): number {
  return Math.max(
    1,
    Math.ceil(graph.scenes.reduce((sum, scene) => sum + scene.durationSec, 0) * fps - 1e-9),
  );
}
