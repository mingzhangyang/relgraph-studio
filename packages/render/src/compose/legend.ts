import { edgeStyleFor, localize, nodeStyleFor } from '@relgraph/core';
import type { DisplayItem } from '../display-list.js';
import { nodeOutline, type GlyphGeometry } from '../node-geometry.js';
import type { RectIndex } from '../spatial.js';
import { edgePaint, mixHex, toneOf } from '../theme.js';
import { color, type FrameContext } from './context.js';
import { fitText } from './text.js';

/** How far the most advanced item of each kind has come. */
const kindProgress = (
  list: readonly { id: string; kind: string }[],
  progressOf: (id: string) => number,
): Map<string, number> => {
  const most = new Map<string, number>();
  for (const item of list)
    most.set(item.kind, Math.max(most.get(item.kind) ?? 0, progressOf(item.id)));
  return most;
};

/**
 * The legend names what colour, rhythm and shape mean, for the kinds that are
 * on screen now. Kinds captioned on their own edges need no entry. Its plate
 * takes its place in `occupied`.
 */
export function composeLegend(ctx: FrameContext, occupied: RectIndex): DisplayItem[] {
  const { view, style, theme: P, u, sans, measure, locale, spec } = ctx;
  const { stage } = spec;
  const titleBand = spec.safe.title;
  const items: DisplayItem[] = [];
  const nodeKindProgress = kindProgress(view.nodes, ctx.nodeProgress),
    edgeKindProgress = kindProgress(view.edges, ctx.edgeProgress);
  const legendEntries = style.legend.flatMap((entry) => {
    const isNode = entry.of === 'node';
    if (!isNode && edgeStyleFor(style, entry.kind).caption) return [];
    const progress = (isNode ? nodeKindProgress : edgeKindProgress).get(entry.kind) ?? 0;
    return progress > 0.5 ? [{ ...entry, isNode, alpha: Math.min(1, (progress - 0.5) * 2) }] : [];
  });
  if (legendEntries.length <= 1) return items;
  const font = sans(12, 400),
    swatch = u(20),
    gap = u(6),
    between = u(16),
    padX = u(10),
    h = u(24);
  const x0 = titleBand.x + u(2),
    y0 = stage.y + stage.h - h - u(8),
    limit = stage.x + stage.w - u(12);
  const row: DisplayItem[] = [];
  let x = x0 + padX;
  for (const entry of legendEntries) {
    const text = fitText(measure, localize(entry.label, locale), font, u(120)),
      w = (entry.isNode ? u(12) : swatch) + gap + measure(text, font);
    if (x + w + padX > limit) break;
    const cy = y0 + h / 2;
    if (entry.isNode) {
      const kindStyle = nodeStyleFor(style, entry.kind),
        c = color(kindStyle.color, toneOf(P, kindStyle.tone) ?? P.legendText),
        half = u(5.2),
        // The miniature is the glyph as drawn: off the time axis a span is a point.
        shape = kindStyle.shape === 'span' && !style.timeAxis ? 'circle' : kindStyle.shape;
      // A miniature of the kind's shape: [half width, half height, corner].
      const [w, h, corner] =
        shape === 'pill' || shape === 'capsule'
          ? [1.25, 0.78, 0.62]
          : shape === 'square'
            ? [0.9, 0.9, 0.26]
            : shape === 'box'
              ? [1.25, 0.82, 0.3]
              : shape === 'span'
                ? [1.3, 0.55, 0.25]
                : shape === 'hexagon'
                  ? [1.08, 1.08 * (Math.sqrt(3) / 2), 0]
                  : shape === 'decision'
                    ? [1.25, 0.9, 0]
                    : [1, 1, 0];
      const g: GlyphGeometry = {
        shape,
        radius: half,
        halfWidth: half * w,
        halfHeight: half * h,
        cornerRadius: half * corner,
        halfStroke: 0,
      };
      row.push({
        type: 'path',
        d: nodeOutline({ x: x + u(6), y: cy }, g),
        fill: mixHex(color(c, P.fallbackNode), P.nodeFill, P.nodeTint),
        stroke: c,
        width: u(1.5),
        alpha: entry.alpha,
      });
    } else {
      const edgeStyle = edgeStyleFor(style, entry.kind),
        c = color(edgeStyle.color, toneOf(P, edgeStyle.tone) ?? edgePaint(P, edgeStyle.stroke));
      row.push({
        type: 'path',
        d: [
          ['M', x, cy],
          ['L', x + swatch, cy],
        ],
        stroke: c,
        width: u(2),
        ...(edgeStyle.dash?.length ? { dash: edgeStyle.dash.map(u) } : {}),
        alpha: entry.alpha,
      });
    }
    row.push({
      type: 'text',
      text,
      x: x + (entry.isNode ? u(12) : swatch) + gap,
      y: cy + u(0.5),
      font,
      fill: P.legendText,
      baseline: 'middle',
      alpha: entry.alpha,
    });
    x += w + between;
  }
  if (row.length) {
    const plate = { x: x0, y: y0, w: x - between + padX - x0, h };
    occupied.add(plate);
    items.push(
      {
        type: 'path',
        d: [['RR', plate.x, plate.y, plate.w, plate.h, h / 2]],
        fill: P.legendPlate,
      },
      ...row,
    );
  }
  return items;
}
