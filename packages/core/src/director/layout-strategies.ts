import type { VisualGraph } from '../../types/visual-graph.js';
import type { ProjectConfig } from '../project.js';
import { layoutMissingNodes, roundPositionCoordinate, type LayoutPoint } from './seeded-layout.js';
import { layoutGraph } from './layout.js';
import { chooseLayoutEngine, runLayoutEngine, type LayoutEngine } from './layout-engines.js';

/** Every strategy a project may store; `manual` keeps coordinates as they are. */
export const LAYOUT_TYPES = [
  'manual',
  'auto',
  'force',
  'layered',
  'flow',
  'radial',
  'circle',
  'grid',
] as const;
export type LayoutSettings = NonNullable<ProjectConfig['layout']>;
export const DEFAULT_LAYOUT_SETTINGS: LayoutSettings = {
  type: 'manual',
  mode: 'preserve',
  seed: 0,
  spacing: 160,
  iterations: 160,
  locked: [],
  positions: {},
};
const compare = (a: string, b: string): number => (a < b ? -1 : a > b ? 1 : 0);

/** Bounded synchronous authoring computation. Never called by playback/frame evaluation. */
export function computeLayout(
  graph: VisualGraph,
  settings: LayoutSettings,
  current: ReadonlyMap<string, LayoutPoint> = layoutGraph(graph),
): Map<string, LayoutPoint> {
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
    !['preserve', 'missing', 'rearrange'].includes(mode)
  )
    throw new RangeError('Invalid layout strategy');
  if (type === 'manual' || mode === 'preserve')
    return new Map([...current].map(([id, p]) => [id, { ...p }]));
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
  const engine: LayoutEngine =
    type === 'auto' ? chooseLayoutEngine({ nodes, edges: graph.edges }) : (type as LayoutEngine);
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
  return new Map([...result].sort(([a], [b]) => compare(a, b)));
}
