import { encodeImageBytes, MAX_IMAGE_SIDE, type ImageAsset } from '@relgraph/core';
/** Decode once locally, flatten orientation, strip metadata, bound exported pixels. */
export async function normalizeNodeImage(file: File): Promise<{ id: string; asset: ImageAsset }> {
  if (!file.size || file.size > 8 * 1024 * 1024)
    throw new Error('请选择不超过 8 MB 的 PNG、JPEG 或 WebP 图片。');
  const head = new Uint8Array(await file.slice(0, 12).arrayBuffer());
  const png = [137, 80, 78, 71, 13, 10, 26, 10].every((v, i) => head[i] === v),
    jpeg = head[0] === 255 && head[1] === 216 && head[2] === 255;
  const webp =
    String.fromCharCode(...head.slice(0, 4)) === 'RIFF' &&
    String.fromCharCode(...head.slice(8, 12)) === 'WEBP';
  if (!png && !jpeg && !webp) throw new Error('仅支持 PNG、JPEG、WebP 静态图片。');
  let bitmap: ImageBitmap;
  try {
    bitmap = await createImageBitmap(file, { imageOrientation: 'from-image' });
  } catch {
    throw new Error('图片无法解码，请更换文件。');
  }
  try {
    if (bitmap.width * bitmap.height > 16 * 1024 * 1024)
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
