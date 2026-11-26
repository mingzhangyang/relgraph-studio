// A shot's evidence card in the literary and biology formats (ADR 004, D4
// follow-up): the source field, its diagnostics, the mapping to the neutral
// `VisualScene.evidence`, and the card as the film shows it.
import { test } from 'vitest';
import assert from 'node:assert/strict';
import honglou from '../datasets/honglou-chengjia-opening/graph.relgraph.json' with { type: 'json' };
import biology from '../examples/biology-egfr-mapk.json' with { type: 'json' };
import { loadDocument } from '../packages/core/src/director/load.ts';
import { layoutGraph } from '../packages/core/src/director/layout.ts';
import { directorFrameAt, frameCount } from '../packages/core/src/director/state.ts';
import { compileTimeline, shotStartFrames } from '../packages/core/src/director/timeline.ts';
import { filmEvents } from '../packages/core/src/director/events.ts';
import { validateRelGraph } from '../packages/core/src/relgraph.ts';
import { validateBiologyDocument } from '../packages/core/src/domains/biology.ts';
import { styleForGraph } from '../packages/core/src/style.ts';
import { composeFrame, drawingStyle } from '../packages/render/src/compose.ts';
import { evidenceCameraFit } from '../packages/render/src/camera-fit.ts';
import { walkDisplayItems } from '../packages/render/src/display-list.ts';
import { FRAME_SPECS } from '../packages/render/src/frame-spec.ts';
import { VIDEO_THEMES } from '../packages/render/src/theme.ts';
import { ENGLISH_DIAGNOSTICS } from '../apps/studio/src/diagnostic-text.ts';
import { measure } from './helpers/display-list.mjs';

const spec = FRAME_SPECS['landscape-720p'];
const clone = (value) => JSON.parse(JSON.stringify(value));
const keys = (errors) => errors.map((e) => [e.variant ? `${e.code}.${e.variant}` : e.code, e.path]);

/** The texts drawn on the last frame of shot `index`, and the film's events. */
function cardFrame(doc, index) {
  const result = loadDocument(doc);
  assert.equal(result.valid, true, JSON.stringify(result.errors));
  const { graph } = result;
  const positions = layoutGraph(graph);
  const timeline = compileTimeline(graph, spec.fps);
  const style = styleForGraph(graph);
  const fit = evidenceCameraFit(spec, graph, () => drawingStyle({ graph, positions, style }));
  const starts = shotStartFrames(timeline);
  const frame =
    index === starts.length - 1 ? frameCount(graph, spec.fps) - 1 : starts[index + 1] - 1;
  const list = composeFrame(directorFrameAt(graph, positions, frame, spec.fps, { fit, timeline }), {
    graph,
    positions,
    frame,
    fps: spec.fps,
    measure,
    frameSpec: spec,
    theme: VIDEO_THEMES.dark,
    style,
    detailAt: result.detailAt,
  });
  const texts = [...walkDisplayItems(list.items)]
    .filter((i) => i.type === 'text')
    .map((i) => i.text);
  return {
    result,
    timeline,
    list,
    texts,
    events: filmEvents(graph, positions, spec.fps, { timeline, authoredIds: result.authoredIds })
      .events,
  };
}

// ---------------------------------------------------------------- literature

/** 红楼梦 opening with a card on 林如海—林黛玉 in the chapter-two shot. */
function literary(card) {
  const doc = clone(honglou);
  const shot = doc.presentation.find((s) => s.id === 'qa-chapter-two');
  shot.durationSec = 6;
  shot.evidence = card;
  return { doc, shot, index: doc.presentation.indexOf(shot) };
}

test('a literary shot shows a relation’s quotations on an evidence card', () => {
  const { doc, index } = literary({ edgeId: 'mu-zheng' });
  const quotes = doc.relations.find((r) => r.id === 'mu-zheng').evidence.map((q) => q.text);
  assert.ok(quotes.length >= 2);
  const { result, timeline, texts, events } = cardFrame(doc, index);
  assert.deepEqual(result.graph.scenes[index].evidence, { edgeId: 'mu-zheng' });
  assert.deepEqual(
    timeline.shots[index].evidence.items.map((item) => item.quote),
    quotes,
  );
  assert.ok(texts.includes('EVIDENCE'));
  assert.ok(
    events.some((e) => e.type === 'evidence' && e.target === 'mu-zheng'),
    'the card enters the film events',
  );
  // Picked items are shown in the order the shot lists them.
  const picked = literary({ edgeId: 'mu-zheng', items: [1, 0] });
  const shots = compileTimeline(loadDocument(picked.doc).graph, spec.fps).shots;
  assert.deepEqual(
    shots[picked.index].evidence.items.map((item) => item.quote),
    [quotes[1], quotes[0]],
  );
});

test('literary card indices count quotations as written, though empty ones are not projected', () => {
  const { doc, index } = literary({ edgeId: 'mu-zheng', items: [2] });
  const relation = doc.relations.find((r) => r.id === 'mu-zheng');
  const third = relation.evidence[2].text;
  relation.evidence[0].text = '  ';
  const result = loadDocument(doc);
  assert.equal(result.valid, true, JSON.stringify(result.errors));
  const edge = result.graph.edges.find((e) => e.id === 'mu-zheng');
  assert.equal(edge.evidence.length, relation.evidence.length - 1);
  assert.deepEqual(result.graph.scenes[index].evidence, { edgeId: 'mu-zheng', items: [1] });
  assert.deepEqual(
    compileTimeline(result.graph, spec.fps).shots[index].evidence.items.map((i) => i.quote),
    [third],
  );
  // Naming the empty quotation is an error, at the index the author wrote.
  doc.presentation[index].evidence.items = [0];
  assert.deepEqual(keys(validateRelGraph(doc).errors), [
    ['SCENE_EVIDENCE.items', `presentation[${index}].evidence.items`],
  ]);
});

test('a literary card is withheld before its relation exists (spoiler safety)', () => {
  const doc = clone(honglou);
  const before = doc.presentation.findIndex((s) => s.id === 'qa-before');
  doc.presentation[before].evidence = { edgeId: 'mu-zheng' };
  const result = loadDocument(doc);
  assert.equal(result.valid, true, JSON.stringify(result.errors));
  const shot = compileTimeline(result.graph, spec.fps).shots[before];
  assert.equal(shot.evidence, null);
  assert.equal(shot.scene.redacted, true);
});

test('literary evidence cards are diagnosed', () => {
  const at = (card, patch = {}) => {
    const { doc, shot, index } = literary(card);
    Object.assign(shot, patch);
    return [keys(validateRelGraph(doc).errors), `presentation[${index}].evidence`];
  };
  let [errors, path] = at({ edgeId: 'no-such-relation' });
  assert.deepEqual(errors, [['UNKNOWN_REF', `${path}.edgeId`]]);
  // A relation without quotations, or with only empty ones.
  for (const evidence of [undefined, [{ text: ' ' }]]) {
    const { doc, index } = literary({ edgeId: 'zheng-min' });
    const relation = doc.relations.find((r) => r.id === 'zheng-min');
    if (evidence) relation.evidence = evidence;
    else delete relation.evidence;
    assert.deepEqual(keys(validateRelGraph(doc).errors), [
      ['SCENE_EVIDENCE.empty', `presentation[${index}].evidence`],
    ]);
  }
  for (const items of [[3], [0, 0]]) {
    [errors, path] = at({ edgeId: 'mu-zheng', items });
    assert.deepEqual(errors, [['SCENE_EVIDENCE.items', `${path}.items`]], JSON.stringify(items));
  }
  [errors, path] = at({ edgeId: 'mu-zheng' }, { openBioId: 'lin-daiyu' });
  assert.deepEqual(errors, [['SCENE_EVIDENCE.card', path]]);
  // The schema: one relation, a non-empty list of indices, nothing else.
  [errors, path] = at({ edgeId: 'mu-zheng', items: [] });
  assert.deepEqual(errors, [['ARRAY_SIZE', `$.${path}.items`]]);
  [errors, path] = at({ nodeId: 'lin-daiyu' });
  assert.deepEqual(errors, [
    ['REQUIRED', `$.${path}.edgeId`],
    ['UNKNOWN_FIELD', `$.${path}.nodeId`],
  ]);
  [errors, path] = at({ edgeId: 'mu-zheng', items: [-1] });
  assert.deepEqual(errors, [['MIN', `$.${path}.items[0]`]]);
});

test('the new literary diagnostics are worded in both languages', () => {
  const { doc } = literary({ edgeId: 'mu-zheng', items: [9] });
  const [error] = validateRelGraph(doc).errors;
  assert.match(error.message, /0 to 2/);
  assert.match(error.fix, /items/);
  for (const key of ['SCENE_EVIDENCE.empty', 'SCENE_EVIDENCE.items', 'SCENE_EVIDENCE.card'])
    assert.ok(ENGLISH_DIAGNOSTICS.semantic[key], key);
});

// ------------------------------------------------------------------- biology

function bio(card, shotId = 'ligand-binding') {
  const doc = clone(biology);
  const shot = doc.presentation.find((s) => s.id === shotId);
  shot.durationSec = 6;
  shot.evidence = card;
  return { doc, shot, index: doc.presentation.indexOf(shot) };
}

test('a biology shot shows an interaction’s or a process’s source records', () => {
  const records = (list, id) => list.find((o) => o.id === id).evidence;
  // An interaction, by its id.
  let { doc, index } = bio({ edgeId: 'egf-binds-egfr' });
  let film = cardFrame(doc, index);
  assert.deepEqual(film.result.graph.scenes[index].evidence, { edgeId: 'egf-binds-egfr' });
  assert.deepEqual(
    film.timeline.shots[index].evidence.items.map(({ cite, locator }) => ({ cite, locator })),
    records(biology.interactions, 'egf-binds-egfr').map((ev) => ({
      cite: ev.source,
      locator: ev.recordId,
    })),
  );
  assert.ok(film.texts.includes('EVIDENCE'));
  // A process, by its storyboard alias, with one record picked, once it exists.
  ({ doc, index } = bio({ nodeId: 'process-egfr-activation', items: [1] }, 'receptor-recruitment'));
  film = cardFrame(doc, index);
  assert.deepEqual(film.result.graph.scenes[index].evidence, {
    nodeId: 'bio:process:egfr-activation',
    items: [1],
  });
  assert.deepEqual(
    film.timeline.shots[index].evidence.items.map((item) => item.locator),
    [records(biology.processes, 'egfr-activation')[1].recordId],
  );
  assert.ok(film.texts.includes('EVIDENCE'));
  assert.ok(film.events.some((e) => e.type === 'evidence'));
});

test('biology evidence cards are diagnosed at their source path', () => {
  const at = (card, patch = {}) => {
    const { doc, shot, index } = bio(card);
    Object.assign(shot, patch);
    const result = validateBiologyDocument(doc);
    assert.equal(loadDocument(doc).valid, false);
    return [keys(result.errors), `presentation[${index}].evidence`];
  };
  let [errors, path] = at({ edgeId: 'egf-binds-egfr', nodeId: 'egf' });
  assert.deepEqual(errors, [['SCENE_EVIDENCE', path]]);
  [errors, path] = at({ edgeId: 'no-such-interaction' });
  assert.deepEqual(errors, [['SCENE_EVIDENCE', `${path}.edgeId`]]);
  // An entity without records, and a participant arc, which never has any.
  for (const card of [{ nodeId: 'egf' }, { edgeId: 'egfr-activation-input-egf' }]) {
    [errors, path] = at(card);
    assert.deepEqual(errors, [['SCENE_EVIDENCE', path]], JSON.stringify(card));
  }
  for (const items of [[2], [], [0, 0], 'all']) {
    [errors, path] = at({ edgeId: 'egf-binds-egfr', items });
    assert.deepEqual(errors, [['SCENE_EVIDENCE', `${path}.items`]], JSON.stringify(items));
  }
  [errors, path] = at({ edgeId: 'egf-binds-egfr' }, { openDetailNodeId: 'egf' });
  assert.deepEqual(errors, [['SCENE_EVIDENCE', path]]);
  // Without a card the example stays valid as before.
  assert.equal(validateBiologyDocument(clone(biology)).valid, true);
});
