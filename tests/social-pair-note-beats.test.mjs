import { test } from 'vitest';
import assert from 'node:assert/strict';
import sample from '../examples/tang-absence.social.json' with { type: 'json' };
import biology from '../examples/biology-signaling-synthetic.json' with { type: 'json' };
import {
  directorFrameAt,
  filmEvents,
  layoutGraph,
  loadDocument,
  validateVisualGraph,
} from '../packages/core/src/index.ts';

const document = (evidence) => {
  const doc = structuredClone(sample);
  delete doc.presentation[0].evidence;
  doc.presentation[0].transitionMs = 0;
  doc.presentation[0].beats = [{ atSec: 0.5, evidence }];
  return doc;
};
const graphOf = (doc) => {
  const loaded = loadDocument(doc);
  assert.equal(loaded.valid, true, JSON.stringify(loaded.errors));
  return loaded.graph;
};
const assertBeatError = (result, prefix) => {
  assert.equal(result.valid, false);
  assert.ok(
    result.errors.some((error) => error.code === 'BEAT' && error.path === prefix + '.evidence'),
    JSON.stringify(result.errors),
  );
};

test('social beats introduce and switch pair-note cards with their selected citations', () => {
  const doc = document({ pairNoteId: 'wang-lu', items: [1, 0] });
  doc.rejectedPairs[0].evidence.push({ cite: 'A second source' });
  doc.rejectedPairs.push({
    ...doc.rejectedPairs[0],
    id: 'other-note',
    reason: 'A separate candidate assessment',
    evidence: [{ cite: 'Another assessment' }],
  });
  doc.nodes[0].evidence = [{ cite: 'Person source' }];
  doc.presentation[0].beats.push(
    { atSec: 1.5, evidence: { pairNoteId: 'other-note' } },
    { atSec: 2.25, evidence: { nodeId: 'wang' } },
  );
  const graph = graphOf(doc),
    positions = layoutGraph(graph),
    frame = (n) => directorFrameAt(graph, positions, n, 24);
  assert.equal(frame(11).evidence, null);
  assert.deepEqual(
    frame(24).evidence.items.map((item) => [item.index, item.cite]),
    [
      [1, 'A second source'],
      [0, sample.rejectedPairs[0].evidence[0].cite],
    ],
  );
  assert.equal(frame(48).evidence.id, 'other-note');
  assert.equal(frame(60).evidence.object, 'node');
  assert.deepEqual(
    filmEvents(graph, positions, 24)
      .events.filter((event) => event.type === 'evidence')
      .map((event) => [event.object, event.target, event.items]),
    [
      ['pairNote', 'wang-lu', [1, 0]],
      ['pairNote', 'other-note', [0]],
      ['node', 'wang', [0]],
    ],
  );
});

test('pair-note beat references use their own namespace and accept authored numeric ids', () => {
  for (const id of ['wang', 7]) {
    const doc = document({ pairNoteId: id, items: [1] });
    doc.rejectedPairs[0].id = id;
    doc.rejectedPairs[0].evidence.push({ cite: 'Pair-specific second source' });
    doc.nodes[0].evidence = [{ cite: 'One person source' }];
    const graph = graphOf(doc);
    assert.deepEqual(graph.scenes[0].beats[0].evidence, { pairNoteId: String(id), items: [1] });
    assert.equal(validateVisualGraph(graph).valid, true);
  }
});

test('source and internal beat validation require exactly one existing evidence target', () => {
  for (const ref of [
    {},
    { pairNoteId: 'missing' },
    { pairNoteId: 'wang' },
    { pairNoteId: null },
    { pairNoteId: 'wang-lu', nodeId: 'wang' },
    { pairNoteId: 'wang-lu', edgeId: 'missing' },
    { pairNoteId: 'wang-lu', nodeId: 'wang', edgeId: 'missing' },
    { nodeId: 'wang', edgeId: 'missing' },
  ]) {
    assertBeatError(loadDocument(document(ref)), 'presentation[0].beats[0]');
    const graph = graphOf(sample);
    graph.scenes[0].beats = [{ atSec: 0.5, evidence: ref }];
    assertBeatError(validateVisualGraph(graph), 'scenes[0].beats[0]');
  }
});

test('pair-note citation indices reject empty, duplicate and invalid selections in both validators', () => {
  for (const items of [[], [1], [-1], [0.5], [0, 0], ['0'], null, {}]) {
    const ref = { pairNoteId: 'wang-lu', items };
    assertBeatError(loadDocument(document(ref)), 'presentation[0].beats[0]');
    const graph = graphOf(sample);
    graph.scenes[0].beats = [{ atSec: 0.5, evidence: ref }];
    assertBeatError(validateVisualGraph(graph), 'scenes[0].beats[0]');
  }
  const graph = graphOf(sample);
  graph.pairNotes[0].evidence = [];
  graph.scenes[0].beats = [{ atSec: 0.5, evidence: { pairNoteId: 'wang-lu' } }];
  assertBeatError(validateVisualGraph(graph), 'scenes[0].beats[0]');
});

test('internal graphs independently accept pair-note beats with ordered citation selection', () => {
  const graph = graphOf(sample);
  graph.pairNotes[0].evidence.push({ cite: 'Second source' });
  graph.scenes[0].beats = [{ atSec: 0.5, evidence: { pairNoteId: 'wang-lu', items: [1, 0] } }];
  assert.deepEqual(validateVisualGraph(graph), { valid: true, errors: [] });
});

test('generic and biology sources report unsupported pair-note references without borrowing edge ids', () => {
  const generic = document({ pairNoteId: 'wang-lu' });
  generic.format = 'relgraph.graph/1';
  generic.edges = [{ id: 'wang-lu', source: 'wang', target: 'lu', evidence: ['Relation source'] }];
  assertBeatError(loadDocument(generic), 'presentation[0].beats[0]');

  const doc = structuredClone(biology);
  doc.interactions.push({
    id: 'known-relation',
    source: 'kinase-k',
    target: 'substrate-s',
    kind: 'physical-association',
    evidenceStatus: 'illustrative',
    evidence: [{ source: 'Example', recordId: 'relation' }],
  });
  doc.presentation[0].beats = [{ atSec: 0.5, evidence: { pairNoteId: 'known-relation' } }];
  assertBeatError(loadDocument(doc), 'presentation[0].beats[0]');
});
