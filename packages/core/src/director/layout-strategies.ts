import type { VisualGraph } from '../../types/visual-graph.js';
import type { ProjectConfig } from '../project.js';
import { layoutMissingNodes, roundPositionCoordinate, type LayoutPoint } from './seeded-layout.js';
import { layoutGraph } from './layout.js';
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

/** Iterative Kosaraju: cycles are components, never guessed family generations. */
function components(ids: string[], adj: Map<string, string[]>): string[][] {
  const seen = new Set<string>(),
    order: string[] = [];
  for (const id of ids) {
    if (seen.has(id)) continue;
    const stack: [string, boolean][] = [[id, false]];
    while (stack.length) {
      const [n, done] = stack.pop()!;
      if (done) {
        order.push(n);
        continue;
      }
      if (seen.has(n)) continue;
      seen.add(n);
      stack.push([n, true]);
      for (const v of [...(adj.get(n) ?? [])].reverse()) if (!seen.has(v)) stack.push([v, false]);
    }
  }
  const reverse = new Map(ids.map((id) => [id, [] as string[]]));
  for (const [id, neighbors] of adj) for (const n of neighbors) reverse.get(n)!.push(id);
  seen.clear();
  const result: string[][] = [];
  for (const id of order.reverse()) {
    if (seen.has(id)) continue;
    const group: string[] = [],
      stack = [id];
    seen.add(id);
    while (stack.length) {
      const n = stack.pop()!;
      group.push(n);
      for (const v of reverse.get(n) ?? [])
        if (!seen.has(v)) {
          seen.add(v);
          stack.push(v);
        }
    }
    result.push(group.sort(compare));
  }
  return result.sort((a, b) => compare(a[0], b[0]));
}
function layered(graph: VisualGraph, spacing: number): Map<string, LayoutPoint> {
  const ids = graph.nodes.map((n) => n.id).sort(compare),
    known = new Set(ids);
  const edges = [...graph.edges]
    .filter((e) => known.has(e.source) && known.has(e.target) && e.source !== e.target)
    .sort((a, b) => compare(a.id, b.id));
  const adjacency = new Map(ids.map((id) => [id, new Set<string>()]));
  for (const e of edges) {
    adjacency.get(e.source)!.add(e.target);
    adjacency.get(e.target)!.add(e.source);
  }
  // Pack disconnected subgraphs in stable columns, with a generous gutter.
  const seen = new Set<string>(),
    out = new Map<string, LayoutPoint>();
  let offset = 0;
  for (const root of ids) {
    if (seen.has(root)) continue;
    const members: string[] = [],
      queue = [root];
    seen.add(root);
    for (let i = 0; i < queue.length; i++) {
      const n = queue[i];
      members.push(n);
      for (const v of [...adjacency.get(n)!].sort(compare))
        if (!seen.has(v)) {
          seen.add(v);
          queue.push(v);
        }
    }
    members.sort(compare);
    const memberSet = new Set(members),
      links = edges.filter((e) => memberSet.has(e.source));
    const ranks = new Map<string, number>();
    if (!links.some((e) => e.directed)) {
      // Generic undirected distance layers; no biological/literary kinship inference.
      ranks.set(root, 0);
      const q = [root];
      for (let i = 0; i < q.length; i++)
        for (const v of [...adjacency.get(q[i])!].sort(compare))
          if (!ranks.has(v)) {
            ranks.set(v, ranks.get(q[i])! + 1);
            q.push(v);
          }
    } else {
      const adj = new Map(members.map((id) => [id, [] as string[]]));
      for (const e of links) if (e.directed) adj.get(e.source)!.push(e.target);
      for (const neighbors of adj.values()) neighbors.sort(compare);
      const groups = components(members, adj),
        owner = new Map<string, number>();
      groups.forEach((g, i) => g.forEach((id) => owner.set(id, i)));
      const children = groups.map(() => new Set<number>()),
        incoming = groups.map(() => 0),
        rank = groups.map(() => 0);
      for (const e of links)
        if (e.directed) {
          const a = owner.get(e.source)!,
            b = owner.get(e.target)!;
          if (a !== b && !children[a].has(b)) {
            children[a].add(b);
            incoming[b]++;
          }
        }
      const ready = groups.map((_, i) => i).filter((i) => incoming[i] === 0);
      while (ready.length) {
        ready.sort((a, b) => compare(groups[a][0], groups[b][0]));
        const i = ready.shift()!;
        for (const child of children[i]) {
          rank[child] = Math.max(rank[child], rank[i] + 1);
          if (--incoming[child] === 0) ready.push(child);
        }
      }
      groups.forEach((g, i) => g.forEach((id) => ranks.set(id, rank[i])));
    }
    const rows = new Map<number, string[]>();
    for (const id of members) {
      const r = ranks.get(id) ?? 0;
      const row = rows.get(r) ?? [];
      row.push(id);
      rows.set(r, row);
    }
    let width = spacing;
    for (const [rank, row] of [...rows].sort((a, b) => a[0] - b[0])) {
      row.sort(compare);
      width = Math.max(width, row.length * spacing);
      row.forEach((id, i) => out.set(id, { x: offset + i * spacing, y: rank * spacing }));
    }
    offset += width + spacing;
  }
  return out;
}
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
    !['manual', 'force', 'circle', 'layered'].includes(type) ||
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
  let result: Map<string, LayoutPoint>;
  if (type === 'force') {
    // Preferred spacing belongs to the solver, never to authored coordinates.
    result = layoutMissingNodes({ nodes, edges: graph.edges }, { seed, iterations, spacing });
  } else if (type === 'circle') {
    const sorted = [...nodes].sort((a, b) => compare(a.id, b.id)),
      radius = Math.max(spacing, (sorted.length * spacing) / (2 * Math.PI));
    const rotation = (seed / 0x100000000) * Math.PI * 2 - Math.PI / 2;
    result = new Map(
      sorted.map((n, i) => {
        const angle = rotation + (i * 2 * Math.PI) / Math.max(1, sorted.length);
        return [n.id, { x: Math.cos(angle) * radius, y: Math.sin(angle) * radius }];
      }),
    );
  } else result = layered(graph, spacing);
  for (const [id, p] of result)
    result.set(id, { x: roundPositionCoordinate(p.x) || 0, y: roundPositionCoordinate(p.y) || 0 });
  // Retain locks exactly, then displace colliding generated points deterministically.
  if (type !== 'force' && anchors.size) {
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
