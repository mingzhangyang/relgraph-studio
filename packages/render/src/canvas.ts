import { materializeImages, browserImageFactory, type ImageFactory } from './images.js';
import { compileTimeline, directorFrameAt, styleForGraph, localeFor } from '@relgraph/core';
import type { DirectorFrameState, DomainStyle, VisualGraph } from '@relgraph/core';
import { canvasTextMeasurer, drawDisplayList, type Canvas2D } from './backends/canvas2d.js';
import { composeFrame, drawingStyle, type DetailLookup } from './compose.js';
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
  imageFactory?: ImageFactory;
  /** Defaults to the frame spec's rate (24 for the presets). */
  fps?: number;
  detailAt?: DetailLookup;
  theme?: unknown;
  /** A preset name or custom spec; defaults to landscape-720p. */
  frameSpec?: FrameSpecName | FrameSpec;
  /** Overrides the style sheet registered for or derived from the graph. */
  style?: DomainStyle;
  /** Locale for renderer captions; unknown values fall back to zh-CN. */
  locale?: unknown;
  /** Lock the camera during an authoring drag. Not used in regular playback. */
  cameraOverride?: DirectorFrameState['cameraResolved'];
}
export interface CanvasRenderer {
  /** Draw a frame and return its state. */
  renderFrame(frame: number): DirectorFrameState;
  /** Draw and return both state and a11y-bearing display list in one composition. */
  renderFrameWithList(frame: number): { state: DirectorFrameState; list: DisplayList };
  /** Compose a frame without drawing it. */
  displayListAt(frame: number): DisplayList;
  theme: 'dark' | 'light';
  frameSpec: Readonly<FrameSpec>;
  /**
   * The style the frames are drawn with, at the positions as they are now
   * (`drawingStyle`). Hit tests and overlays read glyphs through this, so
   * they see the shapes the picture shows: spans only while it keeps time.
   */
  readonly style: DomainStyle;
}

/**
 * A canvas the renderer can size and draw on: an `HTMLCanvasElement` in the
 * browser, a skia-canvas `Canvas` in Node.
 */
export interface CanvasTarget {
  width: number;
  height: number;
  getContext(type: '2d', options?: object): Canvas2D | null;
}

/** Size of the default 16:9 preview frame, kept for existing consumers. */
export const VIDEO_WIDTH = DEFAULT_FRAME_SPEC.width,
  VIDEO_HEIGHT = DEFAULT_FRAME_SPEC.height;

/**
 * Compose frames from a VisualGraph, a static layout and integer frame
 * numbers, and draw them through the Canvas 2D backend.
 */
export function createCanvasRenderer(
  canvas: CanvasTarget,
  graph: VisualGraph,
  positions: ReadonlyMap<string, Point>,
  {
    fps,
    detailAt = () => undefined,
    theme = 'dark',
    frameSpec,
    style,
    locale,
    cameraOverride,
    imageFactory = browserImageFactory,
  }: CanvasRendererOptions = {},
): CanvasRenderer {
  if (
    cameraOverride &&
    (!Number.isFinite(cameraOverride.x) ||
      !Number.isFinite(cameraOverride.y) ||
      !(cameraOverride.scale > 0) ||
      !Number.isFinite(cameraOverride.scale))
  )
    throw new RangeError('Invalid camera override');
  const images = materializeImages(graph.project?.assets, imageFactory);
  const palette = themeFor(theme);
  const spec = frameSpecFor(frameSpec);
  const rate = fps ?? spec.fps;
  const fit = cameraFitFor(spec);
  const resolvedStyle = style ?? styleForGraph(graph);
  const resolvedLocale = localeFor(locale);
  // Safe compilation depends on the input document, never on playback order.
  const timeline = compileTimeline(graph, rate);
  const ctx = canvas.getContext('2d', { alpha: false, desynchronized: false });
  canvas.width = spec.width;
  canvas.height = spec.height;
  function compose(frame: number): { state: DirectorFrameState; list: DisplayList } {
    const evaluated = directorFrameAt(graph, positions, frame, rate, { fit, timeline });
    const state = cameraOverride
      ? { ...evaluated, cameraResolved: { ...cameraOverride } }
      : evaluated;
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
      if (ctx) drawDisplayList(ctx, list, images);
      // directorFrameAt returns a copy, so the cached timeline cannot leak.
      return state;
    },
    renderFrameWithList(frame) {
      const result = compose(frame);
      if (ctx) drawDisplayList(ctx, result.list, images);
      return result;
    },
    displayListAt: (frame) => compose(frame).list,
    theme: palette.name,
    frameSpec: spec,
    // Read on demand: an authoring drag moves the positions in place.
    get style() {
      return drawingStyle({ graph, positions, style: resolvedStyle });
    },
  };
}
