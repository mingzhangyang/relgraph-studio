import { test } from 'vitest';
import assert from 'node:assert/strict';
import literature from '../examples/honglou-provisional.relgraph.json' with { type: 'json' };
import biology from '../examples/biology-signaling-synthetic.json' with { type: 'json' };
import { applyGraphPositions } from '../packages/core/src/director/position-writeback.ts';
import { loadDocument } from '../packages/core/src/director/load.ts';
import { layoutGraph } from '../packages/core/src/director/layout.ts';
import { DEFAULT_FRAME_SPEC } from '../packages/render/src/frame-spec.ts';
import { domainStyle } from '../packages/core/src/style.ts';
import {
  nodeGlyphBounds,
  nodeGlyphIntersectsStage,
  rectsIntersect,
} from '../packages/render/src/node-geometry.ts';
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
    // Snapshot before writeback, so any mutation of the imported document
    // is caught rather than comparing an object to its own late clone.
    const sourceBeforeWriteback = structuredClone(source);
    const loaded = loadDocument(source);
    assert.equal(loaded.valid, true);
    const positions = layoutGraph(loaded.graph);
    const first = loaded.graph.nodes[0];
    const originalAdaptedPosition = structuredClone(first.position);
    positions.set(first.id, { x: 654.32, y: -321.12 });
    const written = applyGraphPositions(source, loaded.graph, positions);
    const checked = loadDocument(written.document);
    assert.equal(checked.valid, true);
    assert.deepEqual(first.position, originalAdaptedPosition, 'writeback must not mutate adapted graph');
    const adapted = checked.graph.nodes.find((node) => node.id === first.id);
    assert.deepEqual(adapted.position, { x: 654.32, y: -321.12 });
    assert.deepEqual(source, sourceBeforeWriteback, 'writeback must not mutate source');
    const repeat = applyGraphPositions(written.document, checked.graph, positions);
    assert.equal(repeat.changed, 0);
  }
});

test('position mode pauses playback, drags only visible nodes, exports JSON and can reset', async () => {
  const app = makeStudio();
  await app.ready;
  assert.equal(app.node('layoutToggle').disabled, false);
  assert.equal(app.node('layoutReset').disabled, true);
  assert.equal(app.window.renderAt(36), true);
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


test('an off-centre stationary tap does not change a node, and dragging preserves grab offset', async () => {
  const app = makeStudio();
  await app.ready;
  assert.equal(app.window.renderAt(48), true);
  const state = app.window.studioFrame();
  const node = state.view.nodes.find((n) => state.reveal.nodes[n.id] > 0.5);
  assert.ok(node);
  const before = literature.characters.find((n) => n.id === node.id).position;
  const screen = screenPosition(before, state.cameraResolved, DEFAULT_FRAME_SPEC);
  await app.node('layoutToggle').click();
  const canvas = app.node('stage');
  const at = { clientX: screen.x + 5, clientY: screen.y - 4 };
  const pointer = { pointerId: 12, isPrimary: true, pointerType: 'mouse', button: 0 };
  await canvas.dispatch('pointerdown', { ...pointer, ...at });
  await canvas.dispatch('pointerup', { ...pointer, ...at });
  assert.equal(app.node('layoutReset').disabled, true, 'a click is not a drag');
  await app.node('layoutExport').click();
  const unchanged = JSON.parse(await app.blobs[0].text());
  assert.deepEqual(unchanged.characters.find((n) => n.id === node.id).position, before);

  await canvas.dispatch('pointerdown', { ...pointer, ...at });
  const moved = { clientX: at.clientX + 35, clientY: at.clientY - 21 };
  await canvas.dispatch('pointermove', { ...pointer, ...moved });
  await canvas.dispatch('pointerup', { ...pointer, ...moved });
  await app.node('layoutExport').click();
  const updated = JSON.parse(await app.blobs[1].text());
  const after = updated.characters.find((n) => n.id === node.id).position;
  assert.ok(Math.abs(after.x - (before.x + 35 / state.cameraResolved.scale)) <= 0.011);
  assert.ok(Math.abs(after.y - (before.y - 21 / state.cameraResolved.scale)) <= 0.011);
  assert.equal(app.node('layoutReset').disabled, false);
});

test('pointercancel rolls back only the interrupted drag and preserves earlier edits', async () => {
  const app = makeStudio();
  await app.ready;
  assert.equal(app.window.renderAt(48), true);
  const frame = app.window.studioFrame();
  const node = frame.view.nodes.find((n) => frame.reveal.nodes[n.id] > 0.5);
  assert.ok(node);
  const original = literature.characters.find((n) => n.id === node.id)?.position;
  assert.ok(original);
  const stage = app.node('stage');
  const pointer = (pointerId, x, y) => ({
    pointerId,
    isPrimary: true,
    pointerType: 'mouse',
    button: 0,
    clientX: x,
    clientY: y,
  });

  await app.node('layoutToggle').click();
  const firstStart = screenPosition(original, frame.cameraResolved, DEFAULT_FRAME_SPEC);
  await stage.dispatch('pointerdown', pointer(41, firstStart.x, firstStart.y));
  assert.equal(stage.hasPointerCapture(41), true);
  assert.equal(app.node('layoutNode').value, node.id, 'first drag selects the intended node');
  await stage.dispatch('pointermove', pointer(41, firstStart.x + 32, firstStart.y - 20));
  await stage.dispatch('pointerup', pointer(41, firstStart.x + 32, firstStart.y - 20));
  assert.equal(stage.hasPointerCapture(41), false);
  assert.equal(app.node('layoutReset').disabled, false, 'committed drag is dirty');

  await app.node('layoutExport').click();
  const firstExport = JSON.parse(await app.blobs.at(-1).text());
  const committed = firstExport.characters.find((n) => n.id === node.id).position;
  assert.notDeepEqual(committed, original, 'first drag must change the position');

  const secondStart = screenPosition(committed, frame.cameraResolved, DEFAULT_FRAME_SPEC);
  await stage.dispatch('pointerdown', pointer(42, secondStart.x, secondStart.y));
  assert.equal(stage.hasPointerCapture(42), true);
  assert.equal(app.node('layoutNode').value, node.id, 'second drag uses the same node');
  await stage.dispatch('pointermove', pointer(42, secondStart.x + 40, secondStart.y + 19));
  assert.notEqual(Number(app.node('layoutX').value), committed.x, 'second drag takes effect');

  await stage.dispatch('pointercancel', { pointerId: 999 });
  assert.equal(stage.hasPointerCapture(42), true, 'unrelated pointer cannot cancel this drag');
  await stage.dispatch('pointercancel', { pointerId: 42 });
  assert.equal(stage.hasPointerCapture(42), false, 'cancellation releases pointer capture');
  await stage.dispatch('pointermove', pointer(42, secondStart.x + 100, secondStart.y));
  assert.equal(
    Number(app.node('layoutX').value),
    committed.x,
    'a cancelled drag cannot continue changing the position',
  );
  assert.deepEqual(
    { x: Number(app.node('layoutX').value), y: Number(app.node('layoutY').value) },
    committed,
    'cancellation restores the position before this drag',
  );
  assert.equal(app.node('layoutReset').disabled, false, 'the earlier adjustment stays dirty');
  assert.match(app.node('layoutNote').textContent, /未保存/);

  await app.node('layoutExport').click();
  const restored = JSON.parse(await app.blobs.at(-1).text());
  assert.deepEqual(
    restored.characters.find((n) => n.id === node.id).position,
    committed,
    'export retains the earlier edit, not the cancelled motion or original position',
  );

  await app.node('layoutReset').click();
  assert.equal(app.node('layoutReset').disabled, true);
  const cleanStart = screenPosition(original, frame.cameraResolved, DEFAULT_FRAME_SPEC);
  await stage.dispatch('pointerdown', pointer(43, cleanStart.x, cleanStart.y));
  assert.equal(app.node('layoutNode').value, node.id);
  await stage.dispatch('pointermove', pointer(43, cleanStart.x + 25, cleanStart.y + 12));
  assert.equal(app.node('layoutReset').disabled, false);
  await stage.dispatch('pointercancel', { pointerId: 43 });
  assert.equal(stage.hasPointerCapture(43), false);
  assert.equal(app.node('layoutReset').disabled, true, 'cancelled first drag stays clean');
});

test('Escape works while controls have focus; arrows and renderAt release frozen camera', async () => {
  const app = makeStudio();
  await app.ready;
  assert.equal(app.window.renderAt(48), true);
  await app.node('layoutToggle').click();
  const key = (code, target = null) =>
    app.window.dispatch('keydown', {
      code,
      target,
      preventDefault() {},
    });
  const focusedToggle = app.node('layoutToggle');
  focusedToggle.focusSelector = 'button';
  key('Escape', focusedToggle);
  assert.equal(focusedToggle.attributes['aria-pressed'], 'false');
  await app.node('layoutToggle').click();
  key('ArrowRight');
  assert.equal(app.node('layoutToggle').attributes['aria-pressed'], 'false');
  assert.equal(Number(app.node('scrubber').value), 72);
  await app.node('layoutToggle').click();
  key('ArrowLeft');
  assert.equal(app.node('layoutToggle').attributes['aria-pressed'], 'false');
  assert.equal(Number(app.node('scrubber').value), 48);
  await app.node('layoutToggle').click();
  assert.equal(app.window.renderAt(250), true);
  assert.equal(app.node('layoutToggle').attributes['aria-pressed'], 'false');
  assert.equal(Number(app.node('scrubber').value), 250);
});

test('manual and OS theme changes leave edit mode without retaining a fixed camera', async () => {
  const app = makeStudio();
  await app.ready;
  assert.equal(app.window.renderAt(48), true);
  await app.node('layoutToggle').click();
  await app.node('themeToggle').click();
  assert.equal(app.node('layoutToggle').attributes['aria-pressed'], 'false');
  await app.node('layoutToggle').click();
  // A manual choice pins the theme; use a second app to test OS-driven changes.
  await app.node('layoutToggle').click();
  const followOS = makeStudio();
  await followOS.ready;
  await followOS.node('layoutToggle').click();
  followOS.setOSTheme(true);
  assert.equal(followOS.node('layoutToggle').attributes['aria-pressed'], 'false');
  assert.equal(followOS.themes.at(-1), 'light');
});

test('keyboard selector excludes hidden nodes and X/Y inputs change only visible nodes', async () => {
  const app = makeStudio();
  await app.ready;
  assert.equal(app.window.renderAt(48), true);
  const state = app.window.studioFrame();
  const visibleIds = state.view.nodes
    .filter((n) => Object.hasOwn(state.reveal.nodes, n.id) && state.reveal.nodes[n.id] > 0.5)
    .map((n) => n.id);
  await app.node('layoutToggle').click();
  const select = app.node('layoutNode');
  assert.equal(app.node('layoutEditor').hidden, false);
  assert.deepEqual(select.children.map((o) => o.value), visibleIds);
  assert.ok(select.children.length > 0);
  const nodeId = select.children.at(-1).value;
  select.value = nodeId;
  await select.dispatch('change');
  const before = literature.characters.find((n) => n.id === nodeId).position;
  assert.equal(Number(app.node('layoutX').value), before.x);
  assert.equal(Number(app.node('layoutY').value), before.y);
  app.node('layoutX').value = 'Infinity';
  await app.node('layoutApply').click();
  assert.match(app.node('layoutNote').textContent, /有限数字/);
  assert.equal(app.node('layoutReset').disabled, true);

  app.node('layoutX').value = String(before.x + 42.25);
  app.node('layoutY').value = String(before.y - 13.5);
  await app.node('layoutApply').click();
  assert.equal(app.node('layoutReset').disabled, false);
  await app.node('layoutExport').click();
  const doc = JSON.parse(await app.blobs[0].text());
  assert.equal(loadDocument(doc).valid, true);
  const changed = doc.characters.find((n) => n.id === nodeId).position;
  assert.deepEqual(changed, { x: before.x + 42.25, y: before.y - 13.5 });
  await app.node('layoutToggle').click();
  assert.equal(app.node('layoutEditor').hidden, true);
  assert.equal(select.children.length, 0, 'hidden/future labels are not kept in DOM');
});


test('hit-testing uses the renderer camera projection for enormous finite distances', () => {
  const camera = { x: 1e308, y: 0, scale: 2.75e-306 };
  const extreme = { x: -1e308, y: 0 };
  const point = screenPosition(extreme, camera, DEFAULT_FRAME_SPEC);
  assert.equal(point.x, 90);
  assert.equal(
    hitVisibleNode(
      [{ id: 'a' }],
      new Map([['a', extreme]]),
      { nodes: { a: 1 }, edges: {} },
      camera, DEFAULT_FRAME_SPEC, point, 24,
    ),
    'a',
  );
});

test('scrubber captures target before edit-mode camera cleanup redraws the old frame', async () => {
  const app = makeStudio();
  await app.ready;
  assert.equal(app.window.renderAt(48), true);
  await app.node('layoutToggle').click();
  app.node('scrubber').value = '250';
  await app.node('scrubber').dispatch('input');
  assert.equal(Number(app.node('scrubber').value), 250);
  assert.equal(app.node('layoutToggle').attributes['aria-pressed'], 'false');
});


test('editing cleanup releases pointer capture on reset and mode exit', async () => {
  const app = makeStudio();
  await app.ready;
  assert.equal(app.window.renderAt(48), true);
  const frame = app.window.studioFrame();
  const node = frame.view.nodes.find((n) => frame.reveal.nodes[n.id] > 0.5);
  const point = screenPosition(node.position, frame.cameraResolved, DEFAULT_FRAME_SPEC);
  await app.node('layoutToggle').click();
  const stage = app.node('stage');
  const pointer = { pointerId: 91, isPrimary: true, pointerType: 'mouse', button: 0, clientX: point.x, clientY: point.y };
  await stage.dispatch('pointerdown', pointer);
  assert.equal(stage.hasPointerCapture(91), true);
  await app.node('layoutToggle').click();
  assert.equal(stage.hasPointerCapture(91), false);
  await app.node('layoutToggle').click();
  await stage.dispatch('pointerdown', pointer);
  assert.equal(stage.hasPointerCapture(91), true);
  await app.node('layoutReset').dispatch('click');
  assert.equal(stage.hasPointerCapture(91), false);
});


test('inverse camera projection survives a mathematically finite extreme-world round trip', () => {
  const spec = DEFAULT_FRAME_SPEC;
  const camera = { x: 1e308, y: 0, scale: 2.75e-306 };
  const world = { x: -1e308, y: 0 };
  const pixel = screenPosition(world, camera, spec);
  assert.deepEqual(pixel, { x: 90, y: 330 });
  assert.deepEqual(graphPosition(pixel, camera, spec), world);
});

test('hit testing ignores caption and title bands outside the renderer stage', () => {
  const spec = DEFAULT_FRAME_SPEC;
  const camera = { x: 0, y: 0, scale: 1 };
  const nodes = [{ id: 'outside', label: 'Outside', kind: 'person' }];
  const reveal = { nodes: { outside: 1 }, edges: {} };
  const outside = new Map([['outside', { x: 0, y: 270 }]]);
  const pixel = screenPosition(outside.get('outside'), camera, spec);
  assert.equal(pixel.y, 600, 'node is in caption band below the clipped stage');
  assert.equal(hitVisibleNode(nodes, outside, reveal, camera, spec, pixel, 24), null);
  assert.equal(hitVisibleNode(nodes, outside, reveal, camera, spec, { x: 640, y: 40 }, 600), null);
  const inside = new Map([['outside', { x: 0, y: 0 }]]);
  assert.equal(
    hitVisibleNode(nodes, inside, reveal, camera, spec, screenPosition(inside.get('outside'), camera, spec), 24),
    'outside',
  );
});

test('hit testing excludes fully clipped glyphs near the stage edge', () => {
  const spec = DEFAULT_FRAME_SPEC;
  const camera = { x: 0, y: 0, scale: 1 };
  const nodes = [{ id: 'clipped', kind: 'person', label: 'Clipped' }];
  const reveal = { nodes: { clipped: 1 }, edges: {} };
  const insideStage = { x: 640, y: spec.stage.y + spec.stage.h - 1 };
  const outsidePosition = new Map([['clipped', { x: 0, y: 232 }]]);
  assert.deepEqual(
    screenPosition(outsidePosition.get('clipped'), camera, spec),
    { x: 640, y: 562 },
  );
  assert.equal(
    hitVisibleNode(nodes, outsidePosition, reveal, camera, spec, insideStage, 24),
    null,
    'a click within hit radius must not select a fully clipped circle',
  );

  // Move the glyph just enough for its outline to overlap the clipped stage.
  const partlyVisible = new Map([['clipped', { x: 0, y: 220 }]]);
  assert.equal(
    hitVisibleNode(nodes, partlyVisible, reveal, camera, spec, insideStage, 24),
    'clipped',
    'a partly visible glyph remains selectable at the same pointer location',
  );
  assert.equal(
    hitVisibleNode(
      nodes,
      partlyVisible,
      { nodes: { clipped: 0.5 }, edges: {} },
      camera,
      spec,
      insideStage,
      24,
    ),
    null,
    'a node below the reveal threshold cannot be selected',
  );
});

test('corner clipping uses actual circle, diamond and rounded-pill footprints', () => {
  const spec = DEFAULT_FRAME_SPEC;
  const camera = { x: 0, y: 0, scale: 1 };
  const at = { x: spec.stage.x + 1, y: spec.stage.y + 1 };
  const cases = [
    {
      node: { id: 'circle', label: 'Circle', kind: 'person', importance: 1 },
      style: domainStyle('literature'),
      outside: { x: 14, y: 96 },
      visible: { x: 19, y: 101 },
    },
    {
      node: { id: 'diamond', label: 'Diamond', kind: 'reaction', importance: 1 },
      style: domainStyle('biology'),
      outside: { x: 14, y: 96 },
      visible: { x: 20, y: 102 },
    },
    {
      node: { id: 'pill', label: 'Pill', kind: 'protein', importance: 1 },
      style: domainStyle('biology'),
      outside: { x: 14, y: 99 },
      visible: { x: 20, y: 103 },
    },
  ];
  for (const { node, style, outside, visible } of cases) {
    const reveal = { nodes: { [node.id]: 1 }, edges: {} };
    const outsideWorld = graphPosition(outside, camera, spec);
    const insideWorld = graphPosition(visible, camera, spec);
    assert.equal(
      rectsIntersect(nodeGlyphBounds(node, outside, camera.scale, spec, style), spec.stage),
      true,
      `${node.id}: the old rectangle-only test would accept this glyph`,
    );
    assert.equal(
      nodeGlyphIntersectsStage(node, outside, camera.scale, spec, style),
      false,
      `${node.id}: the rendered outline is fully clipped at the corner`,
    );
    assert.equal(
      hitVisibleNode(
        [node],
        new Map([[node.id, outsideWorld]]),
        reveal,
        camera,
        spec,
        at,
        24,
        style,
      ),
      null,
      `${node.id}: a nearby stage click must not select a fully clipped node`,
    );
    assert.equal(
      nodeGlyphIntersectsStage(node, visible, camera.scale, spec, style),
      true,
      `${node.id}: a small glyph fragment intersects the stage`,
    );
    assert.equal(
      hitVisibleNode(
        [node],
        new Map([[node.id, insideWorld]]),
        reveal,
        camera,
        spec,
        at,
        24,
        style,
      ),
      node.id,
      `${node.id}: a partially visible node remains selectable`,
    );
  }
});

test('corner clipping honors reveal scaling and frame-spec scaling', () => {
  const spec = DEFAULT_FRAME_SPEC;
  const style = domainStyle('literature');
  const node = { id: 'scaled', label: 'Scaled', kind: 'person', importance: 1 };
  const corner = { x: spec.stage.x - 10, y: spec.stage.y - 10 };
  assert.equal(nodeGlyphIntersectsStage(node, corner, 1, spec, style, 1), true);
  assert.equal(
    nodeGlyphIntersectsStage(node, corner, 1, spec, style, 0.6),
    false,
    'the outline shrinks during reveal without changing node centre',
  );
  const scaledSpec = {
    ...spec,
    stage: {
      x: spec.stage.x * 1.5,
      y: spec.stage.y * 1.5,
      w: spec.stage.w * 1.5,
      h: spec.stage.h * 1.5,
    },
    typeScale: 1.5,
  };
  assert.equal(
    nodeGlyphIntersectsStage(node, { x: 21, y: 144 }, 1, scaledSpec, style),
    false,
    'a uniformly scaled off-corner glyph remains fully clipped',
  );
});
