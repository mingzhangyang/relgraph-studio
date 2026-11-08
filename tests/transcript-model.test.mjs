import { test } from 'vitest';
import assert from 'node:assert/strict';
import {
  liveFrameDescription,
  sameTranscriptSemantics,
  snapshotTranscriptSemantics,
} from '../apps/studio/src/transcript-model.ts';

const frame = () => ({
  title: 'Film',
  scene: { index: 1, count: 3, title: 'Scene', narration: 'Narration' },
  domainTime: '3',
  detail: null,
  nodes: ['Visible A'],
  relations: ['A interacts with B'],
});

test('semantic equality detects reveals and rewinds independent of animation', () => {
  const initial = frame();
  const previous = snapshotTranscriptSemantics(initial);
  assert.equal(sameTranscriptSemantics(previous, { ...frame(), domainTime: 'other' }), true);
  assert.equal(
    sameTranscriptSemantics(previous, { ...frame(), nodes: ['Visible A', 'Visible B'] }),
    false,
  );
  assert.equal(sameTranscriptSemantics(previous, { ...frame(), relations: [] }), false);
  assert.equal(sameTranscriptSemantics(previous, { ...frame(), nodes: ['Visible B'] }), false);
  assert.equal(
    sameTranscriptSemantics(previous, { ...frame(), detail: { label: 'A', summary: 'Bio' } }),
    false,
  );
  assert.equal(
    sameTranscriptSemantics(previous, {
      ...frame(),
      scene: { ...frame().scene, index: 2 },
    }),
    false,
  );
  const revealed = { ...frame(), nodes: ['Visible A', 'Visible B'] };
  const afterReveal = snapshotTranscriptSemantics(revealed);
  assert.equal(sameTranscriptSemantics(afterReveal, revealed), true);
  assert.equal(sameTranscriptSemantics(afterReveal, initial), false, 'rewinding removes new nodes');
});

test('snapshot clones arrays, scene and detail against in-place renderer mutations', () => {
  const current = { ...frame(), detail: { label: 'A', summary: 'First' } };
  const snapshot = snapshotTranscriptSemantics(current);
  current.scene.title = 'Changed';
  current.nodes.push('Revealed');
  current.relations[0] = 'Different edge';
  current.detail.summary = 'Changed detail';
  assert.deepEqual(snapshot.scene, frame().scene);
  assert.deepEqual(snapshot.nodes, frame().nodes);
  assert.deepEqual(snapshot.relations, frame().relations);
  assert.deepEqual(snapshot.detail, { label: 'A', summary: 'First' });
  assert.equal(sameTranscriptSemantics(snapshot, current), false);
});

test('live text preserves existing wording, using only projected a11y', () => {
  assert.equal(liveFrameDescription(frame()), 'Scene。Narration 当前 1 个节点，1 条关系。');
  assert.equal(
    liveFrameDescription({ ...frame(), detail: { label: 'A', summary: 'Visible summary' } }),
    'Scene。Narration 当前 1 个节点，1 条关系。A：Visible summary',
  );
});
