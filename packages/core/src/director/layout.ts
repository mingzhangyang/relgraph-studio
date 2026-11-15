import type { VisualGraph } from '../../types/visual-graph.js';
import { AUTO_LAYOUT_NODE_LIMIT, chooseLayoutEngine, runLayoutEngine } from './layout-engines.js';
import { LAYOUT_DEFAULTS, type LayoutEngine, type LayoutType } from '../project-layout.js';
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
import { hasTimes, timeAxis } from '../graph/time-axis.js';

/**
 * The engine an automatic drawing uses, and why: the engine of the declared
 * diagram kind, else a grid for a graph too large to arrange, else the
 * engine its structure suggests. The player's drawing of a document without
 * coordinates, the `auto` strategy and the workspace's description of both
 * read this one rule.
 */
export function autoEngine(graph: Pick<VisualGraph, 'nodes' | 'edges' | 'diagram'>): {
  engine: LayoutEngine;
  reason: 'diagram' | 'size' | 'structure';
} {
  const declared = DIAGRAM_ENGINE[graph.diagram ?? 'network'];
  if (declared) return { engine: declared, reason: 'diagram' };
  return {
    engine: chooseLayoutEngine(graph),
    reason: graph.nodes.length > AUTO_LAYOUT_NODE_LIMIT ? 'size' : 'structure',
  };
}
import { anchorToTime } from './time-anchor.js';

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
  const arranged = runLayoutEngine(graph, autoEngine(graph).engine, { seed, ...LAYOUT_DEFAULTS });
  return new Map(
    [...arranged].map(([id, p]) => [
      id,
      { x: roundPositionCoordinate(p.x) || 0, y: roundPositionCoordinate(p.y) || 0 },
    ]),
  );
}

/**
 * The engine that actually draws when `chosen` is asked for: the timeline
 * engine draws a tree when the nodes make no time axis, either because none
 * has a time (`untimed`) or because all share one (`instant`).
 */
export function drawnEngine<R extends string | null>(
  nodes: Pick<VisualGraph, 'nodes'>['nodes'],
  chosen: { engine: LayoutEngine; reason: R },
): { engine: LayoutEngine; reason: R | 'untimed' | 'instant' } {
  if (chosen.engine !== 'timeline' || timeAxis(nodes)) return chosen;
  return { engine: 'tree', reason: hasTimes(nodes) ? 'instant' : 'untimed' };
}

/**
 * How `layoutGraph` arrives at a document's drawing, so the workspace can say
 * what drew the picture:
 * - `strategy`: the project stores a strategy other than `manual` and a
 *   coordinate for every node, which is what applying a strategy writes; a
 *   stored type without those coordinates did not draw the picture;
 * - `structure`: there are no coordinates, so `autoEngine` drew it (a
 *   timeline without an axis as a tree, as `drawnEngine` says);
 * - `coordinates`: every node has stored coordinates (source or project);
 * - `partial`: some nodes have coordinates and `missing` are placed beside them.
 */
export type DrawingOrigin =
  | { kind: 'strategy'; type: Exclude<LayoutType, 'manual'> }
  | {
      kind: 'structure';
      engine: LayoutEngine;
      reason: ReturnType<typeof autoEngine>['reason'] | 'untimed' | 'instant';
    }
  | { kind: 'coordinates' }
  | { kind: 'partial'; missing: number };
export function drawingOrigin(
  graph: Pick<VisualGraph, 'nodes' | 'edges' | 'project' | 'diagram'>,
): DrawingOrigin {
  const type = graph.project?.layout?.type ?? 'manual';
  const stored = graph.project?.layout?.positions ?? {};
  // placeNodes ignores the stored type: only the coordinates draw. They are
  // the strategy's drawing when it wrote one for every node.
  if (
    type !== 'manual' &&
    graph.nodes.length &&
    graph.nodes.every((n) => Object.hasOwn(stored, n.id))
  )
    return { kind: 'strategy', type };
  const missing = graph.nodes.filter((n) => !n.position && !Object.hasOwn(stored, n.id)).length;
  // The same test as placeNodes: no coordinates at all, and more than one node.
  if (missing === graph.nodes.length && !Object.keys(stored).length && graph.nodes.length > 1)
    return { kind: 'structure', ...drawnEngine(graph.nodes, autoEngine(graph)) };
  return missing ? { kind: 'partial', missing } : { kind: 'coordinates' };
}

/** Stable layout prepared once per document, never advanced by playback. */
export function layoutGraph(
  graph: Pick<VisualGraph, 'nodes' | 'edges' | 'project' | 'diagram' | 'timeAxis' | 'timeline'>,
): Map<string, Position> {
  const positions = placeNodes(graph);
  // A timeline stays one: dates edited or added after the drawing was saved
  // move their bars to their years instead of taking the axis away.
  const authored = new Set(graph.nodes.filter((n) => n.position).map((n) => n.id));
  for (const id of Object.keys(graph.project?.layout?.positions ?? {})) authored.add(id);
  if (authored.size < graph.nodes.length && authored.size)
    anchorToTime(graph, positions, {
      unplaced: new Set(graph.nodes.filter((n) => !authored.has(n.id)).map((n) => n.id)),
    });
  else anchorToTime(graph, positions);
  return positions;
}

function placeNodes(
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
