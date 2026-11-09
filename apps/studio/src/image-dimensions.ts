/** Encoded-header preflight runs before any browser bitmap allocation. DOM-free. */
export const MAX_UPLOAD_PIXELS = 16 * 1024 * 1024;
export function checkEncodedImageDimensions(bytes: Uint8Array): void {
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const invalid = (): never => {
    throw new Error('图片尺寸信息不完整或格式无效，请更换 PNG、JPEG 或 WebP 文件。');
  };
  const dimensions = (width: number, height: number): void => {
    if (!(width > 0 && height > 0)) invalid();
    if (width > MAX_UPLOAD_PIXELS / height)
      throw new Error('图片尺寸过大，请先缩小到 1600 万像素以内。');
  };
  const tag = (offset: number): string =>
    String.fromCharCode(...bytes.subarray(offset, offset + 4));
  const u24 = (offset: number): number =>
    bytes[offset]! + bytes[offset + 1]! * 256 + bytes[offset + 2]! * 65536;
  if ([137, 80, 78, 71, 13, 10, 26, 10].every((v, i) => bytes[i] === v)) {
    if (bytes.length < 33 || tag(12) !== 'IHDR' || view.getUint32(8) !== 13) invalid();
    dimensions(view.getUint32(16), view.getUint32(20));
    return;
  }
  if (bytes[0] === 255 && bytes[1] === 216) {
    let offset = 2,
      found = false;
    while (offset < bytes.length) {
      if (bytes[offset++] !== 255) invalid();
      while (bytes[offset] === 255) offset++;
      const marker = bytes[offset++];
      if (marker === undefined || marker === 0) invalid();
      if (marker === 0xda || marker === 0xd9) break;
      if (marker === 0x01 || (marker! >= 0xd0 && marker! <= 0xd7)) continue;
      if (offset + 2 > bytes.length) invalid();
      const length = view.getUint16(offset);
      if (length < 2 || offset + length > bytes.length) invalid();
      if (marker! >= 0xc0 && marker! <= 0xcf && ![0xc4, 0xc8, 0xcc].includes(marker!)) {
        if (length < 8) invalid();
        dimensions(view.getUint16(offset + 5), view.getUint16(offset + 3));
        found = true;
      }
      offset += length;
    }
    if (!found) invalid();
    return;
  }
  if (bytes.length >= 12 && tag(0) === 'RIFF' && tag(8) === 'WEBP') {
    const end = view.getUint32(4, true) + 8;
    if (end > bytes.length || end < 12) invalid();
    let found = false;
    const chunks = (start: number, limit: number, inFrame: boolean): void => {
      for (let offset = start; offset < limit;) {
        if (offset + 8 > limit) invalid();
        const type = tag(offset),
          length = view.getUint32(offset + 4, true),
          p = offset + 8,
          next = p + length;
        if (next > limit) invalid();
        if (type === 'VP8X') {
          if (inFrame || length !== 10) invalid();
          dimensions(u24(p + 4) + 1, u24(p + 7) + 1);
        } else if (type === 'VP8 ') {
          if (
            length < 10 ||
            (bytes[p]! & 1) !== 0 ||
            bytes[p + 3] !== 0x9d ||
            bytes[p + 4] !== 0x01 ||
            bytes[p + 5] !== 0x2a
          )
            invalid();
          dimensions(view.getUint16(p + 6, true) & 0x3fff, view.getUint16(p + 8, true) & 0x3fff);
          found = true;
        } else if (type === 'VP8L') {
          if (length < 5 || bytes[p] !== 0x2f || bytes[p + 4]! >> 5 !== 0) invalid();
          const bits = view.getUint32(p + 1, true);
          dimensions((bits & 0x3fff) + 1, ((bits >>> 14) & 0x3fff) + 1);
          found = true;
        } else if (type === 'ANMF') {
          if (inFrame || length < 16) invalid();
          dimensions(u24(p + 6) + 1, u24(p + 9) + 1);
          chunks(p + 16, next, true);
        }
        offset = next + (length % 2);
        if (offset > limit) invalid();
      }
    };
    chunks(12, end, false);
    if (!found) invalid();
    return;
  }
  throw new Error('仅支持 PNG、JPEG、WebP 静态图片。');
}
