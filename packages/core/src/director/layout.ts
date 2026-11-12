import type { VisualGraph } from '../../types/visual-graph.js';
import { autoLayout, runLayoutEngine, type LayoutEngine } from './layout-engines.js';
import type { DiagramKind } from '../style.js';

/** The layout a kind of diagram is drawn with; a network chooses by structure. */
export const DIAGRAM_ENGINE: Readonly<Record<DiagramKind, LayoutEngine | null>> = Object.freeze({
  network: null,
  tree: 'tree',
  mindmap: 'mindmap',
  flowchart: 'flow',
  timeline: 'timeline',
});
import { roundPositionCoordinate } from './seeded-layout.js';

type Position = { x: number; y: number };

/**
 * A drawing made from the structure alone: the engine of the diagram kind,
 * or, for a network, the engine its structure suggests. Coordinates are
 * rounded the way stored coordinates are. This is what a document without
 * any coordinates looks like in the player, and what `relgraph layout`
 * writes for one, so the two cannot drift apart.
 */
export function structuralLayout(
  graph: Pick<VisualGraph, 'nodes' | 'edges' | 'diagram'>,
  seed = 0,
): Map<string, Position> {
  const engine = DIAGRAM_ENGINE[graph.diagram ?? 'network'];
  const arranged = engine
    ? runLayoutEngine(graph, engine, { seed, spacing: 150, iterations: 300 })
    : autoLayout(graph, { seed });
  return new Map(
    [...arranged].map(([id, p]) => [
      id,
      { x: roundPositionCoordinate(p.x) || 0, y: roundPositionCoordinate(p.y) || 0 },
    ]),
  );
}

/** Stable layout prepared once per document, never advanced by playback. */
export function layoutGraph(
  graph: Pick<VisualGraph, 'nodes' | 'edges' | 'project' | 'diagram'>,
): Map<string, Position> {
  const compare = (a: { id: string }, b: { id: string }): number =>
    a.id < b.id ? -1 : a.id > b.id ? 1 : 0;
  const nodes = [...graph.nodes].sort(compare),
    edges = [...graph.edges].sort(compare);
  const positions = new Map<string, Position>();
  for (const node of nodes) if (node.position) positions.set(node.id, { ...node.position });
  for (const [id, p] of Object.entries(graph.project?.layout?.positions ?? {}))
    positions.set(id, { ...p });
  // A document with no coordinates at all is drawn from its structure. Partly
  // positioned documents keep the conservative fallback below, which never
  // moves or crowds what the author has already arranged.
  if (!positions.size && nodes.length > 1) {
    // Engines sort where order must not matter and keep the author's order
    // where it is the reading order (grids, siblings of a tree).
    const arranged = structuralLayout({ nodes: graph.nodes, edges, diagram: graph.diagram });
    return new Map(nodes.map((node) => [node.id, arranged.get(node.id) ?? { x: 0, y: 0 }]));
  }
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
  for (const node of nodes) {
    if (!positions.has(node.id) && node.kind !== 'reaction') positions.set(node.id, fallback());
  }
  // Catalyst position does not pull a process away from the reaction flow.
  for (const node of nodes) {
    if (positions.has(node.id) || node.kind !== 'reaction') continue;
    const neighbors = edges
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
