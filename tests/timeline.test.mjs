import { test } from 'vitest';
import assert from 'node:assert/strict';
import literature from '../examples/honglou-provisional.relgraph.json' with { type: 'json' };
import biology from '../examples/biology-signaling-synthetic.json' with { type: 'json' };
import { loadDocument } from '../packages/core/src/director/load.ts';
import { layoutGraph } from '../packages/core/src/director/layout.ts';
import { frameStateAt } from '../packages/core/src/graph/core.ts';
import {
  compileTimeline,
  captionOpacity,
  revealProgress,
  revealStateAt,
  timelinePlaybackAt,
} from '../packages/core/src/director/timeline.ts';
import { directorFrameAt } from '../packages/core/src/director/state.ts';
import { createCanvasRenderer } from '../packages/render/src/canvas.ts';
import { quadraticPrefix } from '../packages/render/src/compose.ts';
import { measuringCanvas, texts } from './helpers/display-list.mjs';

const [literaryGraph, biologyGraph] = [literature, biology].map(
  (source) => loadDocument(source).graph,
);
const snapshots = [
  {
    graph: literaryGraph,
    expected: {
      duration: 40,
      shots: ['opening', 'baoyu', 'triangle', 'roots', 'ending'],
      starts: [0, 7, 15, 24, 32],
      times: [null, null, null, null, null],
      reveals: [],
    },
  },
  {
    graph: biologyGraph,
    expected: {
      duration: 13,
      shots: ['intro', 'reaction', 'product'],
      starts: [0, 4, 9],
      times: [1, 2, 3],
      reveals: [
        'node:bio:process:phosphorylation-test@4',
        'edge:bio:arc:input:phosphorylation-test:substrate-s@4',
        'edge:bio:arc:modifier:phosphorylation-test:kinase-k@4',
        'node:substrate-sp@9',
        'edge:bio:arc:output:phosphorylation-test:substrate-sp@9',
      ],
    },
  },
];

test('compiled shot, track and reveal snapshots for both authored examples', () => {
  for (const { graph, expected } of snapshots) {
    const timeline = compileTimeline(graph);
    const actual = {
      duration: timeline.durationSec,
      shots: timeline.shots.map((s) => s.scene.id),
      starts: timeline.camera.map((c) => c.atSec),
      times: timeline.domainTime.map((k) => k.value),
      reveals: timeline.reveal.map((cue) => `${cue.kind}:${cue.targetId}@${cue.inSec}`),
    };
    assert.deepEqual(actual, expected);
    assert.equal(timeline.camera.length, graph.scenes.length);
    assert.equal(timeline.highlight.length, graph.scenes.length);
    assert.equal(timeline.captions.length, graph.scenes.length);
    assert.deepEqual(compileTimeline(graph), timeline);
    assert.deepEqual(
      graph.scenes.map((s) => s.id),
      expected.shots,
    );
  }
});

test('projection removes hidden targets and withdrawn prose before track creation', () => {
  const graph = {
    domain: 'literature',
    meta: { title: 'Safe heading' },
    timeline: { unit: 'chapter' },
    nodes: [
      { id: 'safe', kind: 'person', label: 'Safe' },
      { id: 'secret', kind: 'person', label: 'FUTURE PERSON', visibility: { from: 2 } },
    ],
    edges: [{ id: 'secret-edge', source: 'safe', target: 'secret', kind: 'friendship' }],
    groups: [],
    scenes: [
      {
        id: 'unsafe',
        title: 'FUTURE SCENE TITLE',
        narration: 'FUTURE NARRATION',
        durationSec: 1,
        domainAt: 1,
        camera: { focusNodeId: 'secret' },
        highlight: { nodeIds: ['secret'], edgeIds: ['secret-edge'] },
      },
      {
        id: 'safe-shot',
        title: 'Safe reveal',
        durationSec: 2,
        domainAt: 2,
        camera: { focusNodeId: 'secret' },
      },
      { id: 'rewind', title: 'Back', durationSec: 1, domainAt: 1 },
    ],
  };
  const original = structuredClone(graph);
  const timeline = compileTimeline(graph);
  assert.deepEqual(graph, original, 'compilation never mutates source');
  assert.equal(timeline.shots[0].scene.id, undefined);
  assert.equal(timeline.camera[0].value.focusNodeId, undefined);
  assert.deepEqual(timeline.highlight[0].value.nodeIds, []);
  assert.deepEqual(timeline.highlight[0].value.edgeIds, []);
  assert.deepEqual(
    timeline.shots[0].view.nodes.map((n) => n.id),
    ['safe'],
  );
  assert.doesNotMatch(JSON.stringify(timeline.captions), /FUTURE SCENE TITLE|FUTURE NARRATION/);
  assert.deepEqual(
    timeline.reveal.map((r) => [r.targetId, r.inSec, r.outSec]),
    [
      ['secret', 1, 3],
      ['secret-edge', 1, 3],
    ],
  );
  assert.deepEqual(
    timeline.shots[2].view.nodes.map((n) => n.id),
    ['safe'],
  );
  assert.equal(revealProgress(timeline, 'node', 'secret', 3), 0);
});

test('reveal and caption frames have exact start, before, end and exit semantics', () => {
  const timeline = compileTimeline(biologyGraph, 24);
  const id = 'bio:process:phosphorylation-test';
  const edgeId = 'bio:arc:input:phosphorylation-test:substrate-s';
  assert.equal(revealProgress(timeline, 'node', id, 95 / 24), 0);
  assert.equal(revealProgress(timeline, 'node', id, 96 / 24), 0);
  assert.ok(revealProgress(timeline, 'node', id, 105 / 24) > 0);
  assert.equal(revealProgress(timeline, 'node', id, 111 / 24), 1);
  assert.equal(revealProgress(timeline, 'edge', edgeId, 96 / 24), 0);
  assert.ok(revealProgress(timeline, 'edge', edgeId, 112 / 24) < 1);
  assert.equal(revealProgress(timeline, 'edge', edgeId, 116 / 24), 1);
  assert.equal(captionOpacity(timeline, 1, 96 / 24), 0);
  assert.ok(captionOpacity(timeline, 1, 100 / 24) > 0);
  assert.equal(captionOpacity(timeline, 1, 104 / 24), 1);
  assert.ok(captionOpacity(timeline, 1, 215 / 24) > 0);
  assert.equal(captionOpacity(timeline, 1, 216 / 24), 0);
  assert.equal(timelinePlaybackAt(timeline, 216 / 24).index, 2);
});

const lerp = (a, b, t) => a + (b - a) * t;
function pointOn(start, control, end, t) {
  const a = { x: lerp(start.x, control.x, t), y: lerp(start.y, control.y, t) };
  const b = { x: lerp(control.x, end.x, t), y: lerp(control.y, end.y, t) };
  return { x: lerp(a.x, b.x, t), y: lerp(a.y, b.y, t) };
}

test('partially drawn quadratic Béziers are exact de Casteljau sub-curves', () => {
  const start = { x: 3, y: -7 };
  const control = { x: 19, y: 31 };
  const end = { x: 47, y: 2 };
  for (const t of [0, 0.15, 0.5, 0.9, 1]) {
    const [move, quad] = quadraticPrefix(start, control, end, t);
    assert.deepEqual(move, ['M', start.x, start.y]);
    const from = { x: move[1], y: move[2] };
    const via = { x: quad[1], y: quad[2] };
    const to = { x: quad[3], y: quad[4] };
    for (const fraction of [0, 0.2, 0.5, 0.8, 1]) {
      const expected = pointOn(start, control, end, t * fraction);
      const observed = pointOn(from, via, to, fraction);
      assert.ok(Math.abs(expected.x - observed.x) < 1e-10);
      assert.ok(Math.abs(expected.y - observed.y) < 1e-10);
    }
  }
});

test('camera/highlight targets match legacy frame projections and transition easing', () => {
  const position = layoutGraph(biologyGraph);
  const timeline = compileTimeline(biologyGraph);
  for (const index of [0, 1, 2]) {
    const frame = Math.round(timeline.shots[index].startSec * 24);
    const prior = frameStateAt(biologyGraph, frame, 24);
    assert.deepEqual(timeline.camera[index].value, prior.camera);
    assert.deepEqual(timeline.highlight[index].value, prior.highlight);
    const state = directorFrameAt(biologyGraph, position, frame, 24, { timeline });
    assert.deepEqual(state.highlight, prior.highlight);
    assert.deepEqual(state.camera, prior.camera);
    assert.equal(state.transition, index === 0 ? 1 : 0);
  }
  const middle = directorFrameAt(biologyGraph, position, 108, 24, { timeline });
  const elapsed = (108 - 96) / 24;
  const t = elapsed / 1.2;
  assert.ok(Math.abs(middle.transition - t * t * (3 - 2 * t)) < 1e-12);
});

test('display list is frame-only: random seek and prior rendering do not change it', () => {
  const graph = biologyGraph;
  const renderer = createCanvasRenderer(measuringCanvas(), graph, layoutGraph(graph));
  const before = renderer.displayListAt(110);
  const processLabel = graph.nodes.find(
    (node) => node.id === 'bio:process:phosphorylation-test',
  ).label;
  const substrateLabel = graph.nodes.find((node) => node.id === 'substrate-s').label;
  assert.ok(before.a11y.nodes.includes(substrateLabel));
  assert.ok(before.a11y.nodes.includes(processLabel));
  assert.ok(!texts(renderer.displayListAt(96)).includes(processLabel));
  assert.ok(renderer.displayListAt(96).a11y.nodes.includes(processLabel));
  for (const frame of [0, 311, 2, 216, 94, 110, 48]) renderer.displayListAt(frame);
  assert.deepEqual(renderer.displayListAt(110), before);
  const later = renderer.displayListAt(128);
  assert.ok(later.a11y.nodes.includes(processLabel));
});

test('the last caption holds to the final frame while earlier ones fade out', () => {
  for (const graph of [literaryGraph, biologyGraph]) {
    const timeline = compileTimeline(graph, 24);
    const lastIndex = timeline.captions.length - 1;
    const lastFrame = Math.round(timeline.durationSec * 24) - 1;
    assert.equal(timeline.captions[lastIndex].fadeOutSec, 0);
    assert.equal(captionOpacity(timeline, lastIndex, lastFrame / 24), 1);
    // The final frame of an earlier shot is still fading out.
    const earlierEnd = Math.round(timeline.captions[0].outSec * 24) - 1;
    assert.ok(captionOpacity(timeline, 0, earlierEnd / 24) < 1);
  }
});

test('a graph without scenes is drawn as a still, fully revealed', () => {
  const still = {
    domain: 'literature',
    meta: { title: 'Still' },
    nodes: [
      { id: 'a', label: 'Alpha', kind: 'person', position: { x: 0, y: 0 } },
      { id: 'b', label: 'Beta', kind: 'person', position: { x: 200, y: 0 } },
    ],
    edges: [{ id: 'e', source: 'a', target: 'b', kind: 'family' }],
    groups: [],
    scenes: [],
  };
  const layout = layoutGraph(still);
  const state = directorFrameAt(still, layout, 0);
  assert.deepEqual(state.reveal, { nodes: { a: 1, b: 1 }, edges: { e: 1 } });
  const labels = texts(createCanvasRenderer(measuringCanvas(), still, layout).displayListAt(0));
  assert.ok(labels.includes('Alpha') && labels.includes('Beta'), labels.join(', '));
});

test('editing a returned frame state cannot change frames from a reused timeline', () => {
  const layout = layoutGraph(biologyGraph);
  const timeline = compileTimeline(biologyGraph, 24);
  const options = { timeline };
  const pristine = directorFrameAt(biologyGraph, layout, 100, 24, options);
  const edited = directorFrameAt(biologyGraph, layout, 100, 24, options);
  edited.playback.scene.title = 'EDITED';
  edited.camera.focusNodeId = 'EDITED';
  edited.highlight.nodeIds.push('EDITED');
  edited.view.nodes.length = 0;
  assert.deepEqual(directorFrameAt(biologyGraph, layout, 100, 24, options), pristine);
});

// The per-object lookup this PR first shipped, kept as the reference: the
// one-pass evaluation must give the same progress for every projected object.
function referenceRevealProgress(timeline, kind, targetId, second) {
  const tolerance = 8 * Number.EPSILON * Math.max(1, Math.abs(second));
  for (let i = timeline.reveal.length - 1; i >= 0; i--) {
    const cue = timeline.reveal[i];
    if (
      cue.kind === kind &&
      cue.targetId === targetId &&
      cue.inSec <= second + tolerance &&
      (cue.outSec === undefined || second < cue.outSec - tolerance)
    )
      return Math.min(1, Math.max(0, (second - cue.inSec) / cue.durationSec));
  }
  const view = timeline.shots[timelinePlaybackAt(timeline, second).index]?.view;
  if (!view) return 0;
  return (kind === 'node' ? view.nodes : view.edges).some((item) => item.id === targetId) ? 1 : 0;
}

test('one-pass reveal state equals the per-object reference on every frame', () => {
  for (const graph of [literaryGraph, biologyGraph]) {
    const timeline = compileTimeline(graph, 24);
    const frames = Math.round(timeline.durationSec * 24);
    for (let frame = 0; frame < frames; frame += 1) {
      const second = frame / 24;
      const view = timeline.shots[timelinePlaybackAt(timeline, second).index].view;
      const state = revealStateAt(timeline, view, second);
      for (const [kind, items, values] of [
        ['node', view.nodes, state.nodes],
        ['edge', view.edges, state.edges],
      ])
        for (const item of items) {
          const expected = referenceRevealProgress(timeline, kind, item.id, second);
          assert.equal(values[item.id], expected, `${kind} ${item.id} at frame ${frame}`);
          assert.equal(revealProgress(timeline, kind, item.id, second), expected);
        }
    }
  }
});
