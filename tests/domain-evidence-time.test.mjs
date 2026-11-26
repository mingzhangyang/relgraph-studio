// A dated quotation is a timed fact even when its relation is always visible.
import { test } from 'vitest';
import assert from 'node:assert/strict';
import honglou from '../datasets/honglou-chengjia-opening/graph.relgraph.json' with { type: 'json' };
import { loadDocument } from '../packages/core/src/director/load.ts';
import { layoutGraph } from '../packages/core/src/director/layout.ts';
import { directorFrameAt } from '../packages/core/src/director/state.ts';
import { compileTimeline, shotStartFrames } from '../packages/core/src/director/timeline.ts';
import { filmEvents } from '../packages/core/src/director/events.ts';

function literary() {
  const doc = structuredClone(honglou);
  const relation = doc.relations.find((r) => r.id === 'mu-zheng');
  doc.characters = doc.characters.filter((c) => [relation.source, relation.target].includes(c.id));
  for (const c of doc.characters) delete c.firstAppearance;
  delete relation.chapters;
  relation.evidence = [
    { text: 'Early quotation', at: 1 },
    { text: 'Future quotation', at: 3 },
    { text: 'Undated quotation' },
  ];
  doc.relations = [relation];
  doc.presentation = [
    { id: 'early', title: 'Early', durationSec: 6, evidence: { edgeId: relation.id } },
    {
      id: 'picked',
      title: 'Picked',
      durationSec: 6,
      evidence: { edgeId: relation.id, items: [0, 1] },
    },
    {
      id: 'late',
      title: 'Late',
      durationSec: 6,
      chapterAt: 3,
      evidence: { edgeId: relation.id, items: [1] },
    },
  ];
  return doc;
}

test('dated literary evidence alone requires an initial chapter', () => {
  const doc = literary();
  const invalid = loadDocument(doc);
  assert.equal(invalid.valid, false);
  assert.deepEqual(
    invalid.errors.map(({ code, path }) => [code, path]),
    [['INITIAL_DOMAIN_TIME', '$.presentation[0].chapterAt']],
  );
  // Without dated evidence, the initial chapter is still optional.
  for (const q of doc.relations[0].evidence) delete q.at;
  assert.equal(loadDocument(doc).valid, true);
});

test('future quotations on always-visible relations are withheld from frames and events', () => {
  const doc = literary();
  doc.presentation[0].chapterAt = 1;
  const result = loadDocument(doc);
  assert.equal(result.valid, true, JSON.stringify(result.errors));
  const { graph } = result;
  assert.ok([...graph.nodes, ...graph.edges].every((item) => !item.visibility));
  const fps = 30;
  const timeline = compileTimeline(graph, fps);
  const positions = layoutGraph(graph);
  const starts = shotStartFrames(timeline);
  const cardAt = (index) =>
    directorFrameAt(graph, positions, starts[index] + 3 * fps, fps, { timeline }).evidence;
  assert.deepEqual(timeline.shots.map((shot) => shot.domainAt), [1, 1, 3]);
  assert.deepEqual(
    cardAt(0).items.map((item) => item.quote),
    ['Early quotation', 'Undated quotation'],
  );
  // Explicitly naming even one future item withholds the whole card.
  assert.equal(timeline.shots[1].scene.redacted, true);
  assert.equal(cardAt(1), null);
  assert.deepEqual(cardAt(2).items.map((item) => item.quote), ['Future quotation']);
  const events = filmEvents(graph, positions, fps, { timeline }).events;
  assert.deepEqual(
    events.filter((event) => event.type === 'evidence').map((event) => [event.shot, event.items]),
    [
      [0, [0, 2]],
      [2, [1]],
    ],
  );
});
