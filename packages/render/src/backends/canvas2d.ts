import type {
  DisplayItem,
  DisplayList,
  FontFamily,
  FontRef,
  Paint,
  PathCommand,
  TextMeasurer,
} from '../display-list.js';
import { FILM_FONT_FAMILIES } from '../fonts.js';

/**
 * Canvas 2D backend (ADR 003, D1): a thin translation of display items into
 * drawing calls. It makes no layout, style or visibility decisions.
 */

// The vendored film font leads each stack; the rest only covers characters
// outside its subset.
export const FONT_STACKS: Readonly<Record<FontFamily, string>> = Object.freeze({
  sans: `"${FILM_FONT_FAMILIES.sans}", "PingFang SC", system-ui, sans-serif`,
  serif: `"${FILM_FONT_FAMILIES.serif}", "Songti SC", Georgia, serif`,
  mono: `"${FILM_FONT_FAMILIES.mono}", ui-monospace, monospace`,
});
export const cssFont = (font: FontRef): string =>
  `${font.weight} ${font.size}px ${FONT_STACKS[font.family]}`;

/** The subset of the Canvas 2D API this backend uses (also met by skia-canvas). */
export type Canvas2D = Pick<
  CanvasRenderingContext2D,
  | 'arc'
  | 'beginPath'
  | 'clearRect'
  | 'clip'
  | 'closePath'
  | 'createLinearGradient'
  | 'createRadialGradient'
  | 'ellipse'
  | 'fill'
  | 'fillRect'
  | 'fillText'
  | 'lineTo'
  | 'measureText'
  | 'moveTo'
  | 'quadraticCurveTo'
  | 'rect'
  | 'restore'
  | 'roundRect'
  | 'save'
  | 'setLineDash'
  | 'setTransform'
  | 'stroke'
  | 'strokeText'
  | 'transform'
> & {
  fillStyle: CanvasRenderingContext2D['fillStyle'];
  strokeStyle: CanvasRenderingContext2D['strokeStyle'];
  font: string;
  globalAlpha: number;
  lineJoin: CanvasLineJoin;
  lineWidth: number;
  textAlign: CanvasTextAlign;
  textBaseline: CanvasTextBaseline;
};

export function canvasTextMeasurer(ctx: Canvas2D): TextMeasurer {
  return (text, font) => {
    ctx.font = cssFont(font);
    return ctx.measureText(text).width;
  };
}

function paint(ctx: Canvas2D, value: Paint): string | CanvasGradient {
  if (typeof value === 'string') return value;
  const gradient =
    value.type === 'linear'
      ? ctx.createLinearGradient(value.x0, value.y0, value.x1, value.y1)
      : ctx.createRadialGradient(value.x0, value.y0, value.r0, value.x1, value.y1, value.r1);
  for (const stop of value.stops) gradient.addColorStop(stop.offset, stop.color);
  return gradient;
}

function trace(ctx: Canvas2D, commands: readonly PathCommand[]): void {
  for (const command of commands) {
    switch (command[0]) {
      case 'M':
        ctx.moveTo(command[1], command[2]);
        break;
      case 'L':
        ctx.lineTo(command[1], command[2]);
        break;
      case 'Q':
        ctx.quadraticCurveTo(command[1], command[2], command[3], command[4]);
        break;
      case 'A':
        ctx.arc(command[1], command[2], command[3], command[4], command[5]);
        break;
      case 'E':
        ctx.ellipse(
          command[1],
          command[2],
          command[3],
          command[4],
          command[5],
          command[6],
          command[7],
        );
        break;
      case 'R':
        ctx.rect(command[1], command[2], command[3], command[4]);
        break;
      case 'RR':
        ctx.roundRect(command[1], command[2], command[3], command[4], command[5]);
        break;
      case 'Z':
        ctx.closePath();
        break;
    }
  }
}

type RectCommand = Extract<PathCommand, ['R', ...number[]]>;
const isRect = (command: PathCommand): command is RectCommand => command[0] === 'R';

function drawItems(ctx: Canvas2D, items: readonly DisplayItem[], alpha: number): void {
  for (const item of items) {
    if (item.type === 'group') {
      ctx.save();
      if (item.transform) ctx.transform(...item.transform);
      if (item.clip) {
        ctx.beginPath();
        ctx.rect(item.clip.x, item.clip.y, item.clip.w, item.clip.h);
        ctx.clip();
      }
      drawItems(ctx, item.items, alpha * (item.alpha ?? 1));
      ctx.restore();
    } else if (item.type === 'path') {
      ctx.globalAlpha = alpha * (item.alpha ?? 1);
      // A lone rectangle fill uses fillRect, which antialiases fractional
      // edges differently from a filled rect() path; keep the established
      // pixels. Multi-subpath fills stay one path so overlaps and winding
      // keep their path semantics.
      const [only] = item.d;
      if (
        item.fill !== undefined &&
        item.stroke === undefined &&
        item.d.length === 1 &&
        isRect(only)
      ) {
        ctx.fillStyle = paint(ctx, item.fill);
        ctx.fillRect(only[1], only[2], only[3], only[4]);
        continue;
      }
      ctx.beginPath();
      trace(ctx, item.d);
      if (item.fill !== undefined) {
        ctx.fillStyle = paint(ctx, item.fill);
        ctx.fill();
      }
      if (item.stroke !== undefined) {
        ctx.strokeStyle = paint(ctx, item.stroke);
        ctx.lineWidth = item.width ?? 1;
        ctx.lineJoin = 'miter';
        ctx.setLineDash(item.dash ?? []);
        ctx.stroke();
      }
    } else {
      ctx.globalAlpha = alpha * (item.alpha ?? 1);
      ctx.font = cssFont(item.font);
      ctx.textAlign = item.align ?? 'left';
      ctx.textBaseline = item.baseline ?? 'alphabetic';
      if (item.halo) {
        ctx.lineJoin = 'round';
        ctx.lineWidth = item.halo.width;
        ctx.strokeStyle = paint(ctx, item.halo.paint);
        ctx.setLineDash([]);
        ctx.strokeText(item.text, item.x, item.y);
      }
      ctx.fillStyle = paint(ctx, item.fill);
      ctx.fillText(item.text, item.x, item.y);
    }
  }
}

/** Draw a display list onto a context whose canvas has the list's size. */
export function drawDisplayList(ctx: Canvas2D, list: DisplayList): void {
  ctx.setTransform(1, 0, 0, 1, 0, 0);
  ctx.globalAlpha = 1;
  ctx.setLineDash([]);
  ctx.clearRect(0, 0, list.width, list.height);
  drawItems(ctx, list.items, 1);
}
