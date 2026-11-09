import { encodeImageBytes, MAX_IMAGE_SIDE, type ImageAsset } from '@relgraph/core';

const MAX_SOURCE_PIXELS = 16 * 1024 * 1024;
const invalidImage = (): Error => new Error('图片格式或尺寸信息无效，请更换文件。');
const matches = (bytes: Uint8Array, at: number, signature: readonly number[]): boolean =>
  signature.every((value, index) => bytes[at + index] === value);
const be32 = (bytes: Uint8Array, at: number): number =>
  bytes[at] * 0x1000000 + bytes[at + 1] * 0x10000 + bytes[at + 2] * 0x100 + bytes[at + 3];
const le32 = (bytes: Uint8Array, at: number): number =>
  bytes[at] + bytes[at + 1] * 0x100 + bytes[at + 2] * 0x10000 + bytes[at + 3] * 0x1000000;

/**
 * Read encoded dimensions before the browser decoder allocates full-resolution pixels.
 * The file is already limited to 8 MiB. Invalid/truncated headers fail closed.
 */
export function readEncodedImageDimensions(
  bytes: Uint8Array,
): { width: number; height: number } {
  let width = 0;
  let height = 0;
  if (matches(bytes, 0, [137, 80, 78, 71, 13, 10, 26, 10])) {
    // PNG: the first chunk must be the fixed-size IHDR.
    if (bytes.length < 24 || be32(bytes, 8) !== 13 || !matches(bytes, 12, [73, 72, 68, 82]))
      throw invalidImage();
    width = be32(bytes, 16);
    height = be32(bytes, 20);
  } else if (matches(bytes, 0, [255, 216, 255])) {
    // JPEG: skip variable-length APP/EXIF/quantization markers until a SOF.
    let at = 2;
    while (at < bytes.length) {
      if (bytes[at++] !== 255) throw invalidImage();
      while (bytes[at] === 255) at++;
      const marker = bytes[at++];
      if (marker === undefined || marker === 0xda || marker === 0xd9) break;
      if (marker === 0x01 || (marker >= 0xd0 && marker <= 0xd8)) continue;
      if (at + 2 > bytes.length) throw invalidImage();
      const length = (bytes[at] << 8) | bytes[at + 1];
      if (length < 2 || at + length > bytes.length) throw invalidImage();
      if (
        marker >= 0xc0 &&
        marker <= 0xcf &&
        marker !== 0xc4 &&
        marker !== 0xc8 &&
        marker !== 0xcc
      ) {
        if (length < 7) throw invalidImage();
        height = (bytes[at + 3] << 8) | bytes[at + 4];
        width = (bytes[at + 5] << 8) | bytes[at + 6];
        break;
      }
      at += length;
    }
  } else if (
    matches(bytes, 0, [82, 73, 70, 70]) &&
    matches(bytes, 8, [87, 69, 66, 80])
  ) {
    // WebP: VP8 (lossy), VP8L (lossless) and VP8X (extended/animated).
    if (bytes.length < 20 || le32(bytes, 4) + 8 > bytes.length) throw invalidImage();
    const chunkSize = le32(bytes, 16);
    if (20 + chunkSize > bytes.length) throw invalidImage();
    if (matches(bytes, 12, [86, 80, 56, 88])) {
      if (chunkSize < 10) throw invalidImage();
      width = 1 + bytes[24] + (bytes[25] << 8) + (bytes[26] << 16);
      height = 1 + bytes[27] + (bytes[28] << 8) + (bytes[29] << 16);
    } else if (matches(bytes, 12, [86, 80, 56, 76])) {
      if (chunkSize < 5 || bytes[20] !== 0x2f) throw invalidImage();
      width = 1 + bytes[21] + ((bytes[22] & 0x3f) << 8);
      height = 1 + ((bytes[22] >> 6) | (bytes[23] << 2) | ((bytes[24] & 15) << 10));
    } else if (matches(bytes, 12, [86, 80, 56, 32])) {
      if (
        chunkSize < 10 ||
        (bytes[20] & 1) !== 0 ||
        !matches(bytes, 23, [0x9d, 0x01, 0x2a])
      )
        throw invalidImage();
      width = (bytes[26] | (bytes[27] << 8)) & 0x3fff;
      height = (bytes[28] | (bytes[29] << 8)) & 0x3fff;
    } else throw invalidImage();
  } else {
    throw new Error('仅支持 PNG、JPEG、WebP 静态图片。');
  }
  if (!width || !height) throw invalidImage();
  if (width * height > MAX_SOURCE_PIXELS)
    throw new Error('图片尺寸过大，请先缩小到 1600 万像素以内。');
  return { width, height };
}
/** Decode once locally, flatten orientation, strip metadata, bound exported pixels. */
export async function normalizeNodeImage(file: File): Promise<{ id: string; asset: ImageAsset }> {
  if (!file.size || file.size > 8 * 1024 * 1024)
    throw new Error('请选择不超过 8 MB 的 PNG、JPEG 或 WebP 图片。');
  readEncodedImageDimensions(new Uint8Array(await file.arrayBuffer()));
  let bitmap: ImageBitmap;
  try {
    bitmap = await createImageBitmap(file, { imageOrientation: 'from-image' });
  } catch {
    throw new Error('图片无法解码，请更换文件。');
  }
  try {
    if (!bitmap.width || !bitmap.height || bitmap.width * bitmap.height > MAX_SOURCE_PIXELS)
      throw new Error('图片尺寸过大，请先缩小到 1600 万像素以内。');
    const ratio = Math.min(1, MAX_IMAGE_SIDE / Math.max(bitmap.width, bitmap.height));
    const width = Math.max(1, Math.round(bitmap.width * ratio)),
      height = Math.max(1, Math.round(bitmap.height * ratio));
    const canvas = document.createElement('canvas');
    canvas.width = width;
    canvas.height = height;
    const ctx = canvas.getContext('2d');
    if (!ctx) throw new Error('无法准备图片画布。');
    ctx.drawImage(bitmap, 0, 0, width, height);
    const bytes = ctx.getImageData(0, 0, width, height).data;
    const digest = await crypto.subtle.digest(
      'SHA-256',
      new TextEncoder().encode(`${width}/${height}/` + encodeImageBytes(bytes)),
    );
    const id =
      'img-' + Array.from(new Uint8Array(digest), (b) => b.toString(16).padStart(2, '0')).join('');
    return { id, asset: { format: 'rgba8', width, height, data: encodeImageBytes(bytes) } };
  } finally {
    bitmap.close();
  }
}
