import type { FontFamily } from './display-list.js';

/**
 * Vendored film fonts (ADR 003, D6): subsets of Noto Sans / Serif / Sans Mono
 * CJK SC under the SIL Open Font License, in `packages/render/fonts/`. Both
 * backends register them under these family names, which lead every
 * `FONT_STACKS` entry, so the browser preview and headless export measure and
 * draw the same glyphs. `scripts/subset-fonts.mjs` regenerates the files.
 */
export const FILM_FONT_FAMILIES: Readonly<Record<FontFamily, string>> = Object.freeze({
  sans: 'Noto Sans CJK SC',
  serif: 'Noto Serif CJK SC',
  mono: 'Noto Sans Mono CJK SC',
});

export interface FilmFontFace {
  family: FontFamily;
  /** Registered family name, `FILM_FONT_FAMILIES[family]`. */
  name: string;
  weight: number;
  /** File name in `packages/render/fonts/`. */
  file: string;
}

const face = (family: FontFamily, weight: number, file: string): FilmFontFace =>
  Object.freeze({ family, name: FILM_FONT_FAMILIES[family], weight, file });

/**
 * Every face the composer can request. Requested weights resolve with CSS
 * font matching in both backends: 450 → 500 and 600 → 700 for sans, and any
 * serif or mono weight to the single face of that family.
 */
export const FILM_FONT_FACES: readonly FilmFontFace[] = Object.freeze([
  face('sans', 400, 'NotoSansCJKsc-Regular.subset.woff2'),
  face('sans', 500, 'NotoSansCJKsc-Medium.subset.woff2'),
  face('sans', 700, 'NotoSansCJKsc-Bold.subset.woff2'),
  face('serif', 600, 'NotoSerifCJKsc-SemiBold.subset.woff2'),
  face('mono', 400, 'NotoSansMonoCJKsc-Regular.subset.woff2'),
]);

/** CSS font shorthand that makes a `FontFaceSet` load one face. */
export const filmFontQuery = (f: FilmFontFace): string => `${f.weight} 16px "${f.name}"`;
