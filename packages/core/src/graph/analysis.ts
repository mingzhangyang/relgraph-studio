/**
 * Structure of a graph, independent of how it is drawn: connected parts,
 * clusters, strongly connected components, the tree a part reads as and the
 * ranks of a process. Layout engines draw with it and adapters read a
 * diagram's levels and branches from it (`diagramStructure`); it imports no
 * engine, adapter or style.
 *
 * Every function is a pure function of the graph: ids are sorted before any
 * traversal, so JSON array order cannot change the result.
 */
import type { VisualGraph } from '../../types/visual-graph.js';

export type LayoutGraph = Pick<VisualGraph, 'nodes' | 'edges'>;
/** A node's place in time; `point` when it only has a first appearance. */
export type Span = { from: number; to?: number; point: boolean };

export const compare = (a: string, b: string): number => (a < b ? -1 : a > b ? 1 : 0);

export interface Link {
  source: string;
  target: string;
  directed: boolean;
  weight: number;
}
export interface Prepared {
  ids: string[];
  /** Node ids in the order the author wrote them. */
  authored: string[];
  group: Map<string, string | null>;
  kind: Map<string, string>;
  importance: Map<string, number>;
  /** Unique unordered pairs, self loops removed. */
  pairs: Link[];
  /** Directed source→target arcs, as authored. */
  arcs: Link[];
  neighbours: Map<string, string[]>;
  degree: Map<string, number>;
  /** Position of every node in the author's list. */
  order: Map<string, number>;
  /** Where a node lies on the domain time axis, when it says so. */
  span: Map<string, Span>;
}

export function prepare(graph: LayoutGraph): Prepared {
  const ids = graph.nodes.map((n) => n.id).sort(compare),
    known = new Set(ids);
  const edges = graph.edges
    .filter((e) => known.has(e.source) && known.has(e.target) && e.source !== e.target)
    .sort(
      (a, b) => compare(a.source, b.source) || compare(a.target, b.target) || compare(a.id, b.id),
    );
  const pairMap = new Map<string, Link>(),
    arcs: Link[] = [];
  for (const e of edges) {
    const [a, b] = e.source < e.target ? [e.source, e.target] : [e.target, e.source];
    const key = a + '\0' + b,
      weight = 0.7 + 0.1 * Math.min(5, Math.max(1, e.strength ?? 3));
    const existing = pairMap.get(key);
    if (existing) existing.weight = Math.max(existing.weight, weight);
    else pairMap.set(key, { source: a, target: b, directed: Boolean(e.directed), weight });
    if (e.directed) arcs.push({ source: e.source, target: e.target, directed: true, weight });
  }
  const pairs = [...pairMap.values()];
  const sets = new Map(ids.map((id) => [id, new Set<string>()]));
  for (const p of pairs) {
    sets.get(p.source)!.add(p.target);
    sets.get(p.target)!.add(p.source);
  }
  const neighbours = new Map(ids.map((id) => [id, [...sets.get(id)!].sort(compare)]));
  return {
    ids,
    authored: graph.nodes.map((n) => n.id),
    group: new Map(graph.nodes.map((n) => [n.id, n.groupId ?? null])),
    kind: new Map(graph.nodes.map((n) => [n.id, n.kind])),
    importance: new Map(graph.nodes.map((n) => [n.id, n.importance ?? 0])),
    pairs,
    arcs,
    neighbours,
    degree: new Map(ids.map((id) => [id, sets.get(id)!.size])),
    order: new Map(graph.nodes.map((n, i) => [n.id, i])),
    span: new Map(
      graph.nodes.flatMap((n): [string, Span][] => {
        const from = n.span?.from ?? n.visibility?.from;
        return from === undefined
          ? []
          : [[n.id, { from, to: n.span?.to, point: n.span === undefined }]];
      }),
    ),
  };
}

/** Connected components, largest first; members and ties ordered by id. */
export function componentsOf(p: Prepared, ids: readonly string[] = p.ids): string[][] {
  const allowed = new Set(ids),
    seen = new Set<string>(),
    out: string[][] = [];
  for (const root of ids) {
    if (seen.has(root)) continue;
    const members = [root];
    seen.add(root);
    for (let i = 0; i < members.length; i++)
      for (const v of p.neighbours.get(members[i]) ?? [])
        if (allowed.has(v) && !seen.has(v)) {
          seen.add(v);
          members.push(v);
        }
    out.push(members.sort(compare));
  }
  return out.sort((a, b) => b.length - a.length || compare(a[0], b[0]));
}

/**
 * Parts that belong together when drawn: connected by relations, or members
 * of one group. A group split across unconnected parts still forms one hull,
 * so its members must not be packed to opposite ends of the canvas.
 */
export function clustersOf(p: Prepared): string[][] {
  const parent = new Map(p.ids.map((id) => [id, id]));
  const find = (id: string): string => {
    let root = id;
    while (parent.get(root) !== root) root = parent.get(root)!;
    while (parent.get(id) !== root) {
      const next = parent.get(id)!;
      parent.set(id, root);
      id = next;
    }
    return root;
  };
  const union = (a: string, b: string): void => {
    const ra = find(a),
      rb = find(b);
    if (ra !== rb) parent.set(ra < rb ? rb : ra, ra < rb ? ra : rb);
  };
  for (const link of p.pairs) union(link.source, link.target);
  const first = new Map<string, string>();
  for (const id of p.ids) {
    const group = p.group.get(id);
    if (!group) continue;
    const seen = first.get(group);
    if (seen) union(seen, id);
    else first.set(group, id);
  }
  const clusters = new Map<string, string[]>();
  for (const id of p.ids) {
    const root = find(id);
    clusters.set(root, [...(clusters.get(root) ?? []), id]);
  }
  return [...clusters.values()].sort((a, b) => b.length - a.length || compare(a[0], b[0]));
}

/** The best-connected member: degree, then importance, then id. */
export const hubOf = (p: Prepared, members: readonly string[]): string =>
  [...members].sort(
    (a, b) =>
      (p.degree.get(b) ?? 0) - (p.degree.get(a) ?? 0) ||
      (p.importance.get(b) ?? 0) - (p.importance.get(a) ?? 0) ||
      compare(a, b),
  )[0];

/**
 * The member from which every other one is nearest: least eccentricity, then
 * the best-connected. A tree drawn around it has the fewest rings.
 */
export function centreOf(p: Prepared, members: readonly string[]): string {
  // Eccentricity needs a search per member; large parts use the hub instead.
  if (members.length > 400) return hubOf(p, members);
  const inside = new Set(members);
  let best = hubOf(p, members),
    least = Infinity;
  const ranked = [...members].sort(
    (a, b) => (p.degree.get(b) ?? 0) - (p.degree.get(a) ?? 0) || compare(a, b),
  );
  for (const start of ranked) {
    const distance = new Map([[start, 0]]),
      queue = [start];
    let far = 0;
    for (let i = 0; i < queue.length && far < least; i++)
      for (const v of p.neighbours.get(queue[i]) ?? [])
        if (inside.has(v) && !distance.has(v)) {
          far = distance.get(queue[i])! + 1;
          distance.set(v, far);
          queue.push(v);
        }
    if (far < least) {
      least = far;
      best = start;
    }
  }
  return best;
}

/** Breadth-first tree from a root; children keep groups together, then ids. */
export function spanningTree(p: Prepared, members: readonly string[], root: string) {
  const inside = new Set(members),
    depth = new Map([[root, 0]]),
    children = new Map<string, string[]>(members.map((id) => [id, []])),
    order = [root];
  for (let i = 0; i < order.length; i++) {
    const next = (p.neighbours.get(order[i]) ?? [])
      .filter((v) => inside.has(v) && !depth.has(v))
      .sort((a, b) => compare(p.group.get(a) ?? '￿', p.group.get(b) ?? '￿') || compare(a, b));
    for (const v of next) {
      depth.set(v, depth.get(order[i])! + 1);
      children.get(order[i])!.push(v);
      order.push(v);
    }
  }
  return { depth, children, order };
}

/** Iterative Kosaraju: cycles are components, never guessed generations. */
export function stronglyConnected(ids: string[], adj: Map<string, string[]>): string[][] {
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

/** Rank of every member: longest path over directed arcs, else distance from the hub. */
export function ranksOf(p: Prepared, members: string[]): Map<string, number> {
  const inside = new Set(members),
    arcs = p.arcs.filter((a) => inside.has(a.source) && inside.has(a.target));
  const ranks = new Map<string, number>();
  if (!arcs.length) {
    const root = hubOf(p, members);
    ranks.set(root, 0);
    const queue = [root];
    for (let i = 0; i < queue.length; i++)
      for (const v of p.neighbours.get(queue[i]) ?? [])
        if (inside.has(v) && !ranks.has(v)) {
          ranks.set(v, ranks.get(queue[i])! + 1);
          queue.push(v);
        }
    return ranks;
  }
  const adj = new Map(members.map((id) => [id, [] as string[]]));
  for (const a of arcs) adj.get(a.source)!.push(a.target);
  for (const list of adj.values()) list.sort(compare);
  const groups = stronglyConnected(members, adj),
    owner = new Map<string, number>();
  groups.forEach((g, i) => g.forEach((id) => owner.set(id, i)));
  const children = groups.map(() => new Set<number>()),
    incoming = groups.map(() => 0),
    rank = groups.map(() => 0);
  for (const a of arcs) {
    const from = owner.get(a.source)!,
      to = owner.get(a.target)!;
    if (from !== to && !children[from].has(to)) {
      children[from].add(to);
      incoming[to]++;
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
  return ranks;
}

/**
 * Ranks for a process that may loop: relations that lead back to a step
 * already under way are feedback, and are ignored when ranking, so a loop
 * reads as a sequence with one relation returning instead of one tall rank.
 */
export function flowRanks(p: Prepared, members: string[]): Map<string, number> {
  const inside = new Set(members),
    arcs = p.arcs.filter((a) => inside.has(a.source) && inside.has(a.target));
  if (!arcs.length) return ranksOf(p, members);
  const out = new Map(members.map((id) => [id, [] as string[]])),
    incoming = new Map(members.map((id) => [id, 0]));
  for (const a of arcs) {
    out.get(a.source)!.push(a.target);
    incoming.set(a.target, incoming.get(a.target)! + 1);
  }
  const byOrder = (a: string, b: string): number =>
    (p.order.get(a) ?? 0) - (p.order.get(b) ?? 0) || compare(a, b);
  for (const list of out.values()) list.sort(byOrder);
  // Depth-first from the entry points, in the author's order.
  const starts = [...members].sort(
    (a, b) => Math.min(1, incoming.get(a)!) - Math.min(1, incoming.get(b)!) || byOrder(a, b),
  );
  const state = new Map<string, 1 | 2>(),
    forward = new Map(members.map((id) => [id, [] as string[]])),
    pending = new Map(members.map((id) => [id, 0]));
  for (const start of starts) {
    if (state.has(start)) continue;
    const stack: [string, number][] = [[start, 0]];
    state.set(start, 1);
    while (stack.length) {
      const top = stack[stack.length - 1],
        next = out.get(top[0])![top[1]++];
      if (next === undefined) {
        state.set(top[0], 2);
        stack.pop();
      } else if (state.get(next) !== 1) {
        // Not on the current path: a forward relation.
        forward.get(top[0])!.push(next);
        pending.set(next, pending.get(next)! + 1);
        if (!state.has(next)) {
          state.set(next, 1);
          stack.push([next, 0]);
        }
      }
    }
  }
  const ranks = new Map(members.map((id) => [id, 0])),
    ready = members.filter((id) => pending.get(id) === 0).sort(byOrder);
  for (let i = 0; i < ready.length; i++)
    for (const next of forward.get(ready[i])!) {
      ranks.set(next, Math.max(ranks.get(next)!, ranks.get(ready[i])! + 1));
      pending.set(next, pending.get(next)! - 1);
      if (pending.get(next) === 0) ready.push(next);
    }
  return ranks;
}

/** Where a tree starts: the node nothing points to, else the centre of the part. */
export function rootOf(p: Prepared, members: readonly string[]): string {
  const inside = new Set(members),
    incoming = new Map<string, number>(),
    outgoing = new Map<string, number>();
  for (const a of p.arcs)
    if (inside.has(a.source) && inside.has(a.target)) {
      incoming.set(a.target, (incoming.get(a.target) ?? 0) + 1);
      outgoing.set(a.source, (outgoing.get(a.source) ?? 0) + 1);
    }
  const sources = members
    .filter((id) => !incoming.get(id) && outgoing.get(id))
    .sort((a, b) => (p.order.get(a) ?? 0) - (p.order.get(b) ?? 0) || compare(a, b));
  return sources[0] ?? centreOf(p, members);
}

export interface Tree {
  root: string;
  depth: Map<string, number>;
  children: Map<string, string[]>;
  /** Breadth-first order: every parent before its children. */
  order: string[];
}
/** The tree a part is drawn as. Siblings keep the order the author gave them. */
export function treeOf(
  p: Prepared,
  members: readonly string[],
  root: string = rootOf(p, members),
): Tree {
  const inside = new Set(members),
    depth = new Map([[root, 0]]),
    children = new Map<string, string[]>(members.map((id) => [id, []])),
    order = [root];
  for (let i = 0; i < order.length; i++) {
    const next = (p.neighbours.get(order[i]) ?? [])
      .filter((v) => inside.has(v) && !depth.has(v))
      .sort((a, b) => (p.order.get(a) ?? 0) - (p.order.get(b) ?? 0) || compare(a, b));
    for (const v of next) {
      depth.set(v, depth.get(order[i])! + 1);
      children.get(order[i])!.push(v);
      order.push(v);
    }
  }
  return { root, depth, children, order };
}

/**
 * The reading structure of a diagram. `level` is how far a node is from where
 * the diagram begins: its depth in the tree a tree or mind map is drawn as,
 * or its step in a process. A storyboard that unfolds a diagram reveals one
 * level at a time. `branch` numbers the main branches of a tree in reading
 * order, so each can carry its own colour.
 */
export function diagramStructure(
  graph: LayoutGraph,
  by: 'tree' | 'flow',
): { level: Map<string, number>; branch: Map<string, number> } {
  const p = prepare(graph),
    level = new Map<string, number>(),
    branch = new Map<string, number>();
  let next = 0;
  for (const members of componentsOf(p)) {
    if (by === 'flow') {
      const ranks = flowRanks(p, members);
      for (const id of members) level.set(id, ranks.get(id) ?? 0);
      continue;
    }
    const tree = treeOf(p, members);
    for (const id of tree.order) {
      level.set(id, tree.depth.get(id)!);
      // Breadth-first order: a child inherits the branch its parent was given.
      if (tree.depth.get(id) === 1) branch.set(id, next++);
      for (const child of tree.children.get(id)!)
        if (branch.has(id)) branch.set(child, branch.get(id)!);
    }
  }
  return { level, branch };
}
