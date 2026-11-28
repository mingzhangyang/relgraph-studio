/**
 * The list form (`config.view.mode: "list"`): the projected graph read top
 * to bottom, one row per node in time order (`listOrder`). A row gives the
 * node's time, a marker in its kind's shape and colour, its name, its
 * summary as the frame's detail lookup gives it, and its relations to the
 * other rows in view written out as phrases ("黎曼 提出", "提出 黎曼猜想").
 *
 * The frame state is the drawing's: the same projection (spoiler safety),
 * reveal progress, highlight attention and camera. A row grows to its height
 * and fades in with its node's reveal, so later rows move down to make room;
 * rows outside the highlight are dimmed and highlighted ones sit on a plate.
 * Core places each row one `LIST_ROW` apart for the camera; here the camera's
 * position is mapped onto rows as tall as their measured words, which is
 * continuous across rows, so shot and beat framing scroll the list smoothly.
 * Text is wrapped, never cut.
 */
import {
  LIST_ROW,
  listOrder,
  nodeStyleFor,
  type VisualEdge,
  type VisualNode,
} from '@relgraph/core';
import type { DisplayItem, FontRef } from '../display-list.js';
import type { Rect } from '../frame-spec.js';
import { miniatureGeometry, nodeOutline } from '../node-geometry.js';
import { mixHex } from '../theme.js';
import type { FrameContext, Selection } from './context.js';
import { mix } from './geometry.js';
import { legendArea } from './legend.js';
import { drawnNodes } from './nodes.js';
import { wrapAllText } from './text.js';

/** Type sizes and spacing of a row, in 720p design units. */
export const LIST = Object.freeze({
  time: 17,
  title: 23,
  body: 18,
  relations: 15.5,
  /** Line height as a multiple of the type size. */
  leading: 1.45,
  padY: 9,
  gap: 6,
  marker: 8,
  /** Space between the time column, the rail and the text. */
  gutter: 16,
  /** Where the camera's framing centre sits, as a fraction of the list's height. */
  focus: 0.5,
});

const clamp = (n: number, min = 0, max = 1): number => Math.max(min, Math.min(max, n));
const ease = (t: number): number => {
  const x = clamp(t);
  return x * x * (3 - 2 * x);
};

/** A time as written. */
const timeText = (n: number): string => String(n);

/** The time a row shows: a span as `from–to`, else the first appearance. */
export function listTimeLabel(node: Pick<VisualNode, 'span' | 'visibility'>): string {
  if (node.span && Number.isFinite(node.span.from)) {
    const { from, to } = node.span;
    // A negative year beside the dash reads as one sign: space it out.
    const dash = from < 0 || (to !== undefined && to < 0) ? ' – ' : '–';
    return `${timeText(from)}${dash}${to === undefined ? '' : timeText(to)}`;
  }
  const from = node.visibility?.from;
  return from !== undefined && Number.isFinite(from) ? timeText(from) : '';
}

/**
 * A node's relations to the other nodes in view, as phrases: the other end
 * before the verb when the node is the target, after it when the node is the
 * source. A relation with no words of its own is named by its kind.
 */
export function relationPhrases(
  node: Pick<VisualNode, 'id'>,
  edges: readonly VisualEdge[],
  name: (id: string) => string | undefined,
  edgeText: (edge: VisualEdge) => string | undefined,
): string[] {
  const phrases: string[] = [];
  for (const edge of edges) {
    if (edge.source === edge.target) continue;
    const verb = (edgeText(edge) ?? edge.kind).trim();
    if (edge.target === node.id) {
      const other = name(edge.source);
      if (other !== undefined) phrases.push(`${other} ${verb}`.trim());
    } else if (edge.source === node.id) {
      const other = name(edge.target);
      if (other !== undefined) phrases.push(`${verb} ${other}`.trim());
    }
  }
  return phrases;
}

interface Row {
  node: VisualNode;
  time: string;
  title: string[];
  body: string[];
  relations: string[];
  /** Height when fully shown, in output pixels. */
  height: number;
  /** Reveal progress, 0–1: the share of its height the row takes. */
  grow: number;
}

/** Where the rows are drawn: the stage, above the landscape legend's row. */
export function listArea(ctx: FrameContext): Rect {
  const { stage, safe } = ctx.spec;
  const inset = ctx.u(10);
  // Below a legend strip (portrait, 3:4, square); above the landscape legend's row.
  const top = safe.legend ? Math.max(stage.y, safe.legend.y + safe.legend.h) : stage.y;
  const bottom = safe.legend ? stage.y + stage.h : legendArea(ctx).y - ctx.u(6);
  return {
    x: stage.x + inset,
    y: top + inset,
    w: stage.w - 2 * inset,
    h: bottom - top - 2 * inset,
  };
}

/**
 * The rows of a list frame and the legend for its kinds. The legend names
 * node kinds only: a list draws no lines.
 */
export function composeList(ctx: FrameContext): {
  items: DisplayItem[];
  selection: Selection;
} {
  const { view, theme: P, u, sans, mono, measure, cam } = ctx;
  const area = listArea(ctx);
  const font = {
    time: mono(LIST.time),
    title: sans(LIST.title, 700),
    body: sans(LIST.body),
    relations: sans(LIST.relations),
  };
  const lead = (f: FontRef): number => f.size * LIST.leading;
  const ordered = listOrder(view.nodes);
  const names = new Map(view.nodes.map((node) => [node.id, ctx.nodeLabel(node)]));
  const times = ordered.map(listTimeLabel);
  const timeWidth = Math.min(
    area.w * 0.28,
    Math.max(u(36), ...times.map((t) => measure(t, font.time))),
  );
  const railX = area.x + timeWidth + u(LIST.gutter);
  const textX = railX + u(LIST.gutter);
  const textW = Math.max(u(60), area.x + area.w - textX - u(14));
  const domainAt = ctx.playback.domainAt;
  const rows: Row[] = ordered.map((node, i) => {
    const title = wrapAllText(measure, names.get(node.id) ?? node.id, font.title, textW);
    const summary = ctx.detailAt(node.id, domainAt)?.summary?.trim();
    const body = summary ? wrapAllText(measure, summary, font.body, textW) : [];
    const phrases = relationPhrases(node, view.edges, (id) => names.get(id), ctx.edgeLabel);
    const relations = phrases.length
      ? wrapAllText(measure, phrases.join(' · '), font.relations, textW)
      : [];
    const height =
      u(LIST.padY) * 2 +
      title.length * lead(font.title) +
      (body.length ? u(LIST.gap) / 2 + body.length * lead(font.body) : 0) +
      (relations.length ? u(LIST.gap) / 2 + relations.length * lead(font.relations) : 0) +
      u(LIST.gap);
    return {
      node,
      time: times[i],
      title,
      body,
      relations,
      height,
      grow: ease(ctx.nodeProgress(node.id)),
    };
  });

  // Row tops before scrolling, as far as each row has grown.
  const tops: number[] = [];
  let total = 0;
  for (const row of rows) {
    tops.push(total);
    total += row.height * row.grow;
  }
  // The camera's y counts rows (LIST_ROW each): map it onto the measured rows
  // through their centres, continuously, then put it at the focus line.
  const centre = (i: number): number => tops[i] + (rows[i].height * rows[i].grow) / 2;
  let anchor = 0;
  if (rows.length) {
    const f = cam.y / LIST_ROW,
      last = rows.length - 1;
    if (f <= 0) anchor = centre(0) + f * rows[0].height;
    else if (f >= last) anchor = centre(last) + (f - last) * rows[last].height;
    else {
      const i = Math.floor(f);
      anchor = mix(centre(i), centre(i + 1), f - i);
    }
  }
  const scroll = total <= area.h ? 0 : clamp(anchor - area.h * LIST.focus, 0, total - area.h);

  const colours = new Map(drawnNodes(ctx).map((d) => [d.node.id, d]));
  const items: DisplayItem[] = [];
  const selection: Selection = [];
  const visibleRows = rows
    .map((row, i) => ({ row, top: area.y + tops[i] - scroll }))
    .filter(
      ({ row, top }) =>
        row.grow > 0 && top < area.y + area.h && top + row.height * row.grow > area.y,
    );
  if (visibleRows.length) {
    const first = visibleRows[0].top,
      lastRow = visibleRows.at(-1)!;
    items.push({
      type: 'path',
      d: [
        ['M', railX, Math.max(area.y, first + u(LIST.padY))],
        [
          'L',
          railX,
          Math.min(area.y + area.h, lastRow.top + lastRow.row.height * lastRow.row.grow),
        ],
      ],
      stroke: P.bandRule,
      width: u(2),
    });
  }
  for (const { row, top } of visibleRows) {
    const drawn = colours.get(row.node.id);
    const c = drawn?.c ?? P.fallbackNode;
    const appear = ctx.nodeProgress(row.node.id);
    // Attention runs from 0.24 (outside the highlight) to 1.
    const attention = drawn?.alpha ?? 1;
    const alpha = appear * mix(0.42, 1, clamp((attention - 0.24) / 0.76));
    const focus = (drawn?.focus ?? 0) * appear;
    const shown = row.height * row.grow;
    const slide = (1 - ease(appear)) * u(24);
    const rowItems: DisplayItem[] = [];
    if (focus > 0.01)
      rowItems.push({
        type: 'path',
        d: [
          [
            'RR',
            textX - u(12),
            top + u(2),
            area.x + area.w - textX + u(8),
            row.height - u(LIST.gap) - u(2),
            u(8),
          ],
        ],
        fill: P.card,
        stroke: P.cardStroke,
        width: u(1.25),
        alpha: focus,
      });
    const firstLine = top + u(LIST.padY);
    const titleMid = firstLine + lead(font.title) / 2;
    if (row.time)
      rowItems.push({
        type: 'text',
        text: row.time,
        x: railX - u(LIST.gutter),
        y: titleMid,
        font: font.time,
        fill: P.meta,
        align: 'right',
        baseline: 'middle',
      });
    const shape = drawn?.custom.shape ?? nodeStyleFor(ctx.style, row.node.kind).shape;
    // A timeline's bar has no length in a list: its row shows the span in words.
    const marker = miniatureGeometry(shape === 'span' ? 'circle' : shape, u(LIST.marker));
    rowItems.push({
      type: 'path',
      d: nodeOutline({ x: railX, y: titleMid }, marker),
      fill: mixHex(c, P.nodeFill, P.nodeTint),
      stroke: c,
      width: u(2),
    });
    let y = firstLine;
    const lines = (texts: string[], f: FontRef, fill: string): void => {
      for (const text of texts) {
        rowItems.push({
          type: 'text',
          text,
          x: textX + slide,
          y: y + lead(f) / 2,
          font: f,
          fill,
          baseline: 'middle',
        });
        y += lead(f);
      }
    };
    lines(row.title, font.title, P.labelActive);
    if (row.body.length) {
      y += u(LIST.gap) / 2;
      lines(row.body, font.body, P.narration);
    }
    if (row.relations.length) {
      y += u(LIST.gap) / 2;
      lines(row.relations, font.relations, P.edgeLabelText);
    }
    // A growing row shows only the part of it that has room yet.
    const clip = {
      x: area.x,
      y: Math.max(area.y, top),
      w: area.w,
      h: Math.min(area.y + area.h, top + shown) - Math.max(area.y, top),
    };
    if (clip.h <= 0) continue;
    items.push({ type: 'group', clip, alpha, items: rowItems });
    selection.push({
      kind: 'node',
      id: row.node.id,
      box: {
        x: textX - u(12),
        y: top + u(2),
        w: area.x + area.w - textX + u(8),
        h: Math.max(0, shown - u(LIST.gap) - u(2)),
      },
    });
  }
  return { items: [{ type: 'group', clip: { ...area }, items }], selection };
}

/** The list frame's legend context: node kinds only, markers never bars. */
export function listLegendContext(ctx: FrameContext): FrameContext {
  const style = { ...ctx.style, legend: ctx.style.legend.filter((entry) => entry.of === 'node') };
  delete (style as { timeAxis?: unknown }).timeAxis;
  return { ...ctx, style };
}
