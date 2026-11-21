/**
 * A frame as plain data (ADR 003, D1). `composeFrame` produces it; backends
 * only translate it into drawing calls. Values are JSON-serializable so tests
 * can assert on them and future backends (skia-canvas, SVG) can share them.
 */

export interface GradientStop {
  offset: number;
  color: string;
}
export type Paint =
  | string
  | { type: 'linear'; x0: number; y0: number; x1: number; y1: number; stops: GradientStop[] }
  | {
      type: 'radial';
      x0: number;
      y0: number;
      r0: number;
      x1: number;
      y1: number;
      r1: number;
      stops: GradientStop[];
    };

/** Path commands, using Canvas argument order. */
export type PathCommand =
  | ['M', number, number]
  | ['L', number, number]
  | ['Q', number, number, number, number]
  | ['A', number, number, number, number, number]
  | ['E', number, number, number, number, number, number, number]
  | ['R', number, number, number, number]
  | ['RR', number, number, number, number, number]
  | ['Z'];

export type FontFamily = 'sans' | 'serif' | 'mono';
export interface FontRef {
  family: FontFamily;
  size: number;
  weight: number;
}

/**
 * `alpha` multiplies with every enclosing group's alpha (it is not layer
 * opacity). A path is filled before it is stroked.
 */
export interface PathItem {
  type: 'path';
  d: PathCommand[];
  fill?: Paint;
  stroke?: Paint;
  width?: number;
  dash?: number[];
  alpha?: number;
}
export interface TextItem {
  type: 'text';
  text: string;
  x: number;
  y: number;
  font: FontRef;
  fill: Paint;
  align?: 'left' | 'center' | 'right';
  baseline?: 'top' | 'middle' | 'alphabetic';
  /** A round-joined outline drawn under the fill to separate text from lines. */
  halo?: { paint: Paint; width: number };
  alpha?: number;
}
export interface GroupItem {
  type: 'group';
  /** Canvas `transform(a, b, c, d, e, f)` applied to the children. */
  transform?: [number, number, number, number, number, number];
  clip?: { x: number; y: number; w: number; h: number };
  alpha?: number;
  items: DisplayItem[];
}
export interface ImageItem {
  type: 'image';
  assetId: string;
  source: { x: number; y: number; w: number; h: number };
  x: number;
  y: number;
  w: number;
  h: number;
  clip: PathCommand[];
  alpha?: number;
}
export type DisplayItem = PathItem | TextItem | GroupItem | ImageItem;

/** The visible, spoiler-filtered text of a frame, from the same source as its pixels. */
export interface FrameText {
  title: string;
  scene: { index: number; count: number; title: string; narration: string };
  domainTime: string;
  detail: { label: string; summary: string } | null;
  /**
   * The shot's evidence card (ADR 004, D4): what it is about and its items as
   * written, from the start of the shot, like the caption.
   */
  evidence: {
    subject: string;
    items: { quote?: string; cite?: string; locator?: string; url?: string }[];
  } | null;
  nodes: string[];
  relations: string[];
}

/**
 * A label the frame could not place: every candidate place would leave the
 * stage or cover a glyph or other text. Only objects whose point is on the
 * stage are listed, so a node the camera has framed out is not reported.
 * The label is still in `a11y`; this list says it is missing from the pixels.
 */
export interface OmittedLabel {
  kind: 'node-label' | 'edge-label';
  id: string;
  text: string;
}

/**
 * An evidence card that does not fit its region at this frame spec. The card
 * is not drawn: its text is never cut, so the data owner chooses fewer items
 * or a shorter quotation (ADR 004, D4).
 */
export interface EvidenceOverflow {
  object: 'node' | 'edge';
  id: string;
  /** Index, in the object's evidence, of the first item that does not fit. */
  item: number;
  /** Height the items up to that one need, and the height the card has, in 720p pixels. */
  needed: number;
  available: number;
}

/**
 * An evidence card withheld because, even after the camera framed the card's
 * node or relation ends into the area it leaves free, one end's glyph would
 * still lie under it (ADR 004, D4): typically a label-holding shape wider
 * than that area.
 */
export interface EvidenceCovers {
  object: 'node' | 'edge';
  id: string;
  /** The node whose glyph the card would cover. */
  node: string;
}

export interface DisplayList {
  selectionClip?: { x: number; y: number; w: number; h: number };
  selection?: {
    kind: 'node' | 'edge';
    id: string;
    box?: { x: number; y: number; w: number; h: number };
    points?: { x: number; y: number }[];
    /** A node's glyph outline as drawn: the centre line of its stroke. */
    outline?: PathCommand[];
    /** Half the stroke width of that outline, in output pixels. */
    halfStroke?: number;
    /** A relation's stroke width, in output pixels. */
    width?: number;
  }[];
  width: number;
  height: number;
  items: DisplayItem[];
  a11y: FrameText;
  /** Labels this frame had to leave out, in placement order (ADR 004, D1). */
  omitted: OmittedLabel[];
  /** The shot's evidence card, when it does not fit and is therefore not drawn. */
  evidenceOverflow: EvidenceOverflow | null;
  /** The shot's evidence card, when it would cover its own node or relation end and is not drawn. */
  evidenceCovers: EvidenceCovers | null;
}

/** Width of `text` in pixels when drawn with `font`. */
export type TextMeasurer = (text: string, font: FontRef) => number;

/** Depth-first walk over all drawable items, e.g. for tests and text search. */
export function* walkDisplayItems(
  items: readonly DisplayItem[],
): Generator<PathItem | TextItem | ImageItem> {
  for (const item of items) {
    if (item.type === 'group') yield* walkDisplayItems(item.items);
    else yield item;
  }
}
