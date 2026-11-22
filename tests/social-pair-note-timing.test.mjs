import { test } from 'vitest';
import assert from 'node:assert/strict';
import sample from '../examples/tang-absence.social.json' with { type: 'json' };
import {
  compileTimeline,
  directorFrameAt,
  filmEvents,
  frameCount,
  layoutGraph,
  loadDocument,
  styleForGraph,
} from '../packages/core/src/index.ts';
import { hiddenEvidenceCards } from '../packages/cli/src/evidence.ts';
import { composeFrame } from '../packages/render/src/compose.ts';
import { measure, texts } from './helpers/display-list.mjs';

function movie(doc) {
  const result = loadDocument(doc);
  assert.equal(result.valid, true, JSON.stringify(result.errors));
  const { graph, authoredIds } = result;
  const positions = layoutGraph(graph);
  const timeline = compileTimeline(graph, 24);
  const style = styleForGraph(graph);
  const state = (frame) => directorFrameAt(graph, positions, frame, 24, { timeline });
  return {
    state,
    tracks: timeline.stages?.timeline ?? timeline,
    frames: frameCount(graph, 24),
    compose: (frame) =>
      composeFrame(state(frame), { graph, positions, style, measure, frame, fps: 24 }),
    events: filmEvents(graph, positions, 24, { timeline, authoredIds }).events.filter(
      (event) => event.type === 'evidence',
    ),
    hidden: hiddenEvidenceCards(timeline, frameCount(graph, 24)),
  };
}

const close = (actual, expected) => assert.ok(Math.abs(actual - expected) < 1e-9);
const citation = sample.rejectedPairs[0].evidence[0].locator;

test('a pair card whose last endpoint reveals too late is hidden and emits no evidence event', () => {
  for (const endpoint of ['wang', 'lu']) {
    const doc = structuredClone(sample);
    Object.assign(doc.presentation[0], {
      transitionMs: 0,
      beats: [{ atSec: 2.8, reveal: { nodeIds: [endpoint] } }],
    });
    const film = movie(doc);
    close(film.tracks.cardShownSec[1], 3.1);
    for (let frame = 0; frame < film.frames; frame++) {
      assert.equal(film.state(frame).evidenceOpacity, 0);
      assert.ok(!texts(film.compose(frame)).join('').includes(citation));
    }
    assert.deepEqual(film.events, []);
    assert.deepEqual(
      film.hidden.map(({ shot, object, target }) => ({ shot, object, target })),
      [{ shot: 0, object: 'pairNote', target: 'wang-lu' }],
    );
  }
});

test('a pair card waits for the later endpoint halfway point in either endpoint order', () => {
  for (const [first, last] of [
    ['wang', 'lu'],
    ['lu', 'wang'],
  ]) {
    const doc = structuredClone(sample);
    Object.assign(doc.presentation[0], {
      durationSec: 4,
      transitionMs: 0,
      beats: [
        { atSec: 1, reveal: { nodeIds: [first] } },
        { atSec: 2, reveal: { nodeIds: [last] } },
      ],
    });
    const film = movie(doc);
    close(film.tracks.cardShownSec[2], 2.3);
    assert.equal(film.state(55).evidenceOpacity, 0);
    assert.ok(film.state(56).evidenceOpacity > 0);
    const visible = texts(film.compose(56)).join('');
    assert.ok(visible.includes('王勃'));
    assert.ok(visible.includes('卢照邻'));
    assert.ok(visible.includes(citation));
    assert.deepEqual(
      film.events.map(({ sec, frame, target }) => ({ sec, frame, target })),
      [{ sec: 2.3, frame: 56, target: 'wang-lu' }],
    );
    assert.deepEqual(film.hidden, []);
  }
});

test('a pair card still waits for a camera transition longer than either endpoint reveal', () => {
  const doc = structuredClone(sample);
  Object.assign(doc.presentation[0], {
    transitionMs: 800,
    beats: [{ atSec: 1, reveal: { nodeIds: ['lu'] } }],
  });
  const film = movie(doc);
  close(film.tracks.cardShownSec[1], 1.8);
  assert.equal(film.state(43).evidenceOpacity, 0);
  assert.ok(film.state(44).evidenceOpacity > 0);
  assert.deepEqual(
    film.events.map(({ sec, frame }) => ({ sec, frame })),
    [{ sec: 1.8, frame: 44 }],
  );
  assert.deepEqual(film.hidden, []);
});

test('frame-zero endpoint reveals delay a pair card without delaying an already visible pair', () => {
  const doc = structuredClone(sample);
  const plain = movie(doc);
  assert.equal(plain.tracks.cardShownSec[0], 0);
  assert.ok(plain.state(1).evidenceOpacity > 0);
  doc.presentation[0].beats = [{ atSec: 0, reveal: { nodeIds: ['wang', 'lu'] } }];
  const film = movie(doc);
  close(film.tracks.cardShownSec[0], 0.3);
  assert.equal(film.state(7).evidenceOpacity, 0);
  assert.ok(film.state(8).evidenceOpacity > 0);
  assert.deepEqual(
    film.events.map(({ sec, frame }) => ({ sec, frame })),
    [{ sec: 0.3, frame: 8 }],
  );
  assert.deepEqual(film.hidden, []);
});

test('pair card timing follows the active endpoint cue after a domain-time withdrawal', () => {
  const doc = structuredClone(sample);
  doc.nodes[1].visibleFrom = 1;
  doc.presentation = [
    { ...doc.presentation[0], id: 'before', durationSec: 1, transitionMs: 0, domainAt: 1 },
    { id: 'hidden', title: 'Earlier', durationSec: 1, transitionMs: 0, domainAt: 0 },
    { ...doc.presentation[0], id: 'after', durationSec: 1, transitionMs: 0, domainAt: 1 },
  ];
  const film = movie(doc);
  assert.equal(film.tracks.cardShownSec[0], 0);
  assert.equal(film.tracks.cardShownSec[1], null);
  close(film.tracks.cardShownSec[2], 2.3);
  assert.equal(film.state(55).evidenceOpacity, 0);
  assert.ok(film.state(56).evidenceOpacity > 0);
  assert.deepEqual(
    film.events.map(({ sec, frame }) => ({ sec, frame })),
    [
      { sec: 0, frame: 1 },
      { sec: 2.3, frame: 56 },
    ],
  );
  assert.deepEqual(film.hidden, []);
});
