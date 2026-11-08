import { test } from 'vitest';
import assert from 'node:assert/strict';
import literature from '../examples/honglou-provisional.relgraph.json' with { type: 'json' };
import biology from '../examples/biology-signaling-synthetic.json' with { type: 'json' };
import { applyGraphPositions } from '../packages/core/src/director/position-writeback.ts';
import { loadDocument } from '../packages/core/src/director/load.ts';
import { layoutGraph } from '../packages/core/src/director/layout.ts';
import { DEFAULT_FRAME_SPEC } from '../packages/render/src/frame-spec.ts';
import {
  canvasPoint,
  graphPosition,
  hitVisibleNode,
  screenPosition,
} from '../apps/studio/src/position-tool.ts';
import { makeStudio } from './helpers/studio-harness.mjs';

test('pixel/world round trip works with camera scale and CSS canvas scaling', () => {
  const spec = DEFAULT_FRAME_SPEC;
  const camera = { x: 550, y: 380, scale: 0.73 };
  const graph = { x: 432, y: 671 };
  const canvas = screenPosition(graph, camera, spec);
  const recovered = graphPosition(canvas, camera, spec);
  assert.ok(Math.abs(recovered.x - graph.x) < 1e-9);
  assert.ok(Math.abs(recovered.y - graph.y) < 1e-9);
  const scaled = canvasPoint(
    { x: 15 + canvas.x / 2, y: 30 + canvas.y / 2 },
    { left: 15, top: 30, width: 640, height: 360 },
    { width: 1280, height: 720 },
  );
  assert.deepEqual(scaled, canvas);
  assert.equal(canvasPoint(graph, { left: 0, top: 0, width: 0, height: 720 }, spec), null);
});

test('hit-testing excludes hidden nodes even when their IDs match Object prototype keys', () => {
  const nodes = [{ id: 'constructor' }, { id: 'visible' }];
  const positions = new Map([
    ['constructor', { x: 0, y: 0 }],
    ['visible', { x: 0, y: 0 }],
  ]);
  const camera = { x: 0, y: 0, scale: 1 };
  const point = screenPosition({ x: 0, y: 0 }, camera, DEFAULT_FRAME_SPEC);
  assert.equal(
    hitVisibleNode(
      nodes, positions, { nodes: { visible: 1 }, edges: {} },
      camera, DEFAULT_FRAME_SPEC, point, 24,
    ),
    'visible',
  );
});

test('source writeback can export entire layout without changing the imported data', () => {
  for (const source of [literature, biology]) {
    const loaded = loadDocument(source);
    assert.equal(loaded.valid, true);
    const positions = layoutGraph(loaded.graph);
    const first = loaded.graph.nodes[0];
    positions.set(first.id, { x: 654.32, y: -321.12 });
    const written = applyGraphPositions(source, loaded.graph, positions);
    const checked = loadDocument(written.document);
    assert.equal(checked.valid, true);
    assert.deepEqual(first.position, loaded.graph.nodes[0].position);
    const adapted = checked.graph.nodes.find((node) => node.id === first.id);
    assert.deepEqual(adapted.position, { x: 654.32, y: -321.12 });
    const same = structuredClone(source);
    assert.deepEqual(same, source);
    const repeat = applyGraphPositions(written.document, checked.graph, positions);
    assert.equal(repeat.changed, 0);
  }
});

test('position mode pauses playback, drags only visible nodes, exports JSON and can reset', async () => {
  const app = makeStudio();
  await app.ready;
  assert.equal(app.node('layoutToggle').disabled, false);
  assert.equal(app.node('layoutReset').disabled, true);
  const state = app.window.studioFrame();
  const node = state.view.nodes.find((n) => state.reveal.nodes[n.id] > 0.5);
  assert.ok(node, 'at least one displayed node is editable');
  const original = literature.characters.find((n) => n.id === node.id).position;
  const camera = state.cameraResolved;
  const screen = screenPosition(original, camera, DEFAULT_FRAME_SPEC);
  await app.node('play').click();
  await app.node('layoutToggle').click();
  assert.equal(app.node('status').attributes['data-state'], 'ready');
  assert.equal(app.jobs.size, 0, 'switching to edit mode stops playback');
  assert.equal(app.node('layoutToggle').attributes['aria-pressed'], 'true');
  const stage = app.node('stage');
  await stage.dispatch('pointerdown', {
    pointerId: 4, isPrimary: true, button: 0, pointerType: 'mouse',
    clientX: screen.x, clientY: screen.y,
  });
  await stage.dispatch('pointermove', { pointerId: 4, clientX: screen.x + 50, clientY: screen.y + 26 });
  await stage.dispatch('pointerup', { pointerId: 4, clientX: screen.x + 50, clientY: screen.y + 26 });
  assert.equal(app.node('layoutReset').disabled, false);
  assert.match(app.node('layoutNote').textContent, /未保存/);

  await app.node('layoutExport').click();
  assert.equal(app.downloads.length, 1);
  const saved = JSON.parse(await app.blobs[0].text());
  const edited = saved.characters.find((n) => n.id === node.id).position;
  assert.notDeepEqual(edited, original);
  assert.equal(loadDocument(saved).valid, true);

  await app.node('layoutReset').click();
  assert.equal(app.node('layoutReset').disabled, true);
  await app.node('layoutExport').click();
  const reset = JSON.parse(await app.blobs[1].text());
  assert.deepEqual(reset.characters.find((n) => n.id === node.id).position, original);
  await app.node('layoutToggle').click();
  assert.equal(app.node('layoutToggle').attributes['aria-pressed'], 'false');
});

test('switching to a different document disables position tools while loading and after error', async () => {
  const app = makeStudio();
  await app.ready;
  await app.node('layoutToggle').click();
  app.node('fileInput').files = [{ name: 'invalid.json', text: async () => '{}' }];
  await app.node('fileInput').dispatch('change');
  assert.equal(app.node('layoutToggle').disabled, true);
  assert.equal(app.node('layoutExport').disabled, true);
  assert.equal(app.node('layoutToggle').attributes['aria-pressed'], 'false');
});
