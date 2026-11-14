import type { DisplayItem, PathCommand } from '../display-list.js';
import type { FrameContext } from './context.js';
import { TAU } from './geometry.js';

/**
 * Background: a quiet gradient, a soft light behind the stage and a fine
 * dot lattice that gives the graph a ground to sit on.
 */
export function composeBackground(ctx: FrameContext): DisplayItem[] {
  const { spec, theme: P, u } = ctx;
  const { width: W, height: H, stage } = spec;
  const stageCx = stage.x + stage.w / 2,
    stageCy = stage.y + stage.h / 2;
  const items: DisplayItem[] = [
    {
      type: 'path',
      d: [['R', 0, 0, W, H]],
      fill: {
        type: 'linear',
        x0: 0,
        y0: 0,
        x1: W,
        y1: H,
        stops: [
          { offset: 0, color: P.bg[0] },
          { offset: 0.5, color: P.bg[1] },
          { offset: 1, color: P.bg[2] },
        ],
      },
    },
    {
      type: 'path',
      d: [['R', 0, 0, W, H]],
      fill: {
        type: 'radial',
        x0: stageCx,
        y0: stageCy,
        r0: u(20),
        x1: stageCx,
        y1: stageCy,
        r1: stage.w * 0.52,
        stops: [
          { offset: 0, color: P.warm },
          { offset: 1, color: P.warmEnd },
        ],
      },
    },
  ];
  const lattice: PathCommand[] = [];
  const pitch = u(28),
    dot = u(0.8);
  for (let row = 0; stage.y + pitch * (row + 0.5) < stage.y + stage.h; row++)
    for (let column = 0; stage.x + pitch * (column + 0.5) < stage.x + stage.w; column++) {
      const x = stage.x + pitch * (column + 0.5),
        y = stage.y + pitch * (row + 0.5);
      lattice.push(['M', x + dot, y], ['A', x, y, dot, 0, TAU]);
    }
  items.push({ type: 'path', d: lattice, fill: P.grid });
  return items;
}
