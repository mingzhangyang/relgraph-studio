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
export type DisplayItem = PathItem | TextItem | GroupItem;

/** The visible, spoiler-filtered text of a frame, from the same source as its pixels. */
export interface FrameText {
  title: string;
  scene: { index: number; count: number; title: string; narration: string };
  domainTime: string;
  detail: { label: string; summary: string } | null;
  nodes: string[];
  relations: string[];
}

export interface DisplayList {
  selectionClip?: { x: number; y: number; w: number; h: number };
  selection?: {
    kind: 'node' | 'edge';
    id: string;
    box?: { x: number; y: number; w: number; h: number };
    points?: { x: number; y: number }[];
  }[];
  width: number;
  height: number;
  items: DisplayItem[];
  a11y: FrameText;
}

/** Width of `text` in pixels when drawn with `font`. */
export type TextMeasurer = (text: string, font: FontRef) => number;

/** Depth-first walk over all drawable items, e.g. for tests and text search. */
export function* walkDisplayItems(items: readonly DisplayItem[]): Generator<PathItem | TextItem> {
  for (const item of items) {
    if (item.type === 'group') yield* walkDisplayItems(item.items);
    else yield item;
  }
}
