import { test } from 'vitest';
import assert from 'node:assert/strict';
import { loadDocument } from '../packages/core/src/director/load.ts';
import { layoutGraph } from '../packages/core/src/director/layout.ts';
import { directorFrameAt } from '../packages/core/src/director/state.ts';
import { compileTimeline, frameCount } from '../packages/core/src/director/timeline.ts';
import { filmEvents } from '../packages/core/src/director/events.ts';
import { hiddenEvidenceCards } from '../packages/cli/src/evidence.ts';

const document = () => ({
  format: 'relgraph.graph/1',
  nodes: [
    { id: 'a', position: { x: 0, y: 0 }, evidence: ['First source', 'Second source'] },
    { id: 'b', position: { x: 2000, y: 0 }, evidence: ['Other source'] },
  ],
  edges: [{ id: 'ab', source: 'a', target: 'b', evidence: ['Relation source'] }],
  presentation: [
    {
      id: 'card',
      title: 'Continuous evidence',
      durationSec: 4,
      transitionMs: 800,
      camera: { focusNodeId: 'a' },
      evidence: { nodeId: 'a', items: [0] },
    },
  ],
});

function movie(doc) {
  const result = loadDocument(doc);
  assert.equal(result.valid, true, JSON.stringify(result.errors));
  const { graph, authoredIds } = result;
  const positions = layoutGraph(graph);
  const timeline = compileTimeline(graph, 24);
  return {
    frame: (frame) => directorFrameAt(graph, positions, frame, 24, { timeline }),
    events: filmEvents(graph, positions, 24, { timeline, authoredIds }).events.filter(
      (event) => event.type === 'evidence',
    ),
    hidden: hiddenEvidenceCards(timeline, frameCount(graph, 24)),
  };
}

test('highlight-only beats and an explicitly repeated card keep one continuous evidence presentation', () => {
  const doc = document();
  const plain = movie(doc);
  doc.presentation[0].beats = [
    { atSec: 1, highlight: { nodeIds: [] } },
    { atSec: 1.1, highlight: { edgeIds: ['ab'] } },
    { atSec: 1.2, evidence: { nodeId: 'a', items: [0] } },
  ];
  const film = movie(doc);
  for (const frame of [95, 23, 24, 25, 26, 27, 28, 29, 44, 0, 12]) {
    assert.equal(film.frame(frame).evidenceOpacity, plain.frame(frame).evidenceOpacity);
    assert.deepEqual(film.frame(frame).cameraResolved, plain.frame(frame).cameraResolved);
  }
  assert.deepEqual(film.events, plain.events);
  assert.deepEqual(film.hidden, []);
});

test('early and sub-frame beats do not report a card that appears later in the same presentation as hidden', () => {
  const doc = document();
  const plain = movie(doc);
  doc.presentation[0].beats = [
    { atSec: 0.01, highlight: { edgeIds: ['ab'] } },
    { atSec: 0.02, highlight: { edgeIds: [] } },
  ];
  const film = movie(doc);
  assert.deepEqual(film.hidden, []);
  assert.deepEqual(film.events, plain.events);
  for (const frame of [0, 1, 2, 7, 24, 95])
    assert.equal(film.frame(frame).evidenceOpacity, plain.frame(frame).evidenceOpacity);
});

test('an unrelated reveal preserves a focused card, while a fit-all camera still waits for its new framing', () => {
  for (const focus of [true, false]) {
    const doc = document();
    if (!focus) doc.presentation[0].camera = {};
    doc.presentation[0].beats = [{ atSec: 1, reveal: { nodeIds: ['b'] } }];
    const film = movie(doc);
    assert.equal(film.frame(23).view.nodes.length, 1);
    assert.equal(film.frame(24).view.nodes.length, 2);
    assert.equal(film.frame(24).evidenceOpacity, focus ? 1 : 0);
    assert.equal(film.events.length, focus ? 1 : 2);
    assert.ok(film.frame(44).evidenceOpacity > 0);
    assert.deepEqual(film.hidden, []);
    if (focus) assert.deepEqual(film.frame(44).cameraResolved, film.frame(23).cameraResolved);
    else assert.notDeepEqual(film.frame(44).cameraResolved, film.frame(23).cameraResolved);
  }
});

test('a focus highlight that changes framing still delays the card during camera motion', () => {
  const doc = document();
  doc.presentation[0].beats = [{ atSec: 1, highlight: { nodeIds: ['b'] } }];
  const film = movie(doc);
  assert.equal(film.frame(24).evidenceOpacity, 0);
  assert.equal(film.frame(43).evidenceOpacity, 0);
  assert.ok(film.frame(44).evidenceOpacity > 0);
  assert.ok(film.frame(44).cameraResolved.scale < film.frame(23).cameraResolved.scale);
  assert.equal(film.events.length, 2);
  assert.equal(film.events[0].endSec, 1);
  assert.equal(film.events[1].sec, 1.8);
});

test('changing evidence items or switching to a relation starts a new evidence presentation', () => {
  const doc = document();
  doc.presentation[0].beats = [
    { atSec: 1, evidence: { nodeId: 'a', items: [1] } },
    { atSec: 2, evidence: { edgeId: 'ab' } },
  ];
  const film = movie(doc);
  assert.deepEqual(
    film.events.map((event) => [event.target, event.items, event.endSec]),
    [
      ['a', [0], 1],
      ['a', [1], 2],
      ['ab', [0], 4],
    ],
  );
  assert.equal(film.frame(24).evidenceOpacity, 0);
  assert.equal(film.frame(48).evidenceOpacity, 0);
  assert.deepEqual(film.hidden, []);
});

test('a frameless temporary card and camera change does not interrupt the visible card', () => {
  const doc = document();
  const plain = movie(doc);
  doc.presentation[0].beats = [
    { atSec: 1.001, camera: { focusNodeId: 'b' }, evidence: { nodeId: 'b' } },
    { atSec: 1.002, camera: { focusNodeId: 'a' }, evidence: { nodeId: 'a', items: [0] } },
  ];
  const film = movie(doc);
  assert.deepEqual(film.events, plain.events);
  assert.deepEqual(film.hidden, []);
  for (const frame of [24, 25, 26, 44, 95, 23]) {
    assert.equal(film.frame(frame).evidenceOpacity, plain.frame(frame).evidenceOpacity);
    assert.deepEqual(film.frame(frame).cameraResolved, plain.frame(frame).cameraResolved);
  }
});

test('separate authored shots retain their own card entry times', () => {
  const doc = document();
  doc.presentation[0].durationSec = 2;
  doc.presentation.push({ ...doc.presentation[0], id: 'next' });
  doc.presentation[0].beats = [{ atSec: 0.5, highlight: { edgeIds: ['ab'] } }];
  const film = movie(doc);
  assert.equal(film.events.length, 2);
  assert.deepEqual(
    film.events.map((event) => [event.shot, event.sec]),
    [
      [0, 0],
      [1, 2.8],
    ],
  );
  assert.equal(film.frame(48).evidenceOpacity, 0);
  assert.ok(film.frame(69).evidenceOpacity > 0);
  assert.deepEqual(film.hidden, []);
});

test('a trailing frameless unchanged beat preserves the evidence event end time', () => {
  const doc = document();
  const plain = movie(doc);
  doc.presentation[0].beats = [{ atSec: 3.99, highlight: { edgeIds: ['ab'] } }];
  const film = movie(doc);
  assert.deepEqual(film.events, plain.events);
  assert.deepEqual(film.hidden, []);
  doc.presentation[0].beats = [{ atSec: 3.99, evidence: { nodeId: 'b' } }];
  const changed = movie(doc);
  assert.equal(changed.events.length, 1);
  assert.equal(changed.events[0].endSec, 3.99);
  assert.equal(changed.events[0].lastFrame, 95);
});

test('a genuinely unshown card is reported once across its continuous stages', () => {
  const doc = document();
  delete doc.presentation[0].evidence;
  doc.presentation[0].beats = [
    { atSec: 3.8, reveal: { nodeIds: ['a'] }, evidence: { nodeId: 'a' } },
    { atSec: 3.9, highlight: { edgeIds: ['ab'] } },
  ];
  const film = movie(doc);
  assert.deepEqual(film.events, []);
  assert.equal(film.hidden.length, 1);
  assert.equal(film.hidden[0].target, 'a');
});
