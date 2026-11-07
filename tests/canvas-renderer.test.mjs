import { test } from 'vitest';
import assert from 'node:assert/strict';
import { createCanvasRenderer, themeFor, VIDEO_THEMES } from '../src/render/canvas.ts';
import { layoutGraph } from '../src/director/layout.ts';

function recordingCanvas() {
  let commands = [];
  const record = (...args) => commands.push(args);
  const gradient = { addColorStop: (...args) => record('colorStop', ...args) };
  const context = new Proxy(
    {},
    {
      get(target, key) {
        if (key === 'measureText') return (text) => ({ width: String(text).length * 8 });
        if (key === 'createLinearGradient' || key === 'createRadialGradient')
          return (...args) => {
            record(key, ...args);
            return gradient;
          };
        return target[key] ?? ((...args) => record(key, ...args));
      },
      set(target, key, value) {
        target[key] = value;
        record('set', key, value === gradient ? 'gradient' : value);
        return true;
      },
    },
  );
  return {
    canvas: { getContext: () => context },
    take() {
      const result = commands;
      commands = [];
      return result;
    },
  };
}

function timedGraph() {
  return {
    domain: 'literature',
    meta: { title: 'Story' },
    timeline: { unit: 'chapter', total: 2 },
    nodes: [
      { id: 'known', label: 'Known', kind: 'person', position: { x: 0, y: 0 } },
      {
        id: 'future',
        label: 'FUTURE PERSON',
        kind: 'person',
        visibility: { from: 2 },
        position: { x: 300, y: 0 },
      },
    ],
    edges: [
      {
        id: 'secret-link',
        source: 'known',
        target: 'future',
        kind: 'family',
        visibility: { from: 2 },
      },
    ],
    groups: [],
    scenes: [
      {
        id: 'early',
        title: 'FUTURE TITLE',
        narration: 'FUTURE NARRATION',
        durationSec: 1,
        domainAt: 1,
        camera: { focusNodeId: 'future' },
        highlight: { nodeIds: ['future'], edgeIds: ['secret-link'] },
        openDetailNodeId: 'future',
      },
      {
        id: 'reveal',
        title: 'Reveal',
        durationSec: 1,
        domainAt: 2,
        highlight: { nodeIds: ['future'] },
        openDetailNodeId: 'future',
      },
      { id: 'rewind', title: 'Earlier', durationSec: 1, domainAt: 1 },
    ],
  };
}

test('Canvas output and detail lookup respect hidden targets and rewinding domain time', () => {
  const graph = timedGraph();
  const calls = [];
  const rec = recordingCanvas();
  const renderer = createCanvasRenderer(rec.canvas, graph, layoutGraph(graph), {
    detailAt(id, at) {
      calls.push([id, at]);
      return { summary: 'FUTURE BIOGRAPHY' };
    },
  });
  const early = renderer.renderFrame(0);
  const firstCommands = rec.take();
  assert.equal(early.playback.scene.redacted, true);
  assert.equal(early.overlay, null);
  assert.deepEqual(calls, []);
  assert.doesNotMatch(
    JSON.stringify(firstCommands),
    /FUTURE PERSON|FUTURE TITLE|FUTURE NARRATION|FUTURE BIOGRAPHY/,
  );
  const revealed = renderer.renderFrame(24);
  const revealedCommands = rec.take();
  assert.deepEqual(calls, [['future', 2]]);
  assert.equal(revealed.overlay.nodeId, 'future');
  assert.match(JSON.stringify(revealedCommands), /FUTURE PERSON/);
  assert.match(JSON.stringify(revealedCommands), /FUTURE BIOGRAPHY/);
  const rewind = renderer.renderFrame(48);
  const rewindCommands = rec.take();
  assert.equal(rewind.playback.domainAt, 1);
  assert.deepEqual(rewind.previousHighlight.nodeIds, []);
  assert.equal(rewind.overlay, null);
  assert.doesNotMatch(JSON.stringify(rewindCommands), /FUTURE PERSON|FUTURE BIOGRAPHY/);
  renderer.renderFrame(0);
  assert.deepEqual(rec.take(), firstCommands);
  renderer.renderFrame(24);
  assert.deepEqual(rec.take(), revealedCommands);
});

test('missing layout positions fail only when the node is visible', () => {
  const graph = timedGraph();
  const positions = new Map([['known', { x: 0, y: 0 }]]);
  const rec = recordingCanvas();
  const renderer = createCanvasRenderer(rec.canvas, graph, positions);
  assert.doesNotThrow(() => renderer.renderFrame(0));
  assert.throws(() => renderer.renderFrame(24), /Missing layout position for node future/);
});

test('Canvas context failures and inherited theme names are handled explicitly', () => {
  const graph = timedGraph();
  const canvas = { getContext: () => null };
  const renderer = createCanvasRenderer(canvas, graph, layoutGraph(graph));
  assert.throws(() => renderer.renderFrame(0), {
    name: 'TypeError',
    message: 'Canvas 2D context is unavailable',
  });
  for (const value of [null, 7, 'constructor', '__proto__', 'unknown'])
    assert.equal(themeFor(value), VIDEO_THEMES.dark);
});

test('reaction catalysts and inhibitors retain distinct Canvas markers', () => {
  const graph = {
    domain: 'biology',
    meta: { title: 'Synthetic' },
    groups: [],
    timeline: { unit: 'stage' },
    nodes: [
      { id: 'enzyme', label: 'Enzyme', kind: 'protein', position: { x: 0, y: 0 } },
      { id: 'reaction', label: 'Reaction', kind: 'reaction', position: { x: 300, y: 0 } },
    ],
    edges: [{ id: 'edge', source: 'enzyme', target: 'reaction', kind: 'catalyst', directed: true }],
    scenes: [{ id: 'one', title: 'One', durationSec: 2, domainAt: 1 }],
  };
  function draw(kind) {
    graph.edges[0].kind = kind;
    const rec = recordingCanvas();
    createCanvasRenderer(rec.canvas, graph, layoutGraph(graph)).renderFrame(0);
    return rec.take();
  }
  const catalyst = draw('catalyst');
  const inhibitor = draw('inhibitor');
  assert.ok(catalyst.some((command) => command[0] === 'arc' && command[3] === 4));
  assert.ok(!inhibitor.some((command) => command[0] === 'arc' && command[3] === 4));
  assert.ok(
    catalyst.some((command) => command[0] === 'setLineDash' && String(command[1]) === '2,5'),
  );
  assert.ok(
    inhibitor.some((command) => command[0] === 'setLineDash' && String(command[1]) === '7,5'),
  );
});
