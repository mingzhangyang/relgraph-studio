import { test } from 'vitest';
import assert from 'node:assert/strict';
import { createCanvasRenderer, themeFor, VIDEO_THEMES } from '../packages/render/src/canvas.ts';
import { layoutGraph } from '../packages/core/src/director/layout.ts';
import { loadDocument } from '../packages/core/src/director/load.ts';
import { directorFrameAt, frameCount } from '../packages/core/src/director/state.ts';
import { styleForGraph } from '../packages/core/src/style.ts';
import { cameraFitFor, projectCameraPoint } from '../packages/render/src/frame-spec.ts';
import { nodeGlyphBounds } from '../packages/render/src/node-geometry.ts';
import dynasties from '../examples/dynasties-timeline-provisional.graph.json' with { type: 'json' };
import { measuringCanvas, paths, readable, texts } from './helpers/display-list.mjs';

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

test('display lists and detail lookup respect hidden targets and rewinding domain time', () => {
  const graph = timedGraph();
  const calls = [];
  const renderer = createCanvasRenderer(measuringCanvas(), graph, layoutGraph(graph), {
    detailAt(id, at) {
      calls.push([id, at]);
      return { summary: 'FUTURE BIOGRAPHY' };
    },
  });
  const hidden = /FUTURE PERSON|FUTURE TITLE|FUTURE NARRATION|FUTURE BIOGRAPHY/;
  const early = renderer.displayListAt(0);
  assert.deepEqual(calls, []);
  assert.doesNotMatch(readable(early), hidden);
  assert.deepEqual(early.a11y.nodes, ['Known']);
  assert.deepEqual(early.a11y.relations, []);
  assert.equal(early.a11y.detail, null);

  const entering = renderer.displayListAt(24);
  assert.ok(!texts(entering).includes('FUTURE PERSON'));
  assert.deepEqual(entering.a11y.nodes, ['Known', 'FUTURE PERSON']);
  // The detail card waits for its node like the label does; its text is
  // accessible from the start of the reveal.
  assert.ok(!texts(entering).includes('FUTURE BIOGRAPHY'));
  assert.deepEqual(entering.a11y.detail, { label: 'FUTURE PERSON', summary: 'FUTURE BIOGRAPHY' });
  // 10 frames into the 0.6 s reveal: progress 0.694, past halfway, card fading in.
  const fading = renderer.displayListAt(34);
  const card = fading.items.find(
    (item) => item.type === 'group' && JSON.stringify(item).includes('FUTURE BIOGRAPHY'),
  );
  assert.ok(card, 'card drawn as a fading group');
  assert.ok(Math.abs(card.alpha - (10 / 14.4 - 0.5) * 2) < 1e-9, `card alpha ${card.alpha}`);
  const revealed = renderer.displayListAt(40);
  assert.deepEqual(calls, [
    ['future', 2],
    ['future', 2],
    ['future', 2],
  ]);
  assert.ok(texts(revealed).includes('FUTURE PERSON'));
  assert.ok(texts(revealed).includes('FUTURE BIOGRAPHY'));
  assert.deepEqual(revealed.a11y.detail, { label: 'FUTURE PERSON', summary: 'FUTURE BIOGRAPHY' });
  assert.deepEqual(revealed.a11y.relations, ['Known — FUTURE PERSON：family']);

  const rewind = renderer.displayListAt(48);
  assert.equal(rewind.a11y.domainTime, 'chapter 1');
  assert.doesNotMatch(readable(rewind), /FUTURE PERSON|FUTURE BIOGRAPHY/);
  // Random access reproduces the same values.
  assert.deepEqual(renderer.displayListAt(0), early);
  assert.deepEqual(renderer.displayListAt(40), revealed);
});

test('renderFrame returns the director state for the drawn frame', () => {
  const graph = timedGraph();
  const renderer = createCanvasRenderer(recordingCanvas().canvas, graph, layoutGraph(graph));
  const state = renderer.renderFrame(24);
  assert.equal(state.playback.index, 1);
  assert.equal(state.overlay.nodeId, 'future');
  // Published frame data must not mutate private compiled scene snapshots.
  state.view.nodes[0].label = 'TAMPERED';
  state.playback.scene.title = 'TAMPERED SHOT';
  state.camera.focusNodeId = 'known';
  const next = renderer.renderFrame(24);
  assert.equal(next.playback.scene.title, 'Reveal');
  assert.deepEqual(
    next.view.nodes.map((node) => node.label),
    ['Known', 'FUTURE PERSON'],
  );
  assert.notEqual(next.camera.focusNodeId, 'known');
});

test('missing layout positions fail only when the node is visible', () => {
  const graph = timedGraph();
  const positions = new Map([['known', { x: 0, y: 0 }]]);
  const renderer = createCanvasRenderer(measuringCanvas(), graph, positions);
  assert.doesNotThrow(() => renderer.displayListAt(0));
  assert.throws(() => renderer.displayListAt(24), /Missing layout position for node future/);
});

test('Canvas context failures and inherited theme names are handled explicitly', () => {
  const graph = timedGraph();
  const canvas = { getContext: () => null };
  const renderer = createCanvasRenderer(canvas, graph, layoutGraph(graph));
  for (const call of [() => renderer.renderFrame(0), () => renderer.displayListAt(0)])
    assert.throws(call, { name: 'TypeError', message: 'Canvas 2D context is unavailable' });
  for (const value of [null, 7, 'constructor', '__proto__', 'unknown'])
    assert.equal(themeFor(value), VIDEO_THEMES.dark);
});

test('reaction catalysts and inhibitors keep distinct markers from the biology style', () => {
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
    return createCanvasRenderer(measuringCanvas(), graph, layoutGraph(graph)).displayListAt(0);
  }
  const hollowMarker = (list) =>
    paths(list).some(
      (p) => p.stroke && p.fill && p.d.length === 1 && p.d[0][0] === 'A' && p.d[0][3] === 4,
    );
  const dashes = (list) => paths(list).flatMap((p) => (p.dash ? [p.dash.join(',')] : []));
  const catalyst = draw('catalyst');
  const inhibitor = draw('inhibitor');
  const activation = draw('activation');
  assert.ok(hollowMarker(catalyst));
  assert.ok(!hollowMarker(inhibitor));
  assert.ok(dashes(catalyst).includes('2,5'));
  assert.ok(dashes(inhibitor).includes('7,5'));
  // An inhibitor ends in a two-point bar; activation ends in a closed arrowhead.
  const bar = (list) =>
    paths(list).some((p) => p.stroke && !p.fill && p.d.length === 2 && p.d[1][0] === 'L');
  // A swept-back head: tip, wing, notch, wing; filled, never stroked.
  const arrow = (list) =>
    paths(list).some((p) => p.fill && !p.stroke && p.d.at(-1)?.[0] === 'Z' && p.d.length === 5);
  assert.ok(bar(inhibitor) && !arrow(inhibitor));
  assert.ok(arrow(activation) && !bar(activation));
  // The reaction is a diamond and the protein a pill.
  assert.ok(paths(catalyst).some((p) => p.stroke && p.d.length === 5 && p.d[4][0] === 'Z'));
  assert.ok(paths(catalyst).some((p) => p.d[0][0] === 'RR'));
  assert.ok(texts(catalyst).includes('催化'));
});

function recordingCanvas() {
  const commands = [];
  const gradient = { addColorStop: (...args) => commands.push(['colorStop', ...args]) };
  const context = new Proxy(
    {},
    {
      get(target, key) {
        if (key === 'measureText') return (text) => ({ width: String(text).length * 8 });
        if (key === 'createLinearGradient' || key === 'createRadialGradient')
          return (...args) => {
            commands.push([key, ...args]);
            return gradient;
          };
        return target[key] ?? ((...args) => commands.push([key, ...args]));
      },
    },
  );
  return { canvas: { getContext: () => context }, commands };
}

test('the renderer owns the style it draws with; hit tests read glyphs through it (S6)', () => {
  const { graph } = loadDocument(dynasties);
  const positions = layoutGraph(graph);
  const renderer = createCanvasRenderer(measuringCanvas(), graph, positions, {
    style: styleForGraph(graph),
  });
  assert.ok(renderer.style.timeAxis, 'an anchored timeline is drawn with its axis');
  const spec = renderer.frameSpec;
  /** Each drawn node's selection box, and the box a hit test computes with `style`. */
  const boxes = (style) => {
    const frame = frameCount(graph, spec.fps) - 1;
    const camera = directorFrameAt(graph, positions, frame, spec.fps, {
      fit: cameraFitFor(spec),
    }).cameraResolved;
    return renderer
      .displayListAt(frame)
      .selection.filter((target) => target.kind === 'node')
      .map((target) => {
        const node = graph.nodes.find((n) => n.id === target.id);
        const point = projectCameraPoint(positions.get(node.id), camera, spec);
        return [target.box, nodeGlyphBounds(node, point, camera.scale, spec, style)];
      });
  };
  const drawnBoxes = boxes(renderer.style);
  assert.ok(drawnBoxes.length >= 3);
  for (const [drawn, tested] of drawnBoxes) {
    assert.ok(Math.abs(drawn.w - tested.w) < 1e-9 && Math.abs(drawn.h - tested.h) < 1e-9);
  }
  // Bars are wider than they are high on the axis.
  assert.ok(drawnBoxes.some(([drawn]) => drawn.w > drawn.h * 2));

  // Positions move in place during a drag. One bar pushed off its years
  // takes the axis away; the renderer's style follows at once, and so do the
  // glyphs it draws: spans become points.
  const [first] = graph.nodes.filter((node) => node.span);
  const p = positions.get(first.id);
  positions.set(first.id, { x: p.x + 50, y: p.y });
  assert.equal(renderer.style.timeAxis, undefined);
  for (const [drawn, tested] of boxes(renderer.style)) {
    assert.ok(Math.abs(drawn.w - tested.w) < 1e-9 && Math.abs(drawn.h - tested.h) < 1e-9);
    assert.ok(drawn.w < drawn.h * 1.5, 'a span off the axis is drawn as a point');
  }
});
