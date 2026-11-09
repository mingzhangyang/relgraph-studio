import type { ImageAsset } from '@relgraph/core';
import type { ImageItem, PathCommand } from './display-list.js';
type ImageBox = { x: number; y: number; w: number; h: number };

/** Maximum scale that leaves every image corner inside the actual node clip. */
function containScale(asset: ImageAsset, box: ImageBox, clip: readonly PathCommand[]): number {
  const initial = Math.min(box.w / asset.width, box.h / asset.height);
  const first = clip[0];
  if (first?.[0] === 'A') {
    // Circle: its radius must enclose the destination rectangle's farthest corner.
    return Math.min(initial, (2 * first[3]) / Math.hypot(asset.width, asset.height));
  }
  if (
    first?.[0] === 'M' &&
    clip.length === 5 &&
    clip[1]?.[0] === 'L' &&
    clip[2]?.[0] === 'L' &&
    clip[3]?.[0] === 'L' &&
    clip[4]?.[0] === 'Z'
  ) {
    // Diamond: |x| / halfWidth + |y| / halfHeight <= 1 at every corner.
    return Math.min(initial, 2 / (asset.width / (box.w / 2) + asset.height / (box.h / 2)));
  }
  if (first?.[0] === 'RR') {
    // Rounded pill: a corner must lie inside the straight sides or corner arc.
    // Fixed-iteration bisection handles square, portrait and panoramic images.
    const radius = Math.max(0, Math.min(first[5], box.w / 2, box.h / 2));
    if (!radius) return initial;
    const straightX = box.w / 2 - radius;
    const straightY = box.h / 2 - radius;
    const fits = (scale: number): boolean =>
      Math.hypot(
        Math.max(0, (asset.width * scale) / 2 - straightX),
        Math.max(0, (asset.height * scale) / 2 - straightY),
      ) <= radius;
    if (fits(initial)) return initial;
    let low = 0;
    let high = initial;
    for (let i = 0; i < 32; i++) {
      const mid = (low + high) / 2;
      if (fits(mid)) low = mid;
      else high = mid;
    }
    return low;
  }
  // Rectangular or unknown clips keep the previous contain behavior.
  return initial;
}

/** Pure source crop and destination fit, shared by both raster backends. */
export function composeNodeImage(
  assetId: string,
  asset: ImageAsset,
  box: ImageBox,
  clip: PathCommand[],
  fit: 'cover' | 'contain',
): ImageItem {
  const source = { x: 0, y: 0, w: asset.width, h: asset.height },
    destination = { ...box };
  const factor =
    fit === 'cover'
      ? Math.max(box.w / asset.width, box.h / asset.height)
      : containScale(asset, box, clip);
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
