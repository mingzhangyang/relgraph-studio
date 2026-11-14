import { test } from 'vitest';
import assert from 'node:assert/strict';
import literature from '../examples/honglou-provisional.relgraph.json' with { type: 'json' };
import biology from '../examples/biology-signaling-synthetic.json' with { type: 'json' };
import { loadDocument } from '../packages/core/src/director/load.ts';
import { layoutGraph } from '../packages/core/src/director/layout.ts';
import {
  frameStateAt,
  frameStateAtSecond,
  projectVisualGraph,
  validateVisualGraph,
} from '../packages/core/src/graph/core.ts';
import { timeAxis } from '../packages/core/src/graph/time-axis.ts';
import tree from '../examples/vertebrates-tree-provisional.graph.json' with { type: 'json' };
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

test('short captions appear on their only sampled frame', () => {
  const graph = {
    domain: 'literature',
    meta: { title: 'Short film' },
    nodes: [],
    edges: [],
    groups: [],
    scenes: [
      { id: 'opening', title: 'Opening', durationSec: 1 },
      { id: 'flash', title: 'Flash', narration: 'One frame', durationSec: 1 / 24 },
      { id: 'ending', title: 'Ending', durationSec: 1 },
    ],
  };
  const timeline = compileTimeline(graph, 24);
  assert.equal(timeline.captions[1].fadeInSec, 0);
  assert.equal(timeline.captions[1].fadeOutSec, 0);
  assert.equal(captionOpacity(timeline, 1, 1), 1);
  assert.equal(directorFrameAt(graph, new Map(), 24, 24, { timeline }).captionOpacity, 1);
  assert.equal(captionOpacity(timeline, 1, 23 / 24), 0);
  assert.equal(captionOpacity(timeline, 1, 25 / 24), 0);
  assert.ok(timeline.captions[0].fadeInSec > 0);

  // This shot is longer than 1 / fps but starts between sample times,
  // leaving exactly one sampled frame at 25 / 24.
  const offsetGraph = {
    ...graph,
    scenes: [
      { id: 'opening', title: 'Opening', durationSec: 1 + 0.25 / 24 },
      { id: 'ending', title: 'Ending', durationSec: 1.1 / 24 },
    ],
  };
  const offsetTimeline = compileTimeline(offsetGraph, 24);
  assert.equal(offsetTimeline.captions[1].fadeInSec, 0);
  assert.equal(captionOpacity(offsetTimeline, 1, 25 / 24), 1);

  const twoFrameGraph = {
    ...graph,
    scenes: [
      { id: 'opening', title: 'Opening', durationSec: 1 },
      { id: 'ending', title: 'Ending', durationSec: 2 / 24 },
    ],
  };
  assert.ok(compileTimeline(twoFrameGraph, 24).captions[1].fadeInSec > 0);
});

test('timeline compiles many shots from the known projection with inherited domain times', () => {
  const graph = {
    domain: 'literature',
    meta: { title: 'Long presentation' },
    timeline: { unit: 'chapter' },
    nodes: [
      { id: 'safe', label: 'Safe', kind: 'person' },
      { id: 'future', label: 'Future', kind: 'person', visibility: { from: 2 } },
    ],
    edges: [{ id: 'meeting', source: 'safe', target: 'future', kind: 'friendship' }],
    groups: [],
    scenes: Array.from({ length: 800 }, (_, index) => ({
      id: `shot-${index}`,
      title: `Shot ${index}`,
      narration: `Narration ${index}`,
      durationSec: 0.125,
      ...(index === 0 || index === 450 ? { domainAt: 1 } : {}),
      ...(index === 200 ? { domainAt: 2 } : {}),
      camera: { focusNodeId: 'future' },
      highlight: { nodeIds: ['future'] },
    })),
  };
  const original = structuredClone(graph);
  const timeline = compileTimeline(graph, 24);
  assert.deepEqual(graph, original, 'compiling must not change the source');
  assert.equal(timeline.shots.length, 800);
  assert.equal(timeline.durationSec, 100);
  for (const index of [0, 1, 199, 200, 201, 449, 450, 799]) {
    const shot = timeline.shots[index];
    const reference = frameStateAtSecond(graph, (shot.startSec + shot.endSec) / 2);
    assert.deepEqual(shot.scene, reference.playback.scene, `scene ${index}`);
    assert.deepEqual(shot.view, reference.view, `projection ${index}`);
    assert.deepEqual(shot.overlay, reference.overlay, `overlay ${index}`);
    assert.deepEqual(timeline.camera[index].value, reference.camera);
    assert.deepEqual(timeline.highlight[index].value, reference.highlight);
    assert.equal(shot.domainAt, reference.playback.domainAt);
  }
  assert.equal(timeline.shots[199].scene.redacted, true);
  assert.equal(timeline.shots[200].scene.redacted, false);
  assert.equal(timeline.shots[450].scene.redacted, true);
});

test('fractional shot boundaries never hide the only sampled caption frame', () => {
  const cases = [
    { durations: [0.1, 1 / 15, 1 / 24], frame: 4 },
    { durations: [0.1, 7 / 30, 1 / 24, 1], frame: 8 },
  ];
  for (const { durations, frame } of cases) {
    const graph = {
      domain: 'literature',
      meta: { title: 'Fractional boundaries' },
      nodes: [],
      edges: [],
      groups: [],
      scenes: durations.map((durationSec, index) => ({
        id: `shot-${index}`,
        title: `Caption ${index}`,
        narration: `Narration ${index}`,
        durationSec,
      })),
    };
    const timeline = compileTimeline(graph, 24);
    const second = frame / 24;
    assert.equal(timelinePlaybackAt(timeline, second).index, 2);
    assert.ok(timeline.captions[2].inSec > second, 'rounding places the start after the sample');
    assert.equal(timeline.captions[2].fadeInSec, 0);
    assert.equal(captionOpacity(timeline, 1, second), 0, 'previous shot has ended');
    assert.equal(
      captionOpacity(timeline, 2, second),
      1,
      'the current caption must be fully visible',
    );
    assert.equal(
      directorFrameAt(graph, new Map(), frame, 24, { timeline }).captionOpacity,
      1,
      'renderer-facing director state must show the caption',
    );
  }
});

test('hidden targets with inherited Object property names have zero reveal progress', () => {
  const graph = {
    domain: 'literature',
    meta: { title: 'Unusual identifiers' },
    timeline: { unit: 'chapter' },
    nodes: [
      { id: 'visible', label: 'Visible', kind: 'person' },
      { id: 'constructor', label: 'Hidden', kind: 'person', visibility: { from: 2 } },
    ],
    edges: [{ id: 'toString', source: 'visible', target: 'constructor', kind: 'friendship' }],
    groups: [],
    scenes: [
      { id: 'before', title: 'Before', durationSec: 1, domainAt: 1 },
      { id: 'after', title: 'After', durationSec: 1, domainAt: 2 },
    ],
  };
  const timeline = compileTimeline(graph);
  for (const [kind, id] of [
    ['node', 'constructor'],
    ['node', '__proto__'],
    ['edge', 'toString'],
    ['edge', 'hasOwnProperty'],
  ]) {
    assert.equal(revealProgress(timeline, kind, id, 0), 0);
    assert.equal(typeof revealProgress(timeline, kind, id, 0), 'number');
  }
  assert.equal(revealProgress(timeline, 'node', 'constructor', 1.9), 1);
  assert.equal(revealProgress(timeline, 'edge', 'toString', 1.9), 1);
});

test('S3: a graph can unfold and carry domain time, each on its own track', () => {
  // A derived unfolding, given real dates as well: the first two levels exist
  // from year 0, everything deeper from year 10.
  const unfolded = loadDocument(tree).graph;
  const graph = structuredClone(unfolded);
  for (const node of graph.nodes) node.visibility = { from: node.revealStep <= 2 ? 0 : 10 };
  graph.timeline = { unit: 'YEAR' };
  graph.scenes = [
    { id: 'a', title: 'a', durationSec: 2, domainAt: 0, revealStep: 1 },
    { id: 'b', title: 'b', durationSec: 2, revealStep: 3 },
    { id: 'c', title: 'c', durationSec: 2, domainAt: 10 },
    { id: 'd', title: 'd', durationSec: 2, revealStep: 12 },
  ];
  assert.equal(validateVisualGraph(graph).valid, true);
  const ids = (view) => view.nodes.map((n) => n.id).sort();
  const expected = (at, step) =>
    graph.nodes
      .filter((n) => n.visibility.from <= at && n.revealStep <= step)
      .map((n) => n.id)
      .sort();

  // Each track is inherited on its own; the projection admits what both admit.
  const timeline = compileTimeline(graph, 24);
  assert.deepEqual(
    timeline.domainTime.map((k) => k.value),
    [0, 0, 10, 10],
  );
  assert.deepEqual(
    timeline.revealSteps.map((k) => k.value),
    [1, 3, 3, 12],
  );
  const cases = [
    [0, 1],
    [0, 3],
    [10, 3],
    [10, 12],
  ];
  cases.forEach(([at, step], i) => {
    assert.deepEqual(ids(timeline.shots[i].view), expected(at, step), `shot ${i}`);
    assert.deepEqual(ids(projectVisualGraph(graph, at, step)), expected(at, step));
    // Random access agrees with the compiled film, and keeps both values.
    const state = frameStateAtSecond(graph, i * 2 + 1);
    assert.deepEqual(ids(state.view), expected(at, step));
    assert.deepEqual([state.playback.domainAt, state.playback.revealStep], [at, step]);
    assert.deepEqual(
      [
        timelinePlaybackAt(timeline, i * 2 + 1).domainAt,
        timelinePlaybackAt(timeline, i * 2 + 1).revealStep,
      ],
      [at, step],
    );
  });
  // Shot b is still at year 0: unfolding further reveals nothing from year 10.
  assert.ok(ids(timeline.shots[1].view).length < ids(timeline.shots[3].view).length);

  // Reveal steps are never dates: they make no time axis, and only the real
  // dates make one.
  assert.equal(timeAxis(unfolded.nodes), null);
  assert.deepEqual([timeAxis(graph.nodes).from, timeAxis(graph.nodes).to], [0, 10]);
  // A still graph (no step set yet) shows everything, as with domain time.
  assert.equal(projectVisualGraph(graph).nodes.length, graph.nodes.length);
  assert.equal(
    validateVisualGraph({ ...graph, scenes: [{ ...graph.scenes[0], revealStep: NaN }] }).valid,
    false,
  );
});
