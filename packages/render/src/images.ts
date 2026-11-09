import type { ImageAsset } from '@relgraph/core';
import { decodeImageBytes } from '@relgraph/core';
export type ImageFactory = (asset: ImageAsset) => unknown;
export const browserImageFactory: ImageFactory = (asset) => {
  const canvas = document.createElement('canvas');
  canvas.width = asset.width;
  canvas.height = asset.height;
  const ctx = canvas.getContext('2d');
  if (!ctx) throw new Error('Image canvas unavailable');
  const pixels = ctx.createImageData(asset.width, asset.height);
  pixels.data.set(decodeImageBytes(asset));
  ctx.putImageData(pixels, 0, 0);
  return canvas;
};
/** Pixel-aligned bitmap creation happens once, outside frame evaluation. */
export function materializeImages(
  assets: Record<string, ImageAsset> | undefined,
  factory: ImageFactory,
): ReadonlyMap<string, unknown> {
  return new Map(Object.entries(assets ?? {}).map(([id, asset]) => [id, factory(asset)]));
}
