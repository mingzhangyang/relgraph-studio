import type { ImageAsset } from '@relgraph/core';
import type { ImageItem, PathCommand } from './display-list.js';
/** Pure source crop and destination fit, shared by both raster backends. */
export function composeNodeImage(
  assetId: string,
  asset: ImageAsset,
  box: { x: number; y: number; w: number; h: number },
  clip: PathCommand[],
  fit: 'cover' | 'contain',
): ImageItem {
  const source = { x: 0, y: 0, w: asset.width, h: asset.height },
    destination = { ...box };
  const factor =
    fit === 'cover'
      ? Math.max(box.w / asset.width, box.h / asset.height)
      : Math.min(box.w / asset.width, box.h / asset.height);
  if (fit === 'cover') {
    source.w = box.w / factor;
    source.h = box.h / factor;
    source.x = (asset.width - source.w) / 2;
    source.y = (asset.height - source.h) / 2;
  } else {
    destination.w = asset.width * factor;
    destination.h = asset.height * factor;
    destination.x += (box.w - destination.w) / 2;
    destination.y += (box.h - destination.h) / 2;
  }
  return { type: 'image', assetId, source, ...destination, clip };
}
