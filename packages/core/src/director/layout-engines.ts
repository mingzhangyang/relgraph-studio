/**
 * Structure-aware static layouts for arbitrary graphs. Authoring-time only:
 * nothing here runs during playback or frame evaluation.
 *
 * Every engine is a pure function of (graph, options): ids are sorted before
 * any traversal so JSON array order cannot change the result, the only
 * randomness is a seeded hash of node ids, and iteration counts are bounded.
 * Engines compose films for a wide stage, so they prefer landscape results.
 */
import type { VisualGraph } from '../../types/visual-graph.js';

export type EnginePoint = { x: number; y: number };
export const LAYOUT_ENGINES = ['force', 'layered', 'flow', 'radial', 'circle', 'grid'] as const;
export type LayoutEngine = (typeof LAYOUT_ENGINES)[number];
export interface EngineOptions {
  /** Unsigned 32-bit seed. */
  seed: number;
  /** Preferred distance between neighbouring nodes, in world units. */
  spacing: number;
  /** Upper bound of relaxation steps for the force engine. */
  iterations: number;
  /** Nodes that must stay exactly where they are. */
  fixed?: ReadonlyMap<string, EnginePoint>;
}
type LayoutGraph = Pick<VisualGraph, 'nodes' | 'edges'>;

/** Landscape proportion the engines aim for; the film stage is about 2.8:1. */
const ASPECT = 2.2;
const TAU = Math.PI * 2;
const compare = (a: string, b: string): number => (a < b ? -1 : a > b ? 1 : 0);
const hash = (value: string, seed: number): number => {
  let state = (2166136261 ^ seed) >>> 0;
  for (let i = 0; i < value.length; i++)
    state = Math.imul(state ^ value.charCodeAt(i), 16777619) >>> 0;
  return state / 0x100000000;
};

interface Link {
  source: string;
  target: string;
  directed: boolean;
  weight: number;
}
interface Prepared {
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
}

function prepare(graph: LayoutGraph): Prepared {
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
  };
}

/** Connected components, largest first; members and ties ordered by id. */
function componentsOf(p: Prepared, ids: readonly string[] = p.ids): string[][] {
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
function clustersOf(p: Prepared): string[][] {
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
const hubOf = (p: Prepared, members: readonly string[]): string =>
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
function centreOf(p: Prepared, members: readonly string[]): string {
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
function spanningTree(p: Prepared, members: readonly string[], root: string) {
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

/** Concentric rings around a root, each subtree in a wedge sized by its leaves. */
function radialPositions(
  p: Prepared,
  members: readonly string[],
  spacing: number,
  rotation: number,
): Map<string, EnginePoint> {
  const root = centreOf(p, members),
    { depth, children, order } = spanningTree(p, members, root);
  const leaves = new Map<string, number>();
  for (const id of [...order].reverse())
    leaves.set(
      id,
      Math.max(
        1,
        children.get(id)!.reduce((sum, child) => sum + leaves.get(child)!, 0),
      ),
    );
  // Angles first: every subtree gets a wedge proportional to its leaves.
  const angles = new Map<string, number>([[root, rotation]]);
  const assign = (id: string, from: number, to: number): void => {
    let cursor = from;
    const total = leaves.get(id)!;
    for (const child of children.get(id)!) {
      const span = ((to - from) * leaves.get(child)!) / total;
      angles.set(child, cursor + span / 2);
      assign(child, cursor, cursor + span);
      cursor += span;
    }
  };
  assign(root, rotation, rotation + TAU);
  // Then radii: each ring is far enough out for its tightest pair of nodes.
  const rings: number[][] = [];
  for (const id of order) (rings[depth.get(id)!] ??= []).push(angles.get(id)!);
  const gap = spacing * 0.95,
    radii = [0];
  for (let d = 1; d < rings.length; d++) {
    const ring = [...rings[d]].sort((m, n) => m - n);
    let tightest = TAU;
    for (let i = 0; i < ring.length; i++) {
      const next = i + 1 < ring.length ? ring[i + 1] : ring[0] + TAU;
      if (ring.length > 1) tightest = Math.min(tightest, next - ring[i]);
    }
    const needed =
      ring.length > 1 ? (spacing * 0.6) / (2 * Math.sin(Math.min(Math.PI, tightest) / 2)) : 0;
    radii.push(Math.max(radii[d - 1] + gap, needed));
  }
  const out = new Map<string, EnginePoint>();
  for (const id of order) {
    const r = radii[depth.get(id)!],
      angle = angles.get(id)!;
    out.set(id, { x: Math.cos(angle) * r, y: Math.sin(angle) * r });
  }
  return out;
}

interface Box {
  ids: string[];
  minX: number;
  maxX: number;
  minY: number;
  maxY: number;
}
const boxOf = (ids: string[], at: ReadonlyMap<string, EnginePoint>): Box => {
  let minX = Infinity,
    maxX = -Infinity,
    minY = Infinity,
    maxY = -Infinity;
  for (const id of ids) {
    const q = at.get(id)!;
    minX = Math.min(minX, q.x);
    maxX = Math.max(maxX, q.x);
    minY = Math.min(minY, q.y);
    maxY = Math.max(maxY, q.y);
  }
  return { ids, minX, maxX, minY, maxY };
};

/**
 * Arrange separately laid out parts on shelves approaching the stage
 * proportion, largest first, then centre the whole on the origin.
 */
function pack(
  parts: string[][],
  at: Map<string, EnginePoint>,
  gutter: number,
  align: 'center' | 'start' = 'center',
  largestFirst = true,
): Map<string, EnginePoint> {
  const boxes = parts.map((ids) => boxOf(ids, at));
  const width = (b: Box): number => b.maxX - b.minX,
    height = (b: Box): number => b.maxY - b.minY;
  const order = boxes.map((box, index) => ({ box, index }));
  if (largestFirst)
    order.sort(
      (a, b) =>
        (width(b.box) + gutter) * (height(b.box) + gutter) -
          (width(a.box) + gutter) * (height(a.box) + gutter) || compare(a.box.ids[0], b.box.ids[0]),
    );
  const area = boxes.reduce((sum, b) => sum + (width(b) + gutter) * (height(b) + gutter), 0);
  const limit = Math.max(...boxes.map((b) => width(b)), Math.sqrt(area * ASPECT));
  const rows: { box: Box; x: number }[][] = [[]];
  let x = 0;
  for (const { box } of order) {
    if (rows.at(-1)!.length && x + width(box) > limit) {
      rows.push([]);
      x = 0;
    }
    rows.at(-1)!.push({ box, x });
    x += width(box) + gutter;
  }
  let y = 0;
  const out = new Map<string, EnginePoint>();
  for (const row of rows) {
    const rowHeight = Math.max(...row.map((entry) => height(entry.box)));
    const rowWidth = row.at(-1)!.x + width(row.at(-1)!.box);
    for (const { box, x: left } of row) {
      const top = align === 'start' ? y : y + (rowHeight - height(box)) / 2;
      for (const id of box.ids) {
        const q = at.get(id)!;
        out.set(id, { x: q.x - box.minX + left - rowWidth / 2, y: q.y - box.minY + top });
      }
    }
    y += rowHeight + gutter;
  }
  const all = boxOf([...out.keys()], out);
  const cx = (all.minX + all.maxX) / 2,
    cy = (all.minY + all.maxY) / 2;
  for (const q of out.values()) {
    q.x -= cx;
    q.y -= cy;
  }
  return out;
}

/** Isolated nodes as a compact block, grouped and ordered for calm reading. */
function blockOf(p: Prepared, ids: string[], spacing: number): Map<string, EnginePoint> {
  const sorted = [...ids].sort(
    (a, b) =>
      compare(p.kind.get(a) ?? '', p.kind.get(b) ?? '') ||
      (p.importance.get(b) ?? 0) - (p.importance.get(a) ?? 0) ||
      compare(a, b),
  );
  const dx = spacing * 1.15,
    dy = spacing * 0.62;
  const columns = Math.max(1, Math.ceil(Math.sqrt((sorted.length * ASPECT * dy) / dx)));
  return new Map(
    sorted.map((id, i) => [id, { x: (i % columns) * dx, y: Math.floor(i / columns) * dy }]),
  );
}

/**
 * A tidy matrix for items that are compared rather than connected. This is
 * the one engine that keeps the author's order: a list has a reading order.
 */
function gridLayout(p: Prepared, { spacing }: EngineOptions): Map<string, EnginePoint> {
  const byGroup = new Map<string, string[]>();
  for (const id of p.authored) {
    const key = p.group.get(id) ?? '\uffff';
    byGroup.set(key, [...(byGroup.get(key) ?? []), id]);
  }
  const at = new Map<string, EnginePoint>(),
    parts: string[][] = [];
  const dx = spacing * 1.15,
    dy = spacing * 0.62;
  for (const members of byGroup.values()) {
    const columns = Math.max(1, Math.ceil(Math.sqrt((members.length * ASPECT * dy) / dx)));
    members.forEach((id, i) =>
      at.set(id, { x: (i % columns) * dx, y: Math.floor(i / columns) * dy }),
    );
    parts.push(members);
  }
  if (!parts.length) return at;
  return parts.length > 1 ? pack(parts, at, spacing * 0.9, 'start', false) : pack(parts, at, 0);
}

/**
 * Fruchterman–Reingold relaxation with group cohesion and a landscape bias.
 * Starts from the radial tree, which already has few crossings, so a bounded
 * number of steps is enough to settle.
 */
function relax(
  p: Prepared,
  members: readonly string[],
  at: Map<string, EnginePoint>,
  fixed: ReadonlySet<string>,
  centre: EnginePoint,
  { seed, spacing: k, iterations }: EngineOptions,
): void {
  const n = members.length;
  if (n < 2) return;
  const inside = new Set(members),
    links = p.pairs.filter((l) => inside.has(l.source) && inside.has(l.target));
  const groups = new Map<string, string[]>();
  for (const id of members) {
    const g = p.group.get(id);
    if (g) groups.set(g, [...(groups.get(g) ?? []), id]);
  }
  const cohesive = [...groups.entries()].filter(([, ids]) => ids.length > 1 && ids.length < n);
  // Keep the pair loop affordable for large graphs.
  const steps = Math.min(iterations, Math.max(24, Math.floor(4e7 / (n * n))));
  const force = new Map(members.map((id) => [id, { x: 0, y: 0 }]));
  const movable = members.filter((id) => !fixed.has(id));
  for (let step = 0; step < steps; step++) {
    for (const f of force.values()) f.x = f.y = 0;
    for (let i = 0; i < n; i++) {
      const a = members[i],
        pa = at.get(a)!,
        ga = p.group.get(a);
      for (let j = i + 1; j < n; j++) {
        const b = members[j],
          pb = at.get(b)!;
        let dx = pa.x - pb.x,
          dy = pa.y - pb.y,
          d = Math.hypot(dx, dy);
        if (!Number.isFinite(d)) continue;
        if (d < k * 0.01) {
          const angle = hash(a + ':' + b, seed) * TAU;
          dx = Math.cos(angle);
          dy = Math.sin(angle);
          d = k * 0.01;
          dx *= d;
          dy *= d;
        }
        const gb = p.group.get(b);
        // Different groups keep a clear channel between their hulls.
        const push = ((k * k) / d) * (ga && gb ? (ga === gb ? 0.85 : 1.7) : 1);
        const fa = force.get(a)!,
          fb = force.get(b)!;
        fa.x += (dx / d) * push;
        fa.y += (dy / d) * push;
        fb.x -= (dx / d) * push;
        fb.y -= (dy / d) * push;
      }
    }
    for (const link of links) {
      const pa = at.get(link.source)!,
        pb = at.get(link.target)!;
      const dx = pb.x - pa.x,
        dy = pb.y - pa.y,
        d = Math.hypot(dx, dy);
      if (!(d > 0) || !Number.isFinite(d)) continue;
      const pull = ((d * d) / k) * link.weight;
      const fa = force.get(link.source)!,
        fb = force.get(link.target)!;
      fa.x += (dx / d) * pull;
      fa.y += (dy / d) * pull;
      fb.x -= (dx / d) * pull;
      fb.y -= (dy / d) * pull;
    }
    for (const [, ids] of cohesive) {
      let cx = 0,
        cy = 0;
      for (const id of ids) {
        cx += at.get(id)!.x / ids.length;
        cy += at.get(id)!.y / ids.length;
      }
      for (const id of ids) {
        const q = at.get(id)!,
          f = force.get(id)!;
        f.x += (cx - q.x) * 0.8;
        f.y += (cy - q.y) * 0.8;
      }
    }
    // Stronger vertical gravity flattens the result towards the stage shape.
    for (const id of movable) {
      const q = at.get(id)!,
        f = force.get(id)!;
      f.x += (centre.x - q.x) * 0.05;
      f.y += (centre.y - q.y) * 0.05 * ASPECT * ASPECT;
    }
    const cooling = 1 - step / steps,
      limit = k * (0.02 + 0.6 * cooling * cooling);
    for (const id of movable) {
      const q = at.get(id)!,
        f = force.get(id)!,
        length = Math.hypot(f.x, f.y);
      if (!(length > 0) || !Number.isFinite(length)) continue;
      const move = Math.min(length, limit) / length;
      const x = q.x + f.x * move,
        y = q.y + f.y * move;
      if (Number.isFinite(x) && Number.isFinite(y)) {
        q.x = x;
        q.y = y;
      }
    }
  }
  separate(members, at, fixed, k, seed);
}

/**
 * Guarantee room for glyphs and labels. Labels run sideways, so nodes may sit
 * closer above one another than beside one another.
 */
function separate(
  members: readonly string[],
  at: Map<string, EnginePoint>,
  fixed: ReadonlySet<string>,
  k: number,
  seed: number,
): void {
  const n = members.length,
    minX = k * 0.72,
    minY = k * 0.48;
  for (let sweep = 0; sweep < 40; sweep++) {
    let moved = false;
    for (let i = 0; i < n; i++)
      for (let j = i + 1; j < n; j++) {
        const a = members[i],
          b = members[j],
          pa = at.get(a)!,
          pb = at.get(b)!;
        const dx = pb.x - pa.x,
          dy = pb.y - pa.y;
        const overlap = 1 - Math.hypot(dx / minX, dy / minY);
        if (!(overlap > 0.02)) continue;
        const fa = fixed.has(a),
          fb = fixed.has(b);
        if (fa && fb) continue;
        let ux = dx / minX,
          uy = dy / minY;
        const length = Math.hypot(ux, uy);
        if (length < 1e-6) {
          const angle = hash(a + ':' + b + ':gap', seed) * TAU;
          ux = Math.cos(angle);
          uy = Math.sin(angle);
        } else {
          ux /= length;
          uy /= length;
        }
        const shiftX = ux * overlap * minX * 0.5,
          shiftY = uy * overlap * minY * 0.5;
        if (!fa) {
          pa.x -= fb ? shiftX * 2 : shiftX;
          pa.y -= fb ? shiftY * 2 : shiftY;
        }
        if (!fb) {
          pb.x += fa ? shiftX * 2 : shiftX;
          pb.y += fa ? shiftY * 2 : shiftY;
        }
        moved = true;
      }
    if (!moved) break;
  }
}

/**
 * Fit a relaxed part to the stage: turn its longest axis level (a rotation
 * changes no distance), then, if it is still too tall, lower it gently and
 * restore the room between nodes.
 */
function landscape(
  members: readonly string[],
  at: Map<string, EnginePoint>,
  k: number,
  seed: number,
): void {
  const n = members.length;
  if (n < 3) return;
  let cx = 0,
    cy = 0;
  for (const id of members) {
    cx += at.get(id)!.x / n;
    cy += at.get(id)!.y / n;
  }
  let sxx = 0,
    syy = 0,
    sxy = 0;
  for (const id of members) {
    const q = at.get(id)!;
    sxx += (q.x - cx) * (q.x - cx);
    syy += (q.y - cy) * (q.y - cy);
    sxy += (q.x - cx) * (q.y - cy);
  }
  // Principal axis; a nearly round part has none worth turning to.
  const spread = Math.hypot(sxx - syy, 2 * sxy);
  const angle = spread > (sxx + syy) * 0.12 ? 0.5 * Math.atan2(2 * sxy, sxx - syy) : 0;
  const cos = Math.cos(-angle),
    sin = Math.sin(-angle);
  let minX = Infinity,
    maxX = -Infinity,
    minY = Infinity,
    maxY = -Infinity;
  for (const id of members) {
    const q = at.get(id)!,
      x = (q.x - cx) * cos - (q.y - cy) * sin,
      y = (q.x - cx) * sin + (q.y - cy) * cos;
    q.x = x;
    q.y = y;
    minX = Math.min(minX, x);
    maxX = Math.max(maxX, x);
    minY = Math.min(minY, y);
    maxY = Math.max(maxY, y);
  }
  const width = maxX - minX,
    height = maxY - minY;
  if (!(height > k) || !(width > 0)) return;
  const squash = Math.max(0.55, Math.min(1, width / height / ASPECT));
  if (squash < 0.98) {
    for (const id of members) at.get(id)!.y *= squash;
    separate(members, at, new Set(), k, seed);
  }
}

function forceLayout(p: Prepared, options: EngineOptions): Map<string, EnginePoint> {
  const { seed, spacing } = options,
    fixed = options.fixed ?? new Map<string, EnginePoint>();
  const at = new Map<string, EnginePoint>();
  const jitter = (id: string, q: EnginePoint): EnginePoint => {
    const angle = hash(id + ':angle', seed) * TAU,
      r = spacing * 0.12 * hash(id + ':radius', seed);
    return { x: q.x + Math.cos(angle) * r, y: (q.y + Math.sin(angle) * r) * 0.62 };
  };
  if (fixed.size) {
    // Anchors define the frame; free nodes settle around their fixed neighbours.
    let cx = 0,
      cy = 0;
    for (const q of fixed.values()) {
      cx += q.x / fixed.size;
      cy += q.y / fixed.size;
    }
    for (const [id, q] of fixed) at.set(id, { ...q });
    const free = p.ids.filter((id) => !fixed.has(id));
    free.forEach((id, index) => {
      const anchors = (p.neighbours.get(id) ?? [])
        .map((v) => fixed.get(v))
        .filter((q): q is EnginePoint => q !== undefined);
      const base = anchors.length
        ? {
            x: anchors.reduce((sum, q) => sum + q.x / anchors.length, 0),
            y: anchors.reduce((sum, q) => sum + q.y / anchors.length, 0),
          }
        : { x: cx, y: cy };
      const angle = hash(id + ':angle', seed) * TAU,
        r = anchors.length ? spacing * 0.4 : spacing * 0.9 * Math.sqrt(index + 1);
      at.set(id, { x: base.x + Math.cos(angle) * r, y: base.y + Math.sin(angle) * r * 0.62 });
    });
    relax(p, p.ids, at, new Set(fixed.keys()), { x: cx, y: cy }, options);
    return at;
  }
  const parts: string[][] = [],
    singles: string[] = [];
  for (const members of clustersOf(p)) {
    if (members.length === 1) {
      singles.push(members[0]);
      continue;
    }
    // A cluster may hold several connected parts that only share a group:
    // start each from its own tree, side by side, then relax them as one.
    const pieces = componentsOf(p, members);
    for (const piece of pieces)
      for (const [id, q] of radialPositions(p, piece, spacing * 0.8, 0)) at.set(id, jitter(id, q));
    if (pieces.length > 1) for (const [id, q] of pack(pieces, at, spacing * 0.6)) at.set(id, q);
    relax(p, members, at, new Set(), { x: 0, y: 0 }, options);
    landscape(members, at, spacing, seed);
    parts.push(members);
  }
  if (singles.length) {
    for (const [id, q] of blockOf(p, singles, spacing)) at.set(id, q);
    parts.push(singles.sort(compare));
  }
  return parts.length ? pack(parts, at, spacing * 1.1) : at;
}

/** Iterative Kosaraju: cycles are components, never guessed generations. */
function stronglyConnected(ids: string[], adj: Map<string, string[]>): string[][] {
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
function ranksOf(p: Prepared, members: string[]): Map<string, number> {
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
 * Layered drawing: ranks from structure, barycentre sweeps against crossings,
 * then each row is pulled under (or beside) the nodes it connects to.
 */
function layeredLayout(
  p: Prepared,
  { spacing }: EngineOptions,
  horizontal: boolean,
): Map<string, EnginePoint> {
  // Labels run sideways: ranks need more room when they advance horizontally.
  const across = horizontal ? spacing * 0.7 : spacing * 1.15,
    along = horizontal ? spacing * 1.45 : spacing * 0.85;
  const at = new Map<string, EnginePoint>(),
    parts: string[][] = [];
  for (const members of componentsOf(p)) {
    const ranks = ranksOf(p, members),
      inside = new Set(members);
    const rows: string[][] = [];
    for (const id of members) (rows[ranks.get(id) ?? 0] ??= []).push(id);
    for (let r = 0; r < rows.length; r++) rows[r] ??= [];
    const slot = new Map<string, number>();
    const index = (): void => rows.forEach((row) => row.forEach((id, i) => slot.set(id, i)));
    index();
    const linked = (id: string, test: (rank: number) => boolean): string[] =>
      (p.neighbours.get(id) ?? []).filter((v) => inside.has(v) && test(ranks.get(v)!));
    // Groups stay together inside a rank, in the order their members favour,
    // so their hulls become bands instead of interleaving.
    const bandOf = (id: string): string => p.group.get(id) ?? '\0' + id;
    for (let sweep = 0; sweep < 12; sweep++) {
      const down = sweep % 2 === 0;
      for (let step = 0; step < rows.length; step++) {
        const r = down ? step : rows.length - 1 - step;
        const key = new Map<string, number>();
        for (const id of rows[r]) {
          const others = linked(id, (rank) => (down ? rank < r : rank > r));
          key.set(
            id,
            others.length
              ? others.reduce(
                  (sum, v) => sum + (slot.get(v)! + 0.5) / Math.max(1, rows[ranks.get(v)!].length),
                  0,
                ) / others.length
              : (slot.get(id)! + 0.5) / Math.max(1, rows[r].length),
          );
        }
        const band = new Map<string, { sum: number; count: number }>();
        for (const id of members) {
          const entry = band.get(bandOf(id)) ?? { sum: 0, count: 0 };
          entry.sum +=
            key.get(id) ?? (slot.get(id)! + 0.5) / Math.max(1, rows[ranks.get(id)!].length);
          entry.count++;
          band.set(bandOf(id), entry);
        }
        const bandKey = (id: string): number => {
          const entry = band.get(bandOf(id))!;
          return entry.sum / entry.count;
        };
        rows[r].sort(
          (a, b) =>
            bandKey(a) - bandKey(b) ||
            compare(bandOf(a), bandOf(b)) ||
            key.get(a)! - key.get(b)! ||
            compare(a, b),
        );
        rows[r].forEach((id, i) => slot.set(id, i));
      }
    }
    // Neighbours of different groups keep a wider channel for their hulls.
    const room = (row: string[], i: number): number =>
      across * (p.group.get(row[i]) === p.group.get(row[i - 1]) ? 1 : 1.45);
    const offset = new Map<string, number>();
    for (const row of rows) {
      let cursor = 0;
      const placed = row.map((_, i) => (cursor += i ? room(row, i) : 0));
      row.forEach((id, i) => offset.set(id, placed[i] - cursor / 2));
    }
    for (let sweep = 0; sweep < 8; sweep++) {
      const down = sweep % 2 === 0;
      for (let step = 0; step < rows.length; step++) {
        const row = rows[down ? step : rows.length - 1 - step];
        if (!row.length) continue;
        const wish = row.map((id) => {
          const others = linked(id, (rank) => rank !== ranks.get(id));
          return others.length
            ? others.reduce((sum, v) => sum + offset.get(v)!, 0) / others.length
            : offset.get(id)!;
        });
        // Two feasible placements, packed from either side; their mean keeps
        // the order and the separation while staying close to every wish.
        const left = [...wish],
          right = [...wish];
        for (let i = 1; i < row.length; i++)
          left[i] = Math.max(left[i], left[i - 1] + room(row, i));
        for (let i = row.length - 2; i >= 0; i--)
          right[i] = Math.min(right[i], right[i + 1] - room(row, i + 1));
        row.forEach((id, i) => offset.set(id, (left[i] + right[i]) / 2));
      }
    }
    for (const id of members) {
      const a = offset.get(id)!,
        b = (ranks.get(id) ?? 0) * along;
      at.set(id, horizontal ? { x: b, y: a } : { x: a, y: b });
    }
    parts.push(members);
  }
  if (!parts.length) return at;
  return pack(parts, at, spacing, 'start');
}

function radialLayout(p: Prepared, { seed, spacing }: EngineOptions): Map<string, EnginePoint> {
  const rotation = (seed / 0x100000000) * TAU - Math.PI / 2;
  const at = new Map<string, EnginePoint>(),
    parts: string[][] = [],
    singles: string[] = [];
  for (const members of componentsOf(p)) {
    if (members.length === 1) {
      singles.push(members[0]);
      continue;
    }
    // Slightly wider than tall: labels need the room, and so does the stage.
    for (const [id, q] of radialPositions(p, members, spacing, rotation))
      at.set(id, { x: q.x * 1.45, y: q.y * 0.9 });
    parts.push(members);
  }
  if (singles.length) {
    for (const [id, q] of blockOf(p, singles, spacing)) at.set(id, q);
    parts.push(singles.sort(compare));
  }
  return parts.length ? pack(parts, at, spacing * 1.1) : at;
}

/** One ring: groups stay contiguous, and neighbours are drawn towards each other. */
function circleLayout(p: Prepared, { seed, spacing }: EngineOptions): Map<string, EnginePoint> {
  const n = p.ids.length;
  if (!n) return new Map();
  const blockKey = (id: string): string => p.group.get(id) ?? '￿';
  let order = [...p.ids].sort((a, b) => compare(blockKey(a), blockKey(b)) || compare(a, b));
  const blocks = new Set(order.map(blockKey)).size;
  // A small pause between groups; one group needs none.
  const gap = blocks > 1 ? 0.7 : 0;
  const slots = (): Map<string, number> => {
    const total = n + blocks * gap,
      out = new Map<string, number>();
    let cursor = 0;
    order.forEach((id, i) => {
      if (i && blockKey(id) !== blockKey(order[i - 1])) cursor += gap;
      out.set(id, (cursor / total) * TAU);
      cursor += 1;
    });
    return out;
  };
  for (let sweep = 0; sweep < 8; sweep++) {
    const angle = slots();
    const wish = new Map<string, number>();
    for (const id of order) {
      const own = angle.get(id)!;
      let x = Math.cos(own) * 0.5,
        y = Math.sin(own) * 0.5;
      for (const v of p.neighbours.get(id) ?? []) {
        x += Math.cos(angle.get(v)!);
        y += Math.sin(angle.get(v)!);
      }
      // Relative to the node's own slot, so a block never wraps around the ring.
      let delta = Math.atan2(y, x) - own;
      while (delta > Math.PI) delta -= TAU;
      while (delta < -Math.PI) delta += TAU;
      wish.set(id, own + delta);
    }
    order = [...order].sort(
      (a, b) => compare(blockKey(a), blockKey(b)) || wish.get(a)! - wish.get(b)! || compare(a, b),
    );
  }
  const angle = slots(),
    radius = Math.max(spacing, ((n + blocks * gap) * spacing) / TAU),
    rotation = (seed / 0x100000000) * TAU - Math.PI / 2;
  return new Map(
    order.map((id) => [
      id,
      {
        x: Math.cos(rotation + angle.get(id)!) * radius,
        y: Math.sin(rotation + angle.get(id)!) * radius,
      },
    ]),
  );
}

/**
 * Pick the engine that suits the structure: a grid for unrelated items, a
 * layered drawing for hierarchies and pipelines (downwards when broad,
 * sideways when deep), rings for trees, forces for everything else.
 */
export function chooseLayoutEngine(graph: LayoutGraph): LayoutEngine {
  const p = prepare(graph);
  if (!p.pairs.length) return 'grid';
  const directed = p.pairs.filter((l) => l.directed).length;
  if (directed >= p.pairs.length * 0.7) {
    const adj = new Map(p.ids.map((id) => [id, [] as string[]]));
    for (const a of p.arcs) adj.get(a.source)!.push(a.target);
    if (stronglyConnected(p.ids, adj).every((group) => group.length === 1)) {
      const connected = p.ids.filter((id) => p.degree.get(id));
      let depth = 0,
        breadth = 0;
      for (const members of componentsOf(p, connected)) {
        const counts = new Map<number, number>();
        for (const rank of ranksOf(p, members).values())
          counts.set(rank, (counts.get(rank) ?? 0) + 1);
        depth = Math.max(depth, counts.size);
        breadth = Math.max(breadth, ...counts.values());
      }
      return breadth >= depth ? 'layered' : 'flow';
    }
  }
  const connected = p.ids.filter((id) => p.degree.get(id));
  const parts = componentsOf(p, connected);
  if (connected.length >= 3 && p.pairs.length === connected.length - parts.length) return 'radial';
  return 'force';
}

/** Lay out every node with one engine. Fixed nodes are honoured by `force` only. */
export function runLayoutEngine(
  graph: LayoutGraph,
  engine: LayoutEngine,
  options: EngineOptions,
): Map<string, EnginePoint> {
  const p = prepare(graph);
  const result =
    engine === 'force'
      ? forceLayout(p, options)
      : engine === 'layered'
        ? layeredLayout(p, options, false)
        : engine === 'flow'
          ? layeredLayout(p, options, true)
          : engine === 'radial'
            ? radialLayout(p, options)
            : engine === 'circle'
              ? circleLayout(p, options)
              : gridLayout(p, options);
  return new Map([...result].sort(([a], [b]) => compare(a, b)));
}

/** The engine `chooseLayoutEngine` selects, with sensible film defaults. */
export function autoLayout(
  graph: LayoutGraph,
  options: Partial<EngineOptions> = {},
): Map<string, EnginePoint> {
  // The pairwise force model is not meant for thousands of nodes.
  const engine = graph.nodes.length > 1500 ? 'grid' : chooseLayoutEngine(graph);
  return runLayoutEngine(graph, engine, { seed: 0, spacing: 150, iterations: 300, ...options });
}
