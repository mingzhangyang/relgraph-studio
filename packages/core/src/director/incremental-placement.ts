/**
 * Neighbour-aware incremental placement (ADR 004, D2b): fill the coordinates
 * a drawing lacks without moving any it has. Authoring-time only, like the
 * engines; the player's fallback for partly positioned documents
 * (`layoutGraph`) does not use it, so no existing film moves.
 *
 * Every coordinate passed in `anchors` is returned exactly as given. Each new
 * node then goes, one at a time, to the nearest free place to where its
 * acquaintances suggest:
 *
 * 1. The order: the node with the most placed neighbours first (ties by id),
 *    so a node joins the drawing through the people it knows, and a node
 *    known only to other new nodes waits until one of them is placed.
 * 2. The starting point: the barycentre of its placed neighbours, shifted by
 *    the offset the chosen engine gives it from those neighbours. The engine
 *    draws the whole graph once (above `PLACEMENT_LOCAL_LIMIT` nodes, only
 *    the new nodes' neighbourhood, so a few gaps in a large drawing stay
 *    cheap); that drawing is aligned to the anchors by a
 *    least-squares similarity (rotation, reflection, uniform scale), and the
 *    offset counts as much as the alignment explains the anchors (R²), and
 *    never takes the node more than two rooms (below) from where it starts. A
 *    drawing made with the same engine thus gets each new node where the
 *    engine would put it (a child below its parent in layers, outward on a
 *    ring); a drawing the engine does not resemble gets the plain barycentre,
 *    leaning away from the drawing's centre. A node with no placed neighbour
 *    starts from the placed members of its group, else from the whole
 *    drawing, the same way.
 * 3. The free place: the nearest point, on a grid of a tenth of the room
 *    within six rooms, that keeps the room the engines keep between glyphs
 *    (an ellipse, wider than tall, since labels run sideways), that no
 *    relation passes beside, and whose own relations pass beside no other
 *    node. If none is found the relation rules are dropped; if still none,
 *    the search spirals further out. The room is the spacing, scaled by how
 *    much sparser or denser the anchors are drawn than the engine draws the
 *    same nodes (`typicalGap`), since the camera fits the whole drawing.
 *
 * With `chronologyTolerance`, a new node also keeps time in order along x
 * against every placed node, as `relgraph check-layout` checks it: its
 * starting point is moved into the x its time allows and every candidate
 * must lie there.
 *
 * On a timeline that keeps time (`axis`), a dated node's x is its date, and
 * its lane is the free lane nearest its neighbours' lanes (`anchorToTime`
 * with `neighbours`). Only undated nodes go through the free-place search.
 *
 * Relations are checked as straight segments here; how they are drawn
 * (bowed, in screen space) is what `relgraph check-layout` checks.
 */
import type { VisualGraph } from '../../types/visual-graph.js';
import { compare, prepare, type Prepared } from '../graph/analysis.js';
import { placeInTime, type TimeAxis } from '../graph/time-axis.js';
import { nodeTimes } from './chronology.js';
import type { LayoutEngine } from '../project-layout.js';
import { runLayoutEngine } from './layout-engines.js';
import { layoutMissingNodes, roundPositionCoordinate, type LayoutPoint } from './seeded-layout.js';
import { anchorToTime } from './time-anchor.js';

type PlacementGraph = Pick<
  VisualGraph,
  'nodes' | 'edges' | 'diagram' | 'project' | 'timeAxis' | 'timeline'
>;

export interface PlacementOptions {
  /** The engine whose drawing gives a new node its direction from its neighbours. */
  engine: LayoutEngine;
  seed: number;
  /** Preferred distance between neighbouring nodes, in world units; sets every room below. */
  spacing: number;
  iterations: number;
  /** The time axis the drawing keeps, if any (`timeAnchor`). */
  axis?: TimeAxis | null;
  /**
   * Keep time in order along x, as `relgraph check-layout
   * --chronology-tolerance` checks it: a new node whose time (`nodeTimes`)
   * differs from a placed node's by at least this much goes on the side of
   * it that its time says. Opt-in, for drawings whose x means time without
   * being a timeline that keeps time; ignored where existing nodes already
   * leave no room in order (they are never moved).
   */
  chronologyTolerance?: number;
}

/**
 * The room a placed node keeps, as shares of the spacing: the half-axes of
 * the ellipse no other node may enter (the engines' `separate`), how close a
 * relation may pass a node it does not join, the longest offset taken from
 * the engine, how far the search reaches and its grid step.
 */
export const PLACEMENT_ROOM = Object.freeze({
  across: 0.72,
  down: 0.48,
  clearance: 0.3,
  offset: 2,
  reach: 6,
  step: 0.1,
});

/** Beyond this magnitude, differences of coordinates are not trusted to be finite. */
const EXTREME = 1e9;
/** `typicalGap` measures every point up to this many, else a sample of `GAP_SAMPLE`. */
const GAP_SAMPLE_ABOVE = 400,
  GAP_SAMPLE = 200;
/**
 * Up to this many nodes the engine draws the whole graph. Above it, it draws
 * the new nodes and the nodes within `LOCAL_HOPS` relations of them, at most
 * this many beyond twice the new ones, so filling a few gaps in a large
 * drawing costs what the neighbourhood costs, not what the graph costs.
 */
export const PLACEMENT_LOCAL_LIMIT = 400;
const LOCAL_HOPS = 2;

interface Alignment {
  /** Maps an offset in the engine's drawing to an offset in the anchors' drawing. */
  apply(v: LayoutPoint): LayoutPoint;
  /** How much of the anchors' spread the aligned engine drawing explains, 0–1. */
  weight: number;
}
const IDENTITY: Alignment = { apply: (v) => ({ ...v }), weight: 1 };

/**
 * The least-squares similarity taking engine points to anchor points
 * (orthogonal Procrustes with uniform scale, reflection allowed). With fewer
 * than two distinct points there is nothing to align, so the engine's own
 * orientation and scale are kept.
 */
export function alignDrawings(pairs: readonly (readonly [LayoutPoint, LayoutPoint])[]): Alignment {
  const n = pairs.length;
  if (n < 2) return IDENTITY;
  let ex = 0,
    ey = 0,
    ax = 0,
    ay = 0;
  for (const [e, a] of pairs) {
    ex += e.x / n;
    ey += e.y / n;
    ax += a.x / n;
    ay += a.y / n;
  }
  let see = 0,
    saa = 0,
    sc = 0,
    ss = 0,
    rc = 0,
    rs = 0;
  for (const [e, a] of pairs) {
    const Ex = e.x - ex,
      Ey = e.y - ey,
      Ax = a.x - ax,
      Ay = a.y - ay;
    see += Ex * Ex + Ey * Ey;
    saa += Ax * Ax + Ay * Ay;
    sc += Ex * Ax + Ey * Ay;
    ss += Ex * Ay - Ey * Ax;
    // The same sums for the engine drawing mirrored top to bottom.
    rc += Ex * Ax - Ey * Ay;
    rs += Ex * Ay + Ey * Ax;
  }
  if (!(see > 0) || !(saa > 0) || !Number.isFinite(see + saa)) return IDENTITY;
  const direct = Math.hypot(sc, ss),
    mirrored = Math.hypot(rc, rs);
  const flip = mirrored > direct * (1 + 1e-9),
    best = flip ? mirrored : direct;
  if (!(best > 0)) return { apply: () => ({ x: 0, y: 0 }), weight: 0 };
  const cos = (flip ? rc : sc) / best,
    sin = (flip ? rs : ss) / best,
    scale = Math.min(4, Math.max(0.25, best / see)),
    weight = Math.min(1, Math.max(0, (best * best) / (see * saa)));
  return {
    apply: ({ x, y: raw }) => {
      const y = flip ? -raw : raw;
      return { x: scale * (cos * x - sin * y), y: scale * (sin * x + cos * y) };
    },
    weight,
  };
}

const round = (value: number): number => roundPositionCoordinate(value) || 0;
const mean = (points: readonly LayoutPoint[]): LayoutPoint => {
  let x = 0,
    y = 0;
  for (const p of points) {
    x += p.x / points.length;
    y += p.y / points.length;
  }
  return { x, y };
};

/**
 * Whether a segment from `a` to `b` passes within `limit` of `p` beside it:
 * the nearest point of the segment lies strictly between its ends. A point
 * beyond an end is a matter of the ends' own room.
 */
function passesBeside(p: LayoutPoint, a: LayoutPoint, b: LayoutPoint, limit: number): boolean {
  if (
    p.x < Math.min(a.x, b.x) - limit ||
    p.x > Math.max(a.x, b.x) + limit ||
    p.y < Math.min(a.y, b.y) - limit ||
    p.y > Math.max(a.y, b.y) + limit
  )
    return false;
  const dx = b.x - a.x,
    dy = b.y - a.y,
    length2 = dx * dx + dy * dy;
  if (!(length2 > 0)) return false;
  const u = ((p.x - a.x) * dx + (p.y - a.y) * dy) / length2;
  if (!(u > 0 && u < 1)) return false;
  return Math.hypot(p.x - (a.x + u * dx), p.y - (a.y + u * dy)) < limit;
}

/**
 * How far apart a drawing's nodes typically are: the median distance from
 * each point to its nearest other point; 0 with fewer than two points.
 */
export function typicalGap(points: readonly LayoutPoint[]): number {
  if (points.length < 2) return 0;
  // Above a few hundred points, the median over an evenly spaced sample (in
  // the given order) against all points: O(sample × n), not O(n²).
  const every = points.length > GAP_SAMPLE_ABOVE ? points.length / GAP_SAMPLE : 1;
  const sample: number[] = [];
  for (let k = 0; k < points.length; k += every) sample.push(Math.floor(k));
  const nearest = sample.map((i) => {
    const p = points[i];
    let best = Infinity;
    points.forEach((q, j) => {
      if (i !== j) best = Math.min(best, Math.hypot(p.x - q.x, p.y - q.y));
    });
    return best;
  });
  nearest.sort((a, b) => a - b);
  const middle = nearest.length >> 1;
  return nearest.length % 2 ? nearest[middle] : (nearest[middle - 1] + nearest[middle]) / 2;
}

/** Grid offsets within `reach` steps, nearest first; ties upward, then leftward. */
function searchOrder(reach: number): [number, number][] {
  const out: [number, number][] = [];
  for (let j = -reach; j <= reach; j++)
    for (let i = -reach; i <= reach; i++) if (i * i + j * j <= reach * reach) out.push([i, j]);
  return out.sort(
    (p, q) => p[0] * p[0] + p[1] * p[1] - (q[0] * q[0] + q[1] * q[1]) || p[1] - q[1] || p[0] - q[0],
  );
}

/**
 * The nodes the engine draws: all of them in a graph of at most
 * `PLACEMENT_LOCAL_LIMIT` nodes, else the new nodes and, breadth first in id
 * order, the nodes within `LOCAL_HOPS` relations of them.
 */
function neighbourhood(p: Prepared, fresh: readonly string[]): Set<string> {
  if (p.ids.length <= PLACEMENT_LOCAL_LIMIT) return new Set(p.ids);
  const cap = Math.max(PLACEMENT_LOCAL_LIMIT, fresh.length * 2),
    seen = new Set(fresh);
  let frontier = [...fresh];
  for (let hop = 0; hop < LOCAL_HOPS && frontier.length && seen.size < cap; hop++) {
    const next: string[] = [];
    for (const id of frontier)
      for (const v of p.neighbours.get(id) ?? [])
        if (!seen.has(v) && seen.size < cap) {
          seen.add(v);
          next.push(v);
        }
    frontier = next.sort(compare);
  }
  return seen;
}

/**
 * Coordinates for every node of `graph`: those in `anchors` exactly as given,
 * the others placed beside their acquaintances (see the module comment).
 * Deterministic, and independent of the order of nodes and relations.
 */
export function placeIncrementally(
  graph: PlacementGraph,
  anchors: ReadonlyMap<string, LayoutPoint>,
  { engine, seed, spacing, iterations, axis = null, chronologyTolerance }: PlacementOptions,
): Map<string, LayoutPoint> {
  if (
    chronologyTolerance !== undefined &&
    !(Number.isFinite(chronologyTolerance) && chronologyTolerance >= 0)
  )
    throw new RangeError('Chronology tolerance must be a finite number ≥ 0');
  const ids = graph.nodes.map((n) => n.id).sort(compare);
  const out = new Map<string, LayoutPoint>();
  for (const id of ids) {
    const p = anchors.get(id);
    if (p) out.set(id, { x: p.x, y: p.y });
  }
  const fresh = ids.filter((id) => !out.has(id));
  const sorted = (): Map<string, LayoutPoint> =>
    new Map([...out].sort(([a], [b]) => compare(a, b)));
  const byId = new Map(graph.nodes.map((n) => [n.id, n]));
  const dated = (id: string): boolean => Boolean(axis && placeInTime(byId.get(id)!, axis) !== null);

  // Anchors beyond any drawable range keep the overflow-safe force solver.
  if ([...out.values()].some((p) => Math.abs(p.x) > EXTREME || Math.abs(p.y) > EXTREME)) {
    const nodes = graph.nodes.map((n) => ({ ...n, position: out.get(n.id) }));
    const result = layoutMissingNodes({ nodes, edges: graph.edges }, { seed, iterations, spacing });
    anchorToTime(graph, result, { axis, spacing, unplaced: new Set(fresh.filter(dated)) });
    return new Map([...result].sort(([a], [b]) => compare(a, b)));
  }
  if (!fresh.length) {
    anchorToTime(graph, out, { axis, spacing });
    return sorted();
  }
  const p = prepare(graph);
  const local = neighbourhood(p, fresh);
  const drawn = runLayoutEngine(
    local.size === ids.length
      ? graph
      : {
          nodes: graph.nodes.filter((n) => local.has(n.id)),
          edges: graph.edges.filter((e) => local.has(e.source) && local.has(e.target)),
        },
    engine,
    { seed, spacing, iterations },
  );
  // Nothing to keep: the engine's drawing is the placement.
  if (!out.size) {
    for (const id of ids) {
      const p = drawn.get(id) ?? { x: 0, y: 0 };
      out.set(id, { x: round(p.x), y: round(p.y) });
    }
    anchorToTime(graph, out, { axis, spacing });
    return sorted();
  }

  // Anchors the engine drew: the alignment and the density compare them.
  const kept = [...out.keys()].filter((id) => drawn.has(id));
  const align = alignDrawings(kept.map((id) => [drawn.get(id)!, out.get(id)!] as const));
  // The room a node needs scales with the drawing it joins: the camera fits
  // the whole drawing, so a sparser drawing is shown smaller. When the
  // engine drew only a neighbourhood, its few anchors say little about
  // density: its whole drawing is compared with all anchors instead.
  const whole = local.size === ids.length,
    engineGap = typicalGap((whole ? kept : [...drawn.keys()]).map((id) => drawn.get(id)!)),
    keptGap = typicalGap((whole ? kept : [...out.keys()]).map((id) => out.get(id)!)),
    room =
      spacing *
      (engineGap > 0 && keptGap > 0 ? Math.min(4, Math.max(0.25, keptGap / engineGap)) : 1);

  // On a timeline that keeps time, dated nodes take lanes; x is their date.
  const lanes = fresh.filter(dated);
  if (axis) {
    for (const id of lanes) out.set(id, { ...drawn.get(id)! });
    anchorToTime(graph, out, {
      axis,
      spacing,
      unplaced: new Set(lanes),
      neighbours: p.neighbours,
    });
  }

  const across = room * PLACEMENT_ROOM.across,
    down = room * PLACEMENT_ROOM.down,
    clearance = room * PLACEMENT_ROOM.clearance,
    step = room * PLACEMENT_ROOM.step,
    offsets = searchOrder(Math.round(PLACEMENT_ROOM.reach / PLACEMENT_ROOM.step));

  // Placed nodes by grid cell, for the room test.
  const cells = new Map<string, string[]>(),
    cellOf = (q: LayoutPoint): [number, number] => [
      Math.floor(q.x / across),
      Math.floor(q.y / across),
    ];
  const index = (id: string): void => {
    const [cx, cy] = cellOf(out.get(id)!),
      key = cx + ',' + cy;
    cells.set(key, [...(cells.get(key) ?? []), id]);
  };
  for (const id of out.keys()) index(id);
  const roomy = (q: LayoutPoint): boolean => {
    const [cx, cy] = cellOf(q);
    for (let i = -1; i <= 1; i++)
      for (let j = -1; j <= 1; j++)
        for (const other of cells.get(cx + i + ',' + (cy + j)) ?? []) {
          const r = out.get(other)!;
          if (Math.hypot((q.x - r.x) / across, (q.y - r.y) / down) < 1) return false;
        }
    return true;
  };
  // Relations whose both ends are placed, as segments.
  const segments: [string, string][] = p.pairs
    .filter((l) => out.has(l.source) && out.has(l.target))
    .map((l) => [l.source, l.target]);
  /**
   * The relation test for candidates of one new node around `ideal`: no
   * relation passes beside the candidate, and none of its relations to
   * `partners` passes beside another node. Only relations and nodes near the
   * search region can fail it, so only those are kept.
   */
  const clearAround = (
    id: string,
    ideal: LayoutPoint,
    partners: readonly string[],
  ): ((q: LayoutPoint) => boolean) => {
    const reach = PLACEMENT_ROOM.reach * room + clearance,
      x0 = ideal.x - reach,
      x1 = ideal.x + reach,
      y0 = ideal.y - reach,
      y1 = ideal.y + reach;
    const near = segments
      .map(([a, b]) => [out.get(a)!, out.get(b)!] as const)
      .filter(
        ([a, b]) =>
          Math.max(a.x, b.x) >= x0 &&
          Math.min(a.x, b.x) <= x1 &&
          Math.max(a.y, b.y) >= y0 &&
          Math.min(a.y, b.y) <= y1,
      );
    const own = partners.map((m) => {
      const end = out.get(m)!,
        lx = Math.min(x0, end.x - clearance),
        hx = Math.max(x1, end.x + clearance),
        ly = Math.min(y0, end.y - clearance),
        hy = Math.max(y1, end.y + clearance);
      const others: LayoutPoint[] = [];
      for (const [other, r] of out)
        if (other !== m && other !== id && r.x >= lx && r.x <= hx && r.y >= ly && r.y <= hy)
          others.push(r);
      return { end, others };
    });
    return (q) =>
      near.every(([a, b]) => !passesBeside(q, a, b, clearance)) &&
      own.every(({ end, others }) => others.every((r) => !passesBeside(r, q, end, clearance)));
  };

  const times = chronologyTolerance === undefined ? null : nodeTimes(graph);
  /**
   * The open interval of x a node may take so that no placed node whose time
   * differs by at least the tolerance is on the wrong side of it; null when
   * there is no constraint or no room left between the placed nodes.
   */
  const inTime = (id: string): { lo: number; hi: number } | null => {
    const t = times?.get(id);
    if (t === undefined || !times) return null;
    let lo = -Infinity,
      hi = Infinity;
    for (const [other, q] of out) {
      const u = times.get(other);
      if (u === undefined || u === t || Math.abs(u - t) < chronologyTolerance!) continue;
      if (u < t) lo = Math.max(lo, q.x);
      else hi = Math.min(hi, q.x);
    }
    if (lo === -Infinity && hi === Infinity) return null;
    return hi - lo > 0.04 ? { lo, hi } : null;
  };

  const waiting = new Set(fresh.filter((id) => !lanes.includes(id)));
  while (waiting.size) {
    // The node that knows the most placed nodes joins next.
    let id = '',
      known = -1;
    for (const candidate of [...waiting].sort(compare)) {
      const count = p.neighbours.get(candidate)!.filter((v) => out.has(v)).length;
      if (count > known) {
        id = candidate;
        known = count;
      }
    }
    waiting.delete(id);
    const partners = p.neighbours.get(id)!.filter((v) => out.has(v));
    const group = byId.get(id)!.groupId;
    let reference = partners;
    if (!reference.length && group)
      reference = [...out.keys()].filter((v) => byId.get(v)?.groupId === group);
    if (!reference.length) reference = [...out.keys()];
    // Outside the drawn neighbourhood a reference node gives no direction.
    const drawnReference = reference.filter((v) => drawn.has(v));
    const bary = mean(reference.map((v) => out.get(v)!)),
      engineBary = drawnReference.length
        ? mean(drawnReference.map((v) => drawn.get(v)!))
        : drawn.get(id)!,
      own = drawn.get(id)!;
    const turned = align.apply({ x: own.x - engineBary.x, y: own.y - engineBary.y }),
      length = Math.hypot(turned.x, turned.y),
      // Wherever the engine put it, a node stays with the nodes it starts from.
      cap = length > room * PLACEMENT_ROOM.offset ? (room * PLACEMENT_ROOM.offset) / length : 1,
      offset = { x: turned.x * cap, y: turned.y * cap };
    // Where the engine says little, lean away from the centre of the drawing.
    const centre = mean([...out.values()]),
      away = Math.hypot(bary.x - centre.x, bary.y - centre.y),
      lean = away > 1e-9 ? (room * 0.25 * (1 - align.weight)) / away : 0;
    const ideal = {
      x: bary.x + offset.x * align.weight + (bary.x - centre.x) * lean,
      y: bary.y + offset.y * align.weight + (bary.y - centre.y) * lean,
    };
    // In time order, the node starts inside the x its time allows.
    const allowed = inTime(id);
    if (allowed) {
      const margin = Math.min(step, (allowed.hi - allowed.lo) / 4);
      ideal.x = Math.min(allowed.hi - margin, Math.max(allowed.lo + margin, ideal.x));
    }
    const inOrder = (q: LayoutPoint): boolean => !allowed || (q.x > allowed.lo && q.x < allowed.hi);
    let chosen: LayoutPoint | undefined, clear: ((q: LayoutPoint) => boolean) | undefined;
    for (const strict of [true, false]) {
      for (const [i, j] of offsets) {
        const q = { x: round(ideal.x + i * step), y: round(ideal.y + j * step) };
        if (!roomy(q) || !inOrder(q)) continue;
        clear ??= clearAround(id, ideal, partners);
        if (!strict || clear(q)) {
          chosen = q;
          break;
        }
      }
      if (chosen) break;
    }
    // Nothing free within reach. In time order, move up or down at the
    // allowed x until the room is free; otherwise spiral outward.
    const column = round(ideal.x);
    for (let k = 1; allowed && inOrder({ x: column, y: 0 }) && !chosen; k++)
      for (const sign of [1, -1]) {
        const q = { x: column, y: round(ideal.y + sign * k * step) };
        if (!chosen && roomy(q)) chosen = q;
      }
    for (let attempt = 0; !chosen; attempt++) {
      const angle = attempt * 2.399963229728653,
        radius = room * (PLACEMENT_ROOM.reach + 0.5 * Math.sqrt(attempt + 1));
      const q = {
        x: round(ideal.x + Math.cos(angle) * radius),
        y: round(ideal.y + Math.sin(angle) * radius),
      };
      if (roomy(q)) chosen = q;
    }
    out.set(id, chosen);
    index(id);
    for (const m of partners) segments.push([id, m]);
  }
  return sorted();
}
