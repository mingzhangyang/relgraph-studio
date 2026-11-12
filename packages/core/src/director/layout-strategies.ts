import type { VisualGraph } from '../../types/visual-graph.js';
import type { ProjectConfig } from '../project.js';
import { layoutMissingNodes, roundPositionCoordinate, type LayoutPoint } from './seeded-layout.js';
import { DIAGRAM_ENGINE, layoutGraph } from './layout.js';
import {
  AUTO_LAYOUT_NODE_LIMIT,
  chooseLayoutEngine,
  LAYOUT_DEFAULTS,
  LAYOUT_ENGINES,
  runLayoutEngine,
  timeAxis,
  type LayoutEngine,
} from './layout-engines.js';

/**
 * Every strategy a project may store: `manual` keeps coordinates as they
 * are, `auto` chooses an engine, and each engine can be asked for by name.
 * The project type, its validator and the studio's menu all read this list.
 */
export const LAYOUT_TYPES = ['manual', 'auto', ...LAYOUT_ENGINES] as const;
export type LayoutType = (typeof LAYOUT_TYPES)[number];
/** What a strategy may do with the coordinates that already exist. */
export const LAYOUT_MODES = ['preserve', 'missing', 'rearrange'] as const;
export type LayoutMode = (typeof LAYOUT_MODES)[number];
export type LayoutSettings = NonNullable<ProjectConfig['layout']>;
export const DEFAULT_LAYOUT_SETTINGS: LayoutSettings = {
  type: 'manual',
  mode: 'preserve',
  seed: 0,
  ...LAYOUT_DEFAULTS,
  locked: [],
  positions: {},
};
const compare = (a: string, b: string): number => (a < b ? -1 : a > b ? 1 : 0);

/**
 * Why a strategy drew with the engine it did, when that is not simply the
 * engine asked for:
 * - `kept`: `manual`, or the `preserve` policy, keeps every coordinate;
 * - `diagram`: `auto` followed the declared diagram kind;
 * - `structure`: `auto` chose from the graph's structure;
 * - `size`: `auto` chose a grid because the graph is too large to arrange;
 * - `untimed`: a timeline was asked for, but no node has a date, so the
 *   timeline engine drew a tree.
 */
export const LAYOUT_REASONS = ['kept', 'diagram', 'structure', 'size', 'untimed'] as const;
export type LayoutReason = (typeof LAYOUT_REASONS)[number];
/** What a strategy did, so that a preview never looks pending when nothing happened. */
export interface LayoutPlan {
  positions: Map<string, LayoutPoint>;
  /** The engine that actually drew the result; null when coordinates were kept. */
  engine: LayoutEngine | null;
  reason: LayoutReason | null;
  /** How many nodes the result moves away from `current`. */
  moved: number;
}

/** Bounded synchronous authoring computation. Never called by playback/frame evaluation. */
export function computeLayout(
  graph: VisualGraph,
  settings: LayoutSettings,
  current: ReadonlyMap<string, LayoutPoint> = layoutGraph(graph),
): Map<string, LayoutPoint> {
  return planLayout(graph, settings, current).positions;
}

/** `computeLayout`, together with the engine that ran, why, and how much it moved. */
export function planLayout(
  graph: VisualGraph,
  settings: LayoutSettings,
  current: ReadonlyMap<string, LayoutPoint> = layoutGraph(graph),
): LayoutPlan {
  const plan = (
    positions: Map<string, LayoutPoint>,
    engine: LayoutEngine | null,
    reason: LayoutReason | null,
  ): LayoutPlan => {
    let moved = 0;
    for (const [id, p] of positions) {
      const before = current.get(id);
      if (!before || before.x !== p.x || before.y !== p.y) moved++;
    }
    return { positions, engine, reason, moved };
  };
  const { seed, iterations, spacing, type, mode } = settings;
  if (
    !Number.isInteger(seed) ||
    seed < 0 ||
    seed > 0xffffffff ||
    !Number.isInteger(iterations) ||
    iterations < 0 ||
    iterations > 2000 ||
    !Number.isFinite(spacing) ||
    spacing < 64 ||
    spacing > 400
  )
    throw new RangeError('Invalid layout parameters');
  if (
    !(LAYOUT_TYPES as readonly string[]).includes(type) ||
    !(LAYOUT_MODES as readonly string[]).includes(mode)
  )
    throw new RangeError('Invalid layout strategy');
  if (type === 'manual' || mode === 'preserve')
    return plan(new Map([...current].map(([id, p]) => [id, { ...p }])), null, 'kept');
  const locks = new Set(settings.locked),
    anchors = new Map<string, LayoutPoint>();
  for (const node of graph.nodes) {
    const authored = Object.hasOwn(settings.positions, node.id)
      ? settings.positions[node.id]
      : node.position;
    const fixed = locks.has(node.id)
      ? current.get(node.id)
      : mode === 'missing'
        ? authored
        : undefined;
    if (fixed) anchors.set(node.id, { ...fixed });
  }
  const nodes = graph.nodes.map((n) => ({ ...n, position: anchors.get(n.id) }));
  // Auto follows the kind of diagram when the graph declares one.
  const declared = type === 'auto' ? DIAGRAM_ENGINE[graph.diagram ?? 'network'] : null;
  let engine: LayoutEngine =
    type === 'auto'
      ? (declared ?? chooseLayoutEngine({ nodes, edges: graph.edges }))
      : (type as LayoutEngine);
  let reason: LayoutReason | null =
    type !== 'auto'
      ? null
      : declared
        ? 'diagram'
        : graph.nodes.length > AUTO_LAYOUT_NODE_LIMIT
          ? 'size'
          : 'structure';
  // The timeline engine draws a tree when nothing has a date; say so.
  if (engine === 'timeline' && !timeAxis(graph.nodes)) {
    engine = 'tree';
    reason = 'untimed';
  }
  let result: Map<string, LayoutPoint>;
  if (engine === 'force') {
    // Anchors beyond any drawable range keep the overflow-safe incremental
    // solver; everything else gets the full structural relaxation.
    const extreme = [...anchors.values()].some((p) => Math.abs(p.x) > 1e9 || Math.abs(p.y) > 1e9);
    // Preferred spacing belongs to the solver, never to authored coordinates.
    result = extreme
      ? layoutMissingNodes({ nodes, edges: graph.edges }, { seed, iterations, spacing })
      : runLayoutEngine({ nodes, edges: graph.edges }, 'force', {
          seed,
          iterations,
          spacing,
          fixed: anchors,
        });
  } else
    result = runLayoutEngine({ nodes, edges: graph.edges }, engine, { seed, iterations, spacing });
  for (const [id, p] of result)
    result.set(id, { x: roundPositionCoordinate(p.x) || 0, y: roundPositionCoordinate(p.y) || 0 });
  // Retain locks exactly, then displace colliding generated points deterministically.
  if (engine !== 'force' && anchors.size) {
    const occupied = [...anchors.values()];
    for (const id of [...result.keys()].sort(compare)) {
      if (anchors.has(id)) continue;
      const original = result.get(id)!;
      let chosen = { ...original };
      for (
        let attempt = 0;
        occupied.some((p) => Math.hypot(p.x - chosen.x, p.y - chosen.y) < spacing * 0.4);
        attempt++
      ) {
        const angle = attempt * 2.399963229728653,
          radius = spacing * 0.5 * Math.sqrt(attempt + 1);
        chosen = {
          x: roundPositionCoordinate(original.x + Math.cos(angle) * radius),
          y: roundPositionCoordinate(original.y + Math.sin(angle) * radius),
        };
      }
      result.set(id, chosen);
      occupied.push(chosen);
    }
  }
  for (const [id, p] of anchors) result.set(id, p);
  return plan(new Map([...result].sort(([a], [b]) => compare(a, b))), engine, reason);
}
