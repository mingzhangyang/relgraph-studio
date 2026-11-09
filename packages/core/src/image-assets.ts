/** Small, self-contained raster assets. No URLs, filenames or source metadata. */
export interface ImageAsset {
  format: 'rgba8';
  width: number;
  height: number;
  data: string;
}
export const MAX_IMAGE_SIDE = 256;
export const MAX_IMAGE_BYTES = 4 * 1024 * 1024;
const alphabet = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/';
export function encodeImageBytes(bytes: Uint8Array | Uint8ClampedArray): string {
  let output = '';
  for (let i = 0; i < bytes.length; i += 3) {
    const a = bytes[i],
      b = bytes[i + 1] ?? 0,
      c = bytes[i + 2] ?? 0;
    output +=
      alphabet[a >> 2] +
      alphabet[((a & 3) << 4) | (b >> 4)] +
      (i + 1 < bytes.length ? alphabet[((b & 15) << 2) | (c >> 6)] : '=') +
      (i + 2 < bytes.length ? alphabet[c & 63] : '=');
  }
  return output;
}
export function validImageAsset(value: unknown): value is ImageAsset {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return false;
  const v = value as Record<string, unknown>;
  if (
    Object.keys(v).some((k) => !['format', 'width', 'height', 'data'].includes(k)) ||
    v.format !== 'rgba8'
  )
    return false;
  if (
    typeof v.width !== 'number' ||
    typeof v.height !== 'number' ||
    !Number.isInteger(v.width) ||
    !Number.isInteger(v.height) ||
    v.width < 1 ||
    v.height < 1 ||
    v.width > MAX_IMAGE_SIDE ||
    v.height > MAX_IMAGE_SIDE ||
    typeof v.data !== 'string'
  )
    return false;
  const bytes = v.width * v.height * 4,
    padding = (3 - (bytes % 3)) % 3;
  return (
    v.data.length === Math.ceil(bytes / 3) * 4 &&
    /^[A-Za-z0-9+/]*={0,2}$/.test(v.data) &&
    v.data.endsWith('='.repeat(padding)) &&
    (v.data.match(/=/g)?.length ?? 0) === padding
  );
}
export function decodeImageBytes(asset: ImageAsset): Uint8Array {
  if (!validImageAsset(asset)) throw new TypeError('Invalid embedded image asset');
  const bytes = new Uint8Array(asset.width * asset.height * 4);
  let at = 0;
  for (let i = 0; i < asset.data.length; i += 4) {
    const a = alphabet.indexOf(asset.data[i]),
      b = alphabet.indexOf(asset.data[i + 1]),
      c = alphabet.indexOf(asset.data[i + 2]),
      d = alphabet.indexOf(asset.data[i + 3]);
    bytes[at++] = (a << 2) | (b >> 4);
    if (at < bytes.length) bytes[at++] = ((b & 15) << 4) | (c >> 2);
    if (at < bytes.length) bytes[at++] = ((c & 3) << 6) | d;
  }
  return bytes;
}
