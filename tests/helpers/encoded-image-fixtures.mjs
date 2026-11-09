// Header-only fixtures, intentionally not decodable images. Dimensions must
// be rejected before a codec is invoked; real codec smoke cases live in Chromium.
export function pngHeader(width, height) {
  const bytes = Buffer.alloc(33);
  Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]).copy(bytes);
  bytes.writeUInt32BE(13, 8);
  bytes.write('IHDR', 12);
  bytes.writeUInt32BE(width, 16);
  bytes.writeUInt32BE(height, 20);
  bytes[24] = 8;
  bytes[25] = 6;
  return bytes;
}
export function jpegHeader(width, height, marker = 0xc0) {
  const frame = Buffer.alloc(11);
  frame.writeUInt16BE(11);
  frame[2] = 8;
  frame.writeUInt16BE(height, 3);
  frame.writeUInt16BE(width, 5);
  frame[7] = 1;
  frame[8] = 1;
  frame[9] = 0x11;
  return Buffer.concat([
    Buffer.from([255, 216, 255, 224, 0, 4, 0, 0, 255, marker]),
    frame,
    Buffer.from([255, 217]),
  ]);
}
export function webpChunk(type, data) {
  const head = Buffer.alloc(8);
  head.write(type);
  head.writeUInt32LE(data.length, 4);
  return Buffer.concat([head, data, Buffer.alloc(data.length % 2)]);
}
export function webpContainer(...chunks) {
  const head = Buffer.alloc(12),
    body = Buffer.concat(chunks);
  head.write('RIFF');
  head.writeUInt32LE(body.length + 4, 4);
  head.write('WEBP', 8);
  return Buffer.concat([head, body]);
}
export function webpFrame(width, height, lossless = false) {
  if (lossless) {
    const data = Buffer.alloc(5);
    data[0] = 0x2f;
    data.writeUInt32LE(width - 1 + (height - 1) * 16384, 1);
    return webpChunk('VP8L', data);
  }
  const data = Buffer.from([0, 0, 0, 0x9d, 1, 0x2a, 0, 0, 0, 0]);
  data.writeUInt16LE(width, 6);
  data.writeUInt16LE(height, 8);
  return webpChunk('VP8 ', data);
}
export function webpExtended(width, height) {
  const data = Buffer.alloc(10);
  data.writeUIntLE(width - 1, 4, 3);
  data.writeUIntLE(height - 1, 7, 3);
  return webpChunk('VP8X', data);
}
export function encodedSizeFixtures(width, height) {
  return [
    ['png', pngHeader(width, height)],
    ['jpeg', jpegHeader(width, height)],
    ['progressive.jpeg', jpegHeader(width, height, 0xc2)],
    ['lossy.webp', webpContainer(webpFrame(width, height))],
    ['lossless.webp', webpContainer(webpFrame(width, height, true))],
    ['extended.webp', webpContainer(webpExtended(width, height), webpFrame(1, 1))],
  ];
}
