/**
 * Whether a drawing keeps time in order along x (ADR 004, D2a): of two nodes
 * whose times differ by at least a tolerance, the earlier must not be drawn
 * to the right of the later. Camera-independent, so it reads the stored
 * layout, not a frame.
 */
import type { VisualGraph } from '../../types/visual-graph.js';

export interface ChronologyInversion {
  earlier: string;
  later: string;
  /** How far apart their times are, in the graph's domain unit. */
  gap: number;
}

/**
 * A node's time: the mean first appearance (`visibility.from`) of its timed
 * relations, which says when it was in contact; without any, the start of its
 * own span or its own first appearance. Nodes with none of these have no time.
 */
export function nodeTimes(graph: Pick<VisualGraph, 'nodes' | 'edges'>): Map<string, number> {
  const sums = new Map<string, { total: number; count: number }>();
  const add = (id: string, at: number): void => {
    const entry = sums.get(id) ?? { total: 0, count: 0 };
    entry.total += at;
    entry.count += 1;
    sums.set(id, entry);
  };
  for (const edge of graph.edges) {
    const at = edge.visibility?.from;
    if (at === undefined) continue;
    add(edge.source, at);
    if (edge.target !== edge.source) add(edge.target, at);
  }
  const times = new Map<string, number>();
  for (const node of graph.nodes) {
    const related = sums.get(node.id);
    const own = node.span?.from ?? node.visibility?.from;
    if (related) times.set(node.id, related.total / related.count);
    else if (own !== undefined) times.set(node.id, own);
  }
  return times;
}

/** Pairs drawn against time: the earlier node at or to the right of the later. */
export function chronologyInversions(
  graph: Pick<VisualGraph, 'nodes' | 'edges'>,
  positions: ReadonlyMap<string, { x: number; y: number }>,
  tolerance: number,
): ChronologyInversion[] {
  if (!(Number.isFinite(tolerance) && tolerance >= 0))
    throw new RangeError('Chronology tolerance must be a finite number ≥ 0');
  const times = nodeTimes(graph);
  const timed = [...times.keys()]
    .filter((id) => positions.has(id))
    .sort((a, b) => (a < b ? -1 : a > b ? 1 : 0));
  const inversions: ChronologyInversion[] = [];
  for (let i = 0; i < timed.length; i += 1)
    for (let j = i + 1; j < timed.length; j += 1) {
      const [a, b] = [timed[i], timed[j]];
      const ta = times.get(a)!,
        tb = times.get(b)!;
      if (Math.abs(ta - tb) < tolerance || ta === tb) continue;
      const [earlier, later] = ta < tb ? [a, b] : [b, a];
      if (positions.get(earlier)!.x >= positions.get(later)!.x)
        inversions.push({ earlier, later, gap: Math.abs(ta - tb) });
    }
  return inversions;
}
