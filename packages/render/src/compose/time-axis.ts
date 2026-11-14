import type { DisplayItem, PathCommand } from '../display-list.js';
import { projectCameraPoint } from '../frame-spec.js';
import type { RectIndex } from '../spatial.js';
import type { FrameContext } from './context.js';
import { mix } from './geometry.js';

/**
 * A timeline's axis: quiet rules at round times, and a cursor at the film's
 * present that travels with each shot. Nothing for a drawing without an axis.
 * The rule labels take their place in `occupied`.
 */
export function composeTimeAxis(ctx: FrameContext, occupied: RectIndex): DisplayItem[] {
  const { style, spec, cam, theme: P, u, mono, bounds, measure, playback, graph, transition } = ctx;
  const { stage } = spec;
  const items: DisplayItem[] = [];
  const axis = style.timeAxis;
  if (!axis || !(axis.to > axis.from)) return items;
  const half = ((axis.to - axis.from) * axis.scale) / 2;
  const screenX = (time: number): number =>
    projectCameraPoint({ x: (time - axis.from) * axis.scale - half, y: 0 }, cam, spec).x;
  // Rules about 110 reference pixels apart, at 1, 2 or 5 times a power of ten.
  const rough = 110 / (axis.scale * cam.scale),
    power = Math.pow(10, Math.floor(Math.log10(rough))),
    ratio = rough / power,
    step = power * (ratio <= 1 ? 1 : ratio <= 2 ? 2 : ratio <= 5 ? 5 : 10);
  const decimals = Math.max(0, -Math.floor(Math.log10(step)));
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
    // The shot before this one may have set the time this one starts from.
    let before: number = playback.domainAt;
    for (let i = 0; i < playback.index && i < graph.scenes.length; i++) {
      const at = graph.scenes[i].domainAt;
      if (at !== undefined) before = at;
    }
    const x = screenX(
      mix(playback.index > 0 ? before : playback.domainAt, playback.domainAt, transition),
    );
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
