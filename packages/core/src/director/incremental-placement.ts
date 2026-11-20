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
 *    draws the whole graph once; that drawing is aligned to the anchors by a
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
 * On a timeline that keeps time (`axis`), a dated node's x is its date, and
 * its lane is the free lane nearest its neighbours' lanes (`anchorToTime`
 * with `neighbours`). Only undated nodes go through the free-place search.
 *
 * Relations are checked as straight segments here; how they are drawn
 * (bowed, in screen space) is what `relgraph check-layout` checks.
 */
import type { VisualGraph } from '../../types/visual-graph.js';
import { compare, prepare } from '../graph/analysis.js';
import { placeInTime, type TimeAxis } from '../graph/time-axis.js';
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
  const nearest = points.map((p, i) => {
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
 * Coordinates for every node of `graph`: those in `anchors` exactly as given,
 * the others placed beside their acquaintances (see the module comment).
 * Deterministic, and independent of the order of nodes and relations.
 */
export function placeIncrementally(
  graph: PlacementGraph,
  anchors: ReadonlyMap<string, LayoutPoint>,
  { engine, seed, spacing, iterations, axis = null }: PlacementOptions,
): Map<string, LayoutPoint> {
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
  const drawn = runLayoutEngine(graph, engine, { seed, spacing, iterations });
  // Nothing to keep: the engine's drawing is the placement.
  if (!out.size) {
    for (const id of ids) {
      const p = drawn.get(id) ?? { x: 0, y: 0 };
      out.set(id, { x: round(p.x), y: round(p.y) });
    }
    anchorToTime(graph, out, { axis, spacing });
    return sorted();
  }

  const p = prepare(graph);
  const kept = [...out.keys()];
  const align = alignDrawings(kept.map((id) => [drawn.get(id)!, out.get(id)!] as const));
  // The room a node needs scales with the drawing it joins: the camera fits
  // the whole drawing, so a sparser drawing is shown smaller.
  const engineGap = typicalGap(kept.map((id) => drawn.get(id)!)),
    keptGap = typicalGap(kept.map((id) => out.get(id)!)),
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
  const clear = (id: string, q: LayoutPoint, partners: readonly string[]): boolean => {
    for (const [a, b] of segments)
      if (passesBeside(q, out.get(a)!, out.get(b)!, clearance)) return false;
    for (const m of partners) {
      const end = out.get(m)!;
      for (const [other, r] of out)
        if (other !== m && other !== id && passesBeside(r, q, end, clearance)) return false;
    }
    return true;
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
    const bary = mean(reference.map((v) => out.get(v)!)),
      engineBary = mean(reference.map((v) => drawn.get(v)!)),
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
    let chosen: LayoutPoint | undefined;
    for (const strict of [true, false]) {
      for (const [i, j] of offsets) {
        const q = { x: round(ideal.x + i * step), y: round(ideal.y + j * step) };
        if (roomy(q) && (!strict || clear(id, q, partners))) {
          chosen = q;
          break;
        }
      }
      if (chosen) break;
    }
    // Nothing free within reach: spiral outward until the room is free.
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
