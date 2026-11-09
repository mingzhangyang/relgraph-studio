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
  copyConfig,
} from '../apps/studio/src/project-editor-model.ts';
import { measure } from './helpers/display-list.mjs';
import { checkEncodedImageDimensions } from '../apps/studio/src/image-dimensions.ts';
import { normalizeNodeImage } from '../apps/studio/src/node-image.ts';
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
