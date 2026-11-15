import type { VisualGraph } from '../../types/visual-graph.js';
import type { ProjectConfig } from '../project.js';
import { layoutMissingNodes, roundPositionCoordinate, type LayoutPoint } from './seeded-layout.js';
import { autoEngine, layoutGraph } from './layout.js';
import { ENGINE_PARAMETERS, runLayoutEngine, type LayoutParameter } from './layout-engines.js';
import { placeInTime, timeAxis } from '../graph/time-axis.js';
import { componentsOf, prepare, stronglyConnected } from '../graph/analysis.js';
import {
  LAYOUT_DEFAULTS,
  LAYOUT_MODES,
  LAYOUT_TYPES,
  type LayoutEngine,
  type LayoutType,
} from '../project-layout.js';
import { anchorToTime, crowdedBy, offTime, timeAnchor } from './time-anchor.js';

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
  /** Whether the result is drawn on the time axis (`timeAnchor` under this strategy). */
  anchored: boolean;
  /**
   * Whether applying the strategy puts the drawing on the time axis or takes
   * it off: a change even when no coordinate moves.
   */
  anchorChanged: boolean;
  /**
   * Locked dated nodes that the time axis would have to move sideways. A
   * strategy never moves a locked node, so such a plan keeps every
   * coordinate and must not be applied until they are unlocked.
   */
  blocked: string[];
}

/**
 * The engine a strategy other than `manual` draws with, and why when that is
 * not simply the engine asked for: `auto` follows `autoEngine`, and a
 * timeline of a graph without dates is drawn as a tree. Depends only on the
 * graph's structure, dates and diagram kind, never on coordinates, so the
 * workspace can say what a strategy will do before it runs.
 */
export function strategyEngine(
  graph: Pick<VisualGraph, 'nodes' | 'edges' | 'diagram'>,
  type: Exclude<LayoutType, 'manual'>,
): { engine: LayoutEngine; reason: LayoutReason | null } {
  const chosen: { engine: LayoutEngine; reason: LayoutReason | null } =
    type === 'auto' ? autoEngine(graph) : { engine: type, reason: null };
  // The timeline engine draws a tree when nothing has a date; say so.
  if (chosen.engine === 'timeline' && !timeAxis(graph.nodes))
    return { engine: 'tree', reason: 'untimed' };
  return chosen;
}

/**
 * The settings a strategy reads for this graph: none for `manual`, which
 * keeps every coordinate, else those of the engine it draws with
 * (`strategyEngine`). The coordinate policy matters to every strategy but
 * `manual`.
 */
export function strategyParameters(
  graph: Pick<VisualGraph, 'nodes' | 'edges' | 'diagram'>,
  type: LayoutType,
): readonly LayoutParameter[] {
  return type === 'manual' ? [] : ENGINE_PARAMETERS[strategyEngine(graph, type).engine];
}

/**
 * Why a strategy suits a graph or not, as the layout panel words it:
 * - `kept`: `manual` keeps the picture;
 * - `auto`: `auto` names the engine it will use;
 * - `any`, `order`: force and circle suit any graph; the grid too, in the
 *   authors' order and without reading relations;
 * - `dated` / `untimed`: a timeline needs dates, else it draws a tree;
 * - `forest` / `cycles`: tree, mind map and radial read a forest; with
 *   cycles they follow a spanning tree and the other relations place nothing;
 * - `acyclic` / `cyclic` / `feedback` / `undirected`: layers need directed
 *   relations without cycles (a cycle shares one level); flow reads a
 *   relation that loops back as feedback; mostly undirected relations leave
 *   only the connections to rank by;
 * - `unrelated`: an engine that follows relations has none to follow.
 */
export const LAYOUT_FIT_NOTES = [
  'kept',
  'auto',
  'any',
  'order',
  'dated',
  'untimed',
  'forest',
  'cycles',
  'acyclic',
  'cyclic',
  'feedback',
  'undirected',
  'unrelated',
] as const;
export type LayoutFitNote = (typeof LAYOUT_FIT_NOTES)[number];
/** The facts about a graph that decide which strategies suit it. */
export interface GraphTraits {
  /** At least two distinct times: a time axis exists. */
  dated: boolean;
  /** At least one relation between two different nodes. */
  related: boolean;
  /** At least 70% of the relations are directed, the rule `auto` uses. */
  directed: boolean;
  /** Directed, and the directed relations form no cycle. */
  acyclic: boolean;
  /** The relations, read without direction, form no cycle. */
  forest: boolean;
}
/** Whether a strategy suits a graph, why, and what it will draw with. */
export interface StrategyFit {
  suits: boolean;
  note: LayoutFitNote;
  /** The engine it draws with (`strategyEngine`); null for `manual`. */
  engine: LayoutEngine | null;
  reason: LayoutReason | null;
}
/** The traits of a graph from its structure and dates alone. */
export function graphTraits(graph: Pick<VisualGraph, 'nodes' | 'edges'>): GraphTraits {
  const p = prepare(graph),
    related = p.pairs.length > 0;
  const directed = related && p.pairs.filter((l) => l.directed).length >= p.pairs.length * 0.7;
  let acyclic = false;
  if (directed) {
    const adj = new Map(p.ids.map((id) => [id, [] as string[]]));
    for (const a of p.arcs) adj.get(a.source)!.push(a.target);
    acyclic = stronglyConnected(p.ids, adj).every((group) => group.length === 1);
  }
  const connected = p.ids.filter((id) => p.degree.get(id));
  const forest = related && p.pairs.length === connected.length - componentsOf(p, connected).length;
  return { dated: Boolean(timeAxis(graph.nodes)), related, directed, acyclic, forest };
}
/**
 * Which strategies suit a graph and what the others will do, before any of
 * them runs (W3). Reads only structure, dates and the diagram kind.
 */
export function layoutFit(graph: Pick<VisualGraph, 'nodes' | 'edges' | 'diagram'>): {
  traits: GraphTraits;
  strategies: Record<LayoutType, StrategyFit>;
} {
  const traits = graphTraits(graph);
  const fit = (type: LayoutType, suits: boolean, note: LayoutFitNote): StrategyFit =>
    type === 'manual'
      ? { suits, note, engine: null, reason: null }
      : { suits, note, ...strategyEngine(graph, type) };
  const treeLike = (type: LayoutType) =>
    !traits.related
      ? fit(type, false, 'unrelated')
      : traits.forest
        ? fit(type, true, 'forest')
        : fit(type, false, 'cycles');
  const strategies: Record<LayoutType, StrategyFit> = {
    manual: fit('manual', true, 'kept'),
    auto: fit('auto', true, 'auto'),
    force: fit('force', true, 'any'),
    layered: !traits.related
      ? fit('layered', false, 'unrelated')
      : traits.acyclic
        ? fit('layered', true, 'acyclic')
        : traits.directed
          ? fit('layered', false, 'cyclic')
          : fit('layered', false, 'undirected'),
    flow: !traits.related
      ? fit('flow', false, 'unrelated')
      : traits.directed
        ? fit('flow', true, traits.acyclic ? 'acyclic' : 'feedback')
        : fit('flow', false, 'undirected'),
    tree: treeLike('tree'),
    mindmap: treeLike('mindmap'),
    timeline: traits.dated ? fit('timeline', true, 'dated') : fit('timeline', false, 'untimed'),
    radial: treeLike('radial'),
    circle: fit('circle', true, 'any'),
    grid: fit('grid', true, 'order'),
  };
  return { traits, strategies };
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
  const now = Boolean(timeAnchor(graph));
  const plan = (
    positions: Map<string, LayoutPoint>,
    engine: LayoutEngine | null,
    reason: LayoutReason | null,
    anchored = now,
    blocked: string[] = [],
  ): LayoutPlan => {
    let moved = 0;
    for (const [id, p] of positions) {
      const before = current.get(id);
      if (!before || before.x !== p.x || before.y !== p.y) moved++;
    }
    return { positions, engine, reason, moved, anchored, anchorChanged: anchored !== now, blocked };
  };
  const kept = () => new Map([...current].map(([id, p]) => [id, { ...p }]));
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
  if (type === 'manual' || mode === 'preserve') return plan(kept(), null, 'kept');
  // A strategy whose drawing is on the time axis keeps every dated node at
  // its years, and cannot do so while a lock holds one elsewhere.
  const axis = timeAnchor(graph, type);
  if (axis) {
    const blocked = offTime(graph, axis, current, settings.locked);
    if (blocked.length) return plan(kept(), null, null, now, blocked);
  }
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
  const { engine, reason } = strategyEngine(graph, type);
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
    result = runLayoutEngine({ nodes, edges: graph.edges }, engine, {
      seed,
      iterations,
      spacing,
    });
  for (const [id, p] of result)
    result.set(id, { x: roundPositionCoordinate(p.x) || 0, y: roundPositionCoordinate(p.y) || 0 });
  // Retain locks exactly, then displace colliding generated points deterministically.
  if (engine !== 'force' && anchors.size) {
    const occupied = [...anchors.values()];
    const dated = new Set(
      axis ? graph.nodes.filter((n) => placeInTime(n, axis) !== null).map((n) => n.id) : [],
    );
    for (const id of [...result.keys()].sort(compare)) {
      // On the time axis a dated node changes lane, never its years (below).
      if (anchors.has(id) || dated.has(id)) continue;
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
  if (axis)
    anchorToTime(graph, result, {
      axis,
      spacing,
      unplaced: crowdedBy(graph, axis, result, new Set(anchors.keys()), spacing),
    });
  return plan(
    new Map([...result].sort(([a], [b]) => compare(a, b))),
    engine,
    reason,
    Boolean(axis),
  );
}
