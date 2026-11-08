import type { CameraFit } from '@relgraph/core';

export interface Rect {
  x: number;
  y: number;
  w: number;
  h: number;
}

/**
 * Output frame geometry (ADR 003, D2). Every position the composer draws is
 * derived from these rectangles and `typeScale`; nothing assumes 1280×720.
 */
export interface FrameSpec {
  name: string;
  width: number;
  height: number;
  fps: number;
  /** Visible graph area between the title and caption bands; clips the graph. */
  stage: Rect;
  safe: {
    /** Title band: kicker, film title and frame metadata. */
    title: Rect;
    /** Area the camera frames nodes into; its centre is the camera centre. */
    graph: Rect;
    /** Caption band: scene label, scene title, narration and progress. */
    caption: Rect;
  };
  /** Size of text, strokes and spacing relative to the 720p design. */
  typeScale: number;
}

const LANDSCAPE_720P: FrameSpec = {
  name: 'landscape-720p',
  width: 1280,
  height: 720,
  fps: 24,
  stage: { x: 26, y: 108, w: 1228, h: 434 },
  safe: {
    title: { x: 62, y: 0, w: 1156, h: 104 },
    graph: { x: 90, y: 135, w: 1100, h: 390 },
    caption: { x: 62, y: 548, w: 1156, h: 172 },
  },
  typeScale: 1,
};

const scaleRect = (r: Rect, k: number): Rect => ({
  x: r.x * k,
  y: r.y * k,
  w: r.w * k,
  h: r.h * k,
});

/** A uniformly scaled copy, e.g. 1080p from the 720p design. */
export function scaleFrameSpec(spec: FrameSpec, factor: number, name: string): FrameSpec {
  if (!(Number.isFinite(factor) && factor > 0)) throw new RangeError('Scale must be positive');
  return {
    ...spec,
    name,
    // Round up so the scaled rectangles always fit; the epsilon keeps an
    // exact product such as 1280 × 1.5 from gaining a pixel.
    width: Math.ceil(spec.width * factor - 1e-9),
    height: Math.ceil(spec.height * factor - 1e-9),
    stage: scaleRect(spec.stage, factor),
    safe: {
      title: scaleRect(spec.safe.title, factor),
      graph: scaleRect(spec.safe.graph, factor),
      caption: scaleRect(spec.safe.caption, factor),
    },
    typeScale: spec.typeScale * factor,
  };
}

const deepFreeze = <T extends object>(value: T): Readonly<T> => {
  for (const child of Object.values(value))
    if (child && typeof child === 'object') deepFreeze(child as object);
  return Object.freeze(value);
};

/**
 * 16:9 presets. Portrait and square frames need their own safe areas and
 * caption layout; they arrive with the B3 recrop work rather than as a
 * mechanical rescale.
 */
export const FRAME_SPECS = deepFreeze({
  'landscape-720p': LANDSCAPE_720P,
  'landscape-1080p': scaleFrameSpec(LANDSCAPE_720P, 1.5, 'landscape-1080p'),
});
export type FrameSpecName = keyof typeof FRAME_SPECS;
export const DEFAULT_FRAME_SPEC: Readonly<FrameSpec> = FRAME_SPECS['landscape-720p'];

// Scaled rectangles may exceed an exact edge by floating-point rounding.
const EPSILON = 1e-6;

/**
 * Smallest band heights, in 720p reference units, that hold the composer's
 * band layout: the title band's two text rows and rule, and the caption
 * band's scene label, title, two narration lines and progress track.
 */
export const MIN_BAND_HEIGHT = Object.freeze({ title: 88, caption: 158 });

const contains = (outer: Rect, inner: Rect): boolean =>
  inner.x >= outer.x - EPSILON &&
  inner.y >= outer.y - EPSILON &&
  inner.x + inner.w <= outer.x + outer.w + EPSILON &&
  inner.y + inner.h <= outer.y + outer.h + EPSILON;

const isFrameSpecName = (name: string): name is FrameSpecName => Object.hasOwn(FRAME_SPECS, name);

/** Resolve a preset name or validate a custom spec. */
export function frameSpecFor(spec: FrameSpecName | FrameSpec | undefined): Readonly<FrameSpec> {
  if (spec === undefined) return DEFAULT_FRAME_SPEC;
  if (typeof spec === 'string') {
    if (!isFrameSpecName(spec)) throw new RangeError(`Unknown frame spec ${spec}`);
    return FRAME_SPECS[spec];
  }
  const rects = [spec.stage, spec.safe?.title, spec.safe?.graph, spec.safe?.caption];
  const positive = (n: unknown): boolean => typeof n === 'number' && Number.isFinite(n) && n > 0;
  if (
    !Number.isInteger(spec.width) ||
    !Number.isInteger(spec.height) ||
    !positive(spec.width) ||
    !positive(spec.height) ||
    !positive(spec.fps) ||
    !positive(spec.typeScale) ||
    !rects.every(
      (r) =>
        r &&
        Number.isFinite(r.x) &&
        Number.isFinite(r.y) &&
        positive(r.w) &&
        positive(r.h) &&
        r.x >= 0 &&
        r.y >= 0 &&
        r.x + r.w <= spec.width + EPSILON &&
        r.y + r.h <= spec.height + EPSILON,
    )
  )
    throw new RangeError(`Invalid frame spec ${String(spec.name)}`);
  // The camera centres nodes in the graph safe area, so the stage that clips
  // the graph must contain it; the bands must hold their text rows.
  if (!contains(spec.stage, spec.safe.graph))
    throw new RangeError(
      `Invalid frame spec ${String(spec.name)}: safe.graph must lie within the stage`,
    );
  for (const band of ['title', 'caption'] as const)
    if (spec.safe[band].h < MIN_BAND_HEIGHT[band] * spec.typeScale - EPSILON)
      throw new RangeError(
        `Invalid frame spec ${String(spec.name)}: safe.${band} is shorter than ${MIN_BAND_HEIGHT[band] * spec.typeScale}px`,
      );
  return spec;
}

/** Camera fit extents in the 720p reference units used by core. */
export const cameraFitFor = (spec: FrameSpec): CameraFit => ({
  halfWidth: spec.safe.graph.w / 2 / spec.typeScale,
  halfHeight: spec.safe.graph.h / 2 / spec.typeScale,
});

/** Screen position of the camera centre. */
export const cameraCenterFor = (spec: FrameSpec): { x: number; y: number } => ({
  x: spec.safe.graph.x + spec.safe.graph.w / 2,
  y: spec.safe.graph.y + spec.safe.graph.h / 2,
});


/** Overflow-safe coordinate difference, also used by interaction hit testing. */
export function scaledWorldDifference(value: number, center: number, scale: number): number {
  const difference = value - center;
  return Number.isFinite(difference) ? difference * scale : value * scale - center * scale;
}

/** Both display-list drawing and hit-testing must use this same projection. */
export function projectCameraPoint(
  point: { x: number; y: number },
  camera: { x: number; y: number; scale: number },
  spec: FrameSpec,
): { x: number; y: number } {
  const center = cameraCenterFor(spec);
  const scale = camera.scale * spec.typeScale;
  return {
    x: center.x + scaledWorldDifference(point.x, camera.x, scale),
    y: center.y + scaledWorldDifference(point.y, camera.y, scale),
  };
}
