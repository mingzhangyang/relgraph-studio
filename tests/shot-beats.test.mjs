import { test } from 'vitest';
import assert from 'node:assert/strict';
import project from '../examples/scrolling-timeline.studio.json' with { type: 'json' };
import biology from '../examples/biology-signaling-synthetic.json' with { type: 'json' };
import { loadDocument } from '../packages/core/src/director/load.ts';
import { layoutGraph } from '../packages/core/src/director/layout.ts';
import { directorFrameAt } from '../packages/core/src/director/state.ts';
import { compileTimeline } from '../packages/core/src/director/timeline.ts';
import { filmEvents } from '../packages/core/src/director/events.ts';
import { frameStateAt } from '../packages/core/src/graph/core.ts';

function movie(doc) {
  const result = loadDocument(doc);
  assert.equal(result.valid, true, JSON.stringify(result.errors));
  const { graph, authoredIds } = result,
    positions = layoutGraph(graph),
    timeline = compileTimeline(graph, 24);
  return {
    frame: (f) => directorFrameAt(graph, positions, f, 24, { timeline }),
    graph,
    events: filmEvents(graph, positions, 24, { timeline, authoredIds }).events,
  };
}

test('one scrolling shot keeps its caption while the camera moves and a node enters on the beat', () => {
  const { frame, graph, events } = movie(project);
  assert.equal(events.filter((e) => e.type === 'shot').length, 1);
  assert.equal(events.filter((e) => e.type === 'caption').length, 1);
  assert.deepEqual(
    events.filter((e) => e.type === 'beat').map((e) => e.frame),
    [24, 60],
  );
  const late = events.find((e) => e.type === 'reveal' && e.id === '黄昏');
  assert.equal(late.frame, 60);
  assert.equal(late.effect, 'fade');
  assert.ok(frame(24).cameraResolved.y < frame(34).cameraResolved.y);
  assert.ok(frame(34).cameraResolved.y < frame(44).cameraResolved.y);
  assert.equal(frame(59).view.nodes.length, 2);
  assert.equal(frame(60).view.nodes.length, 3);
  assert.equal(frame(60).captionOpacity, 1);
  assert.equal(frame(60).playback.elapsedSec, 2.5);
  for (const f of [70, 0, 59, 60, 20]) {
    const direct = frameStateAt(graph, f);
    assert.deepEqual(frame(f).view, direct.view);
    assert.deepEqual(frame(f).playback, direct.playback);
  }
});

test('beat evidence uses projected items, and future targets redact the shot and its events', () => {
  const source = structuredClone(project.source);
  source.nodes[1].evidence = [{ cite: 'Field notes' }];
  source.presentation[0].beats[0].evidence = { nodeId: '正午' };
  let film = movie(source);
  assert.equal(film.frame(23).evidence, null);
  assert.equal(film.frame(48).evidence.items[0].cite, 'Field notes');
  assert.ok(film.events.some((e) => e.type === 'evidence' && e.target === '正午'));
  source.nodes[2].visibleFrom = 30;
  film = movie(source);
  assert.equal(film.frame(90).view.nodes.length, 2);
  assert.equal(film.frame(0).playback.scene.redacted, true);
  assert.ok(!JSON.stringify(film.events).includes('黄昏'));
});

test('generic and biology accept marker beats and reject invalid times and targets', () => {
  for (const template of [project.source, biology]) {
    const doc = structuredClone(template);
    const shot = doc.presentation[0];
    shot.beats = [{ atSec: 0.01 }, { atSec: 0.02 }];
    assert.deepEqual(
      movie(doc)
        .events.filter((e) => e.type === 'beat')
        .map((e) => [e.beat, e.frame]),
      [
        [0, 1],
        [1, 1],
      ],
    );
    for (const beats of [
      [{ atSec: shot.durationSec }],
      [{ atSec: 1 }, { atSec: 1 }],
      [{ atSec: 0, camera: { focusNodeId: 'unknown' } }],
    ]) {
      shot.beats = beats;
      assert.equal(loadDocument(doc).valid, false);
    }
  }
});

test('a biology beat maps a process alias and its highlights into the projected graph', () => {
  const doc = structuredClone(biology);
  doc.presentation[1].beats = [
    {
      atSec: 1,
      camera: { focusNodeId: 'process-phosphorylation-test' },
      highlight: { nodeIds: ['process-phosphorylation-test'] },
    },
  ];
  const film = movie(doc);
  const f = film.frame(5 * 24);
  assert.equal(f.camera.focusNodeId, 'bio:process:phosphorylation-test');
  assert.deepEqual(f.highlight.nodeIds, ['bio:process:phosphorylation-test']);
});

test('an opening reveal fades from frame zero and holds back incident edges until both ends appear', () => {
  const doc = {
    format: 'relgraph.graph/1',
    nodes: [{ id: 'a' }, { id: 'b' }],
    edges: [{ id: 'ab', source: 'a', target: 'b' }],
    presentation: [
      {
        title: 'Opening',
        durationSec: 2,
        beats: [
          { atSec: 0, reveal: { nodeIds: ['a'] } },
          { atSec: 0.5, reveal: { nodeIds: ['b'] } },
        ],
      },
    ],
  };
  const film = movie(doc);
  assert.equal(film.frame(0).reveal.nodes.a, 0);
  assert.equal(film.frame(11).view.edges.length, 0);
  assert.equal(film.frame(12).reveal.edges.ab, 0);
  assert.deepEqual(
    film.events.filter((e) => e.type === 'reveal').map((e) => [e.id, e.frame, e.effect]),
    [
      ['a', 0, 'fade'],
      ['b', 12, 'fade'],
      ['ab', 12, 'draw'],
    ],
  );
});
