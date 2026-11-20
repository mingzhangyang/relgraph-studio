// Omitted-label diagnostics (ADR 004, D1): labels that find no place are
// listed by the composer, counted only while a shot holds, and reported by
// the CLI. Placement itself, and so every pixel, is unchanged.
import { test } from 'vitest';
import assert from 'node:assert/strict';
import { mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import bookshop from '../examples/bookshop-systems-synthetic.graph.json' with { type: 'json' };
import { loadDocument } from '../packages/core/src/director/load.ts';
import { layoutGraph } from '../packages/core/src/director/layout.ts';
import { directorFrameAt, frameCount } from '../packages/core/src/director/state.ts';
import { compileTimeline, shotSettledSec } from '../packages/core/src/director/timeline.ts';
import { styleForGraph } from '../packages/core/src/style.ts';
import { composeFrame } from '../packages/render/src/compose.ts';
import { walkDisplayItems } from '../packages/render/src/display-list.ts';
import { cameraFitFor, FRAME_SPECS } from '../packages/render/src/frame-spec.ts';
import { VIDEO_THEMES } from '../packages/render/src/theme.ts';
import {
  formatOmissions,
  OmissionTally,
  sampleSettledFrames,
  settledFrameRanges,
} from '../packages/cli/src/labels.ts';
import { main } from '../packages/cli/src/index.ts';
import { omittedLabelsText } from '../apps/studio/src/omitted-labels-view.ts';
import { measure } from './helpers/display-list.mjs';
import { flush, makeStudio } from './helpers/studio-harness.mjs';

const spec = FRAME_SPECS['landscape-720p'];

/**
 * Fourteen people in a tight cluster and one far away. The overview fits all
 * fifteen, so the cluster is tiny and most of its names cannot be placed; the
 * second shot frames the cluster alone, where every name fits and the far
 * node is off the stage.
 */
const cluster = Array.from({ length: 14 }, (_, i) => ({
  id: `成员${i}`,
  position: { x: (i % 7) * 30, y: Math.floor(i / 7) * 30 },
}));
const crowded = {
  format: 'relgraph.graph/1',
  nodes: [...cluster, { id: '远方', position: { x: 5000, y: 0 } }],
  edges: [{ source: '成员0', target: '成员1' }],
  presentation: [
    { id: 'all', title: '全部', durationSec: 2 },
    { id: 'near', title: '近处', durationSec: 2, camera: { fitIds: cluster.map((n) => n.id) } },
  ],
};

function frameOf(doc, frame) {
  const result = loadDocument(doc);
  assert.equal(result.valid, true, JSON.stringify(result.errors));
  const { graph } = result;
  const positions = layoutGraph(graph);
  const state = directorFrameAt(graph, positions, frame, spec.fps, { fit: cameraFitFor(spec) });
  return composeFrame(state, {
    graph,
    positions,
    frame,
    fps: spec.fps,
    measure,
    frameSpec: spec,
    theme: VIDEO_THEMES.light,
    style: styleForGraph(graph),
    detailAt: result.detailAt,
  });
}

const drawnTexts = (list) =>
  new Set([...walkDisplayItems(list.items)].filter((i) => i.type === 'text').map((i) => i.text));

test('a label that finds no place is listed, missing from the pixels and kept in a11y', () => {
  const list = frameOf(crowded, 30);
  assert.ok(list.omitted.length >= 3, `expected crowding, got ${list.omitted.length}`);
  const texts = drawnTexts(list);
  for (const label of list.omitted) {
    assert.equal(label.kind, 'node-label');
    assert.match(label.text, /^成员\d+$/);
    assert.equal(texts.has(label.text), false, `${label.text} is not drawn`);
    assert.ok(
      list.a11y.nodes.some((entry) => entry.includes(label.text)),
      label.text,
    );
  }
  // Placed names are not listed.
  for (const text of texts)
    assert.equal(
      list.omitted.some((label) => label.text === text),
      false,
    );
});

test('a node framed out of the stage is not reported, and a roomy shot reports nothing', () => {
  const list = frameOf(crowded, 72);
  assert.deepEqual(list.omitted, []);
  assert.equal(drawnTexts(list).has('远方'), false, 'the far node is off the stage');
});

test('every example frame carries a list, empty where all labels fit', () => {
  const result = loadDocument(bookshop);
  const last = frameCount(result.graph, spec.fps) - 1;
  assert.deepEqual(frameOf(bookshop, last).omitted, []);
});

test('a shot settles when its transition and the reveals under way have finished', () => {
  const doc = structuredClone(crowded);
  doc.presentation[1].transitionMs = 500;
  const timeline = compileTimeline(loadDocument(doc).graph, 24);
  // The first shot has no transition and nothing being revealed.
  assert.deepEqual(shotSettledSec(timeline), [0, 2.5]);

  // A shot whose reveals outlast its camera move settles when they end.
  const timed = {
    format: 'relgraph.graph/1',
    timeline: { unit: '年' },
    nodes: [
      { id: 'a', visibleFrom: 1 },
      { id: 'b', visibleFrom: 2 },
    ],
    edges: [{ source: 'a', target: 'b', visibleFrom: 2 }],
    presentation: [
      { id: 's1', title: '一', durationSec: 3, domainAt: 1 },
      { id: 's2', title: '二', durationSec: 3, domainAt: 2, transitionMs: 200 },
      { id: 's3', title: '三', durationSec: 0.5, domainAt: 2, transitionMs: 1200 },
    ],
  };
  const settled = shotSettledSec(compileTimeline(loadDocument(timed).graph, 24));
  assert.equal(settled[1], 3 + 0.8, 'the edge draw (0.8 s) outlasts the 0.2 s move');
  // A transition longer than its shot never settles: capped at the shot's end.
  assert.equal(settled[2], 6.5);
});

test('the tally counts settled frames only and reports each label once per shot', () => {
  const timeline = compileTimeline(loadDocument(crowded).graph, 24);
  const frames = frameCount(loadDocument(crowded).graph, 24);
  // Shot 2 starts at frame 48 with the default 1.2 s transition: settled from 77.
  assert.deepEqual(settledFrameRanges(timeline, frames), [
    { first: 0, last: 47 },
    { first: 77, last: frames - 1 },
  ]);
  const tally = new OmissionTally(timeline, frames);
  assert.equal(tally.settledShot(60), null, 'mid-transition');
  const a = { kind: 'node-label', id: 'x-a', text: '甲' },
    b = { kind: 'edge-label', id: 'r', text: '同游' };
  tally.add(60, [a]); // ignored: not settled
  tally.add(10, [a]);
  tally.add(12, [a, b]);
  tally.add(11, []);
  tally.add(80, [b]);
  assert.deepEqual(tally.report(), [
    {
      shot: 0,
      shots: 2,
      id: 'all',
      title: '全部',
      checked: 3,
      labels: [
        { ...a, frames: 2, first: 10, last: 12 },
        { ...b, frames: 1, first: 12, last: 12 },
      ],
    },
    {
      shot: 1,
      shots: 2,
      id: 'near',
      title: '近处',
      checked: 1,
      labels: [{ ...b, frames: 1, first: 80, last: 80 }],
    },
  ]);
  const text = formatOmissions(tally.report());
  assert.match(text, /^警告：2 个镜头/);
  assert.match(text, /镜头 1\/2「全部」：甲（2\/3 帧）、关系「同游」（1\/3 帧）\n/);
  assert.match(text, /镜头 2\/2「近处」：关系「同游」\n/);
  assert.equal(formatOmissions([]), '');
  const last = frames - 1;
  assert.deepEqual(sampleSettledFrames(timeline, frames), [
    0,
    23,
    47,
    77,
    Math.floor((77 + last) / 2),
    last,
  ]);
});

test('relgraph check-labels exits 1 with a report, 0 when every label fits', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'relgraph-labels-'));
  const file = join(dir, 'crowded.graph.json');
  writeFileSync(file, JSON.stringify(crowded));
  const run = async (argv) => {
    let stdout = '',
      stderr = '';
    const code = await main(argv, {
      stdout: (text) => (stdout += text),
      stderr: (text) => (stderr += text),
    });
    return { code, stdout, stderr };
  };
  const found = await run(['check-labels', file, '--frame-spec', 'landscape-720p']);
  assert.equal(found.code, 1, found.stderr);
  assert.match(found.stdout, /^检查了 2 个镜头的 6 个稳定帧\n/);
  assert.match(found.stdout, /镜头 1\/2「全部」：成员\d/);
  assert.doesNotMatch(found.stdout, /近处/);

  const json = await run(['check-labels', file, '--json']);
  const summary = JSON.parse(json.stdout);
  assert.equal(summary.shots, 2);
  assert.deepEqual(summary.unsettled, []);
  assert.equal(summary.omittedLabels[0].id, 'all');

  const clean = await run(['check-labels', 'examples/bookshop-systems-synthetic.graph.json']);
  assert.equal(clean.code, 0, clean.stdout + clean.stderr);
  assert.match(clean.stdout, /没有标签被省略。\n$/);
});

test('the studio names the labels the current frame leaves out, and hides the notice otherwise', async () => {
  const fetcher = async () => ({ ok: true, text: async () => JSON.stringify(crowded) });
  const app = makeStudio({ fetcher });
  await app.ready;
  const notice = app.node('omittedLabels');
  assert.equal(app.window.renderAt(30), true);
  assert.equal(notice.hidden, false);
  assert.match(notice.textContent, /^本帧有 \d+ 个标签放不下，未画出：成员\d+/);

  const language = app.node('languageSelect');
  language.value = 'en';
  await language.dispatch('change');
  await flush();
  assert.match(
    notice.textContent,
    /^\d+ labels do not fit in this frame and are not drawn: 成员\d+/,
  );

  assert.equal(app.window.renderAt(72), true);
  assert.equal(notice.hidden, true);
  assert.equal(notice.textContent, '');
});

test('notice wording in both interface languages', () => {
  const node = { kind: 'node-label', id: 'a', text: '严武' },
    edge = { kind: 'edge-label', id: 'r', text: '同游' };
  assert.equal(omittedLabelsText([], 'zh-CN'), '');
  assert.equal(
    omittedLabelsText([node, edge], 'zh-CN'),
    '本帧有 2 个标签放不下，未画出：严武、关系「同游」',
  );
  assert.equal(
    omittedLabelsText([node], 'en'),
    '1 label does not fit in this frame and is not drawn: 严武',
  );
  assert.equal(
    omittedLabelsText([node, edge], 'en'),
    '2 labels do not fit in this frame and are not drawn: 严武, relation “同游”',
  );
});
