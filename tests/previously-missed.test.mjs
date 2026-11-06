import { test } from 'vitest';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { runInNewContext } from 'node:vm';
import { validateVisualGraph, sceneAtSecond, frameStateAt } from '../src/graph/core.mjs';
import { validateBiologyDocument, adaptBiologyDocument } from '../src/domains/biology.mjs';
import biology from '../examples/biology-signaling-synthetic.json' with { type: 'json' };

const graph = {
  domain: 'biology',
  meta: { title: 'Technical test' },
  nodes: [], edges: [], groups: [],
  scenes: [
    { id: 'first', title: 'First', durationSec: 0.1, domainAt: 1 },
    { id: 'second', title: 'Second', durationSec: 0.2, domainAt: 2 },
    { id: 'third', title: 'Third', durationSec: 1, domainAt: 3 },
  ],
};

test('visual graph requires nonempty domain and title strings', () => {
  assert.equal(validateVisualGraph(graph).valid, true);
  for (const value of [undefined, null, 42, '', '  ']) {
    const result = validateVisualGraph({ ...graph, domain: value });
    assert.ok(result.errors.some(e => e.code === 'GRAPH_DOMAIN' && e.path === 'domain' && e.fix));
    const metaResult = validateVisualGraph({ ...graph, meta: { title: value } });
    assert.ok(metaResult.errors.some(e => e.code === 'GRAPH_TITLE' && e.path === 'meta.title' && e.fix));
  }
});

test('visual graph and biology adapter reject non-finite or non-positive camera zooms', () => {
  for (const zoom of ['not-a-number', NaN, Infinity, -Infinity, -1, 0]) {
    const scenes = [{ ...graph.scenes[0], camera: { zoom } }];
    assert.ok(validateVisualGraph({ ...graph, scenes }).errors.some(e => e.code === 'CAMERA_ZOOM'));
    const doc = structuredClone(biology);
    doc.presentation[0].camera.zoom = zoom;
    assert.ok(validateBiologyDocument(doc).errors.some(e => e.code === 'CAMERA_ZOOM'));
    assert.throws(() => adaptBiologyDocument(doc), e => e.issues?.some(issue => issue.code === 'CAMERA_ZOOM'));
  }
  assert.equal(validateVisualGraph({ ...graph, scenes: [{ ...graph.scenes[0], camera: { zoom: 1.25 } }] }).valid, true);
});

test('fractional scene boundaries select the next scene on the exact frame', () => {
  assert.equal(sceneAtSecond(graph, 0.1).index, 1);
  assert.equal(sceneAtSecond(graph, 0.3).index, 2);
  assert.equal(frameStateAt(graph, 3, 30).playback.index, 1);
  assert.equal(frameStateAt(graph, 8, 30).playback.index, 1);
  const frame = frameStateAt(graph, 9, 30);
  assert.equal(frame.playback.index, 2);
  assert.equal(frame.playback.domainAt, 3);
  assert.equal(frame.playback.elapsedSec, 0);
  assert.equal(frame.playback.progress, 0);
});

test('pause/restart cannot leave more than one animation frame loop', () => {
  const html = readFileSync(new URL('../demo/standalone.html', import.meta.url), 'utf8');
  const start = html.indexOf('function setPlaying(next){');
  const end = html.indexOf('function makeShotList(){', start);
  assert.ok(start >= 0 && end > start, 'The demo still contains the transport functions');
  const transport = html.slice(start, end);
  const jobs = new Map();
  let id = 0;
  let drawCount = 0;
  const env = {
    requestAnimationFrame(fn) { const token = ++id; jobs.set(token, fn); return token; },
    cancelAnimationFrame(token) { jobs.delete(token); },
    play: { textContent: '', setAttribute() {} },
    state: { textContent: '' },
    setFrame() { drawCount += 1; },
    FPS: 24,
    TOTAL_FRAMES: 960,
  };
  const controller = runInNewContext(
    'let animationFrameId=null, playing=false, lastTick=0, position=0;' +
    'const { requestAnimationFrame, cancelAnimationFrame, play, state, setFrame, FPS, TOTAL_FRAMES }=env;\n' +
    transport + '\n({setPlaying, tick})',
    { env }
  );
  controller.setPlaying(true);
  assert.equal(jobs.size, 1);
  controller.setPlaying(false);
  assert.equal(jobs.size, 0);
  controller.setPlaying(true);
  controller.setPlaying(true);
  assert.equal(jobs.size, 1, 'repeated play should replace rather than duplicate an RAF');
  const [token, callback] = jobs.entries().next().value;
  jobs.delete(token); // browser has dequeued the callback
  callback(1000);
  assert.equal(jobs.size, 1);
  controller.setPlaying(false);
  assert.equal(jobs.size, 0);
  assert.equal(drawCount, 1);
});
