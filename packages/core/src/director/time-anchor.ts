/**
 * Whether a drawing is a timeline is a declared state, not a coincidence of
 * coordinates. While a timeline diagram is drawn with a strategy that keeps
 * or asks for time (`manual`, `auto`, `timeline`), every dated node's x is
 * its place in time and only its lane (y) is stored and edited. Leaving that
 * state is an explicit act: applying another strategy.
 */
import type { VisualGraph, VisualNode } from '../../types/visual-graph.js';
import {
  LAYOUT_DEFAULTS,
  placeInTime,
  TIME_TOLERANCE,
  timeAxis,
  type EnginePoint,
  type TimeAxis,
} from './layout-engines.js';
import { roundPositionCoordinate } from './seeded-layout.js';

/** The strategies whose drawing of a timeline diagram stays on its time axis. */
export const TIME_ANCHORED_TYPES = Object.freeze(['manual', 'auto', 'timeline'] as const);
type AnchorGraph = Pick<VisualGraph, 'nodes' | 'diagram' | 'project'>;

/**
 * The time axis a drawing is anchored to, or null when it is not anchored:
 * the graph is not a timeline, has no dates, or was rearranged by another
 * strategy. `type` defaults to the strategy stored in the project.
 */
export function timeAnchor(
  graph: AnchorGraph,
  type: string = graph.project?.layout?.type ?? 'manual',
): TimeAxis | null {
  if (graph.diagram !== 'timeline' || !(TIME_ANCHORED_TYPES as readonly string[]).includes(type))
    return null;
  return timeAxis(graph.nodes);
}

/** Where an anchored node's x must be, rounded as stored coordinates are; null if undated. */
function pinned(
  node: Pick<VisualNode, 'span' | 'visibility'>,
  axis: TimeAxis,
  x?: number,
): number | null {
  const exact = placeInTime(node, axis);
  if (exact === null) return null;
  // A coordinate already in time stays exactly as authored.
  if (x !== undefined && Math.abs(x - exact) <= TIME_TOLERANCE) return x;
  return roundPositionCoordinate(exact) || 0;
}

/**
 * The point a node may be moved to: on an anchored drawing a dated node only
 * changes lane, so its x is its place in time whatever was asked for.
 */
export function anchoredPoint(graph: AnchorGraph, id: string, point: EnginePoint): EnginePoint {
  const axis = timeAnchor(graph),
    node = axis ? graph.nodes.find((n) => n.id === id) : undefined;
  const x = node && axis ? pinned(node, axis, point.x) : null;
  return x === null ? point : { x, y: point.y };
}

/**
 * Put every dated node of an anchored drawing at its place in time, in
 * place. Nodes listed in `unplaced` have no lane of their own yet (they were
 * added after the drawing was saved): each takes the first lane, top down,
 * where it overlaps nothing, or a new lane below the others. Undated nodes
 * and drawings that are not anchored are left alone. Returns whether
 * anything moved.
 */
export function anchorToTime(
  graph: AnchorGraph,
  positions: Map<string, EnginePoint>,
  unplaced: ReadonlySet<string> = new Set(),
  axis: TimeAxis | null = timeAnchor(graph),
): boolean {
  if (!axis) return false;
  let changed = false;
  const extent = (node: Pick<VisualNode, 'span' | 'visibility'>): [number, number] => {
    const from = node.span?.from ?? node.visibility!.from!;
    return [from, node.span ? (node.span.to ?? axis.to) : from];
  };
  const lanes = new Map<number, [number, number][]>(),
    waiting: VisualNode[] = [];
  for (const node of graph.nodes) {
    const p = positions.get(node.id);
    if (!p) continue;
    if (unplaced.has(node.id)) {
      if (placeInTime(node, axis) !== null) waiting.push(node);
      continue;
    }
    const x = pinned(node, axis, p.x);
    if (x === null) continue;
    if (x !== p.x) {
      positions.set(node.id, { x, y: p.y });
      changed = true;
    }
    lanes.set(p.y, [...(lanes.get(p.y) ?? []), extent(node)]);
  }
  // First fit, earliest first, with the timeline engine's breathing room and lane height.
  const gap = (axis.to - axis.from) * 0.012,
    height = roundPositionCoordinate(LAYOUT_DEFAULTS.spacing * 0.42);
  const order = new Map(graph.nodes.map((n, i) => [n.id, i]));
  waiting.sort((a, b) => extent(a)[0] - extent(b)[0] || order.get(a.id)! - order.get(b.id)!);
  for (const node of waiting) {
    const [from, to] = extent(node),
      ys = [...lanes.keys()].sort((a, b) => a - b);
    let y = ys.find((lane) => lanes.get(lane)!.every(([a, b]) => to + gap <= a || b + gap <= from));
    if (y === undefined) y = ys.length ? roundPositionCoordinate(ys[ys.length - 1] + height) : 0;
    lanes.set(y, [...(lanes.get(y) ?? []), [from, to]]);
    positions.set(node.id, { x: pinned(node, axis)!, y });
    changed = true;
  }
  return changed;
}
