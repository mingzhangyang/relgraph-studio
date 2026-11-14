/**
 * Whether a drawing is a timeline is a declared state, not a coincidence of
 * coordinates, and this module is its only definition: the editor, the
 * layout panel, `layoutGraph`, the CLI and the renderer (`styleForDrawing`)
 * all ask `timeAnchor`.
 *
 * A timeline diagram is anchored when
 * - its stored strategy (`project.layout.type`) is `auto` or `timeline`, or
 * - no strategy was applied (`manual`, the default) and the source does not
 *   say `"timeAxis": false`.
 * Every other strategy takes the drawing off the axis. Exporting the
 * positioned source writes that state back (`applyGraphPositions`), so it
 * survives a reload and the CLI.
 *
 * While a drawing is anchored, every dated node's x is its place in time and
 * only its lane (y) is stored and edited: a positioned source writes such a
 * node as `"position": { "y": … }` (`lanedNodes`) and the adapter derives x
 * from its dates (`timeCoordinate`), so a date edit or a rescaled axis
 * leaves no stale x behind. A lock holds a dated node's lane;
 * its x is its date, which is data, not layout. Leaving the anchored state is
 * an explicit act: applying another strategy.
 */
import type { VisualGraph, VisualNode } from '../../types/visual-graph.js';
import {
  placeInTime,
  TIME_TOLERANCE,
  TIMELINE_GAP,
  TIMELINE_LANE,
  timeAxis,
  type TimeAxis,
} from '../graph/time-axis.js';
import { LAYOUT_DEFAULTS } from '../project-layout.js';
import { roundPositionCoordinate, type LayoutPoint } from './seeded-layout.js';

/** The strategies whose drawing of a timeline diagram is on its time axis. */
export const TIME_ANCHORED_TYPES = Object.freeze(['auto', 'timeline'] as const);
type AnchorGraph = Pick<VisualGraph, 'nodes' | 'diagram' | 'project' | 'timeAxis' | 'timeline'>;

/**
 * Whether a source declares that its timeline keeps time: the state a file
 * records in `diagram` and `timeAxis`, with no strategy applied. The adapter
 * reads lane-only positions by this state and `applyGraphPositions` writes
 * them by the state it leaves in the file, so the two cannot disagree.
 */
export function sourceKeepsTime(source: { diagram?: unknown; timeAxis?: unknown }): boolean {
  return source.diagram === 'timeline' && source.timeAxis !== false;
}

/**
 * Whether the drawing of `graph` under strategy `type` (by default the one
 * stored in the project) declares a time axis, before asking whether the
 * graph has dates at all.
 */
function declared(graph: AnchorGraph, type: string): boolean {
  if (graph.diagram !== 'timeline') return false;
  // No strategy applied: the source says, and keeps time unless it says otherwise.
  if (type === 'manual') return sourceKeepsTime(graph);
  return (TIME_ANCHORED_TYPES as readonly string[]).includes(type);
}

/**
 * Whether the drawing of a timeline diagram declares itself on its time axis,
 * whether or not any node has a date yet. This, not the presence of an axis,
 * is the state a positioned source records: a timeline without dates that
 * gains them later must be drawn on its axis.
 */
export function declaresTimeAxis(
  graph: AnchorGraph,
  type: string = graph.project?.layout?.type ?? 'manual',
): boolean {
  return declared(graph, type);
}

/**
 * The time axis a drawing is anchored to, or null when it is not anchored:
 * the graph is not a timeline, has no dates, or is drawn with a strategy that
 * leaves the axis. `type` defaults to the strategy stored in the project.
 */
export function timeAnchor(
  graph: AnchorGraph,
  type: string = graph.project?.layout?.type ?? 'manual',
): TimeAxis | null {
  return declared(graph, type) ? timeAxis(graph.nodes) : null;
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
 * The x a dated node has on `axis`, rounded as stored coordinates are, or
 * null when it has no date: what a lane-only position (`{ "y": … }`) stands for.
 */
export function timeCoordinate(
  node: Pick<VisualNode, 'span' | 'visibility'>,
  axis: TimeAxis,
): number | null {
  return pinned(node, axis);
}

/**
 * The nodes whose stored position is their lane alone: the dated nodes of a
 * timeline that is `anchored` (by default, as declared) and has an axis. On
 * such a drawing x is derived from the dates, so it is not authored data.
 *
 * This is the one rule for both directions: the adapter derives x for exactly
 * these nodes (anchored as the source says, `sourceKeepsTime`), and
 * `applyGraphPositions` writes exactly these as `{ "y": … }` (anchored as the
 * file it writes says). Without an axis, while fewer than two distinct times
 * exist, every dated node stands at one time, so its x is layout, not a date,
 * and is stored; once dates make an axis, that x is reported as off the axis
 * (`OFF_TIME_AXIS`) until the positioned source is exported again.
 */
export function lanedNodes(
  graph: AnchorGraph,
  anchored: boolean = declaresTimeAxis(graph),
): Set<string> {
  if (!anchored || graph.diagram !== 'timeline') return new Set();
  const nodes = graph.nodes,
    axis = timeAxis(nodes);
  return axis
    ? new Set(nodes.filter((node) => placeInTime(node, axis) !== null).map((node) => node.id))
    : new Set();
}

/** Dated nodes as the axis sees them, by id. */
function dated(graph: AnchorGraph): Map<string, Pick<VisualNode, 'id' | 'span' | 'visibility'>> {
  return new Map(graph.nodes.map((node) => [node.id, node]));
}

/**
 * The point a node may be moved to: on an anchored drawing a dated node only
 * changes lane, so its x is its place in time whatever was asked for.
 */
export function anchoredPoint(graph: AnchorGraph, id: string, point: LayoutPoint): LayoutPoint {
  const axis = timeAnchor(graph),
    node = axis ? dated(graph).get(id) : undefined;
  const x = node && axis ? pinned(node, axis, point.x) : null;
  return x === null ? point : { x, y: point.y };
}

/**
 * The nodes among `ids` that an anchored drawing on `axis` would have to move
 * sideways: dated nodes whose x at `positions` is not their place in time.
 */
export function offTime(
  graph: AnchorGraph,
  axis: TimeAxis,
  positions: ReadonlyMap<string, LayoutPoint>,
  ids: Iterable<string>,
): string[] {
  const nodes = dated(graph),
    off: string[] = [];
  for (const id of ids) {
    const node = nodes.get(id),
      p = positions.get(id);
    if (!node || !p) continue;
    const x = pinned(node, axis, p.x);
    if (x !== null && x !== p.x) off.push(id);
  }
  return off;
}

const extentOf = (
  node: Pick<VisualNode, 'span' | 'visibility'>,
  axis: TimeAxis,
): [number, number] => {
  const from = node.span?.from ?? node.visibility!.from!;
  return [from, node.span ? (node.span.to ?? axis.to) : from];
};
/** The height of one lane of a timeline drawn with `spacing`. */
const laneHeight = (spacing: number): number => spacing * TIMELINE_LANE;

/**
 * The dated nodes, other than `fixed` ones, whose bar at `positions` would
 * overlap the bar of a fixed dated node in its lane: a strategy that keeps
 * locks gives them another lane instead of pushing them off their years.
 */
export function crowdedBy(
  graph: AnchorGraph,
  axis: TimeAxis,
  positions: ReadonlyMap<string, LayoutPoint>,
  fixed: ReadonlySet<string>,
  spacing: number = LAYOUT_DEFAULTS.spacing,
): Set<string> {
  const gap = (axis.to - axis.from) * TIMELINE_GAP,
    half = laneHeight(spacing) / 2,
    bars: { id: string; y: number; from: number; to: number }[] = [];
  for (const node of graph.nodes) {
    const p = positions.get(node.id);
    if (!p || placeInTime(node, axis) === null) continue;
    const [from, to] = extentOf(node, axis);
    bars.push({ id: node.id, y: p.y, from, to });
  }
  const held = bars.filter((b) => fixed.has(b.id)),
    crowded = new Set<string>();
  for (const bar of bars)
    if (
      !fixed.has(bar.id) &&
      held.some(
        (b) => Math.abs(b.y - bar.y) < half && !(bar.to + gap <= b.from || b.to + gap <= bar.from),
      )
    )
      crowded.add(bar.id);
  return crowded;
}

export interface AnchorOptions {
  /**
   * Nodes without a lane of their own yet: added after the drawing was saved,
   * or displaced by a lock. Each takes the first lane, top down, where it
   * overlaps nothing, or a new lane below the others.
   */
  unplaced?: ReadonlySet<string>;
  /** The axis to anchor to; by default the graph's own, if it is anchored. */
  axis?: TimeAxis | null;
  /** The spacing the drawing was made with; it sets the height of a new lane. */
  spacing?: number;
}

/**
 * Put every dated node of an anchored drawing at its place in time, in
 * place. Undated nodes and drawings that are not anchored are left alone.
 * Returns whether anything moved.
 */
export function anchorToTime(
  graph: AnchorGraph,
  positions: Map<string, LayoutPoint>,
  {
    unplaced = new Set(),
    axis = timeAnchor(graph),
    spacing = graph.project?.layout?.spacing ?? LAYOUT_DEFAULTS.spacing,
  }: AnchorOptions = {},
): boolean {
  if (!axis) return false;
  let changed = false;
  const nodes = graph.nodes,
    waiting: (typeof nodes)[number][] = [];
  for (const node of nodes) {
    const p = positions.get(node.id);
    if (!p) continue;
    if (unplaced.has(node.id)) {
      if (placeInTime(node, axis) !== null) waiting.push(node);
      continue;
    }
    const x = pinned(node, axis, p.x);
    if (x !== null && x !== p.x) {
      positions.set(node.id, { x, y: p.y });
      changed = true;
    }
  }
  if (!waiting.length) return changed;

  // First fit, earliest first, with the timeline engine's breathing room.
  const extent = (node: Pick<VisualNode, 'span' | 'visibility'>) => extentOf(node, axis);
  const bars: { y: number; from: number; to: number }[] = [];
  for (const node of nodes) {
    const p = positions.get(node.id);
    if (!p || unplaced.has(node.id) || placeInTime(node, axis) === null) continue;
    const [from, to] = extent(node);
    bars.push({ y: p.y, from, to });
  }
  // A new lane is as far below as the drawing's own lanes are apart.
  const lanes = [...new Set(bars.map((b) => b.y))].sort((a, b) => a - b),
    fallback = laneHeight(spacing);
  let height = Infinity;
  for (let i = 1; i < lanes.length; i++) height = Math.min(height, lanes[i] - lanes[i - 1]);
  height = roundPositionCoordinate(
    Number.isFinite(height) ? Math.max(height, fallback / 2) : fallback,
  );
  const gap = (axis.to - axis.from) * TIMELINE_GAP,
    order = new Map(nodes.map((n, i) => [n.id, i]));
  waiting.sort((a, b) => extent(a)[0] - extent(b)[0] || order.get(a.id)! - order.get(b.id)!);
  for (const node of waiting) {
    const [from, to] = extent(node);
    const free = (y: number) =>
      bars.every(
        (b) => Math.abs(b.y - y) >= height / 2 || to + gap <= b.from || b.to + gap <= from,
      );
    let y = lanes.find(free);
    if (y === undefined) {
      y = lanes.length ? roundPositionCoordinate(lanes[lanes.length - 1] + height) : 0;
      lanes.push(y);
    }
    bars.push({ y, from, to });
    positions.set(node.id, { x: pinned(node, axis)!, y });
    changed = true;
  }
  return changed;
}
