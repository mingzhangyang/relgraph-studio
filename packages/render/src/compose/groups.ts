import type { ResolvedHighlight } from '@relgraph/core';
import type { DisplayItem, PathCommand } from '../display-list.js';
import type { Rect } from '../frame-spec.js';
import type { RectIndex } from '../spatial.js';
import { toneOf } from '../theme.js';
import { color, type FrameContext } from './context.js';
import { clamp, ease, mix, TAU, type Point } from './geometry.js';
import type { DrawnNode } from './nodes.js';
import { fitText } from './text.js';

/**
 * Smooth outline around a set of circles: the convex hull of points sampled
 * on every circle, rounded with quadratic segments through its edge midpoints.
 * One circle gives a disc, two a capsule, more a soft blob that follows them.
 */
export function hullOutline(circles: readonly { x: number; y: number; r: number }[]): {
  d: PathCommand[];
  points: Point[];
} {
  const samples: Point[] = [];
  for (const c of circles)
    for (let i = 0; i < 16; i++) {
      const angle = (i / 16) * TAU;
      samples.push({ x: c.x + Math.cos(angle) * c.r, y: c.y + Math.sin(angle) * c.r });
    }
  samples.sort((a, b) => a.x - b.x || a.y - b.y);
  const cross = (o: Point, a: Point, b: Point): number =>
    (a.x - o.x) * (b.y - o.y) - (a.y - o.y) * (b.x - o.x);
  const half = (source: Point[]): Point[] => {
    const chain: Point[] = [];
    for (const q of source) {
      while (chain.length >= 2 && cross(chain[chain.length - 2], chain[chain.length - 1], q) <= 0)
        chain.pop();
      chain.push(q);
    }
    chain.pop();
    return chain;
  };
  const points = [...half(samples), ...half([...samples].reverse())];
  if (points.length < 3) return { d: [], points: samples };
  const mid = (a: Point, b: Point): Point => ({ x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 });
  const first = mid(points[points.length - 1], points[0]);
  const d: PathCommand[] = [['M', first.x, first.y]];
  points.forEach((q, i) => {
    const next = mid(q, points[(i + 1) % points.length]);
    d.push(['Q', q.x, q.y, next.x, next.y]);
  });
  d.push(['Z']);
  return { d, points };
}

const hasFocus = (h: ResolvedHighlight): boolean =>
  Boolean(h.nodeIds.length || h.edgeIds.length || h.groupId);

/**
 * Groups: a soft hull that follows its members instead of a fixed ellipse,
 * named by a tab on its outline. The tabs take their place in `occupied`.
 */
export function composeGroups(
  ctx: FrameContext,
  drawn: readonly DrawnNode[],
  occupied: RectIndex,
): DisplayItem[] {
  const { view, theme: P, u, sans, measure, bounds, inBounds, highlight, previousHighlight } = ctx;
  const { transition } = ctx;
  const items: DisplayItem[] = [];
  const focusActive = mix(
    hasFocus(previousHighlight) ? 1 : 0,
    hasFocus(highlight) ? 1 : 0,
    transition,
  );
  const membersOf = new Map<string, DrawnNode[]>();
  for (const entry of drawn)
    if (entry.node.groupId != null) {
      const members = membersOf.get(entry.node.groupId);
      if (members) members.push(entry);
      else membersOf.set(entry.node.groupId, [entry]);
    }
  for (const group of view.groups) {
    const members = membersOf.get(group.id) ?? [];
    if (!members.length) continue;
    const groupProgress = Math.max(...members.map((entry) => entry.visibility));
    if (groupProgress <= 0) continue;
    // A member that is still arriving pulls the hull out as it appears.
    const settled = members.filter((entry) => entry.visibility >= 1),
      anchor = settled.length
        ? {
            x: settled.reduce((sum, entry) => sum + entry.p.x / settled.length, 0),
            y: settled.reduce((sum, entry) => sum + entry.p.y / settled.length, 0),
          }
        : null;
    const circles = members.map((entry) => {
      const grow = anchor ? ease(entry.visibility) : 1;
      return {
        x: anchor ? mix(anchor.x, entry.p.x, grow) : entry.p.x,
        y: anchor ? mix(anchor.y, entry.p.y, grow) : entry.p.y,
        r:
          (Math.max(entry.geometry.halfWidth, entry.geometry.halfHeight) + u(26)) *
          (0.6 + 0.4 * grow),
      };
    });
    const hull = hullOutline(circles),
      c = color(group.color, toneOf(P, group.tone) ?? P.fallbackNode);
    const presence = Math.max(...members.map((entry) => entry.alpha)),
      lit = mix(
        previousHighlight.groupId === group.id ? 1 : 0,
        highlight.groupId === group.id ? 1 : 0,
        transition,
      );
    const decoration: DisplayItem[] = [
      { type: 'path', d: hull.d, fill: c + P.hullFill },
      {
        type: 'path',
        d: hull.d,
        stroke: c + P.groupStroke,
        width: u(mix(1, 1.6, lit)),
      },
    ];
    const font = sans(13, 500),
      label = fitText(measure, group.label, font, u(180));
    if (label && groupProgress > 0.5) {
      const w = measure(label, font) + u(14),
        h = font.size * 1.5;
      // The name sits on the outline like a tab, where no member can be:
      // at the highest point of the outline that is on stage and free.
      const boxAt = (q: Point): Rect => ({ x: q.x - w / 2, y: q.y - h / 2, w, h });
      const free = (candidate: Rect): boolean =>
        inBounds(candidate) && !occupied.someIntersecting(candidate);
      // Long straight runs of the outline have no vertices of their own.
      const along = hull.points.flatMap((q, i) => {
        const next = hull.points[(i + 1) % hull.points.length],
          steps = Math.max(1, Math.ceil(Math.hypot(next.x - q.x, next.y - q.y) / u(36)));
        return Array.from({ length: steps }, (_, k) => ({
          x: mix(q.x, next.x, k / steps),
          y: mix(q.y, next.y, k / steps),
        }));
      });
      const spot = along.sort((m, n) => m.y - n.y || m.x - n.x).find((q) => free(boxAt(q)));
      // With no free spot, fall back to the visible point nearest the top,
      // pulled onto the stage. A hull that is entirely off stage, or that
      // surrounds the whole stage, goes unnamed rather than mislabel a corner.
      const visible = along.find(
        (q) =>
          q.x >= bounds.left && q.x <= bounds.right && q.y >= bounds.top && q.y <= bounds.bottom,
      );
      const box = spot
        ? boxAt(spot)
        : visible
          ? {
              w,
              h,
              x: clamp(visible.x - w / 2, bounds.left, Math.max(bounds.left, bounds.right - w)),
              y: clamp(visible.y - h / 2, bounds.top, Math.max(bounds.top, bounds.bottom - h)),
            }
          : null;
      if (box) {
        occupied.add(box);
        decoration.push({
          type: 'text',
          text: label,
          x: box.x + w / 2,
          y: box.y + h / 2,
          font,
          fill: c + P.groupLabel,
          align: 'center',
          baseline: 'middle',
          halo: { paint: P.labelHalo, width: u(6) },
          ...(groupProgress < 1 ? { alpha: (groupProgress - 0.5) * 2 } : {}),
        });
      }
    }
    // Hulls recede with their members when another part of the graph is in focus.
    const hullAlpha = groupProgress * mix(1, Math.max(lit, 0.35 + 0.65 * presence), focusActive);
    items.push(
      hullAlpha >= 1
        ? { type: 'group', items: decoration }
        : { type: 'group', alpha: hullAlpha, items: decoration },
    );
  }
  return items;
}
