import { edgeStyleFor, localize, nodeStyleFor } from '@relgraph/core';
import type { DisplayItem } from '../display-list.js';
import { LEGEND_ROW_HEIGHT, type Rect } from '../frame-spec.js';
import { miniatureGeometry, nodeOutline } from '../node-geometry.js';
import type { RectIndex } from '../spatial.js';
import { edgePaint, mixHex, toneOf } from '../theme.js';
import { color, type FrameContext } from './context.js';
import { fitText } from './text.js';

/**
 * The legend's type and marks, in 720p design units. At 12 its words were
 * the smallest text in the frame, about 9 px in the workspace preview; now
 * they are no smaller than the frame's other secondary text (scene label and
 * group names, 13). Marks and plate grow with them.
 */
export const LEGEND = Object.freeze({
  size: 14,
  mark: 14,
  swatch: 22,
  gap: 7,
  plate: LEGEND_ROW_HEIGHT,
  /** Space between the rows of a legend strip. */
  rowGap: 6,
});

/**
 * Where the legend may be drawn: the spec's legend strip, or the landscape
 * legend's one row at the bottom left of the stage, as `composeLegend`
 * places it. Other furniture of the stage keeps out of it.
 */
export function legendArea(ctx: Pick<FrameContext, 'spec' | 'u'>): Rect {
  const { spec, u } = ctx;
  if (spec.safe.legend) return spec.safe.legend;
  const { stage } = spec,
    x = spec.safe.title.x + u(2),
    h = u(LEGEND.plate);
  return { x, y: stage.y + stage.h - h - u(8), w: stage.x + stage.w - u(12) - x, h };
}

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
 * on screen now. Kinds captioned on their own edges need no entry. Each row's
 * plate takes its place in `occupied`. Entries that find no room are left
 * out, as before; a legend strip with two rows holds more of them.
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
    return progress > 0.5
      ? [{ ...entry, hollow: false, isNode, alpha: Math.min(1, (progress - 0.5) * 2) }]
      : [];
  });
  const marked = view.nodes.find((node) => node.hollowOutline && ctx.nodeProgress(node.id) > 0.5);
  if (marked?.hollowOutline)
    legendEntries.unshift({
      of: 'node',
      isNode: true,
      kind: marked.kind,
      label: marked.hollowOutline,
      alpha: 1,
      hollow: true,
    });
  if (!marked && legendEntries.length <= 1) return items;
  const font = sans(LEGEND.size, 400),
    swatch = u(LEGEND.swatch),
    gap = u(LEGEND.gap),
    between = u(16),
    padX = u(12),
    h = u(LEGEND.plate),
    mark = u(LEGEND.mark);
  // Landscape: one row at the bottom left of the stage. A spec with a
  // legend strip (portrait, 3:4, square) fills its rows from the top left.
  const strip = spec.safe.legend;
  const x0 = strip ? strip.x : titleBand.x + u(2),
    limit = strip ? strip.x + strip.w : stage.x + stage.w - u(12),
    rowGap = u(LEGEND.rowGap),
    rows = strip ? Math.floor((strip.h + rowGap) / (h + rowGap)) : 1;
  // A strip too short for one row (frameSpecFor refuses such a spec) shows
  // no legend rather than a plate reaching past it.
  if (rows < 1) return items;
  const rowY = (row: number): number =>
    strip ? strip.y + row * (h + rowGap) : stage.y + stage.h - h - u(8);
  let row: DisplayItem[] = [];
  let line = 0,
    y0 = rowY(0),
    x = x0 + padX;
  const closeRow = (): void => {
    if (!row.length) return;
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
    row = [];
  };
  for (const entry of legendEntries) {
    const text = entry.hollow
        ? localize(entry.label, locale)
        : fitText(measure, localize(entry.label, locale), font, u(140)),
      w = (entry.isNode ? mark : swatch) + gap + measure(text, font);
    if (x + w + padX > limit) {
      // The next row, if the strip has one and this entry fits a row at all.
      if (line + 1 >= rows || x0 + padX + w + padX > limit) break;
      closeRow();
      line += 1;
      y0 = rowY(line);
      x = x0 + padX;
    }
    const cy = y0 + h / 2;
    if (entry.isNode) {
      const kindStyle = nodeStyleFor(style, entry.kind),
        c = color(kindStyle.color, toneOf(P, kindStyle.tone) ?? P.legendText),
        half = mark * 0.43,
        // The miniature is the glyph as drawn: off the time axis a span is a point.
        shape = kindStyle.shape === 'span' && !style.timeAxis ? 'circle' : kindStyle.shape,
        miniature = miniatureGeometry(shape, half);
      // A bar runs down with time drawn vertically (ADR 004, D7 step 2).
      const drawn =
        shape === 'span' && ctx.vertical
          ? { ...miniature, halfWidth: miniature.halfHeight, halfHeight: miniature.halfWidth }
          : miniature;
      row.push({
        type: 'path',
        d: nodeOutline({ x: x + mark / 2, y: cy }, drawn),
        ...(entry.hollow
          ? { dash: [u(3), u(2)] }
          : { fill: mixHex(color(c, P.fallbackNode), P.nodeFill, P.nodeTint) }),
        stroke: c,
        width: u(1.5),
        alpha: entry.alpha,
      });
    } else {
      const edgeStyle = edgeStyleFor(style, entry.kind),
        c = color(
          edgeStyle.color,
          toneOf(P, edgeStyle.tone) ?? edgePaint(P, edgeStyle.stroke, style.edgeContrast),
        );
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
      x: x + (entry.isNode ? mark : swatch) + gap,
      y: cy + u(0.5),
      font,
      fill: P.legendText,
      baseline: 'middle',
      alpha: entry.alpha,
    });
    x += w + between;
  }
  closeRow();
  return items;
}
