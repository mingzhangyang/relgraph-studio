import type { PathCommand } from '../display-list.js';

export type Point = { x: number; y: number };

export const TAU = Math.PI * 2;
export const ease = (t: number): number => {
  const x = Math.min(1, Math.max(0, t));
  return x * x * (3 - 2 * x);
};
export const clamp = (x: number, a: number, b: number): number => Math.min(b, Math.max(a, x));
export const mix = (a: number, b: number, t: number): number => a + (b - a) * t;

/** Exact de Casteljau prefix [0,t] of a quadratic Bézier. No raster approximation. */
export function quadraticPrefix(
  start: Point,
  control: Point,
  end: Point,
  progress: number,
): PathCommand[] {
  const t = clamp(progress, 0, 1);
  if (t === 1)
    return [
      ['M', start.x, start.y],
      ['Q', control.x, control.y, end.x, end.y],
    ];
  const first = { x: mix(start.x, control.x, t), y: mix(start.y, control.y, t) };
  const second = { x: mix(control.x, end.x, t), y: mix(control.y, end.y, t) };
  const point = { x: mix(first.x, second.x, t), y: mix(first.y, second.y, t) };
  return [
    ['M', start.x, start.y],
    ['Q', first.x, first.y, point.x, point.y],
  ];
}
/** A quadratic Bézier: start, control, end. Routed relations are a run of them. */
export type Segment = [Point, Point, Point];
const segmentAt = (segments: readonly Segment[], t: number): [Segment, number, number] => {
  const scaled = clamp(t, 0, 1) * segments.length,
    index = Math.min(segments.length - 1, Math.floor(scaled));
  return [segments[index], scaled - index, index];
};
/** Point at parameter t of a run of segments, each taking an equal share of [0, 1]. */
export function pathPoint(segments: readonly Segment[], t: number): Point {
  const [[a, c, b], local] = segmentAt(segments, t),
    v = 1 - local;
  return {
    x: v * v * a.x + 2 * v * local * c.x + local * local * b.x,
    y: v * v * a.y + 2 * v * local * c.y + local * local * b.y,
  };
}
/** Unit tangent at t, or null where the path has no direction. */
export function pathTangent(segments: readonly Segment[], t: number): Point | null {
  const [[a, c, b], local] = segmentAt(segments, t);
  const x = mix(c.x - a.x, b.x - c.x, local),
    y = mix(c.y - a.y, b.y - c.y, local),
    length = Math.hypot(x, y);
  return length > 0 ? { x: x / length, y: y / length } : null;
}
/** Exact prefix [0, t] of a run of segments. */
export function pathPrefix(segments: readonly Segment[], t: number): PathCommand[] {
  const [[a, c, b], local, index] = segmentAt(segments, t);
  const d: PathCommand[] = [['M', segments[0][0].x, segments[0][0].y]];
  for (const [, control, end] of segments.slice(0, index))
    d.push(['Q', control.x, control.y, end.x, end.y]);
  d.push(quadraticPrefix(a, c, b, local)[1]);
  return d;
}
