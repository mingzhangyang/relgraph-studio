// Evidence as data and evidence cards (ADR 004, D4): the generic format's
// `evidence` on nodes and relations, a shot's `evidence` card, the
// spoiler-safe projection of both, camera framing beside the card, the
// card's composition (verbatim text, no truncation), events, the CLI's
// refusal of a card that does not fit, and the studio's transcript and notice.
import { test } from 'vitest';
import assert from 'node:assert/strict';
import { existsSync, mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import fixture from './fixtures/evidence-cards.graph.json' with { type: 'json' };
import tang64 from '../datasets/tang-poets-met/唐代诗人见面网络_64.graph.json' with { type: 'json' };
import honglou from '../datasets/honglou-chengjia-opening/graph.relgraph.json' with { type: 'json' };
import biology from '../examples/biology-egfr-mapk.json' with { type: 'json' };
import { loadDocument } from '../packages/core/src/director/load.ts';
import { layoutGraph } from '../packages/core/src/director/layout.ts';
import { directorFrameAt, frameCount } from '../packages/core/src/director/state.ts';
import {
  compileTimeline,
  evidenceFrames,
  evidenceOpacity,
  shotStartFrames,
} from '../packages/core/src/director/timeline.ts';
import { filmEvents } from '../packages/core/src/director/events.ts';
import { validateGenericDocument } from '../packages/core/src/domains/generic.ts';
import { validateVisualGraph } from '../packages/core/src/graph/core.ts';
import { styleForGraph } from '../packages/core/src/style.ts';
import { composeFrame, drawingStyle } from '../packages/render/src/compose.ts';
import { evidenceCameraFit } from '../packages/render/src/camera-fit.ts';
import { nodeGlyphBounds } from '../packages/render/src/node-geometry.ts';
import { createHeadlessRenderer } from '../packages/render/src/backends/skia.ts';
import { wrapAllText } from '../packages/render/src/compose/text.ts';
import { walkDisplayItems } from '../packages/render/src/display-list.ts';
import {
  cameraFitFor,
  evidenceCardRegion,
  EVIDENCE_CARD_GAP,
  FRAME_SPECS,
  projectCameraPoint,
} from '../packages/render/src/frame-spec.ts';
import { VIDEO_THEMES } from '../packages/render/src/theme.ts';
import { main } from '../packages/cli/src/index.ts';
import { renderFilm, RenderError } from '../packages/cli/src/render.ts';
import { evidenceCovering, formatEvidenceCovering } from '../packages/cli/src/evidence.ts';
import { evidenceLines, linkableUrl } from '../apps/studio/src/transcript-model.ts';
import {
  evidenceCoversText,
  evidenceOverflowText,
} from '../apps/studio/src/omitted-labels-view.ts';
import { measure } from './helpers/display-list.mjs';
import { makeStudio } from './helpers/studio-harness.mjs';

const spec = FRAME_SPECS['landscape-720p'];
const clone = (value) => JSON.parse(JSON.stringify(value));

/** The film as the renderers frame it: with glyph extents (`evidenceCameraFit`), unless `plainFit`. */
function film(doc, frameSpec = spec, { plainFit = false } = {}) {
  const result = loadDocument(doc);
  assert.equal(result.valid, true, JSON.stringify(result.errors));
  const { graph } = result;
  const positions = layoutGraph(graph);
  const timeline = compileTimeline(graph, frameSpec.fps);
  const fit = plainFit
    ? cameraFitFor(frameSpec)
    : evidenceCameraFit(frameSpec, graph, () =>
        drawingStyle({ graph, positions, style: styleForGraph(graph) }),
      );
  const state = (frame) =>
    directorFrameAt(graph, positions, frame, frameSpec.fps, { fit, timeline });
  const compose = (frame) =>
    composeFrame(state(frame), {
      graph,
      positions,
      frame,
      fps: frameSpec.fps,
      measure,
      frameSpec,
      theme: VIDEO_THEMES.dark,
      style: styleForGraph(graph),
      detailAt: result.detailAt,
    });
  const starts = shotStartFrames(timeline);
  const total = frameCount(graph, frameSpec.fps);
  const lastOf = (i) => (i === starts.length - 1 ? total - 1 : starts[i + 1] - 1);
  return { result, graph, positions, timeline, state, compose, starts, lastOf };
}

const drawnTexts = (list) =>
  [...walkDisplayItems(list.items)].filter((i) => i.type === 'text').map((i) => i.text);
const errorKeys = (doc) =>
  validateGenericDocument(doc).errors.map((e) => (e.variant ? `${e.code}.${e.variant}` : e.code));

test('evidence items are citations or { cite, quote, url, locator } objects', () => {
  const { graph } = film(fixture);
  const e1 = graph.edges.find((edge) => edge.label === undefined && edge.kind === '书信往来');
  assert.deepEqual(e1.evidence, [
    {
      cite: '沈墨《寄顾青书》',
      quote: '春水初生，别来三载，每读君诗，如对故人。',
      locator: '卷一',
    },
    { cite: '顾青《答沈墨》' },
  ]);
  const zhou = graph.nodes.find((node) => node.label === '周寂');
  assert.deepEqual(zhou.evidence, [
    { cite: '《虚构人物志》卷三：生平不详，未见与他人往来的记载。' },
  ]);
  // The Tang files already write citation-only evidence; they stay valid.
  const tang = loadDocument(tang64);
  assert.equal(tang.valid, true, JSON.stringify(tang.errors));
  const cited = tang.graph.edges.filter((edge) => edge.evidence?.length);
  assert.ok(cited.length > 100, `${cited.length} Tang relations carry evidence`);
  assert.ok(cited.every((edge) => edge.evidence.every((item) => item.cite && !item.quote)));
});

test('invalid evidence and evidence cards are diagnosed', () => {
  const base = (patch) => ({ ...clone(fixture), ...patch });
  const withEdge = (evidence) => {
    const doc = clone(fixture);
    doc.edges[0].evidence = evidence;
    return doc;
  };
  assert.deepEqual(errorKeys(withEdge('一封信')), ['EVIDENCE.type']);
  assert.deepEqual(errorKeys(withEdge([''])), ['EVIDENCE.item']);
  assert.deepEqual(errorKeys(withEdge([{ quote: '没有出处的引文' }])), ['EVIDENCE.item']);
  assert.deepEqual(errorKeys(withEdge([{ cite: '某书', quote: 42 }])), ['EVIDENCE.item']);
  assert.deepEqual(errorKeys(withEdge([{ cite: 'x'.repeat(2001) }])), ['EVIDENCE.item']);

  const shot = (evidence, extra = {}) =>
    base({ presentation: [{ id: 's', title: 's', domainAt: 3, evidence, ...extra }] });
  assert.deepEqual(errorKeys(shot({})), ['SCENE_EVIDENCE.target']);
  assert.deepEqual(errorKeys(shot({ edgeId: 'e1', nodeId: '甲' })), ['SCENE_EVIDENCE.target']);
  assert.deepEqual(errorKeys(shot({ edgeId: 'nope' })), ['SCENE_REF']);
  assert.deepEqual(errorKeys(shot({ edgeId: 'e3' })), ['SCENE_EVIDENCE.empty']);
  assert.deepEqual(errorKeys(shot({ edgeId: 'e1', items: [2] })), ['SCENE_EVIDENCE.items']);
  assert.deepEqual(errorKeys(shot({ edgeId: 'e1', items: [0, 0] })), ['SCENE_EVIDENCE.items']);
  assert.deepEqual(errorKeys(shot({ edgeId: 'e1', items: [] })), ['SCENE_EVIDENCE.items']);
  assert.deepEqual(errorKeys(shot({ edgeId: 'e1' }, { openDetailNodeId: '甲' })), [
    'SCENE_EVIDENCE.card',
  ]);
  assert.deepEqual(errorKeys(shot({ edgeId: 'e1', items: [1, 0] })), []);
  // The kernel checks the same rules for every adapter.
  const { graph } = film(fixture);
  const broken = clone(graph);
  broken.scenes[1].evidence = { edgeId: broken.scenes[1].evidence.edgeId, items: [5] };
  broken.nodes[0].evidence = [{ locator: 'p. 3' }];
  assert.deepEqual(
    validateVisualGraph(broken)
      .errors.map((e) => e.code)
      .sort(),
    ['EVIDENCE', 'SCENE_EVIDENCE'],
  );
});

test('a card is projected with its shot: its object is highlighted, a hidden one redacts the shot', () => {
  const { timeline, graph } = film(fixture);
  const [, letters, trip, alone] = timeline.shots;
  assert.equal(letters.evidence.object, 'edge');
  assert.deepEqual(
    letters.evidence.items.map((item) => item.index),
    [0, 1],
  );
  assert.ok(letters.scene.highlight.edgeIds.includes(letters.evidence.id));
  assert.deepEqual(
    trip.evidence.items.map((item) => item.index),
    [0],
  );
  assert.equal(alone.evidence.object, 'node');
  assert.ok(alone.scene.highlight.nodeIds.includes(alone.evidence.id));

  // A card for a relation that is not visible yet withholds the card and the
  // shot's prose, like any other reference to a hidden object.
  const early = clone(fixture);
  early.presentation[1].domainAt = 0;
  early.presentation[0].domainAt = 0;
  const hidden = film(early).timeline.shots[1];
  assert.equal(hidden.evidence, null);
  assert.equal(hidden.scene.redacted, true);
  assert.equal(hidden.scene.narration, undefined);
  assert.equal(graph.scenes[1].evidence.edgeId, letters.evidence.id);
});

test('dated evidence (a literary quotation) is never shown before its time', () => {
  const graph = {
    domain: 'literature',
    meta: { title: 't' },
    timeline: { unit: '回' },
    groups: [],
    nodes: [
      { id: 'a', label: 'A', kind: 'person' },
      { id: 'b', label: 'B', kind: 'person' },
    ],
    edges: [
      {
        id: 'r',
        source: 'a',
        target: 'b',
        kind: 'family',
        evidence: [{ quote: '第一回的话' }, { quote: '第五回的话', from: 5 }],
      },
    ],
    scenes: [
      { id: 'one', title: '一', durationSec: 2, domainAt: 1, evidence: { edgeId: 'r' } },
      {
        id: 'pick',
        title: '二',
        durationSec: 2,
        domainAt: 1,
        evidence: { edgeId: 'r', items: [1] },
      },
      { id: 'five', title: '五', durationSec: 2, domainAt: 5, evidence: { edgeId: 'r' } },
    ],
  };
  assert.equal(validateVisualGraph(graph).valid, true);
  const [one, pick, five] = compileTimeline(graph, 24).shots;
  assert.deepEqual(
    one.evidence.items.map((item) => item.quote),
    ['第一回的话'],
  );
  assert.equal(pick.evidence, null);
  assert.equal(pick.scene.redacted, true);
  assert.deepEqual(
    five.evidence.items.map((item) => item.index),
    [0, 1],
  );
});

test('literary and biology evidence map to the neutral shape', () => {
  const lit = loadDocument(honglou);
  assert.equal(lit.valid, true, JSON.stringify(lit.errors));
  const quoted = lit.graph.edges.find((edge) => edge.evidence?.length);
  assert.ok(quoted.evidence.every((item) => item.quote && item.from >= 1 && !item.cite));
  const bio = loadDocument(biology);
  const cited = bio.graph.edges.find((edge) => edge.evidence?.length);
  assert.deepEqual(Object.keys(cited.evidence[0]).sort(), ['cite', 'locator']);
  assert.ok(bio.graph.nodes.some((node) => node.id.startsWith('bio:process:') && node.evidence));
});

test('the camera frames a card shot into the area the card leaves free', () => {
  for (const frameSpec of [spec, FRAME_SPECS['landscape-1080p']]) {
    const { state, starts, lastOf, positions, timeline } = film(fixture, frameSpec);
    const card = evidenceCardRegion(frameSpec);
    const limit = card.x - EVIDENCE_CARD_GAP * frameSpec.typeScale;
    assert.ok(limit > frameSpec.safe.graph.x);
    for (const index of [1, 2, 3]) {
      const shot = timeline.shots[index];
      const ends =
        shot.evidence.object === 'node'
          ? [shot.evidence.id]
          : (({ source, target }) => [source, target])(
              shot.view.edges.find((edge) => edge.id === shot.evidence.id),
            );
      // From the end of the camera move to the end of the shot.
      for (const frame of [starts[index] + 30, lastOf(index)]) {
        const camera = state(frame).cameraResolved;
        for (const id of ends) {
          const p = projectCameraPoint(positions.get(id), camera, frameSpec);
          assert.ok(p.x < limit - 20 * frameSpec.typeScale, `shot ${index} node ${id} at ${p.x}`);
          assert.ok(p.x > frameSpec.safe.graph.x - 1, `shot ${index} node ${id} at ${p.x}`);
          assert.ok(
            p.y > frameSpec.safe.graph.y && p.y < frameSpec.safe.graph.y + frameSpec.safe.graph.h,
          );
        }
      }
    }
  }
  // Shots without a card keep the full area: the plain fit is unchanged.
  const fit = cameraFitFor(spec);
  assert.deepEqual(
    { halfWidth: fit.halfWidth, halfHeight: fit.halfHeight },
    { halfWidth: 550, halfHeight: 195 },
  );
  assert.deepEqual(fit.card, { halfWidth: 360, halfHeight: 195, offsetX: -190, offsetY: 0 });
});

test('the card shows each quotation verbatim with its citation, and the same text in a11y', () => {
  const { compose, lastOf } = film(fixture);
  const list = compose(lastOf(1));
  const drawn = drawnTexts(list);
  assert.ok(drawn.includes('EVIDENCE'));
  assert.ok(drawn.includes('沈墨 — 顾青'));
  // Quotation lines put back together are the quotation, character for character.
  const quote = '春水初生，别来三载，每读君诗，如对故人。';
  const start = drawn.findIndex((text) => quote.startsWith(text));
  let joined = '';
  for (let i = start; joined.length < quote.length; i++) joined += drawn[i];
  assert.equal(joined, quote);
  assert.ok(drawn.includes('——沈墨《寄顾青书》 · 卷一'));
  assert.ok(drawn.includes('顾青《答沈墨》'));
  assert.deepEqual(list.a11y.evidence, {
    subject: '沈墨 — 顾青',
    items: [{ quote, cite: '沈墨《寄顾青书》', locator: '卷一' }, { cite: '顾青《答沈墨》' }],
  });
  assert.equal(list.evidenceOverflow, null);
  // The card sits in its region, over the graph and inside the stage.
  const region = evidenceCardRegion(spec);
  const plate = [...walkDisplayItems(list.items)].find(
    (item) => item.type === 'path' && item.d[0][0] === 'RR' && item.d[0][1] === region.x,
  );
  assert.ok(plate, 'card plate drawn at the card region');
  assert.ok(plate.d[0][4] <= region.h);
  // Shots without a card draw none and describe none.
  const plain = compose(lastOf(0));
  assert.equal(plain.a11y.evidence, null);
  assert.ok(!drawnTexts(plain).includes('EVIDENCE'));
});

test('the card fades in with the caption and waits for its relation to be half drawn', () => {
  const { compose, starts, lastOf } = film(fixture);
  // Shot 3 reveals its relation at its start (domain time 2).
  const first = compose(starts[2]);
  assert.ok(!drawnTexts(first).includes('EVIDENCE'));
  assert.ok(first.a11y.evidence, 'accessible from the start of the shot');
  const settled = compose(lastOf(2));
  assert.ok(drawnTexts(settled).includes('EVIDENCE'));
});

test('a card that does not fit is not drawn and is reported, never cut', () => {
  const doc = clone(fixture);
  const long = '长'.repeat(400);
  doc.edges[0].evidence = [
    { cite: '甲书', quote: '短句。' },
    { cite: '乙书', quote: long },
  ];
  const { compose, lastOf } = film(doc);
  const list = compose(lastOf(1));
  assert.equal(list.evidenceOverflow.item, 1);
  assert.equal(list.evidenceOverflow.object, 'edge');
  assert.ok(list.evidenceOverflow.needed > list.evidenceOverflow.available);
  const drawn = drawnTexts(list);
  assert.ok(!drawn.includes('EVIDENCE') && !drawn.some((text) => text.includes('长长')));
  assert.ok(!drawn.some((text) => text.includes('…')));
  // Choosing the item that fits is the data owner's remedy.
  doc.presentation[1].evidence.items = [0];
  assert.equal(film(doc).compose(lastOf(1)).evidenceOverflow, null);
});

test('wrapping keeps every character, Latin words whole and closing punctuation off line starts', () => {
  const font = { family: 'serif', size: 10, weight: 400 };
  const width = 10 * 0.55 * 12;
  for (const text of [
    '春水初生，别来三载，每读君诗，如对故人。与顾子同登西岭，风雨大作，宿于寺中。',
    'Letters to Meng Haoran, collected in volume three of the anthology (1704).',
    '王维《送孟六归襄阳》：“杜门不复出，久与世情疏。”',
  ]) {
    const lines = wrapAllText(measure, text, font, width);
    assert.equal(lines.join('').replaceAll(' ', ''), text.replaceAll(' ', ''));
    for (const line of lines) {
      assert.ok(measure(line, font) <= width + 1e-9, line);
      assert.doesNotMatch(line, /^[，。、；：？！）」』》”]/u);
    }
  }
  // Every line of a Latin text holds whole words only.
  const sentence = 'Letters to Meng Haoran, collected';
  const words = new Set(sentence.split(' '));
  for (const line of wrapAllText(measure, sentence, font, width))
    assert.ok(
      line.split(' ').every((word) => words.has(word)),
      line,
    );
  assert.deepEqual(wrapAllText(measure, 'Haoran collected', font, width), ['Haoran', 'collected']);
});

test('the events list each card with its items and the source ids', () => {
  const { graph, positions, result } = film(fixture);
  const events = filmEvents(graph, positions, 24, { authoredIds: result.authoredIds });
  const cards = events.events.filter((event) => event.type === 'evidence');
  assert.deepEqual(
    cards.map(({ shot, id, object, target, items }) => ({ shot, id, object, target, items })),
    [
      { shot: 1, id: 'letters', object: 'edge', target: 'e1', items: [0, 1] },
      { shot: 2, id: 'trip', object: 'edge', target: 'e2', items: [0] },
      { shot: 3, id: 'alone', object: 'node', target: '戊', items: [0] },
    ],
  );
  // Within a frame: shot, domain time, caption, evidence, reveals.
  const atLetters = events.events.filter((event) => event.shot === 1).map((event) => event.type);
  assert.deepEqual(atLetters.slice(0, 2), ['shot', 'caption']);
  assert.equal(atLetters[2], 'evidence');
});

const run = async (argv) => {
  let stdout = '',
    stderr = '';
  const code = await main(argv, {
    stdout: (text) => (stdout += text),
    stderr: (text) => (stderr += text),
  });
  return { code, stdout, stderr };
};

test('relgraph render refuses a card that does not fit before writing; check-labels reports it', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'relgraph-evidence-'));
  const doc = clone(fixture);
  doc.edges[0].evidence = [{ cite: '乙书', quote: '长'.repeat(600) }];
  const file = join(dir, 'overflow.graph.json');
  writeFileSync(file, JSON.stringify(doc));
  await assert.rejects(
    renderFilm({
      file,
      frames: join(dir, 'f', '%04d.png'),
      frameSpec: 'landscape-720p',
      theme: 'dark',
      locale: 'zh-CN',
      jobs: 1,
    }),
    (error) =>
      error instanceof RenderError &&
      /1 张证据卡片放不下/.test(error.message) &&
      /镜头 2\/5「书信为证」：关系 e1 的证据从序号 0 起放不下/.test(error.message),
  );
  assert.equal(existsSync(join(dir, 'f')), false, 'nothing written');

  const report = await run(['check-labels', file, '--frame-spec', 'landscape-720p']);
  assert.equal(report.code, 1);
  assert.match(report.stdout, /错误：1 张证据卡片放不下/);
  const json = JSON.parse((await run(['check-labels', file, '--json'])).stdout);
  assert.deepEqual(
    json.evidenceOverflows.map(({ shot, id, target, object, item }) => ({
      shot,
      id,
      target,
      object,
      item,
    })),
    [{ shot: 1, id: 'letters', target: 'e1', object: 'edge', item: 0 }],
  );

  const fits = join(dir, 'fits.graph.json');
  writeFileSync(fits, JSON.stringify(fixture));
  const clean = await run(['check-labels', fits, '--json']);
  assert.deepEqual(JSON.parse(clean.stdout).evidenceOverflows, []);
});

test('the studio transcript reads the card, and the notice names a card that does not fit', async () => {
  const fetcher = async () => ({ ok: true, text: async () => JSON.stringify(fixture) });
  const app = makeStudio({ fetcher });
  await app.ready;
  assert.equal(app.window.renderAt(230), true);
  const transcript = app.node('transcript').textContent;
  assert.match(transcript, /当前证据：沈墨 — 顾青/);
  assert.match(transcript, /「春水初生，别来三载，每读君诗，如对故人。」——沈墨《寄顾青书》 · 卷一/);
  assert.equal(app.node('omittedLabels').hidden, true);

  assert.deepEqual(evidenceLines(null, 'en'), []);
  assert.deepEqual(
    evidenceLines({ subject: 'A — B', items: [{ quote: 'q', cite: 'c' }, { cite: 'd' }] }, 'en'),
    ['A — B', '“q” — c', 'd'],
  );
  const overflow = { object: 'edge', id: 'r', item: 2, needed: 400, available: 300 };
  assert.equal(evidenceOverflowText(null, 'zh-CN'), '');
  assert.match(evidenceOverflowText(overflow, 'zh-CN'), /证据卡片从证据序号 2 起放不下，未画出/);
  assert.match(evidenceOverflowText(overflow, 'en'), /does not fit from evidence index 2 on/);
});

// Review follow-ups (PR #60).

/** Two pairs far apart: the first shot looks at the left pair, the second opens a card for the right one. */
const pan = {
  format: 'relgraph.graph/1',
  nodes: [
    { id: 'A', position: { x: -900, y: 0 } },
    { id: 'B', position: { x: -800, y: 60 } },
    { id: 'C', position: { x: 800, y: 0 } },
    { id: 'D', position: { x: 900, y: 60 } },
  ],
  edges: [
    { id: 'ab', source: 'A', target: 'B' },
    { id: 'cd', source: 'C', target: 'D', evidence: [{ cite: '某书', quote: '二人同行。' }] },
  ],
  presentation: [
    { id: 'left', title: '左', durationSec: 3, camera: { focusNodeId: 'A' } },
    { id: 'right', title: '右', durationSec: 4, transitionMs: 1200, evidence: { edgeId: 'cd' } },
  ],
};

test('the card waits for the camera: it never covers its relation, even mid-transition', () => {
  for (const frameSpec of [spec, FRAME_SPECS['landscape-1080p']]) {
    const { compose, state, starts, lastOf, positions, timeline } = film(pan, frameSpec);
    const region = evidenceCardRegion(frameSpec);
    const shot = timeline.shots[1];
    const edge = shot.view.edges.find((e) => e.id === shot.evidence.id);
    let covered = 0,
      drawn = 0;
    for (let frame = starts[1]; frame <= lastOf(1); frame++) {
      const camera = state(frame).cameraResolved;
      const xs = [edge.source, edge.target].map(
        (id) => projectCameraPoint(positions.get(id), camera, frameSpec).x,
      );
      const underCard = xs.some((x) => x > region.x - EVIDENCE_CARD_GAP * frameSpec.typeScale);
      const list = compose(frame);
      const shown = drawnTexts(list).includes('EVIDENCE');
      if (underCard) covered++;
      if (shown) drawn++;
      assert.ok(!(shown && underCard), `frame ${frame}: card drawn over its relation`);
    }
    // The pan does pass under the card region, and the card does appear.
    assert.ok(covered > 0 && drawn > 0, `${covered} covered, ${drawn} drawn`);
  }
});

test('a card waits for its relation to be half drawn and its first frame is the evidence event', () => {
  const { graph, positions, compose, timeline, starts, lastOf, result } = film(fixture);
  const events = filmEvents(graph, positions, 24, { authoredIds: result.authoredIds }).events;
  for (const event of events.filter((e) => e.type === 'evidence')) {
    const first = [...Array(lastOf(event.shot) - starts[event.shot] + 1).keys()]
      .map((i) => starts[event.shot] + i)
      .find((frame) => drawnTexts(compose(frame)).includes('EVIDENCE'));
    assert.equal(event.frame, first, `shot ${event.shot}`);
    assert.ok(event.sec > timeline.shots[event.shot].startSec);
  }
});

test('a card its shot ends before showing is reported, never silently dropped', async () => {
  const doc = clone(pan);
  doc.presentation[1].durationSec = 1;
  const result = loadDocument(doc);
  assert.equal(result.valid, true);
  const warning = result.warnings.find((w) => w.code === 'EVIDENCE_CARD_HIDDEN');
  assert.ok(warning, JSON.stringify(result.warnings));
  assert.equal(warning.path, '$.presentation[1].evidence');
  const { graph, positions } = film(doc);
  assert.ok(!filmEvents(graph, positions, 24).events.some((e) => e.type === 'evidence'));

  const dir = mkdtempSync(join(tmpdir(), 'relgraph-hidden-card-'));
  const file = join(dir, 'hidden.graph.json');
  writeFileSync(file, JSON.stringify(doc));
  await assert.rejects(
    renderFilm({
      file,
      frames: join(dir, 'f', '%04d.png'),
      frameSpec: 'landscape-720p',
      theme: 'dark',
      locale: 'zh-CN',
      jobs: 1,
    }),
    (error) =>
      error instanceof RenderError &&
      /1 张证据卡片不会出现/.test(error.message) &&
      /镜头 2\/2「右」：关系 cd 的证据卡片/.test(error.message),
  );
  assert.equal(existsSync(join(dir, 'f')), false);
  const report = await run(['check-labels', file, '--json']);
  assert.equal(report.code, 1);
  assert.deepEqual(
    JSON.parse(report.stdout).hiddenEvidence.map(({ shot, id, target }) => ({ shot, id, target })),
    [{ shot: 1, id: 'right', target: 'cd' }],
  );
  // The pan itself, with its 4-second shot, shows its card.
  assert.deepEqual(loadDocument(pan).warnings, []);
});

test('a long subject wraps in full and counts towards the fit', () => {
  const name =
    '一位名字非常非常长、需要两行以上才能写完的虚构人物，其全名在此完整列出以便区分同名者';
  const doc = clone(fixture);
  doc.nodes.find((node) => node.id === '戊').label = name;
  const { compose, lastOf } = film(doc);
  const list = compose(lastOf(3));
  const drawn = drawnTexts(list);
  assert.equal(list.evidenceOverflow, null);
  const start = drawn.findIndex((text) => name.startsWith(text) && text.length > 1);
  let joined = '';
  for (let i = start; joined.length < name.length; i++) joined += drawn[i];
  assert.equal(joined, name);
  assert.ok(!drawn.some((text) => text.includes('…')));
  assert.equal(list.a11y.evidence.subject, name);
  // A subject that leaves no room for the items overflows instead of being cut.
  doc.nodes.find((node) => node.id === '戊').label = '名'.repeat(400);
  const crowded = film(doc).compose(lastOf(3));
  assert.equal(crowded.evidenceOverflow?.item, 0);
  assert.ok(!drawnTexts(crowded).includes('EVIDENCE'));
});

test('source addresses reach the accessible text and the transcript, as links only for http(s)', async () => {
  const evidence = {
    subject: '顾青 — 陆远',
    items: [
      { quote: '与顾子同登西岭。', cite: '陆远《山行记》', url: 'https://example.org/shanxing' },
      { cite: '某书', url: 'javascript:alert(1)' },
    ],
  };
  assert.deepEqual(evidenceLines(evidence, 'zh-CN'), [
    '顾青 — 陆远',
    '「与顾子同登西岭。」——陆远《山行记》 https://example.org/shanxing',
    '某书 javascript:alert(1)',
  ]);
  assert.equal(linkableUrl('https://example.org/shanxing'), 'https://example.org/shanxing');
  assert.equal(linkableUrl('javascript:alert(1)'), null);
  assert.equal(linkableUrl('not a url'), null);

  const fetcher = async () => ({ ok: true, text: async () => JSON.stringify(fixture) });
  const app = makeStudio({ fetcher });
  await app.ready;
  const { lastOf } = film(fixture);
  assert.equal(app.window.renderAt(lastOf(2)), true);
  const transcript = app.node('transcript');
  assert.match(transcript.textContent, /陆远《山行记》 https:\/\/example\.org\/shanxing/);
  const links = [];
  const walk = (node) => {
    if (node?.tagName === 'A') links.push(node);
    for (const child of node?.children ?? []) walk(child);
  };
  walk(transcript);
  assert.deepEqual(
    links.map((a) => [a.getAttribute('href'), a.getAttribute('rel'), a.textContent]),
    [['https://example.org/shanxing', 'noopener noreferrer', 'https://example.org/shanxing']],
  );
  assert.match(app.node('sceneDescription').textContent, /https:\/\/example\.org\/shanxing/);
});

test('biology entity evidence is validated and mapped, without an evidence status', () => {
  const doc = clone(biology);
  const entity = doc.entities[0];
  entity.evidence = [{ source: 'UniProt', recordId: 'P00533' }];
  const result = loadDocument(doc);
  assert.equal(result.valid, true, JSON.stringify(result.errors));
  assert.deepEqual(result.graph.nodes.find((node) => node.id === entity.id).evidence, [
    { cite: 'UniProt', locator: 'P00533' },
  ]);
  entity.evidence = [{ source: 'UniProt' }];
  const invalid = loadDocument(doc);
  assert.equal(invalid.valid, false);
  assert.ok(
    invalid.errors.some((e) => e.code === 'EVIDENCE_REF' && e.path === 'entities[0].evidence[0]'),
  );
});

test('an authored zoom never pushes the card relation under the card (review: zoom 2)', () => {
  const zoomed = clone(pan);
  zoomed.presentation[1].camera = { zoom: 2 };
  for (const frameSpec of [spec, FRAME_SPECS['landscape-1080p']]) {
    const { compose, state, starts, lastOf, positions, timeline, graph } = film(zoomed, frameSpec);
    const free = evidenceCardRegion(frameSpec).x - EVIDENCE_CARD_GAP * frameSpec.typeScale;
    const edge = timeline.shots[1].view.edges.find((e) => e.id === 'cd');
    const xs = (frame) =>
      [edge.source, edge.target].map(
        (id) => projectCameraPoint(positions.get(id), state(frame).cameraResolved, frameSpec).x,
      );
    // Settled: both ends' drawn outlines inside the free area.
    const style = drawingStyle({ graph, positions, style: styleForGraph(graph) });
    const settled = state(lastOf(1)).cameraResolved;
    for (const id of [edge.source, edge.target]) {
      const node = graph.nodes.find((n) => n.id === id);
      const p = projectCameraPoint(positions.get(id), settled, frameSpec);
      const box = nodeGlyphBounds(node, p, settled.scale, frameSpec, style, 1, graph.project);
      assert.ok(box.x + box.w <= free, `${id} reaches ${box.x + box.w}`);
    }
    // And on every frame the card is drawn.
    for (let frame = starts[1]; frame <= lastOf(1); frame++)
      if (drawnTexts(compose(frame)).includes('EVIDENCE'))
        for (const x of xs(frame)) assert.ok(x < free, `frame ${frame}: x ${x}`);
    // The zoom still counts as far as the card allows.
    const plain = film(pan, frameSpec).state(lastOf(1)).cameraResolved.scale;
    assert.ok(state(lastOf(1)).cameraResolved.scale > plain);
  }
});

test('card start times are compiled once; a frame only looks them up (review: per-frame cost)', () => {
  // A card-heavy film: 300 card shots over 600 timed relations.
  const nodes = Array.from({ length: 601 }, (_, i) => ({
    id: `n${i}`,
    position: { x: i * 40, y: (i % 7) * 30 },
  }));
  const edges = Array.from({ length: 600 }, (_, i) => ({
    id: `e${i}`,
    source: `n${i}`,
    target: `n${i + 1}`,
    visibleFrom: i,
    evidence: ['某书'],
  }));
  const presentation = Array.from({ length: 300 }, (_, i) => ({
    id: `s${i}`,
    title: `${i}`,
    durationSec: 3,
    domainAt: 2 * i,
    evidence: { edgeId: `e${2 * i}` },
  }));
  const { timeline, graph } = film({ format: 'relgraph.graph/1', nodes, edges, presentation });
  assert.equal(timeline.cardShownSec.length, 300);
  assert.ok(timeline.cardShownSec.every((sec, i) => sec >= timeline.shots[i].startSec));
  // Opacity and the card frames read the compiled start times, never the cues.
  const lookupOnly = {
    ...timeline,
    get reveal() {
      throw new Error('reveal cues scanned per frame');
    },
  };
  for (let i = 0; i < timeline.shots.length; i++)
    evidenceOpacity(lookupOnly, i, timeline.shots[i].endSec - 0.5);
  assert.equal(evidenceFrames(lookupOnly, frameCount(graph, 24)).length, 300);
});

/** The review's case: a wide flowchart box at a card end, with zoom 2 (PR #60, third review). */
const wide = clone(pan);
wide.diagram = 'flowchart';
wide.nodes.find((node) => node.id === 'D').label = 'MMMMMMMMMMMMMM';
wide.presentation[1].camera = { zoom: 2 };
// A long quotation makes the card tall enough to reach the ends' height.
wide.edges.find((edge) => edge.id === 'cd').evidence = [
  { cite: '某书', quote: '二人同行，自西岭至东湖，往返三日，途中唱和诗十余首。'.repeat(4) },
];

test('the card frames its ends clear by their drawn outlines: a wide flowchart box with zoom 2', () => {
  for (const frameSpec of [spec, FRAME_SPECS['landscape-1080p']]) {
    const { compose, state, starts, lastOf, positions, timeline, graph } = film(wide, frameSpec);
    const style = drawingStyle({ graph, positions, style: styleForGraph(graph) });
    const edge = timeline.shots[1].view.edges.find((e) => e.id === 'cd');
    const ends = [edge.source, edge.target].map((id) => graph.nodes.find((n) => n.id === id));
    const d = ends.find((node) => node.label === 'MMMMMMMMMMMMMM');
    let drawn = 0;
    for (let frame = starts[1]; frame <= lastOf(1); frame++) {
      const list = compose(frame);
      if (!drawnTexts(list).includes('EVIDENCE')) continue;
      drawn++;
      const plate = [...walkDisplayItems(list.items)].find(
        (item) =>
          item.type === 'path' &&
          item.d[0][0] === 'RR' &&
          item.d[0][1] === evidenceCardRegion(frameSpec).x,
      );
      const card = { x: plate.d[0][1], y: plate.d[0][2], w: plate.d[0][3], h: plate.d[0][4] };
      const camera = state(frame).cameraResolved;
      for (const node of ends) {
        const box = nodeGlyphBounds(
          node,
          projectCameraPoint(positions.get(node.id), camera, frameSpec),
          camera.scale,
          frameSpec,
          style,
          1,
          graph.project,
        );
        assert.ok(
          box.x + box.w < card.x,
          `frame ${frame}: ${node.label} reaches ${box.x + box.w}, card at ${card.x}`,
        );
      }
      assert.equal(list.evidenceCovers, null);
    }
    assert.ok(drawn > 0, 'the card is shown');
    // The box really is wide: far more than the old 40-pixel allowance.
    const settled = state(lastOf(1)).cameraResolved;
    const dBox = nodeGlyphBounds(
      d,
      { x: 0, y: 0 },
      settled.scale,
      frameSpec,
      style,
      1,
      graph.project,
    );
    assert.ok(dBox.w / 2 / frameSpec.typeScale > 70);
  }
});

test('the native renderer frames with glyph extents too', () => {
  const { lastOf } = film(wide);
  const result = loadDocument(wide);
  const renderer = createHeadlessRenderer(result.graph, layoutGraph(result.graph), {
    frameSpec: 'landscape-720p',
    detailAt: result.detailAt,
  });
  const list = renderer.displayListAt(lastOf(1));
  assert.ok(drawnTexts(list).includes('EVIDENCE'));
  assert.equal(list.evidenceCovers, null);
  const cardX = evidenceCardRegion(spec).x;
  for (const entry of list.selection.filter((e) => e.kind === 'node' && e.box))
    if (['C', 'D'].includes(result.graph.nodes.find((n) => n.id === entry.id)?.label))
      assert.ok(
        entry.box.x + entry.box.w < cardX,
        `${entry.id} reaches ${entry.box.x + entry.box.w}`,
      );
});

test('a card that would still cover its own end is withheld and reported, never drawn over it', () => {
  // A caller that frames without glyph extents keeps only the 40-pixel
  // allowance: the wide box then reaches under the card, which the composer
  // catches.
  const { compose, lastOf, result } = film(wide, spec, { plainFit: true });
  const list = compose(lastOf(1));
  assert.ok(!drawnTexts(list).includes('EVIDENCE'));
  const d = result.graph.nodes.find((node) => node.label === 'MMMMMMMMMMMMMM');
  assert.deepEqual(list.evidenceCovers, { object: 'edge', id: 'cd', node: d.id });
  assert.ok(list.a11y.evidence, 'the card text stays accessible');

  const { timeline, graph } = film(wide);
  const report = evidenceCovering(
    timeline,
    frameCount(graph, 24),
    () => ({ evidenceCovers: list.evidenceCovers }),
    (kind, id) =>
      kind === 'nodes'
        ? (result.authoredIds.nodes.get(id) ?? id)
        : kind === 'edges'
          ? (result.authoredIds.edges.get(id) ?? id)
          : (result.authoredIds.scenes.get(id) ?? id),
  );
  assert.deepEqual(
    report.map(({ shot, id, target, node }) => ({ shot, id, target, node })),
    [{ shot: 1, id: 'right', target: 'cd', node: 'D' }],
  );
  assert.match(formatEvidenceCovering(report), /镜头 2\/2「右」：关系 cd 的证据卡片会盖住节点 D/);
  assert.equal(evidenceCoversText(null, 'en'), '');
  assert.match(
    evidenceCoversText(list.evidenceCovers, 'zh-CN'),
    /证据卡片会盖住它引证的节点，未画出/,
  );
  assert.match(evidenceCoversText(list.evidenceCovers, 'en'), /would cover the node it cites/);
});

test('check-labels lists covering cards (none for the review case, framed by glyph extents)', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'relgraph-wide-card-'));
  const file = join(dir, 'wide.graph.json');
  writeFileSync(file, JSON.stringify(wide));
  const json = JSON.parse((await run(['check-labels', file, '--json'])).stdout);
  assert.deepEqual(json.evidenceCovering, []);
  assert.deepEqual(json.evidenceOverflows, []);
  assert.deepEqual(json.hiddenEvidence, []);
});
