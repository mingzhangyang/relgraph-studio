import type { DisplayList } from './display-list.js';
type Point = { x: number; y: number };
const inBox = (p: Point, b: { x: number; y: number; w: number; h: number }): boolean =>
  p.x >= b.x && p.x <= b.x + b.w && p.y >= b.y && p.y <= b.y + b.h;
/** Pick only targets produced by safe composition, using continuous path segments. */
export function hitDisplayList(
  list: DisplayList,
  point: Point,
  tolerance = 9,
): { kind: 'node' | 'edge'; id: string } | null {
  if (
    !Number.isFinite(point.x) ||
    !Number.isFinite(point.y) ||
    !Number.isFinite(tolerance) ||
    tolerance < 0
  )
    return null;
  if (list.selectionClip && !inBox(point, list.selectionClip)) return null;
  for (const target of [...(list.selection ?? [])].reverse()) {
    if (target.box && inBox(point, target.box)) return { kind: target.kind, id: target.id };
    const points = target.points ?? [];
    for (let i = 1; i < points.length; i++) {
      const a = points[i - 1],
        b = points[i],
        dx = b.x - a.x,
        dy = b.y - a.y,
        length = dx * dx + dy * dy;
      const t = length
        ? Math.max(0, Math.min(1, ((point.x - a.x) * dx + (point.y - a.y) * dy) / length))
        : 0;
      if (Math.hypot(point.x - a.x - t * dx, point.y - a.y - t * dy) <= tolerance)
        return { kind: target.kind, id: target.id };
    }
  }
  return null;
}
