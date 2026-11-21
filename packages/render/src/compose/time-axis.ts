import type { DisplayItem, PathCommand, TextItem } from '../display-list.js';
import { projectCameraPoint, type Rect } from '../frame-spec.js';
import { rectsIntersect } from '../node-geometry.js';
import type { RectIndex } from '../spatial.js';
import type { FrameContext } from './context.js';
import { mix } from './geometry.js';
import { legendArea } from './legend.js';

/** Rules at 1, 2 or 5 times a power of ten, about `apart` reference pixels apart. */
function ruleStep(apart: number, scale: number): { step: number; decimals: number } {
  const rough = apart / scale,
    power = Math.pow(10, Math.floor(Math.log10(rough))),
    ratio = rough / power,
    step = power * (ratio <= 1 ? 1 : ratio <= 2 ? 2 : ratio <= 5 ? 5 : 10);
  return { step, decimals: Math.max(0, -Math.floor(Math.log10(step))) };
}

/** The time the cursor shows: where the previous shot left it, moving to this one's. */
function cursorTime(ctx: FrameContext, at: number): number {
  const { playback, graph, transition } = ctx;
  // The shot before this one may have set the time this one starts from.
  let before: number = at;
  for (let i = 0; i < playback.index && i < graph.scenes.length; i++) {
    const t = graph.scenes[i].domainAt;
    if (t !== undefined) before = t;
  }
  return mix(playback.index > 0 ? before : at, at, transition);
}

/**
 * A timeline's axis: quiet rules at round times, and a cursor at the film's
 * present that travels with each shot. Nothing for a drawing without an axis.
 * The rule labels take their place in `occupied`.
 *
 * With time running down (ADR 004, D7 step 2) the rules run across the
 * stage, their labels stand in a column at its left edge, clear of the
 * legend, and the cursor is a level line with its head beside the labels.
 * `composeFrame` then drops a label the evidence card would cover
 * (`withoutCoveredLabels`).
 */
export function composeTimeAxis(ctx: FrameContext, occupied: RectIndex): DisplayItem[] {
  const { style, spec, cam, theme: P, u, mono, bounds, measure, playback } = ctx;
  const { stage } = spec;
  const items: DisplayItem[] = [];
  const axis = style.timeAxis;
  if (!axis || !(axis.to > axis.from)) return items;
  const half = ((axis.to - axis.from) * axis.scale) / 2;
  if (ctx.vertical) return composeVerticalAxis(ctx, occupied);
  const screenX = (time: number): number =>
    projectCameraPoint({ x: (time - axis.from) * axis.scale - half, y: 0 }, cam, spec).x;
  // Rules about 110 reference pixels apart, at 1, 2 or 5 times a power of ten.
  const { step, decimals } = ruleStep(110, axis.scale * cam.scale);
  const rules: PathCommand[] = [],
    font = mono(11);
  for (
    let k = Math.ceil(axis.from / step);
    k <= Math.floor(axis.to / step) && rules.length < 400;
    k++
  ) {
    const time = k * step,
      x = screenX(time);
    if (x < bounds.left + u(20) || x > bounds.right - u(20)) continue;
    rules.push(['M', x, stage.y + u(24)], ['L', x, stage.y + stage.h]);
    const text = decimals ? time.toFixed(decimals) : String(Math.round(time)),
      w = measure(text, font);
    occupied.add({ x: x - w / 2 - u(3), y: stage.y + u(5), w: w + u(6), h: u(18) });
    items.push({
      type: 'text',
      text,
      x,
      y: stage.y + u(14),
      font,
      fill: P.legendText,
      align: 'center',
      baseline: 'middle',
    });
  }
  if (rules.length) items.push({ type: 'path', d: rules, stroke: P.bandRule, width: u(1) });
  if (playback.domainAt !== null) {
    const x = screenX(cursorTime(ctx, playback.domainAt));
    if (x >= bounds.left && x <= bounds.right)
      items.push(
        {
          type: 'path',
          d: [
            ['M', x, stage.y + u(24)],
            ['L', x, stage.y + stage.h],
          ],
          stroke: P.progress,
          width: u(1.4),
          alpha: 0.55,
        },
        {
          type: 'path',
          d: [
            ['M', x - u(5), stage.y + u(24)],
            ['L', x + u(5), stage.y + u(24)],
            ['L', x, stage.y + u(31)],
            ['Z'],
          ],
          fill: P.progress,
        },
      );
  }
  return items;
}

/** Height of a rule label's box, in reference pixels: the row it takes in `occupied`. */
const LABEL_HEIGHT = 18;

/** The vertical axis: time runs down the stage (`composeTimeAxis`). */
function composeVerticalAxis(ctx: FrameContext, occupied: RectIndex): DisplayItem[] {
  const { style, spec, cam, theme: P, u, mono, bounds, measure, playback } = ctx;
  const axis = style.timeAxis!;
  const { stage } = spec;
  const half = ((axis.to - axis.from) * axis.scale) / 2;
  // Drawn y is stored x: the transpose of the horizontal axis.
  const screenY = (time: number): number =>
    projectCameraPoint({ x: 0, y: (time - axis.from) * axis.scale - half }, cam, spec).y;
  // Rows of type are shorter than they are wide: rules about 64 apart.
  const { step, decimals } = ruleStep(64, axis.scale * cam.scale);
  const font = mono(11),
    left = bounds.left + u(2);
  // The legend keeps its place: no label in its rows (a strip, or the
  // landscape legend's row at the bottom left of the stage).
  const legend = legendArea(ctx);
  const marks: { y: number; text: string; w: number }[] = [];
  for (
    let k = Math.ceil(axis.from / step);
    k <= Math.floor(axis.to / step) && marks.length < 400;
    k++
  ) {
    const time = k * step,
      y = screenY(time);
    if (y < bounds.top + u(20) || y > bounds.bottom - u(20)) continue;
    const text = decimals ? time.toFixed(decimals) : String(Math.round(time));
    marks.push({ y, text, w: measure(text, font) });
  }
  // The rules start right of the widest label, so every rule reads level
  // with its own label and none runs under another.
  const column = left + Math.max(0, ...marks.map((m) => m.w)) + u(6);
  const items: DisplayItem[] = [],
    rules: PathCommand[] = [];
  for (const { y, text, w } of marks) {
    const box: Rect = {
      x: left - u(2),
      y: y - u(LABEL_HEIGHT) / 2,
      w: w + u(4),
      h: u(LABEL_HEIGHT),
    };
    // A rule whose label the legend would hide is left out with it: an
    // unlabelled rule reads as a stray line.
    if (legend && rectsIntersect(box, legend)) continue;
    if (box.y < bounds.top || box.y + box.h > bounds.bottom) continue;
    rules.push(['M', column, y], ['L', stage.x + stage.w, y]);
    occupied.add(box);
    items.push({
      type: 'text',
      text,
      x: left,
      y,
      font,
      fill: P.legendText,
      align: 'left',
      baseline: 'middle',
    });
  }
  if (rules.length) items.unshift({ type: 'path', d: rules, stroke: P.bandRule, width: u(1) });
  if (playback.domainAt !== null) {
    const y = screenY(cursorTime(ctx, playback.domainAt));
    if (y >= bounds.top && y <= bounds.bottom)
      items.push(
        {
          type: 'path',
          d: [
            ['M', column, y],
            ['L', stage.x + stage.w, y],
          ],
          stroke: P.progress,
          width: u(1.4),
          alpha: 0.55,
        },
        {
          type: 'path',
          d: [['M', column, y - u(5)], ['L', column, y + u(5)], ['L', column + u(7), y], ['Z']],
          fill: P.progress,
        },
      );
  }
  return items;
}

/**
 * The axis without the rule labels a card would cover: with time running
 * down they stand at the stage's left edge, which a card below the graph
 * spans. Rules and cursor pass under the card like relations do.
 */
export function withoutCoveredLabels(
  ctx: FrameContext,
  items: DisplayItem[],
  card: Rect | null,
): DisplayItem[] {
  if (!ctx.vertical || !card) return items;
  return items.filter((item) => {
    if (item.type !== 'text') return true;
    const text = item as TextItem;
    const h = ctx.u(LABEL_HEIGHT);
    const box = {
      x: text.x - ctx.u(2),
      y: text.y - h / 2,
      w: ctx.measure(text.text, text.font) + ctx.u(4),
      h,
    };
    return !rectsIntersect(box, card);
  });
}
