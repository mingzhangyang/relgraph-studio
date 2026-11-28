// The list form (`config.view.mode: "list"`): the project field, the row
// order core gives the camera, and composed list frames (simulated text
// measurement, no browser): rows in time order, spoiler-safe text, rows
// inside the stage and clear of each other and of the legend, the camera
// scrolling to the framed rows, determinism, and the graph form unchanged.
import { test } from 'vitest';
import assert from 'node:assert/strict';
import dynasties from '../examples/dynasties-timeline-provisional.graph.json' with { type: 'json' };
import quantum from '../datasets/quantum-history/quantum-history.graph.json' with { type: 'json' };
import { loadDocument } from '../packages/core/src/director/load.ts';
import { layoutGraph } from '../packages/core/src/director/layout.ts';
import { directorFrameAt, frameCount } from '../packages/core/src/director/state.ts';
import { compileTimeline, shotStartFrames } from '../packages/core/src/director/timeline.ts';
import {
  LIST_AIM_ROWS,
  LIST_ROW,
  listCamera,
  listOrder,
  listPositions,
  viewMode,
} from '../packages/core/src/director/list-view.ts';
import { createProject, validateProjectConfig } from '../packages/core/src/project.ts';
import { styleForGraph } from '../packages/core/src/style.ts';
import { composeFrame } from '../packages/render/src/compose.ts';
import { listArea, listTimeLabel, relationPhrases } from '../packages/render/src/compose/list.ts';
import { frameContext } from '../packages/render/src/compose/context.ts';
import { cameraFitFor, FRAME_SPECS } from '../packages/render/src/frame-spec.ts';
import { VIDEO_THEMES } from '../packages/render/src/theme.ts';
import { timeAxisWarning } from '../packages/cli/src/render.ts';
import { drawables, measure, readable, texts } from './helpers/display-list.mjs';

const asList = (source, extra = {}) =>
  JSON.parse(JSON.stringify(createProject(source, { view: { mode: 'list', ...extra } })));

/** A small timeline with summaries, relations and a second shot that brings in later nodes. */
const chronicle = {
  format: 'relgraph.graph/1',
  diagram: 'timeline',
  meta: { title: 'Chronicle' },
  timeline: { unit: '年' },
  nodes: [
    { id: '后来者', visibleFrom: 1950, summary: '第二个镜头才出现。' },
    { id: '先驱', visibleFrom: 1900, summary: '最早的一行。' },
    { id: '同年甲', visibleFrom: 1920, summary: '与乙同年，写在前面。' },
    { id: '同年乙', visibleFrom: 1920 },
    { id: '无时间', summary: '没有时间的节点排在最前。' },
  ],
  edges: [
    { source: '先驱', target: '同年甲', label: '启发', visibleFrom: 1920 },
    { source: '同年甲', target: '后来者', label: '影响', visibleFrom: 1950 },
  ],
  presentation: [
    { id: 'a', title: '早期', durationSec: 4, domainAt: 1920, camera: { fitIds: ['先驱'] } },
    {
      id: 'b',
      title: '后来',
      durationSec: 4,
      domainAt: 1950,
      camera: { fitIds: ['后来者'] },
      highlight: { nodeIds: ['后来者'] },
    },
  ],
};

function frameOf(doc, frame, specName = 'portrait-1080x1920', theme = 'light') {
  const result = loadDocument(doc);
  assert.equal(result.valid, true, JSON.stringify(result.errors));
  const { graph } = result;
  const spec = FRAME_SPECS[specName];
  const positions = layoutGraph(graph);
  const at = frame ?? frameCount(graph, spec.fps) - 1;
  const state = directorFrameAt(graph, positions, at, spec.fps, { fit: cameraFitFor(spec) });
  const options = {
    graph,
    positions,
    frame: at,
    fps: spec.fps,
    measure,
    frameSpec: spec,
    theme: VIDEO_THEMES[theme],
    style: styleForGraph(graph),
    detailAt: result.detailAt,
  };
  return { list: composeFrame(state, options), state, options, graph, spec };
}
const middles = (graph, fps) => {
  const starts = shotStartFrames(compileTimeline(graph, fps));
  const total = frameCount(graph, fps);
  return starts.map((start, i) => Math.floor((start + (starts[i + 1] ?? total) - 1) / 2));
};
const overlap = (a, b) => a.x < b.x + b.w && b.x < a.x + a.w && a.y < b.y + b.h && b.y < a.y + a.h;

test('config.view.mode is validated with the rest of config and read from the project only', () => {
  for (const mode of ['graph', 'list'])
    assert.deepEqual(validateProjectConfig({ view: { mode } }), [], mode);
  assert.deepEqual(validateProjectConfig({ view: { mode: 'list', timeAxis: 'vertical' } }), []);
  for (const mode of ['table', true, 1, null])
    assert.ok(validateProjectConfig({ view: { mode } }).includes('config.view.mode'), String(mode));
  assert.equal(viewMode(loadDocument(structuredClone(chronicle)).graph), 'graph');
  const loaded = loadDocument(asList(chronicle));
  assert.equal(loaded.valid, true, JSON.stringify(loaded.errors));
  assert.equal(viewMode(loaded.graph), 'list');
});

test('rows are in time order: untimed first, ties in written order, one LIST_ROW apart', () => {
  const { graph } = loadDocument(structuredClone(chronicle));
  assert.deepEqual(
    listOrder(graph.nodes).map((node) => node.label),
    ['无时间', '先驱', '同年甲', '同年乙', '后来者'],
  );
  const positions = listPositions({ nodes: graph.nodes });
  assert.deepEqual(
    listOrder(graph.nodes).map((node) => positions.get(node.id)),
    [0, 1, 2, 3, 4].map((row) => ({ x: 0, y: row * LIST_ROW })),
  );
  assert.equal(listTimeLabel({ span: { from: 1707, to: 1783 } }), '1707–1783');
  assert.equal(listTimeLabel({ span: { from: 1944 } }), '1944–');
  assert.equal(listTimeLabel({ span: { from: -221, to: -207 } }), '-221 – -207');
  assert.equal(listTimeLabel({ visibility: { from: 1859 } }), '1859');
  assert.equal(listTimeLabel({}), '');
});

test('the list camera aims at the framed rows, never far below the first of them', () => {
  const rows = new Map([0, 1, 2, 3, 20].map((row, i) => [`n${i}`, { x: 0, y: row * LIST_ROW }]));
  assert.equal(listCamera({ nodes: [] }, { fitIds: ['n1', 'n2'] }, rows).y, 1.5 * LIST_ROW);
  assert.equal(
    listCamera({ nodes: [] }, { focusNodeId: 'n4', fitIds: ['n0'] }, rows).y,
    20 * LIST_ROW,
  );
  // A framing taller than a screen aims near where it begins.
  assert.equal(
    listCamera({ nodes: [] }, { fitIds: ['n1', 'n4'] }, rows).y,
    (1 + LIST_AIM_ROWS) * LIST_ROW,
  );
  assert.equal(listCamera({ nodes: [] }, {}, new Map()).y, 0);
});

test('relations are written as phrases from the row they belong to', () => {
  const names = { a: '黎曼', b: '黎曼猜想', c: 'ζ 函数' };
  const edges = [
    { id: 1, source: 'a', target: 'b', kind: 'k', label: '提出' },
    { id: 2, source: 'c', target: 'b', kind: '引出' },
    { id: 3, source: 'b', target: 'b', kind: 'self' },
    { id: 4, source: 'a', target: 'hidden', kind: 'k', label: '写出' },
  ];
  const phrases = (id) =>
    relationPhrases(
      { id },
      edges,
      (other) => names[other],
      (edge) => edge.label,
    );
  assert.deepEqual(phrases('b'), ['黎曼 提出', 'ζ 函数 引出']);
  assert.deepEqual(phrases('a'), ['提出 黎曼猜想'], 'an end outside the view is not named');
});

test('a list frame draws rows in time order, inside the stage, clear of each other and the legend', () => {
  for (const [doc, specs] of [
    [asList(chronicle), ['portrait-1080x1920', 'landscape-1080p', 'square-1080']],
    [asList(dynasties), ['portrait-1080x1920', 'portrait-1080x1440', 'landscape-720p']],
    [asList(quantum), ['portrait-1080x1920', 'landscape-1080p']],
  ])
    for (const specName of specs) {
      const { graph } = loadDocument(doc);
      for (const frame of middles(graph, FRAME_SPECS[specName].fps))
        for (const theme of ['light', 'dark']) {
          const { list, state, options, spec } = frameOf(doc, frame, specName, theme);
          const where = `${graph.meta.title} ${specName} ${theme} frame ${frame}`;
          const area = listArea(frameContext(state, options));
          const rows = list.selection;
          assert.ok(rows.length > 0, where);
          // Only projected nodes have rows, each once.
          const visible = new Set(state.view.nodes.map((node) => node.id));
          assert.ok(
            rows.every((row) => visible.has(row.id)),
            where,
          );
          assert.equal(new Set(rows.map((row) => row.id)).size, rows.length, where);
          // Rows go down in time order and never overlap.
          const order = listOrder(state.view.nodes).map((node) => node.id);
          for (let i = 1; i < rows.length; i++) {
            assert.ok(order.indexOf(rows[i - 1].id) < order.indexOf(rows[i].id), where);
            assert.ok(rows[i - 1].box.y + rows[i - 1].box.h <= rows[i].box.y + 0.01, where);
          }
          // The rows' area is inside the stage and clear of a legend strip.
          const stage = spec.stage;
          assert.ok(area.x >= stage.x && area.x + area.w <= stage.x + stage.w, where);
          assert.ok(area.y >= stage.y && area.y + area.h <= stage.y + stage.h + 0.01, where);
          if (spec.safe.legend) assert.ok(!overlap(area, spec.safe.legend), where);
          // Drawn row text stays inside the frame's width.
          for (const item of drawables(list))
            if (item.type === 'text')
              assert.ok(
                item.x >= 0 &&
                  (item.align === 'right'
                    ? item.x <= spec.width
                    : item.x + measure(item.text, item.font) <= spec.width + 0.5),
                `${where}: ${item.text}`,
              );
          assert.deepEqual(list.omitted, [], where);
        }
    }
});

test('a list names nothing before its time and scrolls to the framed rows', () => {
  const doc = asList(chronicle);
  const { graph } = loadDocument(doc);
  const [early, late] = middles(graph, 24);
  const first = frameOf(doc, early);
  assert.doesNotMatch(readable(first.list), /后来者|第二个镜头才出现|影响/);
  const second = frameOf(doc, late);
  assert.match(texts(second.list).join('\n'), /后来者/);
  assert.match(texts(second.list).join('\n'), /同年甲 影响/, 'the relation is written on its row');
  // The camera's framing is a row: the framed row is on screen in both shots.
  for (const [{ list, state, options }, id] of [
    [first, graph.nodes.find((n) => n.label === '先驱').id],
    [second, graph.nodes.find((n) => n.label === '后来者').id],
  ]) {
    const area = listArea(frameContext(state, options));
    const row = list.selection.find((entry) => entry.id === id);
    assert.ok(row && row.box.y >= area.y - 0.01 && row.box.y + row.box.h <= area.y + area.h + 0.01);
  }
});

test('a long list scrolls: the framed rows of every shot are on screen once settled', () => {
  const doc = asList(quantum);
  const { graph } = loadDocument(doc);
  const spec = FRAME_SPECS['portrait-1080x1920'];
  const timeline = compileTimeline(graph, spec.fps);
  const starts = shotStartFrames(timeline);
  starts.forEach((start, shot) => {
    const end = (starts[shot + 1] ?? frameCount(graph, spec.fps)) - 1;
    const scene = graph.scenes[shot];
    const fit = scene.camera?.fitIds ?? [];
    if (!fit.length || scene.beats?.length) return;
    const { list, state, options } = frameOf(doc, end, spec.name);
    const area = listArea(frameContext(state, options));
    // The first framed row, in reading order, is wholly on screen.
    const order = listOrder(state.view.nodes).map((node) => node.id);
    const first = fit
      .filter((id) => order.includes(id))
      .sort((a, b) => order.indexOf(a) - order.indexOf(b))[0];
    const row = list.selection.find((entry) => entry.id === first);
    assert.ok(row, `${scene.title}: the first framed row is drawn`);
    assert.ok(
      row.box.y >= area.y - 0.01 && row.box.y + row.box.h <= area.y + area.h + 0.01,
      `${scene.title}: the first framed row is on screen`,
    );
  });
});

test('a list frame is a function of its frame, and the graph form is unchanged', () => {
  const doc = asList(dynasties);
  const { graph } = loadDocument(doc);
  const frame = middles(graph, 24)[1];
  assert.deepEqual(frameOf(doc, frame).list, frameOf(doc, frame).list);
  // An explicit graph form composes the film of the plain source.
  const plain = structuredClone(dynasties),
    explicit = JSON.parse(JSON.stringify(createProject(dynasties, { view: { mode: 'graph' } })));
  for (const at of middles(loadDocument(plain).graph, 24)) {
    const a = frameOf(plain, at, 'landscape-720p').list,
      b = frameOf(explicit, at, 'landscape-720p').list;
    assert.deepEqual(drawables(a), drawables(b), `frame ${at}`);
  }
});

test('the portrait time-axis warning is not given for a list, which draws no axis', () => {
  const spec = FRAME_SPECS['portrait-1080x1920'];
  const drawing = loadDocument(structuredClone(dynasties)).graph;
  assert.ok(timeAxisWarning(drawing, layoutGraph(drawing), spec));
  const list = loadDocument(asList(dynasties)).graph;
  assert.equal(timeAxisWarning(list, layoutGraph(list), spec), null);
});
