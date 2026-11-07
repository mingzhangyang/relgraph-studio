import { directorFrameAt, domainStyle, localeFor } from '@relgraph/core';
import type { DirectorFrameState, DomainStyle, VisualGraph } from '@relgraph/core';
import { canvasTextMeasurer, drawDisplayList } from './backends/canvas2d.js';
import { composeFrame, type DetailLookup } from './compose.js';
import type { DisplayList } from './display-list.js';
import {
  cameraFitFor,
  DEFAULT_FRAME_SPEC,
  frameSpecFor,
  type FrameSpec,
  type FrameSpecName,
} from './frame-spec.js';
import { themeFor } from './theme.js';

export { shotAttention } from './compose.js';
export { VIDEO_THEMES, themeFor } from './theme.js';

type Point = { x: number; y: number };
export interface CanvasRendererOptions {
  /** Defaults to the frame spec's rate (24 for the presets). */
  fps?: number;
  detailAt?: DetailLookup;
  theme?: unknown;
  /** A preset name or custom spec; defaults to landscape-720p. */
  frameSpec?: FrameSpecName | FrameSpec;
  /** Overrides the style sheet registered for `graph.domain`. */
  style?: DomainStyle;
  /** Locale for renderer captions; unknown values fall back to zh-CN. */
  locale?: unknown;
}
export interface CanvasRenderer {
  /** Draw a frame and return its state. */
  renderFrame(frame: number): DirectorFrameState;
  /** Compose a frame without drawing it. */
  displayListAt(frame: number): DisplayList;
  theme: 'dark' | 'light';
  frameSpec: Readonly<FrameSpec>;
}

/** Size of the default 16:9 preview frame, kept for existing consumers. */
export const VIDEO_WIDTH = DEFAULT_FRAME_SPEC.width,
  VIDEO_HEIGHT = DEFAULT_FRAME_SPEC.height;

/**
 * Compose frames from a VisualGraph, a static layout and integer frame
 * numbers, and draw them through the Canvas 2D backend.
 */
export function createCanvasRenderer(
  canvas: Pick<HTMLCanvasElement, 'getContext' | 'width' | 'height'>,
  graph: VisualGraph,
  positions: ReadonlyMap<string, Point>,
  {
    fps,
    detailAt = () => undefined,
    theme = 'dark',
    frameSpec,
    style,
    locale,
  }: CanvasRendererOptions = {},
): CanvasRenderer {
  const palette = themeFor(theme);
  const spec = frameSpecFor(frameSpec);
  const rate = fps ?? spec.fps;
  const fit = cameraFitFor(spec);
  const resolvedStyle = style ?? domainStyle(graph.domain);
  const resolvedLocale = localeFor(locale);
  const ctx = canvas.getContext('2d', { alpha: false, desynchronized: false });
  canvas.width = spec.width;
  canvas.height = spec.height;
  function compose(frame: number): { state: DirectorFrameState; list: DisplayList } {
    const state = directorFrameAt(graph, positions, frame, rate, { fit });
    if (!ctx) throw new TypeError('Canvas 2D context is unavailable');
    const list = composeFrame(state, {
      graph,
      positions,
      frame,
      fps: rate,
      measure: canvasTextMeasurer(ctx),
      frameSpec: spec,
      theme: palette,
      style: resolvedStyle,
      locale: resolvedLocale,
      detailAt,
    });
    return { state, list };
  }
  return {
    renderFrame(frame) {
      const { state, list } = compose(frame);
      // compose() has already rejected a missing context.
      if (ctx) drawDisplayList(ctx, list);
      return state;
    },
    displayListAt: (frame) => compose(frame).list,
    theme: palette.name,
    frameSpec: spec,
  };
}
