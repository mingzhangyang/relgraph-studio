import { test } from 'vitest';
import assert from 'node:assert/strict';
import literature from '../examples/honglou-provisional.relgraph.json' with { type: 'json' };
import biology from '../examples/biology-signaling-synthetic.json' with { type: 'json' };
import verified from '../datasets/honglou-chengjia-opening/graph.relgraph.json' with { type: 'json' };
import {
  encodeImageBytes,
  decodeImageBytes,
  validImageAsset,
} from '../packages/core/src/image-assets.ts';
import { loadDocument } from '../packages/core/src/director/load.ts';
import { createProject, nodeAppearance } from '../packages/core/src/project.ts';
import { layoutGraph } from '../packages/core/src/director/layout.ts';
import { directorFrameAt } from '../packages/core/src/director/state.ts';
import { domainStyle } from '../packages/core/src/style.ts';
import { composeFrame } from '../packages/render/src/compose.ts';
import { composeNodeImage } from '../packages/render/src/image-layout.ts';
import { walkDisplayItems } from '../packages/render/src/display-list.ts';
import { FRAME_SPECS, cameraFitFor } from '../packages/render/src/frame-spec.ts';
import { VIDEO_THEMES } from '../packages/render/src/theme.ts';
import { createHeadlessRenderer } from '../packages/render/src/backends/skia.ts';
import {
  ProjectHistory,
  setNodeImage,
  inheritNodeImage,
  copyConfig,
} from '../apps/studio/src/project-editor-model.ts';
import { normalizeNodeImage, readEncodedImageDimensions } from '../apps/studio/src/node-image.ts';
import { measure } from './helpers/display-list.mjs';
import { checkEncodedImageDimensions } from '../apps/studio/src/image-dimensions.ts';
import {
  encodedSizeFixtures,
  pngHeader,
  jpegHeader,
  webpContainer,
  webpChunk,
  webpFrame,
  webpExtended,
} from './helpers/encoded-image-fixtures.mjs';
const asset = {
  format: 'rgba8',
  width: 2,
  height: 1,
  data: encodeImageBytes(new Uint8Array([255, 0, 0, 255, 0, 0, 255, 255])),
};
const at = (graph, frame, spec = FRAME_SPECS['landscape-720p']) => {
  const positions = layoutGraph(graph);
  return composeFrame(directorFrameAt(graph, positions, frame, 24, { fit: cameraFitFor(spec) }), {
    graph,
    positions,
    frame,
    fps: 24,
    measure,
    frameSpec: spec,
    theme: VIDEO_THEMES.light,
    style: domainStyle(graph.domain),
  });
};
test('encoded PNG, JPEG and all WebP dimension headers enforce the budget before decoding', () => {
  for (const [, bytes] of encodedSizeFixtures(4096, 4096))
    assert.doesNotThrow(() => checkEncodedImageDimensions(bytes));
  for (const [, bytes] of encodedSizeFixtures(4097, 4096))
    assert.throws(() => checkEncodedImageDimensions(bytes), /尺寸过大/);
  const frame = Buffer.alloc(16);
  frame.writeUIntLE(4096, 6, 3);
  frame.writeUIntLE(4095, 9, 3);
  for (const bytes of [
    webpContainer(webpExtended(1, 1), webpFrame(4097, 4096)),
    webpContainer(webpExtended(1, 1), webpChunk('ANMF', Buffer.concat([frame, webpFrame(1, 1)]))),
  ])
    assert.throws(() => checkEncodedImageDimensions(bytes), /尺寸过大/);
  for (const bytes of [
    pngHeader(0, 16),
    pngHeader(16, 16).subarray(0, 24),
    jpegHeader(16, 16).subarray(0, 15),
    Buffer.from([255, 216, 255, 224, 0, 1]),
    webpContainer(webpExtended(16, 16)),
    webpContainer(webpFrame(16, 16)).subarray(0, 24),
    webpContainer(webpChunk('VP8L', Buffer.from([0x2f, 0, 0, 0, 0x20]))),
    webpContainer(webpChunk('ANMF', Buffer.alloc(16))),
  ])
    assert.throws(() => checkEncodedImageDimensions(bytes), /尺寸信息/);
});
test('upload preflight never invokes the decoder for oversized headers and retains the decoded guard', async () => {
  const original = Object.getOwnPropertyDescriptor(globalThis, 'createImageBitmap');
  let calls = 0,
    closed = 0;
  Object.defineProperty(globalThis, 'createImageBitmap', {
    configurable: true,
    value: async () => {
      calls++;
      return { width: 4097, height: 4096, close: () => closed++ };
    },
  });
  try {
    for (const [name, bytes] of encodedSizeFixtures(4097, 4096))
      await assert.rejects(normalizeNodeImage(new File([bytes], name)), /尺寸过大/);
    assert.equal(calls, 0);
    await assert.rejects(
      normalizeNodeImage(new File([pngHeader(16, 16)], 'small.png')),
      /尺寸过大/,
    );
    assert.equal(calls, 1);
    assert.equal(closed, 1);
  } finally {
    if (original) Object.defineProperty(globalThis, 'createImageBitmap', original);
    else delete globalThis.createImageBitmap;
  }
});
test('image outlines stroke once after the bitmap under reveal and dimming opacity', () => {
  const groups = (items) =>
    items.flatMap((i) => (i.type === 'group' ? [i, ...groups(i.items)] : []));
  let reveal = false,
    dimmed = false;
  for (const [source, frames] of [
    [literature, [84, 300]],
    [verified, [29, 48]],
  ]) {
    const graph = loadDocument(source).graph;
    graph.project = { assets: { a: asset }, nodes: { defaults: { image: 'a' } } };
    for (const frame of frames)
      for (const group of groups(at(graph, frame).items)) {
        if (!group.items.some((i) => i.type === 'image')) continue;
        const imageIndex = group.items.findIndex((i) => i.type === 'image'),
          strokes = group.items.filter((i) => i.type === 'path' && i.stroke !== undefined);
        assert.equal(strokes.length, 1);
        assert.ok(group.items.indexOf(strokes[0]) > imageIndex);
        if (group.transform) reveal = true;
        if (!group.transform && group.alpha < 1) dimmed = true;
      }
  }
  assert.ok(reveal);
  assert.ok(dimmed);
});

test('PNG, JPEG and all WebP header forms enforce the pixel budget before decode', async () => {
  const png = (w, h) => {
    const bytes = new Uint8Array(33);
    bytes.set([137, 80, 78, 71, 13, 10, 26, 10, 0, 0, 0, 13, 73, 72, 68, 82]);
    const view = new DataView(bytes.buffer);
    view.setUint32(16, w);
    view.setUint32(20, h);
    return bytes;
  };
  const jpeg = (w, h) =>
    Uint8Array.from([
      0xff,
      0xd8,
      0xff,
      0xe1,
      0,
      7,
      0xff,
      0xc0,
      0xff,
      0xd9,
      0,
      0xff,
      0xc2,
      0,
      8,
      8,
      h >> 8,
      h & 255,
      w >> 8,
      w & 255,
      0,
      0xff,
      0xd9,
    ]);
  const webp = (fourcc, w, h) => {
    if (fourcc === 'VP8X') return webpContainer(webpExtended(w, h), webpFrame(1, 1));
    const size = fourcc === 'VP8L' ? 5 : 10;
    const bytes = new Uint8Array(20 + size + (size & 1));
    bytes.set([82, 73, 70, 70]);
    bytes.set([87, 69, 66, 80], 8);
    bytes.set(
      [...fourcc].map((c) => c.charCodeAt(0)),
      12,
    );
    const view = new DataView(bytes.buffer);
    view.setUint32(4, bytes.length - 8, true);
    view.setUint32(16, size, true);
    if (fourcc === 'VP8X') {
      const x = w - 1,
        y = h - 1;
      bytes.set([x & 255, (x >> 8) & 255, (x >> 16) & 255], 24);
      bytes.set([y & 255, (y >> 8) & 255, (y >> 16) & 255], 27);
    } else if (fourcc === 'VP8L') {
      const x = w - 1,
        y = h - 1;
      bytes.set(
        [0x2f, x & 255, ((x >> 8) & 63) | ((y & 3) << 6), (y >> 2) & 255, (y >> 10) & 15],
        20,
      );
    } else {
      bytes.set([0x10, 0, 0, 0x9d, 0x01, 0x2a], 20);
      view.setUint16(26, w, true);
      view.setUint16(28, h, true);
    }
    return bytes;
  };
  const formats = [png, jpeg, ...['VP8 ', 'VP8L', 'VP8X'].map((cc) => (w, h) => webp(cc, w, h))];
  for (const make of formats) {
    assert.deepEqual(readEncodedImageDimensions(make(2, 3)), { width: 2, height: 3 });
    const oversized = make(8192, 8192);
    assert.throws(() => readEncodedImageDimensions(oversized), /尺寸过大/);
    await assert.rejects(normalizeNodeImage(new Blob([oversized])), /尺寸过大/);
  }
  assert.throws(() => readEncodedImageDimensions(png(0, 50)), /尺寸信息无效/);
  assert.throws(() => readEncodedImageDimensions(png(100, 100).subarray(0, 16)), /尺寸信息无效/);
  assert.throws(
    () => readEncodedImageDimensions(webp('VP8X', 2, 3).subarray(0, 24)),
    /尺寸信息无效/,
  );
  // An APP/EXIF segment may contain SOF-like bytes: only real markers count.
  assert.deepEqual(readEncodedImageDimensions(jpeg(2, 3)), { width: 2, height: 3 });
});

test('restoring image inheritance edits only the selected node and prunes orphan pixels', () => {
  const graph = loadDocument(literature).graph;
  const node = graph.nodes[0];
  const other = graph.nodes.find((item) => item.id !== node.id);
  const original = {
    assets: { inherited: asset, custom: asset },
    nodes: {
      defaults: { image: 'inherited' },
      categories: { [node.kind]: { imageFit: 'contain' } },
      objects: { [node.id]: { image: 'custom' } },
    },
  };
  const history = new ProjectHistory();
  history.commit(original);
  const result = inheritNodeImage(history.value, node);
  history.commit(result);
  assert.equal(nodeAppearance(result, node).image, 'inherited');
  assert.equal(result.nodes.objects[node.id].image, undefined);
  assert.equal(result.nodes.defaults.image, 'inherited');
  assert.equal(result.nodes.categories[node.kind].imageFit, 'contain');
  assert.deepEqual(Object.keys(result.assets), ['inherited']);
  if (other) assert.equal(nodeAppearance(result, other).image, 'inherited');
  history.undo();
  assert.equal(nodeAppearance(history.value, node).image, 'custom');
  const hidden = setNodeImage(history.value, node, null);
  const restored = inheritNodeImage(hidden, node);
  assert.equal(nodeAppearance(restored, node).image, 'inherited');
});

test('image outlines receive one border stroke for circle, pill and diamond', () => {
  for (const shape of ['circle', 'pill', 'diamond']) {
    const graph = loadDocument(literature).graph;
    const node = graph.nodes[0];
    const config = setNodeImage({}, node, 'portrait', asset);
    config.nodes.objects[node.id].shape = shape;
    graph.project = config;
    const items = [...walkDisplayItems(at(graph, 100).items)];
    const image = items.find((item) => item.type === 'image' && item.assetId === 'portrait');
    assert.ok(image, shape + ': expected visible image');
    const border = items.filter(
      (item) => item.type === 'path' && JSON.stringify(item.d) === JSON.stringify(image.clip),
    );
    assert.equal(border.filter((item) => item.stroke).length, 1, shape + ': border painted once');
    assert.equal(border.filter((item) => item.fill).length, 1, shape + ': fill preserved');
    assert.ok(!border.some((item) => item.fill && item.stroke), shape + ': no double stroke');
  }
});

test('embedded RGBA codec handles every padding length and rejects malformed/bounded resources', () => {
  for (let size = 1; size < 20; size++) {
    const bytes = Uint8Array.from({ length: size * 4 }, (_, i) => (i * 31) % 256),
      image = { format: 'rgba8', width: size, height: 1, data: encodeImageBytes(bytes) };
    assert.ok(validImageAsset(image));
    assert.deepEqual(decodeImageBytes(image), bytes);
  }
  for (const image of [
    { ...asset, width: 257 },
    { ...asset, data: 'http://example.test/image.png' },
    { ...asset, data: asset.data + '=' },
    { ...asset, height: 0 },
    { ...asset, data: asset.data.replace('A', '!') },
    { ...asset, filename: 'hidden' },
  ])
    assert.equal(validImageAsset(image), false);
});
test('project validation diagnoses missing/invalid image references, fields and budgets', () => {
  const id = loadDocument(literature).graph.nodes[0].id;
  for (const config of [
    { assets: { a: { ...asset, width: 300 } } },
    { assets: { a: asset }, nodes: { objects: { [id]: { image: 'missing' } } } },
    { assets: { a: asset }, nodes: { defaults: { image: 'a', imageFit: 'stretch' } } },
    { assets: { a: { ...asset, data: '<svg/>' } } },
    { assets: Object.fromEntries(Array.from({ length: 33 }, (_, i) => ['a' + i, asset])) },
  ])
    assert.equal(loadDocument(createProject(literature, config)).valid, false);
  assert.equal(
    loadDocument(
      createProject(literature, { assets: { a: asset }, nodes: { defaults: { image: 'a' } } }),
    ).valid,
    true,
  );
});
test('image assignment/removal shares the cascade and owns history without rewriting source facts', () => {
  const { graph } = loadDocument(literature),
    node = graph.nodes[0],
    before = JSON.stringify(literature),
    history = new ProjectHistory();
  const first = setNodeImage({}, node, 'a', asset);
  history.commit(first);
  assert.equal(nodeAppearance(first, node).size, 32);
  first.assets.a.width = 1;
  assert.equal(history.value.assets.a.width, 2);
  const second = setNodeImage(history.value, node, null);
  history.commit(second);
  assert.deepEqual(second.assets, {});
  assert.equal(nodeAppearance(second, node).image, null);
  history.undo();
  assert.equal(nodeAppearance(history.value, node).image, 'a');
  history.redo();
  assert.equal(nodeAppearance(history.value, node).image, null);
  const inherited = {
    assets: { a: asset },
    nodes: { defaults: { image: 'a' }, objects: { [node.id]: { image: null } } },
  };
  assert.equal(nodeAppearance(inherited, node).image, null);
  delete inherited.nodes.objects[node.id].image;
  assert.equal(nodeAppearance(inherited, node).image, 'a');
  const copy = copyConfig(inherited);
  copy.assets.a.width = 1;
  assert.equal(inherited.assets.a.width, 2);
  assert.equal(JSON.stringify(literature), before);
});
test('cover/contain geometry uses one crop contract and scales only destination pixels', () => {
  const box = { x: 10, y: 20, w: 40, h: 40 },
    clip = [['R', 10, 20, 40, 40]];
  const cover = composeNodeImage('a', asset, box, clip, 'cover');
  assert.deepEqual(cover.source, { x: 0.5, y: 0, w: 1, h: 1 });
  const contain = composeNodeImage('a', asset, box, clip, 'contain');
  assert.deepEqual(
    { x: contain.x, y: contain.y, w: contain.w, h: contain.h },
    { x: 10, y: 30, w: 40, h: 20 },
  );
  const large = composeNodeImage('a', asset, { x: 15, y: 30, w: 60, h: 60 }, clip, 'cover');
  assert.deepEqual(cover.source, large.source);
  assert.equal(large.w, cover.w * 1.5);
});
test('hidden node images never enter the display list, selections or a11y before safe projection', () => {
  const base = loadDocument(verified).graph,
    node = base.nodes[0];
  base.project = setNodeImage({}, node, 'secret-picture', asset);
  const before = at(base, 0),
    after = at(base, 48);
  assert.ok(!JSON.stringify(before).includes('secret-picture'));
  assert.ok(!JSON.stringify(before.a11y).includes(asset.data));
  assert.ok(
    [...walkDisplayItems(after.items)].some(
      (i) => i.type === 'image' && i.assetId === 'secret-picture',
    ),
  );
  assert.ok(!JSON.stringify(at(base, 0)).includes('secret-picture'));
});
for (const [domain, source] of [
  ['literature', literature],
  ['biology', biology],
])
  for (const theme of ['light', 'dark'])
    for (const spec of Object.keys(FRAME_SPECS))
      test(`actual Skia image round trip and random access: ${domain}/${theme}/${spec}`, () => {
        const base = loadDocument(source).graph,
          node = base.nodes[0],
          config = setNodeImage({}, node, 'portrait', asset);
        if (theme === 'dark') config.nodes.objects[node.id].imageFit = 'contain';
        const doc = createProject(source, config),
          loaded = loadDocument(JSON.parse(JSON.stringify(doc)));
        assert.equal(loaded.valid, true);
        const renderer = createHeadlessRenderer(loaded.graph, layoutGraph(loaded.graph), {
          frameSpec: spec,
          theme,
        });
        const expected = renderer.rgbaAt(100);
        renderer.rgbaAt(0);
        assert.deepEqual(renderer.rgbaAt(100), expected);
        const original = createHeadlessRenderer(base, layoutGraph(base), {
          frameSpec: spec,
          theme,
        });
        assert.notDeepEqual(renderer.pngAt(100), original.pngAt(100));
        const fresh = createHeadlessRenderer(loadDocument(doc).graph, layoutGraph(loaded.graph), {
          frameSpec: spec,
          theme,
        });
        assert.deepEqual(fresh.rgbaAt(100), expected);
      });
