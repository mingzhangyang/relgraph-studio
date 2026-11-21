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
    /**
     * Strip of the stage that holds the legend, clear of the graph area and
     * the evidence card. Without it the legend sits at the bottom left of
     * the stage, as in the landscape specs.
     */
    legend?: Rect;
    /**
     * Where the evidence card is drawn (ADR 004, D7 step 1). Without it the
     * card is the right of the graph area (`evidenceCardRegion`).
     */
    card?: Rect;
  };
  /** Size of text, strokes and spacing relative to the 720p design. */
  typeScale: number;
  /** How the frame furniture is laid out; landscape when absent (`furnitureOf`). */
  furniture?: Partial<FrameFurniture>;
}

/**
 * The layout of a spec's frame furniture (ADR 004, D7 step 1). The landscape
 * specs use the defaults, `LANDSCAPE_FURNITURE`.
 */
export interface FrameFurniture {
  /**
   * `inline`: the film title shares its row with the domain time, and the
   * kicker with the frame number, at the top of the band. `stacked`: kicker
   * and frame number, film title, and domain time each on a row of their
   * own, at the bottom of the band so the space above stays clear.
   */
  title: 'inline' | 'stacked';
  /** Lines of narration the caption band holds before it ends in an ellipsis. */
  narrationLines: number;
  /**
   * `beside`: the card holds the right of the graph area and the camera
   * frames into the left. `below`: the card holds the bottom of the graph
   * area, just above the caption band, and the camera frames into the top.
   */
  card: 'beside' | 'below';
}
export const LANDSCAPE_FURNITURE: Readonly<FrameFurniture> = Object.freeze({
  title: 'inline',
  narrationLines: 2,
  card: 'beside',
});
/** The furniture of a spec, defaults filled in. */
export const furnitureOf = (spec: Pick<FrameSpec, 'furniture'>): FrameFurniture => ({
  ...LANDSCAPE_FURNITURE,
  ...spec.furniture,
});

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

/** A spec from rectangles in 720p reference units, at `typeScale`. */
const referenceSpec = (spec: FrameSpec): FrameSpec => {
  const k = spec.typeScale;
  return {
    ...spec,
    stage: scaleRect(spec.stage, k),
    safe: Object.fromEntries(
      Object.entries(spec.safe).map(([band, r]) => [band, scaleRect(r, k)]),
    ) as FrameSpec['safe'],
  };
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
      ...(spec.safe.legend ? { legend: scaleRect(spec.safe.legend, factor) } : {}),
      ...(spec.safe.card ? { card: scaleRect(spec.safe.card, factor) } : {}),
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
 * Portrait, 3:4 and square presets (ADR 004, D7 step 1), each with its own
 * safe areas. Rectangles are given in 720p reference units across a 720-unit
 * width and scaled by the type scale, 1.5: every text is as many pixels tall
 * as in landscape-1080p, so the same phone held either way shows the same
 * type size; narrow bands take more lines (four of narration), not smaller
 * type. See the D7 step 1 note in ADR 004 for the measurements.
 */
const PORTRAIT_1080X1920 = referenceSpec({
  name: 'portrait-1080x1920',
  width: 1080,
  height: 1920,
  fps: 24,
  stage: { x: 16, y: 156, w: 688, h: 818 },
  safe: {
    title: { x: 40, y: 0, w: 640, h: 150 },
    legend: { x: 40, y: 182, w: 640, h: 62 },
    graph: { x: 40, y: 252, w: 640, h: 708 },
    card: { x: 40, y: 680, w: 640, h: 280 },
    caption: { x: 40, y: 980, w: 640, h: 300 },
  },
  typeScale: 1.5,
  furniture: { title: 'stacked', narrationLines: 4, card: 'below' },
});
const PORTRAIT_1080X1440 = referenceSpec({
  name: 'portrait-1080x1440',
  width: 1080,
  height: 1440,
  fps: 24,
  stage: { x: 16, y: 134, w: 688, h: 600 },
  safe: {
    title: { x: 40, y: 0, w: 640, h: 128 },
    legend: { x: 40, y: 160, w: 640, h: 62 },
    graph: { x: 40, y: 230, w: 640, h: 488 },
    card: { x: 40, y: 478, w: 640, h: 240 },
    caption: { x: 40, y: 740, w: 640, h: 220 },
  },
  typeScale: 1.5,
  furniture: { title: 'stacked', narrationLines: 4, card: 'below' },
});
const SQUARE_1080 = referenceSpec({
  name: 'square-1080',
  width: 1080,
  height: 1080,
  fps: 24,
  stage: { x: 16, y: 102, w: 688, h: 392 },
  safe: {
    title: { x: 40, y: 0, w: 640, h: 96 },
    legend: { x: 40, y: 128, w: 640, h: 30 },
    graph: { x: 40, y: 164, w: 640, h: 324 },
    card: { x: 370, y: 164, w: 320, h: 324 },
    caption: { x: 40, y: 500, w: 640, h: 220 },
  },
  typeScale: 1.5,
  furniture: { title: 'inline', narrationLines: 4, card: 'beside' },
});

/**
 * The 16:9 presets, scaled from the 720p design, and the portrait, 3:4 and
 * square presets with their own safe areas and furniture.
 */
export const FRAME_SPECS = deepFreeze({
  'landscape-720p': LANDSCAPE_720P,
  'landscape-1080p': scaleFrameSpec(LANDSCAPE_720P, 1.5, 'landscape-1080p'),
  'portrait-1080x1920': PORTRAIT_1080X1920,
  'portrait-1080x1440': PORTRAIT_1080X1440,
  'square-1080': SQUARE_1080,
});
export type FrameSpecName = keyof typeof FRAME_SPECS;
export const DEFAULT_FRAME_SPEC: Readonly<FrameSpec> = FRAME_SPECS['landscape-720p'];

// Scaled rectangles may exceed an exact edge by floating-point rounding.
const EPSILON = 1e-6;

/**
 * Smallest band heights, in 720p reference units, that hold the landscape
 * band layout: the title band's two text rows and rule, and the caption
 * band's scene label, title, two narration lines and progress track. Other
 * furniture needs other heights: see `minBandHeight`.
 */
export const MIN_BAND_HEIGHT = Object.freeze({ title: 88, caption: 158 });

/**
 * Smallest band heights of a spec, in 720p reference units (ADR 004, D7
 * step 1): a stacked title band holds three rows (kicker and frame number,
 * film title, domain time) and its rule; the caption band grows by one
 * narration line, 21 units, for each line past two.
 */
export function minBandHeight(spec: Pick<FrameSpec, 'furniture'>): {
  title: number;
  caption: number;
} {
  const furniture = furnitureOf(spec);
  return {
    title: furniture.title === 'stacked' ? 120 : MIN_BAND_HEIGHT.title,
    caption: MIN_BAND_HEIGHT.caption + (furniture.narrationLines - 2) * 21,
  };
}

const overlaps = (a: Rect, b: Rect): boolean =>
  a.x < b.x + b.w - EPSILON &&
  b.x < a.x + a.w - EPSILON &&
  a.y < b.y + b.h - EPSILON &&
  b.y < a.y + a.h - EPSILON;

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
  const optional = [spec.safe?.legend, spec.safe?.card].filter((r) => r !== undefined);
  const rects = [spec.stage, spec.safe?.title, spec.safe?.graph, spec.safe?.caption, ...optional];
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
  const invalid = (why: string): RangeError =>
    new RangeError(`Invalid frame spec ${String(spec.name)}: ${why}`);
  const f = spec.furniture ?? {};
  if (
    (f.title !== undefined && f.title !== 'inline' && f.title !== 'stacked') ||
    (f.card !== undefined && f.card !== 'beside' && f.card !== 'below') ||
    (f.narrationLines !== undefined &&
      !(Number.isInteger(f.narrationLines) && f.narrationLines >= 1 && f.narrationLines <= 6))
  )
    throw invalid('unknown furniture');
  const least = minBandHeight(spec);
  for (const band of ['title', 'caption'] as const)
    if (spec.safe[band].h < least[band] * spec.typeScale - EPSILON)
      throw invalid(`safe.${band} is shorter than ${least[band] * spec.typeScale}px`);
  // The stage clips the graph and its labels, so labels never enter a band.
  for (const band of ['title', 'caption'] as const)
    if (overlaps(spec.stage, spec.safe[band])) throw invalid(`the stage overlaps safe.${band}`);
  if (overlaps(spec.safe.title, spec.safe.caption)) throw invalid('the bands overlap');
  const { legend, card } = spec.safe;
  if (legend && !contains(spec.stage, legend)) throw invalid('safe.legend must lie on the stage');
  if (legend && overlaps(legend, spec.safe.graph)) throw invalid('safe.legend overlaps safe.graph');
  // The legend is drawn in whole rows; a strip that holds none would let a
  // row's plate reach past it, over the graph.
  if (legend && legend.h < LEGEND_ROW_HEIGHT * spec.typeScale - EPSILON)
    throw invalid(
      `safe.legend is shorter than one legend row (${LEGEND_ROW_HEIGHT * spec.typeScale}px)`,
    );
  if (card) {
    if (!contains(spec.stage, card)) throw invalid('safe.card must lie on the stage');
    if (legend && overlaps(legend, card)) throw invalid('safe.legend overlaps safe.card');
  }
  // The camera frames into what the card leaves of the graph area, which
  // must be more than the gap kept to the card.
  const region = evidenceCardRegion(spec),
    g = spec.safe.graph,
    gap = EVIDENCE_CARD_GAP * spec.typeScale;
  const room = furnitureOf(spec).card === 'below' ? region.y - gap - g.y : region.x - gap - g.x;
  if (!(room > 0)) throw invalid('the card leaves no room for the graph');
  return spec;
}

/**
 * Where a frame shows an evidence card (ADR 004, D4 and D7 step 1): the
 * spec's `safe.card` when it has one (portrait, 3:4 and square), otherwise,
 * as in landscape, the right of the graph safe area, the full height of it,
 * reaching 10 reference pixels past its right edge like the detail card. The
 * camera frames the graph into what is left (`cardFreeArea`), so the card
 * never covers the nodes it is about. The drawn card is as tall as its
 * items, from the top of the region, or from its bottom for a card below
 * the graph.
 */
export function evidenceCardRegion(spec: FrameSpec): Rect {
  if (spec.safe.card) return spec.safe.card;
  const g = spec.safe.graph,
    u = spec.typeScale;
  const w = Math.min(EVIDENCE_CARD_WIDTH * u, g.w / 2);
  return { x: g.x + g.w + 10 * u - w, y: g.y, w, h: g.h };
}
/** Height of one legend row (its plate), in 720p reference pixels. */
export const LEGEND_ROW_HEIGHT = 28;
/** Width of the evidence card, in 720p reference pixels. */
export const EVIDENCE_CARD_WIDTH = 370;
/** Least space between the evidence card and the area the camera frames into. */
export const EVIDENCE_CARD_GAP = 20;

/**
 * The part of the graph area the camera frames into while a card is shown:
 * left of the card when it is beside the graph, above it when it is below,
 * `EVIDENCE_CARD_GAP` short of it.
 */
export function cardFreeArea(spec: FrameSpec): Rect {
  const g = spec.safe.graph,
    u = spec.typeScale;
  const card = evidenceCardRegion(spec);
  if (furnitureOf(spec).card === 'below')
    return { x: g.x, y: g.y, w: g.w, h: Math.max(u, card.y - EVIDENCE_CARD_GAP * u - g.y) };
  return { x: g.x, y: g.y, w: Math.max(u, card.x - EVIDENCE_CARD_GAP * u - g.x), h: g.h };
}

/** Camera fit extents in the 720p reference units used by core. */
export const cameraFitFor = (spec: FrameSpec): CameraFit => {
  const g = spec.safe.graph,
    u = spec.typeScale;
  const free = cardFreeArea(spec);
  return {
    halfWidth: g.w / 2 / u,
    halfHeight: g.h / 2 / u,
    card: {
      halfWidth: free.w / 2 / u,
      halfHeight: free.h / 2 / u,
      offsetX: (free.x + free.w / 2 - (g.x + g.w / 2)) / u,
      offsetY: (free.y + free.h / 2 - (g.y + g.h / 2)) / u,
    },
  };
};

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

/**
 * Convert a screen-pixel displacement into a world coordinate without
 * overflowing a valid finite result. Large opposite world coordinates can
 * exceed Number.MAX_VALUE when the intermediate pixel delta is divided by
 * a very small zoom, even if the final world position is representable.
 *
 * Prefer the ordinary expression to preserve its precision for normal views.
 * Only when it overflows, combine the scaled origin and pixel offset first.
 */
export function worldWithScreenOffset(
  worldOrigin: number,
  pixelOffset: number,
  scale: number,
): number | null {
  if (
    !Number.isFinite(worldOrigin) ||
    !Number.isFinite(pixelOffset) ||
    !Number.isFinite(scale) ||
    !(scale > 0)
  )
    return null;
  if (pixelOffset === 0) return worldOrigin;
  const direct = worldOrigin + pixelOffset / scale;
  if (Number.isFinite(direct)) return direct;
  const scaledOrigin = worldOrigin * scale;
  const scaledTarget = scaledOrigin + pixelOffset;
  if (!Number.isFinite(scaledTarget)) return null;
  const result = scaledTarget / scale;
  return Number.isFinite(result) ? result : null;
}

/**
 * The width:height, in world units, that layout engines aim for when a
 * drawing is computed for a film at `spec` (ADR 004, D7 step 2): the graph
 * area's, or its inverse when time is drawn vertically (the drawing is then
 * shown transposed). Undefined for a landscape spec drawn horizontally: the
 * engines keep their landscape default, so no landscape film changes.
 */
export function engineAspect(
  spec: Pick<FrameSpec, 'width' | 'height' | 'safe'>,
  direction: 'horizontal' | 'vertical',
): number | undefined {
  if (spec.width > spec.height && direction === 'horizontal') return undefined;
  const g = spec.safe.graph,
    drawn = g.w / g.h;
  return direction === 'vertical' ? 1 / drawn : drawn;
}
