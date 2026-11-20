/**
 * Layout problems a viewer sees in one composed frame (ADR 004, D2a), read
 * from the frame's own hit geometry (`DisplayList.selection`): the drawn path
 * of every relation, bow and parallel offsets included, and every glyph's
 * bounds. Relation curves are laid out in screen space and depend on the
 * camera, so this is a property of a frame, not of the stored coordinates.
 */
import type { DisplayList } from './display-list.js';
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
   * ending where the next begins, abut by design, so two bars are never
   * reported as crowded; a bar and any other glyph still are.
   */
  bars?: ReadonlySet<string>;
}

type Point = { x: number; y: number };

const intersects = (a: Rect, b: Rect): boolean =>
  a.x <= b.x + b.w && b.x <= a.x + a.w && a.y <= b.y + b.h && b.y <= a.y + a.h;

/** Distance from a point to a rectangle (0 inside). */
const pointRect = (p: Point, r: Rect): number =>
  Math.hypot(Math.max(r.x - p.x, 0, p.x - r.x - r.w), Math.max(r.y - p.y, 0, p.y - r.y - r.h));

/** Distance from a point to a segment. */
function pointSegment(p: Point, a: Point, b: Point): number {
  const dx = b.x - a.x,
    dy = b.y - a.y,
    length2 = dx * dx + dy * dy;
  const t = length2 ? Math.max(0, Math.min(1, ((p.x - a.x) * dx + (p.y - a.y) * dy) / length2)) : 0;
  return Math.hypot(p.x - (a.x + t * dx), p.y - (a.y + t * dy));
}

/** Whether a segment crosses a rectangle's interior or edge. */
function segmentHitsRect(a: Point, b: Point, r: Rect): boolean {
  if (pointRect(a, r) === 0 || pointRect(b, r) === 0) return true;
  const corners: Point[] = [
    { x: r.x, y: r.y },
    { x: r.x + r.w, y: r.y },
    { x: r.x + r.w, y: r.y + r.h },
    { x: r.x, y: r.y + r.h },
  ];
  const side = (p: Point, q: Point, s: Point): number =>
    Math.sign((q.x - p.x) * (s.y - p.y) - (q.y - p.y) * (s.x - p.x));
  return corners.some((c, i) => {
    const d = corners[(i + 1) % 4];
    return side(a, b, c) !== side(a, b, d) && side(c, d, a) !== side(c, d, b);
  });
}

/** Distance from a segment to a rectangle (0 when they meet). */
function segmentRect(a: Point, b: Point, r: Rect): number {
  if (segmentHitsRect(a, b, r)) return 0;
  const corners: Point[] = [
    { x: r.x, y: r.y },
    { x: r.x + r.w, y: r.y },
    { x: r.x + r.w, y: r.y + r.h },
    { x: r.x, y: r.y + r.h },
  ];
  return Math.min(pointRect(a, r), pointRect(b, r), ...corners.map((c) => pointSegment(c, a, b)));
}

/** Distance between two rectangles (0 when they meet). */
const rectRect = (a: Rect, b: Rect): number =>
  Math.hypot(
    Math.max(0, b.x - (a.x + a.w), a.x - (b.x + b.w)),
    Math.max(0, b.y - (a.y + a.h), a.y - (b.y + b.h)),
  );

/**
 * A glyph as measured: its bounds, and for a square bound the circle it
 * holds. Circles, the most common glyph, would otherwise read as touching a
 * line that only passes a corner of their bound; a diamond fits the same
 * circle, and a square glyph is measured a little short at its corners.
 */
interface Glyph {
  id: string;
  box: Rect;
  circle: { x: number; y: number; r: number } | null;
}

const glyphOf = (id: string, box: Rect): Glyph => ({
  id,
  box,
  circle:
    Math.abs(box.w - box.h) <= 1e-6 * Math.max(box.w, box.h)
      ? { x: box.x + box.w / 2, y: box.y + box.h / 2, r: box.w / 2 }
      : null,
});

const segmentGlyph = (a: Point, b: Point, glyph: Glyph): number =>
  glyph.circle
    ? Math.max(0, pointSegment(glyph.circle, a, b) - glyph.circle.r)
    : segmentRect(a, b, glyph.box);

function glyphGlyph(a: Glyph, b: Glyph): number {
  if (a.circle && b.circle)
    return Math.max(
      0,
      Math.hypot(a.circle.x - b.circle.x, a.circle.y - b.circle.y) - a.circle.r - b.circle.r,
    );
  if (a.circle) return Math.max(0, pointRect(a.circle, b.box) - a.circle.r);
  if (b.circle) return Math.max(0, pointRect(b.circle, a.box) - b.circle.r);
  return rectRect(a.box, b.box);
}

/**
 * Near passes and crowded glyphs in one frame, among the nodes whose glyphs
 * meet the stage. The first and last of a relation's sampled segments are
 * skipped: they leave and reach its own ends, where a neighbour of either end
 * may legitimately sit close.
 */
export function frameLayoutIssues(
  list: Pick<DisplayList, 'selection' | 'selectionClip'>,
  ends: ReadonlyMap<string, { source: string; target: string }>,
  options: FrameCheckOptions,
): { nearPasses: NearPass[]; crowded: CrowdedGlyphs[] } {
  const stage = list.selectionClip;
  const nodes: Glyph[] = [];
  const edges: { id: string; points: Point[] }[] = [];
  for (const entry of list.selection ?? []) {
    if (entry.kind === 'node' && entry.box && (!stage || intersects(entry.box, stage)))
      nodes.push(glyphOf(entry.id, entry.box));
    else if (entry.kind === 'edge' && entry.points && entry.points.length > 3)
      edges.push({ id: entry.id, points: entry.points });
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
    const inner = edge.points.slice(1, -1);
    const xs = inner.map((p) => p.x),
      ys = inner.map((p) => p.y);
    const reach: Rect = {
      x: Math.min(...xs) - clearance,
      y: Math.min(...ys) - clearance,
      w: Math.max(...xs) - Math.min(...xs) + 2 * clearance,
      h: Math.max(...ys) - Math.min(...ys) + 2 * clearance,
    };
    for (const node of nodes) {
      if (node.id === joined.source || node.id === joined.target) continue;
      if (!intersects(reach, node.box)) continue;
      let distance = Infinity;
      for (let i = 1; i < inner.length && distance > 0; i += 1)
        distance = Math.min(distance, segmentGlyph(inner[i - 1], inner[i], node));
      // A relation touching a glyph it does not join is always reported.
      if (distance < clearance || distance === 0)
        nearPasses.push({ edge: edge.id, node: node.id, distance: round(distance) });
    }
  }

  const crowded: CrowdedGlyphs[] = [];
  for (let i = 0; i < nodes.length; i += 1)
    for (let j = i + 1; j < nodes.length; j += 1) {
      if (options.bars?.has(nodes[i].id) && options.bars.has(nodes[j].id)) continue;
      const distance = glyphGlyph(nodes[i], nodes[j]);
      if (distance < crowding || distance === 0)
        crowded.push({ nodes: [nodes[i].id, nodes[j].id], distance: round(distance) });
    }
  return { nearPasses, crowded };
}
