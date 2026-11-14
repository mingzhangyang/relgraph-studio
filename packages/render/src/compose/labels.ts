import type { DisplayItem } from '../display-list.js';
import type { Rect } from '../frame-spec.js';
import { PointIndex, type RectIndex } from '../spatial.js';
import type { FrameContext } from './context.js';
import type { Point } from './geometry.js';
import type { DrawnNode } from './nodes.js';
import type { EdgeLabel } from './relations.js';
import { fitText, wrapText } from './text.js';

/** Node ids in reading order; one collator instead of one per comparison. */
const byId = new Intl.Collator('en').compare;

export interface NodeLabelInputs {
  drawn: readonly DrawnNode[];
  /** Nodes whose label is drawn inside their shape (`composeNodes`). */
  held: ReadonlySet<string>;
  /** Each node's own label obstacle (`nodeObstacles`). */
  obstacles: ReadonlyMap<string, Rect>;
  /** Where each node's neighbours lie (`relationLayout`). */
  pull: ReadonlyMap<string, Point>;
  /** The strokes drawn so far, counted as crossings (`composeRelations`). */
  relations: RectIndex;
}

/**
 * Deterministic screen-space label placement: prioritize selected and major
 * nodes. Each placed label takes its place in `occupied`.
 */
export function composeNodeLabels(
  ctx: FrameContext,
  { drawn, held, obstacles, pull, relations: edgeObstacles }: NodeLabelInputs,
  occupied: RectIndex,
): DisplayItem[] {
  const { theme: P, u, sans, measure, inBounds } = ctx;
  const items: DisplayItem[] = [];
  const sorted = drawn
    .filter((entry) => entry.visibility > 0.5 && !held.has(entry.node.id))
    .sort(
      (a, b) =>
        b.alpha - a.alpha ||
        (b.node.importance || 0) - (a.node.importance || 0) ||
        byId(a.node.id, b.node.id),
    );
  // Where the other labelled nodes are, for the test that a label reads as theirs.
  const labelled = new PointIndex(u(96));
  for (const entry of sorted) labelled.add(entry.node.id, entry.p.x, entry.p.y);
  for (const { node, custom, p, r, alpha: active } of sorted) {
    const obstacle = obstacles.get(node.id);
    if (!obstacle) continue;
    const importance = node.importance ?? 0;
    // Type follows the same hierarchy as the glyphs: principals speak loudest.
    const font = sans(
      custom.fontSize ??
        (importance >= 5 ? 19 : importance >= 4 ? 17 : importance >= 1 && importance < 3 ? 14 : 16),
      custom.fontWeight ?? (importance >= 4 ? 600 : 500),
    );
    const lines = wrapText(measure, ctx.nodeLabel(node), font, u(170), 2);
    const width = Math.max(0, ...lines.map((line) => measure(line, font))),
      height = lines.length * font.size * 1.3;
    const rightX = Math.max(p.x + r + u(9), obstacle.x + obstacle.w + u(5));
    const leftX = Math.min(p.x - r - u(9) - width, obstacle.x - width - u(5));
    const topY = Math.min(p.y - r - Math.max(u(25), height + u(4)), obstacle.y - height - u(4));
    const bottomY = Math.max(p.y + r + u(6), obstacle.y + obstacle.h + u(2));
    const nearRightX = Math.max(p.x + r + u(5), obstacle.x + obstacle.w + u(1));
    const nearLeftX = Math.min(p.x - r - u(5) - width, obstacle.x - width - u(1));
    const upperY = Math.min(p.y - r - Math.max(u(24), height + u(4)), obstacle.y - height - u(1));
    const sides = [
      { x: rightX, y: p.y - height / 2 },
      { x: leftX, y: p.y - height / 2 },
      { x: p.x - width / 2, y: topY },
      { x: p.x - width / 2, y: bottomY },
    ];
    const corners = [
      { x: nearRightX, y: upperY },
      { x: nearLeftX, y: upperY },
      { x: nearRightX, y: bottomY },
      { x: nearLeftX, y: bottomY },
    ];
    const preferred =
      custom.textPosition === undefined || custom.textPosition === 'auto'
        ? undefined
        : { right: 0, left: 1, top: 2, bottom: 3 }[custom.textPosition];
    // An authored side comes first. Otherwise face away from the node's
    // relations: the side its neighbours leave free. Reading order breaks
    // ties, so a lone node labels to the right.
    const towards = pull.get(node.id) ?? { x: 0, y: 0 },
      reach = Math.hypot(towards.x, towards.y),
      out = reach > 0.35 ? { x: -towards.x / reach, y: -towards.y / reach } : { x: 0, y: 0 };
    const score = [out.x + 0.3, -out.x + 0.12, -out.y, out.y + 0.06];
    const ordered =
      preferred !== undefined
        ? [sides[preferred], ...sides.filter((_, i) => i !== preferred)]
        : sides
            .map((side, i) => ({ side, score: score[i], i }))
            .sort((m, n) => n.score - m.score || m.i - n.i)
            .map((entry) => entry.side);
    const candidates = [...ordered, ...corners].map((c) => ({ ...c, w: width, h: height }));
    // Hard rules: stay on the stage and never cover a glyph or other text.
    // Among the places that remain, prefer the natural side, then the one
    // that crosses fewest relations and cannot be read as a neighbour's name.
    let box: Rect | undefined,
      best = Infinity;
    for (let rank = 0; rank < candidates.length; rank++) {
      // A place costs at least its rank, so nothing further down can win.
      if (rank >= best) break;
      const c = candidates[rank];
      if (!inBounds(c) || occupied.someIntersecting(c)) continue;
      // Count crossings only while they can still change the outcome: they
      // are capped at six, and a place already as costly as the best is out.
      let crossings = 0;
      edgeObstacles.someIntersecting(c, () => ++crossings >= 6 || rank + crossings * 0.9 >= best);
      if (rank + Math.min(6, crossings) * 0.9 >= best) continue;
      const cx = c.x + c.w / 2,
        cy = c.y + c.h / 2,
        own = Math.hypot(cx - p.x, cy - p.y);
      const ambiguous = labelled.anyCloser(cx, cy, own * 0.9, node.id);
      const placeCost = rank + Math.min(6, crossings) * 0.9 + (ambiguous ? 4 : 0);
      if (placeCost < best) {
        best = placeCost;
        box = c;
      }
    }
    if (!box) continue;
    const placed: Rect = box;
    occupied.add(placed);
    lines.forEach((line, index) =>
      items.push({
        type: 'text',
        text: line,
        x: placed.x,
        y: placed.y + index * font.size * 1.3,
        font,
        fill: custom.textColor ?? (active > 0.8 ? P.labelActive : P.labelMuted),
        baseline: 'top',
        halo: { paint: P.labelHalo, width: u(3.5) },
        alpha: active * Math.min(1, (ctx.nodeProgress(node.id) - 0.5) * 2),
      }),
    );
  }
  return items;
}

/**
 * Relation tags, placed after the node labels: on their relation, or a step
 * aside when the line is taken. Each placed tag takes its place in `occupied`.
 */
export function composeRelationLabels(
  ctx: FrameContext,
  labels: readonly EdgeLabel[],
  occupied: RectIndex,
): DisplayItem[] {
  const { theme: P, u, measure, inBounds } = ctx;
  const items: DisplayItem[] = [];
  for (const label of labels) {
    const edgeFont = label.font;
    const text = fitText(measure, label.text, edgeFont, u(150)),
      w = measure(text, edgeFont) + u(14),
      h = Math.max(u(18), edgeFont.size * 1.5),
      // The tag sits on its relation, interrupting the line like a route
      // marker. Between two close shapes it steps aside instead of vanishing.
      home = {
        x: label.x - w / 2 + (label.push ? (label.push.x * w) / 2 : 0),
        y: label.y - h / 2 + (label.push ? (label.push.y * h) / 2 : 0),
        w,
        h,
      },
      aside = label.aside,
      reach = h / 2 + u(15);
    const box = (aside ? [0, 1, -1, 2, -2] : [0])
      .map((k) => ({
        ...home,
        x: home.x + (aside?.x ?? 0) * k * reach,
        y: home.y + (aside?.y ?? 0) * k * reach,
      }))
      .find((candidate) => inBounds(candidate) && !occupied.someIntersecting(candidate));
    if (!box) continue;
    occupied.add(box);
    items.push(
      {
        type: 'path',
        d: [['RR', box.x, box.y, w, box.h, h / 2]],
        fill: P.edgeLabelBox,
        stroke: label.stroke,
        width: u(0.8),
        alpha: label.alpha,
      },
      {
        type: 'text',
        text,
        x: box.x + w / 2,
        y: box.y + h / 2 + u(0.5),
        font: edgeFont,
        fill: label.color,
        align: 'center',
        baseline: 'middle',
        alpha: label.alpha,
      },
    );
  }
  return items;
}
