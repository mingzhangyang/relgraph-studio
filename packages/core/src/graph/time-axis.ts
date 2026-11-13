/**
 * The time axis of a graph: how the domain time its nodes carry maps to
 * world x. The timeline engine, the anchoring of a saved timeline
 * (`director/time-anchor.ts`), the generic adapter and the renderer's styles
 * all read it here, so they agree; it imports no engine.
 */
import type { VisualNode } from '../../types/visual-graph.js';

/**
 * A timeline's lane height, as a share of the spacing, and the breathing room
 * between two spans in one lane, as a share of the axis. The timeline engine
 * and the anchoring of a saved timeline (`time-anchor.ts`) share them.
 */
export const TIMELINE_LANE = 0.42;
export const TIMELINE_GAP = 0.012;

/** How domain time maps to world coordinates in a timeline. */
export interface TimeAxis {
  from: number;
  to: number;
  /** World units per unit of domain time. */
  scale: number;
  /** World x of a domain time. */
  x(time: number): number;
}
/**
 * The time axis of a graph whose nodes carry a span or a first appearance.
 * It depends on the nodes alone, so the layout that places them and the
 * renderer that draws their extent and the axis always agree.
 */
export function timeAxis(nodes: readonly VisualNode[]): TimeAxis | null {
  let from = Infinity,
    to = -Infinity,
    count = 0;
  for (const node of nodes) {
    const start = node.span?.from ?? node.visibility?.from;
    if (start === undefined || !Number.isFinite(start)) continue;
    count++;
    from = Math.min(from, start);
    to = Math.max(
      to,
      start,
      node.span?.to !== undefined && Number.isFinite(node.span.to) ? node.span.to : start,
    );
  }
  if (!count || !(to > from)) return null;
  const width = Math.min(5200, Math.max(1400, count * 170)),
    scale = width / (to - from);
  return { from, to, scale, x: (time) => (time - from) * scale - width / 2 };
}

/**
 * Where a dated node sits along the axis: the middle of its span, or its
 * first appearance when that is all it has. A node without a time has no
 * place on the axis.
 */
export function placeInTime(
  node: Pick<VisualNode, 'span' | 'visibility'>,
  axis: Pick<TimeAxis, 'from' | 'to' | 'scale'>,
): number | null {
  const from = node.span?.from ?? node.visibility?.from;
  if (from === undefined || !Number.isFinite(from)) return null;
  // A span without an end is still going on.
  const to = node.span === undefined ? from : (node.span.to ?? axis.to);
  return ((from + to) / 2 - (axis.from + axis.to) / 2) * axis.scale;
}

/** How far, in world units, a stored x may lie from its place in time and still keep time. */
export const TIME_TOLERANCE = 0.02;

/**
 * Whether a drawing keeps time: every dated node sits at its place on the
 * axis, to the precision coordinates are stored with. The timeline engine
 * always does, and so does its result once written to a file. A drawing
 * that was rearranged, by hand or by another engine, does not, and must not
 * be shown with an axis: its rules and bars would point at the wrong years.
 */
export function keepsTime(
  nodes: readonly Pick<VisualNode, 'id' | 'span' | 'visibility'>[],
  positions: ReadonlyMap<string, { x: number; y: number }>,
  axis: Pick<TimeAxis, 'from' | 'to' | 'scale'>,
): boolean {
  for (const node of nodes) {
    const x = placeInTime(node, axis),
      p = positions.get(node.id);
    if (x === null || !p) continue;
    if (!(Math.abs(p.x - x) <= TIME_TOLERANCE)) return false;
  }
  return true;
}
