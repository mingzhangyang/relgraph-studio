import { test } from 'vitest';
import assert from 'node:assert/strict';
import literature from '../examples/honglou-provisional.relgraph.json' with { type: 'json' };
import biology from '../examples/biology-signaling-synthetic.json' with { type: 'json' };
import { validateRelGraph, visibleStory } from '../packages/core/src/relgraph.ts';
import { validateBiologyDocument } from '../packages/core/src/domains/biology.ts';
import { loadDocument, parseDocument } from '../packages/core/src/director/load.ts';
import { frameStateAt } from '../packages/core/src/graph/core.ts';

const fiction = {
  schemaVersion: '0.1',
  meta: { title: 'Fiction' },
  timeline: { unit: 'chapter', total: 10 },
  characters: [
    {
      id: 'a',
      name: 'A',
      importance: 4,
      bio: {
        summary: 'A',
        fate: 'future fate',
        arc: 'future arc',
        quotes: [{ text: 'early', at: 1 }, { text: 'late', at: 8 }, { text: 'untimed' }],
      },
    },
    { id: 'b', name: 'Future B', importance: 2, firstAppearance: 5, bio: { summary: 'B' } },
  ],
  relations: [
    {
      id: 'bond',
      source: 'a',
      target: 'b',
      type: 'family',
      strength: 3,
      chapters: { from: 5 },
      evidence: [
        { text: 'early proof', at: 5 },
        { text: 'late proof', at: 8 },
        { text: 'untimed proof' },
      ],
    },
  ],
  presentation: [
    {
      id: 'intro',
      title: 'Future B appears',
      narration: 'Future B secret',
      durationSec: 1,
      chapterAt: 1,
      camera: { focusNodeId: 'b' },
      highlight: { characterIds: ['b'], relationIds: ['bond'] },
      openBioId: 'b',
    },
    { id: 'reveal', title: 'Reveal', durationSec: 1, chapterAt: 5, openBioId: 'b' },
    { id: 'rewind', title: 'Earlier', durationSec: 1, chapterAt: 1 },
  ],
};

test('both source validators accept examples and reject untrusted structures', () => {
  assert.equal(validateRelGraph(literature).valid, true);
  assert.equal(validateBiologyDocument(biology).valid, true);
  for (const source of [literature, biology])
    assert.equal(parseDocument(JSON.stringify(source)).valid, true);
  for (const value of [
    null,
    [],
    12,
    'text',
    {},
    { schemaVersion: '0.1', meta: null },
    { format: 'relgraph.bio/0.1-draft', meta: {}, entities: [] },
  ]) {
    assert.equal(loadDocument(value).valid, false);
    assert.equal(validateRelGraph(value).valid, false);
    assert.equal(validateBiologyDocument(value).valid, false);
  }
  const invalid = structuredClone(fiction);
  invalid.characters[0].bio.quotes[0].text = 42;
  const result = loadDocument(invalid);
  assert.equal(result.valid, false);
  assert.ok(
    result.errors.some(
      (e) => e.code === 'TYPE' && e.id === 'a' && e.path.endsWith('.bio.quotes[0].text'),
    ),
  );
  assert.equal(parseDocument('{broken').errors[0].code, 'JSON');
  assert.doesNotThrow(() => validateRelGraph({ ...fiction, schemaVersion: 1n }));
});

test('literary source, evidence and frame projection follow domain time without leaking hidden targets', () => {
  const source = structuredClone(fiction);
  const snapshot = structuredClone(source);
  const loaded = loadDocument(source);
  assert.equal(loaded.valid, true, JSON.stringify(loaded.errors));
  const early = frameStateAt(loaded.graph, 0);
  assert.equal(early.playback.domainAt, 1);
  assert.equal(early.playback.scene.redacted, true);
  assert.equal(early.playback.scene.narration, undefined);
  assert.deepEqual(early.highlight.nodeIds, []);
  assert.deepEqual(early.highlight.edgeIds, []);
  assert.equal(early.camera.focusNodeId, undefined);
  assert.equal(early.overlay, null);
  assert.equal(JSON.stringify(early).includes('Future B'), false);
  assert.equal(loaded.detailAt('b', 1), undefined);
  assert.deepEqual(
    loaded.detailAt('a', 1).quotes.map((q) => q.text),
    ['early'],
  );
  assert.equal(loaded.detailAt('a', 1).fate, undefined);
  assert.equal(loaded.detailAt('a', 1).arc, undefined);
  const atFive = visibleStory(source, 5);
  assert.deepEqual(
    atFive.relations[0].evidence.map((q) => q.text),
    ['early proof'],
  );
  assert.deepEqual(
    frameStateAt(loaded.graph, 24).view.nodes.map((n) => n.id),
    ['a', 'b'],
  );
  const rewind = frameStateAt(loaded.graph, 48);
  assert.equal(rewind.playback.domainAt, 1);
  assert.deepEqual(
    rewind.view.nodes.map((n) => n.id),
    ['a'],
  );
  assert.deepEqual(source, snapshot);
});

test('biological process roles, visibility and hidden shot references survive loading', () => {
  const source = structuredClone(biology);
  source.processes[0].reactants[0].stoichiometry = 2;
  source.timeline.privateAnnotation = 'secret timeline metadata';
  source.presentation[0].title = 'Hidden reaction title';
  source.presentation[0].narration = 'Hidden reaction text';
  source.presentation[0].camera = {
    focusNodeId: 'bio:process:phosphorylation-test',
    privateAnnotation: 'secret metadata',
  };
  source.presentation[0].highlight = { nodeIds: ['bio:process:phosphorylation-test'] };
  const loaded = loadDocument(source);
  assert.equal(loaded.valid, true, JSON.stringify(loaded.errors));
  const early = frameStateAt(loaded.graph, 0);
  assert.equal(early.playback.scene.redacted, true);
  assert.equal(JSON.stringify(early).includes('Hidden reaction'), false);
  assert.equal(JSON.stringify(early).includes('secret metadata'), false);
  assert.equal(JSON.stringify(early).includes('secret timeline metadata'), false);
  assert.equal(early.camera.focusNodeId, undefined);
  const process = 'bio:process:phosphorylation-test';
  assert.ok(
    loaded.graph.edges.some(
      (e) => e.kind === 'consumption' && e.target === process && e.label === '2',
    ),
  );
  assert.ok(loaded.graph.edges.some((e) => e.kind === 'production' && e.source === process));
  assert.ok(loaded.graph.edges.some((e) => e.kind === 'catalyst' && e.target === process));
  assert.equal(
    frameStateAt(loaded.graph, 0).view.nodes.some((n) => n.id === process),
    false,
  );
  assert.equal(
    frameStateAt(loaded.graph, 96).view.nodes.some((n) => n.id === process),
    true,
  );
});

test('invalid biological optional values and references produce actionable diagnostics', () => {
  const bad = structuredClone(biology);
  bad.presentation[0].camera.fitIds = [42];
  const result = loadDocument(bad);
  assert.equal(result.valid, false);
  assert.ok(
    result.errors.some(
      (e) =>
        e.code === 'FIELD_TYPE' &&
        e.id === 'intro' &&
        e.path === 'presentation[0].camera.fitIds[0]',
    ),
  );
  const badSource = structuredClone(biology);
  badSource.processes[0].products[0].entityId = 'missing';
  badSource.processes[0].evidenceStatus = 'curated';
  const errors = validateBiologyDocument(badSource).errors;
  assert.ok(errors.some((e) => e.code === 'UNKNOWN_ENTITY' && e.id === 'phosphorylation-test'));
  assert.ok(errors.some((e) => e.code === 'EVIDENCE_REQUIRED' && e.id === 'phosphorylation-test'));
  assert.ok(errors.every((e) => e.path && e.fix));

  const malformed = structuredClone(biology);
  const unusualId = { toString: null, valueOf: null };
  malformed.interactions.push({
    id: unusualId,
    source: unusualId,
    target: 'kinase-k',
    kind: 'activation',
    evidenceStatus: 'hypothesis',
  });
  assert.doesNotThrow(() => validateBiologyDocument(malformed));
  const reported = loadDocument(malformed);
  assert.equal(reported.valid, false);
  assert.ok(reported.errors.every((entry) => typeof entry.id !== 'object'));
});

test('ambiguous generated biological arc aliases cannot silently select the wrong participant', () => {
  const source = structuredClone(biology);
  source.entities.push(
    { id: 'b-input-c', name: 'One', kind: 'protein' },
    { id: 'c', name: 'Two', kind: 'protein' },
  );
  const original = source.processes[0];
  source.processes = [
    { ...structuredClone(original), id: 'a', reactants: [{ entityId: 'b-input-c' }] },
    { ...structuredClone(original), id: 'a-input-b', reactants: [{ entityId: 'c' }] },
  ];
  source.presentation[0].highlight = { edgeIds: ['a-input-b-input-c'] };
  const result = loadDocument(source);
  assert.equal(result.valid, false);
  assert.ok(
    result.errors.some((e) => e.code === 'SCENE_REF' && e.path.endsWith('highlight.edgeIds[0]')),
  );
});
