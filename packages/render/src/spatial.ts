/**
 * Spatial lookups for one frame's collision tests. Both indexes only narrow
 * the set of candidates: the caller's own predicate decides every answer, so
 * a test through an index gives exactly the answer of a scan over all items.
 */
import type { Rect } from './frame-spec.js';
import { rectsIntersect } from './node-geometry.js';

/**
 * Rectangles in a uniform grid over a region. A rectangle that reaches past
 * the region is kept in the border cells it would clamp to; one entirely
 * outside it is kept apart and consulted only for queries that are not inside
 * the region, since it cannot meet one that is.
 */
export class RectIndex {
  private readonly cells: number[][];
  private readonly outside: number[] = [];
  /** Rectangles of negative size have no cells of their own; every query asks them. */
  private readonly always: number[] = [];
  private readonly rects: Rect[] = [];
  private readonly seen: number[] = [];
  private stamp = 0;
  private readonly cols: number;
  private readonly rows: number;

  constructor(
    private readonly region: Rect,
    private readonly cell: number,
  ) {
    this.cols = Math.max(1, Math.ceil(region.w / cell));
    this.rows = Math.max(1, Math.ceil(region.h / cell));
    this.cells = Array.from({ length: this.cols * this.rows }, () => []);
  }

  private column(x: number): number {
    return Math.min(this.cols - 1, Math.max(0, Math.floor((x - this.region.x) / this.cell)));
  }
  private row(y: number): number {
    return Math.min(this.rows - 1, Math.max(0, Math.floor((y - this.region.y) / this.cell)));
  }
  /** Inside the closed region: then only rectangles that meet the region can meet it. */
  private within(box: Rect): boolean {
    const r = this.region;
    return box.x >= r.x && box.x + box.w <= r.x + r.w && box.y >= r.y && box.y + box.h <= r.y + r.h;
  }

  add(box: Rect): void {
    const id = this.rects.length;
    this.rects.push(box);
    this.seen.push(0);
    if (box.w < 0 || box.h < 0) {
      this.always.push(id);
      return;
    }
    if (!rectsIntersect(box, this.region)) {
      this.outside.push(id);
      return;
    }
    const c0 = this.column(box.x),
      c1 = this.column(box.x + box.w),
      r0 = this.row(box.y),
      r1 = this.row(box.y + box.h);
    for (let r = r0; r <= r1; r++)
      for (let c = c0; c <= c1; c++) this.cells[r * this.cols + c].push(id);
  }

  /**
   * Visit each stored rectangle that intersects `box`, once each, until the
   * visitor returns true. Returns whether a visitor stopped the walk.
   */
  someIntersecting(box: Rect, visit: (hit: Rect) => boolean = () => true): boolean {
    const stamp = ++this.stamp;
    const test = (id: number): boolean => {
      if (this.seen[id] === stamp) return false;
      this.seen[id] = stamp;
      return rectsIntersect(box, this.rects[id]) && visit(this.rects[id]);
    };
    // A query without finite corners, or of negative size, has no cells: ask every rectangle.
    if (
      ![box.x, box.y, box.x + box.w, box.y + box.h].every(Number.isFinite) ||
      box.w < 0 ||
      box.h < 0
    ) {
      for (let id = 0; id < this.rects.length; id++) if (test(id)) return true;
      return false;
    }
    for (const id of this.always) if (test(id)) return true;
    if (!this.within(box)) for (const id of this.outside) if (test(id)) return true;
    const c0 = this.column(box.x),
      c1 = this.column(box.x + box.w),
      r0 = this.row(box.y),
      r1 = this.row(box.y + box.h);
    for (let r = r0; r <= r1; r++)
      for (let c = c0; c <= c1; c++)
        for (const id of this.cells[r * this.cols + c]) if (test(id)) return true;
    return false;
  }
}

/** Points with an id in a hash grid, for "is any other point this close". */
export class PointIndex {
  private readonly cells = new Map<string, number[]>();
  private readonly xs: number[] = [];
  private readonly ys: number[] = [];
  private readonly ids: string[] = [];

  constructor(private readonly cell: number) {}

  add(id: string, x: number, y: number): void {
    // A point that is not finite is never closer than anything.
    if (!Number.isFinite(x) || !Number.isFinite(y)) return;
    const index = this.ids.length;
    this.ids.push(id);
    this.xs.push(x);
    this.ys.push(y);
    const key = `${Math.floor(x / this.cell)},${Math.floor(y / this.cell)}`;
    const bucket = this.cells.get(key);
    if (bucket) bucket.push(index);
    else this.cells.set(key, [index]);
  }

  /**
   * Whether a point other than `except` satisfies `Math.hypot(x - px, y - py) < limit`,
   * the same expression a scan would evaluate.
   */
  anyCloser(x: number, y: number, limit: number, except: string): boolean {
    const test = (index: number): boolean => {
      return (
        this.ids[index] !== except && Math.hypot(x - this.xs[index], y - this.ys[index]) < limit
      );
    };
    if (!(limit > 0)) return false;
    // A margin keeps rounding in hypot and in the subtraction from losing a point.
    const reach = limit * 1.001 + 1,
      c0 = Math.floor((x - reach) / this.cell),
      c1 = Math.floor((x + reach) / this.cell),
      r0 = Math.floor((y - reach) / this.cell),
      r1 = Math.floor((y + reach) / this.cell);
    const span = (c1 - c0 + 1) * (r1 - r0 + 1);
    if (!Number.isFinite(span) || span > this.cells.size) {
      for (let index = 0; index < this.ids.length; index++) if (test(index)) return true;
      return false;
    }
    for (let r = r0; r <= r1; r++)
      for (let c = c0; c <= c1; c++) {
        const bucket = this.cells.get(`${c},${r}`);
        if (bucket) for (const index of bucket) if (test(index)) return true;
      }
    return false;
  }
}
