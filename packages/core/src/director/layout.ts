import type { VisualGraph } from '../../types/visual-graph.js';

type Position = { x: number; y: number };

/** Stable layout prepared once per document, never advanced by playback. */
export function layoutGraph(
  graph: Pick<VisualGraph, 'nodes' | 'edges' | 'project'>,
): Map<string, Position> {
  const positions = new Map<string, Position>();
  for (const node of graph.nodes) if (node.position) positions.set(node.id, { ...node.position });
  for (const [id, p] of Object.entries(graph.project?.layout?.positions ?? {}))
    positions.set(id, { ...p });
  const existing = [...positions.values()];
  const originX = existing.length ? Math.max(...existing.map((p) => p.x)) + 150 : 0;
  const originY = existing.length ? Math.min(...existing.map((p) => p.y)) : 0;
  let missing = 0;
  // Preserve authored coordinates, but never place an automatically positioned
  // node exactly on top of another one: the connecting edge would be invisible.
  function uniquePosition(point: Position): Position {
    let { x } = point;
    const { y } = point;
    const direction = x > Number.MAX_VALUE / 2 ? -1 : 1;
    while ([...positions.values()].some((p) => p.x === x && p.y === y)) {
      const step = Math.max(80, Math.abs(x) * Number.EPSILON * 2);
      x += direction * step;
    }
    return { x, y };
  }
  function fallback() {
    const point = { x: originX + (missing % 4) * 150, y: originY + Math.floor(missing / 4) * 110 };
    missing++;
    return uniquePosition(point);
  }
  // Lay out missing participants first, so reaction centroids use all known
  // inputs/outputs rather than coinciding with the one positioned participant.
  for (const node of graph.nodes) {
    if (!positions.has(node.id) && node.kind !== 'reaction') positions.set(node.id, fallback());
  }
  // Catalyst position does not pull a process away from the reaction flow.
  for (const node of graph.nodes) {
    if (positions.has(node.id) || node.kind !== 'reaction') continue;
    const neighbors = graph.edges
      .filter(
        (edge) =>
          (edge.kind === 'consumption' && edge.target === node.id) ||
          (edge.kind === 'production' && edge.source === node.id),
      )
      .map((edge) => positions.get(edge.source === node.id ? edge.target : edge.source))
      .filter((p): p is Position => p !== undefined);
    if (neighbors.length) {
      const n = neighbors.length;
      positions.set(
        node.id,
        uniquePosition({
          x: neighbors.reduce((sum, p) => sum + p.x / n, 0),
          y: neighbors.reduce((sum, p) => sum + p.y / n, 0),
        }),
      );
    } else positions.set(node.id, fallback());
  }
  return positions;
}
