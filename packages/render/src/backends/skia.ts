/// <reference types="node" />
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { Canvas, FontLibrary } from 'skia-canvas';
import { decodeImageBytes, type VisualGraph } from '@relgraph/core';
import {
  createCanvasRenderer,
  type CanvasRenderer,
  type CanvasRendererOptions,
} from '../canvas.js';
import { FILM_FONT_FACES } from '../fonts.js';

/**
 * Headless backend (ADR 003, D1/D6): skia-canvas behind the same Canvas 2D
 * contract as the browser preview. Composition and drawing are shared with
 * `createCanvasRenderer`; this module only provides the canvas, registers the
 * vendored fonts and reads pixels back. Node only: import it from
 * `@relgraph/render/skia`.
 */

type Point = { x: number; y: number };

/** Directory of the vendored font files (`packages/render/fonts`). */
export const FILM_FONTS_DIR: string = fileURLToPath(new URL('../../fonts/', import.meta.url));

const require = createRequire(import.meta.url);
/** Installed skia-canvas version; golden frames are only enforced for the same one. */
export const SKIA_CANVAS_VERSION: string = (
  JSON.parse(
    readFileSync(join(dirname(require.resolve('skia-canvas')), '../package.json'), 'utf8'),
  ) as { version: string }
).version;

let registered = false;

/**
 * Register every vendored face under its film family name. Idempotent; throws
 * when a face is missing or skia-canvas reads a different weight than declared.
 */
export function registerFilmFonts(): void {
  if (registered) return;
  const byName = new Map<string, string[]>();
  for (const face of FILM_FONT_FACES)
    byName.set(face.name, [...(byName.get(face.name) ?? []), join(FILM_FONTS_DIR, face.file)]);
  for (const [name, paths] of byName) {
    const fonts = FontLibrary.use(name, paths);
    const weights = fonts.map((font) => font.weight).sort((a, b) => a - b);
    const expected = FILM_FONT_FACES.filter((face) => face.name === name)
      .map((face) => face.weight)
      .sort((a, b) => a - b);
    if (weights.join() !== expected.join())
      throw new Error(
        `${name}: registered weights ${weights.join()} but expected ${expected.join()}`,
      );
  }
  registered = true;
}

/**
 * Characters of `texts` that some vendored face has no glyph for. Reads
 * coverage.txt, which lists what every face really contains (charset.txt is
 * the request, and the sources lack a few requested punctuation marks).
 */
export function uncoveredCharacters(texts: Iterable<string>): string[] {
  const charset = new Set(readFileSync(join(FILM_FONTS_DIR, 'coverage.txt'), 'utf8'));
  const missing = new Set<string>();
  for (const text of texts)
    for (const ch of text) if (!charset.has(ch) && !/\s/u.test(ch)) missing.add(ch);
  return [...missing].sort();
}

export interface HeadlessRenderer extends CanvasRenderer {
  canvas: Canvas;
  /** Draw a frame and return its pixels as unpremultiplied RGBA rows. */
  rgbaAt(frame: number): Uint8Array;
  /** Draw a frame and return it as a PNG. */
  pngAt(frame: number): Buffer;
}

/**
 * Compose and draw frames without a browser. Like the preview renderer, every
 * frame is a pure function of (graph, layout, frame, options).
 */
export function createHeadlessRenderer(
  graph: VisualGraph,
  positions: ReadonlyMap<string, Point>,
  options: CanvasRendererOptions = {},
): HeadlessRenderer {
  registerFilmFonts();
  // The CPU rasterizer: a GPU backend would make pixels depend on the device.
  const canvas = new Canvas(1, 1, { gpu: false });
  const renderer = createCanvasRenderer(canvas, graph, positions, {
    ...options,
    imageFactory: (asset) => {
      const bitmap = new Canvas(asset.width, asset.height, { gpu: false }),
        context = bitmap.getContext('2d');
      const pixels = context.createImageData(asset.width, asset.height);
      pixels.data.set(decodeImageBytes(asset));
      context.putImageData(pixels, 0, 0);
      return bitmap;
    },
  });
  const { width, height } = renderer.frameSpec;
  const ctx = canvas.getContext('2d');
  return {
    ...renderer,
    canvas,
    rgbaAt(frame) {
      renderer.renderFrame(frame);
      const { data } = ctx.getImageData(0, 0, width, height);
      return new Uint8Array(data.buffer, data.byteOffset, data.byteLength);
    },
    pngAt(frame) {
      renderer.renderFrame(frame);
      return canvas.toBufferSync('png');
    },
  };
}
