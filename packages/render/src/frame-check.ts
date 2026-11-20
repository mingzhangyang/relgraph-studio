/**
 * Layout problems a viewer sees in one composed frame (ADR 004, D2a), read
 * from the frame's own hit geometry (`DisplayList.selection`): the drawn path
 * of every relation, bow and parallel offsets included, with its stroke
 * width, and every glyph's outline as drawn (circle, rounded rectangle,
 * diamond, hexagon) with its stroke. Relation curves are laid out in screen
 * space and depend on the camera, so this is a property of a frame, not of
 * the stored coordinates.
 */
import type { DisplayList, PathCommand } from './display-list.js';
import type { Rect } from './frame-spec.js';

/** A relation drawn close to, or across, a node it does not join. */
export interface NearPass {
  edge: string;
  node: string;
  /** Gap between the drawn path and the glyph, in 720p reference pixels (0: they touch). */
  distance: number;
}

/** Two glyphs drawn closer than the crowding margin. */
export interface CrowdedGlyphs {
  nodes: [string, string];
  /** Gap between the glyphs, in 720p reference pixels (0: they overlap). */
  distance: number;
}

export interface FrameCheckOptions {
  /** Least gap between a relation and a node it does not join, 720p pixels. */
  clearance: number;
  /** Least gap between two glyphs, 720p pixels. */
  crowding: number;
  /** Output pixels per 720p reference pixel (`FrameSpec.typeScale`). */
  typeScale: number;
  /**
   * Nodes drawn as bars on a time axis. Bars in neighbouring lanes, or one
   * ending where the next begins, sit close or abut by design, so two bars
   * are reported only when they overlap; a bar and any other glyph are
   * checked as usual.
   */
  bars?: ReadonlySet<string>;
}

type Point = { x: number; y: number };

const intersects = (a: Rect, b: Rect): boolean =>
  a.x <= b.x + b.w && b.x <= a.x + a.w && a.y <= b.y + b.h && b.y <= a.y + a.h;

const grow = (r: Rect, by: number): Rect => ({
  x: r.x - by,
  y: r.y - by,
  w: r.w + 2 * by,
  h: r.h + 2 * by,
});

const cross = (o: Point, a: Point, b: Point): number =>
  (a.x - o.x) * (b.y - o.y) - (a.y - o.y) * (b.x - o.x);

/** Distance from a point to a segment. */
function pointSegment(p: Point, a: Point, b: Point): number {
  const dx = b.x - a.x,
    dy = b.y - a.y,
    length2 = dx * dx + dy * dy;
  const t = length2 ? Math.max(0, Math.min(1, ((p.x - a.x) * dx + (p.y - a.y) * dy) / length2)) : 0;
  return Math.hypot(p.x - (a.x + t * dx), p.y - (a.y + t * dy));
}

/** Distance between two segments (0 when they meet). */
function segmentSegment(a: Point, b: Point, c: Point, d: Point): number {
  const d1 = cross(c, d, a),
    d2 = cross(c, d, b),
    d3 = cross(a, b, c),
    d4 = cross(a, b, d);
  if (((d1 > 0 && d2 < 0) || (d1 < 0 && d2 > 0)) && ((d3 > 0 && d4 < 0) || (d3 < 0 && d4 > 0)))
    return 0;
  return Math.min(
    pointSegment(a, c, d),
    pointSegment(b, c, d),
    pointSegment(c, a, b),
    pointSegment(d, a, b),
  );
}

/** Convex hull, counter-clockwise (monotone chain). */
function hull(points: Point[]): Point[] {
  const sorted = [...points].sort((p, q) => p.x - q.x || p.y - q.y);
  if (sorted.length < 3) return sorted;
  const lower: Point[] = [],
    upper: Point[] = [];
  for (const p of sorted) {
    while (lower.length >= 2 && cross(lower.at(-2)!, lower.at(-1)!, p) <= 0) lower.pop();
    lower.push(p);
  }
  for (const p of sorted.reverse()) {
    while (upper.length >= 2 && cross(upper.at(-2)!, upper.at(-1)!, p) <= 0) upper.pop();
    upper.push(p);
  }
  return [...lower.slice(0, -1), ...upper.slice(0, -1)];
}

/** Points of an arc from a to b, circumscribed so the polygon holds the curve. */
function arc(cx: number, cy: number, rx: number, ry: number, a: number, b: number): Point[] {
  const steps = Math.max(2, Math.ceil((Math.abs(b - a) / (Math.PI * 2)) * 48)),
    step = (b - a) / steps,
    out = 1 / Math.cos(Math.min(Math.PI / 4, Math.abs(step) / 2));
  return Array.from({ length: steps + 1 }, (_, i) => ({
    x: cx + rx * out * Math.cos(a + step * i),
    y: cy + ry * out * Math.sin(a + step * i),
  }));
}

/**
 * The convex polygon of a glyph outline as drawn. Glyph outlines are convex;
 * arcs and rounded corners are circumscribed, so the polygon holds the
 * outline and a distance is never overstated by more than a fraction of a
 * pixel.
 */
function outlinePolygon(outline: readonly PathCommand[]): Point[] {
  const points: Point[] = [];
  for (const command of outline) {
    switch (command[0]) {
      case 'M':
      case 'L':
        points.push({ x: command[1], y: command[2] });
        break;
      case 'Q':
        // A quadratic lies within the hull of its start, control and end.
        points.push({ x: command[1], y: command[2] }, { x: command[3], y: command[4] });
        break;
      case 'A':
        points.push(...arc(command[1], command[2], command[3], command[3], command[4], command[5]));
        break;
      case 'E': {
        const [, cx, cy, rx, ry, rotation, a, b] = command;
        const cos = Math.cos(rotation),
          sin = Math.sin(rotation);
        for (const p of arc(0, 0, rx, ry, a, b))
          points.push({ x: cx + p.x * cos - p.y * sin, y: cy + p.x * sin + p.y * cos });
        break;
      }
      case 'R':
        points.push(
          { x: command[1], y: command[2] },
          { x: command[1] + command[3], y: command[2] },
          { x: command[1] + command[3], y: command[2] + command[4] },
          { x: command[1], y: command[2] + command[4] },
        );
        break;
      case 'RR': {
        const [, x, y, w, h, radius] = command;
        const r = Math.max(0, Math.min(radius, w / 2, h / 2));
        const q = Math.PI / 2;
        points.push(
          ...arc(x + w - r, y + r, r, r, -q, 0),
          ...arc(x + w - r, y + h - r, r, r, 0, q),
          ...arc(x + r, y + h - r, r, r, q, 2 * q),
          ...arc(x + r, y + r, r, r, 2 * q, 3 * q),
        );
        break;
      }
      case 'Z':
        break;
    }
  }
  return hull(points);
}

const inside = (p: Point, polygon: readonly Point[]): boolean =>
  polygon.length >= 3 &&
  polygon.every((a, i) => cross(a, polygon[(i + 1) % polygon.length], p) >= 0);

const edgesOf = (polygon: readonly Point[]): [Point, Point][] =>
  polygon.length === 1
    ? [[polygon[0], polygon[0]]]
    : polygon.map((a, i): [Point, Point] => [a, polygon[(i + 1) % polygon.length]]);

/** Distance from a segment to a filled convex polygon (0 when they meet). */
function segmentPolygon(a: Point, b: Point, polygon: readonly Point[]): number {
  if (inside(a, polygon) || inside(b, polygon)) return 0;
  let best = Infinity;
  for (const [c, d] of edgesOf(polygon)) {
    best = Math.min(best, segmentSegment(a, b, c, d));
    if (best === 0) break;
  }
  return best;
}

/** Distance between two filled convex polygons (0 when they meet). */
function polygonPolygon(p: readonly Point[], q: readonly Point[]): number {
  if (p.some((v) => inside(v, q)) || q.some((v) => inside(v, p))) return 0;
  let best = Infinity;
  for (const [a, b] of edgesOf(p))
    for (const [c, d] of edgesOf(q)) {
      best = Math.min(best, segmentSegment(a, b, c, d));
      if (best === 0) return 0;
    }
  return best;
}

/** A glyph as measured: its outline polygon, half its stroke, and its bounds. */
interface Glyph {
  id: string;
  box: Rect;
  polygon: Point[];
  halfStroke: number;
}

const boxPolygon = (r: Rect): Point[] => [
  { x: r.x, y: r.y },
  { x: r.x + r.w, y: r.y },
  { x: r.x + r.w, y: r.y + r.h },
  { x: r.x, y: r.y + r.h },
];

/**
 * Near passes and crowded glyphs in one frame, among the nodes whose glyphs
 * meet the stage. Gaps are measured between what is painted: from the outer
 * edge of a relation's stroke to the outer edge of a glyph's stroke, along
 * the whole drawn path. A glyph without an outline (hit geometry from an
 * older producer) is measured by its bounds.
 */
export function frameLayoutIssues(
  list: Pick<DisplayList, 'selection' | 'selectionClip'>,
  ends: ReadonlyMap<string, { source: string; target: string }>,
  options: FrameCheckOptions,
): { nearPasses: NearPass[]; crowded: CrowdedGlyphs[] } {
  const stage = list.selectionClip;
  const nodes: Glyph[] = [];
  const edges: { id: string; points: Point[]; halfWidth: number }[] = [];
  for (const entry of list.selection ?? []) {
    if (entry.kind === 'node' && entry.box && (!stage || intersects(entry.box, stage)))
      nodes.push({
        id: entry.id,
        box: entry.box,
        polygon: entry.outline?.length ? outlinePolygon(entry.outline) : boxPolygon(entry.box),
        halfStroke: entry.outline?.length ? (entry.halfStroke ?? 0) : 0,
      });
    else if (entry.kind === 'edge' && entry.points && entry.points.length >= 2)
      edges.push({ id: entry.id, points: entry.points, halfWidth: (entry.width ?? 0) / 2 });
  }
  nodes.sort((a, b) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0));
  const scale = options.typeScale;
  const clearance = options.clearance * scale,
    crowding = options.crowding * scale;
  const round = (px: number): number => Math.round((px / scale) * 10) / 10;

  const nearPasses: NearPass[] = [];
  for (const edge of edges) {
    const joined = ends.get(edge.id);
    if (!joined) continue;
    const { points, halfWidth } = edge;
    const xs = points.map((p) => p.x),
      ys = points.map((p) => p.y);
    const reach = grow(
      {
        x: Math.min(...xs),
        y: Math.min(...ys),
        w: Math.max(...xs) - Math.min(...xs),
        h: Math.max(...ys) - Math.min(...ys),
      },
      clearance + halfWidth,
    );
    for (const node of nodes) {
      // Its own ends: the stroke starts and stops at their rims.
      if (node.id === joined.source || node.id === joined.target) continue;
      if (!intersects(reach, grow(node.box, node.halfStroke))) continue;
      let gap = Infinity;
      for (let i = 1; i < points.length && gap > 0; i += 1)
        gap = Math.min(
          gap,
          Math.max(
            0,
            segmentPolygon(points[i - 1], points[i], node.polygon) - halfWidth - node.halfStroke,
          ),
        );
      // A relation touching a glyph it does not join is always reported.
      if (gap < clearance || gap === 0)
        nearPasses.push({ edge: edge.id, node: node.id, distance: round(gap) });
    }
  }

  const crowded: CrowdedGlyphs[] = [];
  const overlapTolerance = scale;
  for (let i = 0; i < nodes.length; i += 1)
    for (let j = i + 1; j < nodes.length; j += 1) {
      const [a, b] = [nodes[i], nodes[j]];
      if (options.bars?.has(a.id) && options.bars.has(b.id)) {
        // Bars may sit close or abut; overlapping, they hide each other.
        const w = Math.min(a.box.x + a.box.w, b.box.x + b.box.w) - Math.max(a.box.x, b.box.x),
          h = Math.min(a.box.y + a.box.h, b.box.y + b.box.h) - Math.max(a.box.y, b.box.y);
        if (w > overlapTolerance && h > overlapTolerance)
          crowded.push({ nodes: [a.id, b.id], distance: 0 });
        continue;
      }
      const reach = crowding + a.halfStroke + b.halfStroke;
      if (!intersects(grow(a.box, reach), b.box)) continue;
      const gap = Math.max(0, polygonPolygon(a.polygon, b.polygon) - a.halfStroke - b.halfStroke);
      if (gap < crowding || gap === 0) crowded.push({ nodes: [a.id, b.id], distance: round(gap) });
    }
  return { nearPasses, crowded };
}
