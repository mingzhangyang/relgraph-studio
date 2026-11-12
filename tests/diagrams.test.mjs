import { test } from 'vitest';
import assert from 'node:assert/strict';
import tree from '../examples/vertebrates-tree-provisional.graph.json' with { type: 'json' };
import dynasties from '../examples/dynasties-timeline-provisional.graph.json' with { type: 'json' };
import mindmap from '../examples/reading-club-mindmap-synthetic.graph.json' with { type: 'json' };
import flowchart from '../examples/order-flowchart-synthetic.graph.json' with { type: 'json' };
import { loadDocument } from '../packages/core/src/director/load.ts';
import { DIAGRAM_ENGINE, layoutGraph } from '../packages/core/src/director/layout.ts';
import {
  diagramStructure,
  keepsTime,
  placeInTime,
  runLayoutEngine,
  timeAxis,
} from '../packages/core/src/director/layout-engines.ts';
import {
  computeLayout,
  DEFAULT_LAYOUT_SETTINGS,
} from '../packages/core/src/director/layout-strategies.ts';
import { directorFrameAt, frameCount } from '../packages/core/src/director/state.ts';
import { DIAGRAM_KINDS, styleForGraph, styleForPositions } from '../packages/core/src/style.ts';
import { applyGraphPositions } from '../packages/core/src/director/position-writeback.ts';
import { composeFrame } from '../packages/render/src/compose.ts';
import { cameraFitFor, FRAME_SPECS } from '../packages/render/src/frame-spec.ts';
import {
  estimateTextWidth,
  glyphGeometry,
  insideLabel,
  nodeGlyphContainsPoint,
  nodeGlyphRayDistance,
} from '../packages/render/src/node-geometry.ts';
import { VIDEO_THEMES } from '../packages/render/src/theme.ts';
import { measure, paths, texts } from './helpers/display-list.mjs';

const FORMAT = 'relgraph.graph/1';
const spec = FRAME_SPECS['landscape-720p'];
const load = (doc) => {
  const result = loadDocument(doc);
  assert.equal(result.valid, true, JSON.stringify(result.errors));
  return result;
};
const compose = (result, frame, positions = layoutGraph(result.graph)) => {
  const state = directorFrameAt(result.graph, positions, frame, spec.fps, {
    fit: cameraFitFor(spec),
  });
  return {
    state,
    list: composeFrame(state, {
      graph: result.graph,
      positions,
      frame,
      fps: spec.fps,
      measure,
      frameSpec: spec,
      theme: VIDEO_THEMES.light,
      style: styleForGraph(result.graph),
      detailAt: result.detailAt,
    }),
  };
};
const byLabel = (graph, label) => graph.nodes.find((n) => n.label === label);
const last = (graph) => frameCount(graph) - 1;

test('a diagram is still a graph: the kind only selects conventions', () => {
  assert.deepEqual([...DIAGRAM_KINDS], ['network', 'tree', 'mindmap', 'flowchart', 'timeline']);
  assert.deepEqual(
    { ...DIAGRAM_ENGINE },
    { network: null, tree: 'tree', mindmap: 'mindmap', flowchart: 'flow', timeline: 'timeline' },
  );
  for (const [doc, kind] of [
    [tree, 'tree'],
    [mindmap, 'mindmap'],
    [flowchart, 'flowchart'],
    [dynasties, 'timeline'],
  ]) {
    const { graph } = load(doc);
    assert.equal(graph.diagram, kind);
    assert.equal(graph.domain, 'graph');
    const style = styleForGraph(graph);
    assert.equal(style.routing, 'elbow', kind);
    assert.equal(style.curvature, 0);
    // The same document without the hint is an ordinary network.
    const plain = load({ ...doc, diagram: undefined });
    assert.equal(plain.graph.diagram, undefined);
    assert.equal(styleForGraph(plain.graph).routing, undefined);
  }
  const bad = loadDocument({ format: FORMAT, diagram: 'spiral', nodes: ['a'] });
  assert.equal(bad.valid, false);
  assert.equal(bad.errors[0].path, 'diagram');
});

test('a tree unfolds one level at a time from its root', () => {
  const result = load(tree),
    { graph } = result;
  const levels = diagramStructure(graph, 'tree').level;
  const root = byLabel(graph, 'Vertebrata');
  assert.equal(levels.get(root.id), 0);
  assert.equal(levels.get(byLabel(graph, 'Aves').id), 8);
  // One step per level, each node arriving at its depth, then the whole tree.
  for (const node of graph.nodes) assert.equal(node.visibility.from, levels.get(node.id) + 1);
  for (const edge of graph.edges)
    assert.equal(
      edge.visibility.from,
      Math.max(levels.get(edge.source), levels.get(edge.target)) + 1,
    );
  assert.equal(graph.scenes.length, 10);
  assert.deepEqual(
    graph.scenes.slice(0, 9).map((s) => s.domainAt),
    [1, 2, 3, 4, 5, 6, 7, 8, 9],
  );
  assert.equal(graph.scenes.at(-1).id, 'auto-closing');
  assert.equal(graph.scenes[0].title, 'Vertebrata');
  assert.equal(graph.scenes[1].title, 'Cyclostomata · Gnathostomata', 'siblings in written order');
  assert.deepEqual(
    graph.scenes[4].highlight.nodeIds.map((id) => graph.nodes.find((n) => n.id === id).label),
    ['Actinistia', 'Dipnoi', 'Tetrapoda'],
  );
  assert.equal(graph.scenes[4].narration, '四足动物：登上陆地的一支。');
  // The film shows exactly what has unfolded so far.
  assert.deepEqual(compose(result, 12).list.a11y.nodes, ['Vertebrata']);
  const middle = compose(result, 330).list.a11y.nodes;
  assert.ok(middle.includes('Tetrapoda') && !middle.includes('Amniota'));
  assert.equal(compose(result, last(graph)).list.a11y.nodes.length, graph.nodes.length);
  // Hierarchy speaks from the root; each main branch has its own tone.
  assert.equal(root.importance, 5);
  assert.equal(byLabel(graph, 'Gnathostomata').importance, 4);
  assert.equal(byLabel(graph, 'Aves').importance, 2);
  assert.equal(root.tone, undefined);
  assert.equal(byLabel(graph, 'Cyclostomata').tone, 0);
  for (const label of ['Gnathostomata', 'Tetrapoda', 'Aves'])
    assert.equal(byLabel(graph, label).tone, 1, label);
  // Branches need no arrowheads and take the colour of where they lead.
  const style = styleForGraph(graph);
  assert.equal(style.edges.link.head, 'none');
  assert.equal(style.edgeHue, 'target');
  const frame = compose(result, last(graph)).list;
  assert.ok(
    !paths(frame).some((p) => p.fill && !p.stroke && p.d.length === 5 && p.d[4][0] === 'Z'),
  );
  assert.ok(paths(frame).some((p) => p.stroke === VIDEO_THEMES.light.tones[1] && !p.fill));
});

test('unfolding is a default, not a rule: authors can switch it off or time things themselves', () => {
  const still = load({ ...tree, unfold: false }).graph;
  assert.ok(still.nodes.every((n) => n.visibility === undefined));
  assert.equal(still.scenes[0].id, 'auto-overview');
  assert.equal(byLabel(still, 'Vertebrata').importance, 5, 'the hierarchy remains');
  const authored = load({
    ...tree,
    presentation: [{ title: 'Mine', durationSec: 2 }],
  }).graph;
  assert.equal(authored.scenes.length, 1);
  assert.ok(authored.nodes.every((n) => n.visibility === undefined));
  // Timed facts keep their own time: nothing is re-timed by depth.
  const timed = load({
    format: FORMAT,
    diagram: 'tree',
    timeline: { unit: 'Ma' },
    nodes: [
      { id: 'root', visibleFrom: -500 },
      { id: 'left', visibleFrom: -300 },
      { id: 'right', visibleFrom: -100 },
    ],
    edges: [
      { source: 'root', target: 'left' },
      { source: 'root', target: 'right' },
    ],
  }).graph;
  assert.deepEqual(
    timed.scenes.map((s) => s.domainAt),
    [-500, -300, -100, undefined],
  );
  assert.equal(timed.scenes[1].title, 'Ma -300');
  assert.equal(timed.timeline.unit, 'Ma');
});

test('the tree layout keeps reading order, centres parents and grows to the right', () => {
  const { graph } = load(tree),
    at = layoutGraph(graph);
  const p = (label) => at.get(byLabel(graph, label).id);
  const chain = ['Vertebrata', 'Gnathostomata', 'Osteichthyes', 'Sarcopterygii', 'Tetrapoda'];
  for (let i = 1; i < chain.length; i++) assert.ok(p(chain[i]).x > p(chain[i - 1]).x);
  // Siblings stay in the order they were written, top to bottom.
  assert.ok(p('Actinistia').y < p('Dipnoi').y && p('Dipnoi').y < p('Tetrapoda').y);
  assert.ok(p('Monotremata').y < p('Marsupialia').y && p('Marsupialia').y < p('Placentalia').y);
  // Same depth, same column; a parent sits midway between its outer children.
  assert.equal(p('Crocodylia').x, p('Aves').x);
  assert.ok(Math.abs(p('Archosauria').y - (p('Crocodylia').y + p('Aves').y) / 2) < 0.02);
  assert.ok(Math.abs(p('Mammalia').y - p('Marsupialia').y) < 0.02);
  // No two leaves share a row.
  const leaves = graph.nodes.filter((n) => !graph.edges.some((e) => e.source === n.id));
  assert.equal(new Set(leaves.map((n) => at.get(n.id).y)).size, leaves.length);
  // Reversing the file changes sibling order, by design, but never the shape.
  const reversed = runLayoutEngine(
    { nodes: [...graph.nodes].reverse(), edges: graph.edges },
    'tree',
    { seed: 0, spacing: 150, iterations: 0 },
  );
  assert.equal(
    reversed.get(byLabel(graph, 'Aves').id).x - reversed.get(graph.nodes[0].id).x,
    p('Aves').x - p('Vertebrata').x,
  );
});

test('a mind map grows from its topic to both sides, with words inside every shape', () => {
  const result = load(mindmap),
    { graph } = result,
    at = layoutGraph(graph);
  const p = (label) => at.get(byLabel(graph, label).id);
  const topic = p('读书会');
  // The first branches go right, the rest left, each side in written order.
  for (const right of ['选书', '时间', '地点']) assert.ok(p(right).x > topic.x, right);
  for (const left of ['流程', '记录']) assert.ok(p(left).x < topic.x, left);
  assert.ok(p('选书').y < p('时间').y && p('时间').y < p('地点').y);
  assert.ok(p('流程').y < p('记录').y);
  assert.ok(p('类型').x > p('选书').x && p('开场介绍').x < p('流程').x, 'leaves grow outward');
  // Each main branch carries one tone through all of its nodes.
  assert.equal(byLabel(graph, '读书会').tone, undefined);
  assert.equal(byLabel(graph, '类型').tone, byLabel(graph, '选书').tone);
  assert.equal(
    new Set(['选书', '时间', '地点', '流程', '记录'].map((l) => byLabel(graph, l).tone)).size,
    5,
  );
  const style = styleForGraph(graph);
  assert.equal(style.nodes.node.shape, 'box');
  const { list } = compose(result, last(graph));
  // Every label is drawn once, centred in its own shape, with nothing beside it.
  for (const node of graph.nodes) {
    const drawn =
      [...paths(list), ...list.items].length && texts(list).filter((t) => t === node.label);
    assert.equal(drawn.length, 1, node.label);
  }
  const geometry = glyphGeometry(byLabel(graph, '成员投票'), 1, spec, style);
  assert.deepEqual(geometry.inside.lines, ['成员投票']);
  assert.ok(geometry.halfWidth > geometry.inside.width / 2 + 10);
  // The film opens on the topic alone and unfolds two more levels.
  assert.deepEqual(compose(result, 12).list.a11y.nodes, ['读书会']);
  assert.deepEqual(
    graph.scenes.map((s) => s.domainAt),
    [1, 2, 3, undefined],
  );
});

test('a flowchart reads as a sequence: conventional shapes, labelled branches, loops that return', () => {
  const result = load(flowchart),
    { graph } = result,
    style = styleForGraph(graph),
    at = layoutGraph(graph);
  assert.deepEqual(
    Object.fromEntries(Object.entries(style.nodes).map(([kind, s]) => [kind, s.shape])),
    { 步骤: 'box', 判断: 'decision', 开始: 'capsule', 结束: 'capsule' },
  );
  assert.equal(style.edgeLabels, 'always');
  assert.equal(style.edges.link.head, 'arrow');
  const x = (label) => at.get(byLabel(graph, label).id).x;
  const order = ['开始', '提交订单', '库存充足？', '发起支付', '支付成功？', '安排发货', '结束'];
  for (let i = 1; i < order.length; i++) assert.ok(x(order[i]) > x(order[i - 1]), order[i]);
  // The retry returns to an earlier step instead of folding the loop into one rank.
  const levels = diagramStructure(graph, 'flow').level;
  assert.ok(
    levels.get(byLabel(graph, '支付成功？').id) > levels.get(byLabel(graph, '发起支付').id),
  );
  assert.equal(
    levels.get(byLabel(graph, '通知缺货').id),
    levels.get(byLabel(graph, '发起支付').id),
  );
  const { list } = compose(result, last(graph));
  const drawn = texts(list);
  for (const label of ['是', '否', '否，重试']) assert.ok(drawn.includes(label), label);
  // Each label is drawn in its own shape; 开始 and 结束 also name their kind in the legend.
  for (const node of graph.nodes)
    assert.equal(
      drawn.filter((t) => t === node.label).length,
      node.label === node.kind ? 2 : 1,
      node.label,
    );
  // Elbow links leave level: the first control point shares the start's height.
  const elbows = paths(list).filter(
    (p) => p.stroke && !p.fill && p.d.length === 3 && p.d[1][0] === 'Q' && p.d[2][0] === 'Q',
  );
  assert.ok(elbows.length >= 6);
  for (const p of elbows) assert.ok(Math.abs(p.d[1][2] - p.d[0][2]) < 1e-9);
  // The film walks the process step by step.
  assert.deepEqual(compose(result, 12).list.a11y.nodes, ['开始']);
  assert.equal(graph.scenes.length, 8);
});

test('a timeline puts every span at its place in time, in lanes, under an axis', () => {
  const result = load(dynasties),
    { graph } = result,
    at = layoutGraph(graph),
    axis = timeAxis(graph.nodes);
  assert.deepEqual([axis.from, axis.to], [-221, 1912]);
  const style = styleForGraph(graph);
  assert.deepEqual(style.timeAxis, { from: axis.from, to: axis.to, scale: axis.scale });
  for (const node of graph.nodes) {
    assert.ok(node.span && node.visibility.from === node.span.from);
    assert.equal(node.visibility.to, undefined, 'what has ended stays on screen');
    const centre = (axis.x(node.span.from) + axis.x(node.span.to)) / 2;
    assert.ok(Math.abs(at.get(node.id).x - centre) < 0.01, node.label);
  }
  // Spans that overlap in time never share a lane.
  for (const a of graph.nodes)
    for (const b of graph.nodes)
      if (a.id < b.id && a.span.from < b.span.to && b.span.from < a.span.to)
        assert.notEqual(at.get(a.id).y, at.get(b.id).y, `${a.label} / ${b.label}`);
  // A bar is exactly as long as its years at the current zoom.
  const tang = byLabel(graph, '唐'),
    geometry = glyphGeometry(tang, 0.5, spec, style);
  assert.equal(geometry.shape, 'span');
  assert.ok(Math.abs(geometry.halfWidth * 2 - (907 - 618) * axis.scale * 0.5) < 1e-9);
  // The film travels: one shot per sampled start, then the whole axis.
  assert.equal(graph.scenes[0].domainAt, -221);
  assert.equal(graph.scenes[0].title, '公元 -221');
  assert.equal(graph.scenes.at(-1).id, 'auto-closing');
  assert.ok(
    graph.scenes.some((s) => s.camera?.fitIds?.length > 1),
    'the camera follows the present',
  );
  const end = compose(result, last(graph));
  assert.equal(end.list.a11y.nodes.length, graph.nodes.length);
  const drawn = texts(end.list);
  for (const tick of ['0', '500', '1000', '1500']) assert.ok(drawn.includes(tick), tick);
  assert.ok(drawn.includes('唐') && drawn.includes('秦'));
  // Early in the film the future is absent, and the cursor is drawn.
  const early = compose(result, 12);
  assert.deepEqual(early.list.a11y.nodes, ['秦']);
  assert.ok(!JSON.stringify(early.list).includes('清'));
  assert.ok(
    paths(early.list).some((p) => p.fill === VIDEO_THEMES.light.progress && p.d.length === 4),
  );
});

test('the time axis is drawn only for a drawing that keeps time', () => {
  const result = load(dynasties),
    { graph } = result,
    style = styleForGraph(graph),
    at = layoutGraph(graph),
    ticks = (list) => texts(list).filter((t) => /^-?\d+$/.test(t)),
    cursor = (list) =>
      paths(list).some((p) => p.fill === VIDEO_THEMES.light.progress && p.d.length === 4);
  // The engine puts every dated node at its place, and the place is the axis's own.
  const axis = timeAxis(graph.nodes);
  for (const node of graph.nodes)
    assert.ok(Math.abs(placeInTime(node, axis) - at.get(node.id).x) <= 0.005, node.label);
  assert.equal(keepsTime(graph.nodes, at, style.timeAxis), true);
  assert.equal(styleForPositions(style, graph.nodes, at), style);

  // Written to the file and read back, the drawing is authored and still in time.
  const saved = load(applyGraphPositions(dynasties, graph, at).document);
  assert.ok(saved.graph.nodes.every((n) => n.position));
  const reread = compose(saved, last(saved.graph));
  assert.ok(ticks(reread.list).includes('1000'));
  assert.equal(
    glyphGeometry(byLabel(saved.graph, '唐'), 0.5, spec, styleForGraph(saved.graph)).shape,
    'span',
  );

  // Rearranged by another engine, the same data has no axis to stand on:
  // no rules, no cursor, and a span is a point again, in outline and hit test alike.
  const grid = computeLayout(
    graph,
    { ...DEFAULT_LAYOUT_SETTINGS, type: 'grid', mode: 'rearrange' },
    at,
  );
  assert.equal(keepsTime(graph.nodes, grid, style.timeAxis), false);
  const loose = styleForPositions(style, graph.nodes, grid);
  assert.equal(loose.timeAxis, undefined);
  assert.equal(styleForPositions(style, graph.nodes, grid), loose, 'one style per drawing');
  assert.deepEqual({ ...loose, timeAxis: style.timeAxis }, { ...style });
  for (const frame of [12, last(graph)]) {
    const { list } = compose(result, frame, grid);
    assert.deepEqual(ticks(list), []);
    assert.equal(cursor(list), false);
  }
  assert.equal(cursor(compose(result, 12).list), true);
  assert.equal(glyphGeometry(byLabel(graph, '唐'), 0.5, spec, loose).shape, 'circle');

  // A lane is the author's to choose; a year is not. One node moved along
  // the axis is enough to lose it, however many others still agree.
  const tang = byLabel(graph, '唐').id,
    lane = new Map(at).set(tang, { x: at.get(tang).x, y: at.get(tang).y + 300 }),
    year = new Map(at).set(tang, { x: at.get(tang).x + 40, y: at.get(tang).y });
  assert.equal(keepsTime(graph.nodes, lane, style.timeAxis), true);
  assert.ok(ticks(compose(result, last(graph), lane).list).length > 0);
  assert.equal(keepsTime(graph.nodes, year, style.timeAxis), false);
  assert.deepEqual(ticks(compose(result, last(graph), year).list), []);

  // Partly authored coordinates take the conservative fallback, which is not in time.
  const partly = structuredClone(dynasties);
  partly.nodes[0].position = { x: 0, y: 0 };
  const mixed = load(partly);
  assert.deepEqual(ticks(compose(mixed, last(mixed.graph)).list), []);
  // A node without a time makes no claim and may sit anywhere.
  assert.equal(placeInTime({}, axis), null);
});

test('timeline spans validate, and a lineage with dates keeps its branches apart', () => {
  for (const [node, path] of [
    [{ id: 'a', end: 5 }, 'nodes[0].end'],
    [{ id: 'a', start: 9, end: 5 }, 'nodes[0]'],
    [{ id: 'a', start: 'early' }, 'nodes[0].start'],
  ]) {
    const result = loadDocument({ format: FORMAT, diagram: 'timeline', nodes: [node] });
    assert.equal(result.valid, false, path);
    assert.ok(
      result.errors.some((e) => e.path === path),
      JSON.stringify(result.errors),
    );
  }
  // An open span runs to the end of the axis; a tree in time is a phylogram.
  const { graph } = load({
    format: FORMAT,
    diagram: 'timeline',
    nodes: [
      { id: 'root', start: 0 },
      { id: 'a', start: 10 },
      { id: 'b', start: 10 },
      { id: 'a1', start: 30 },
      { id: 'a2', start: 30, end: 40 },
    ],
    edges: [
      { source: 'root', target: 'a' },
      { source: 'root', target: 'b' },
      { source: 'a', target: 'a1' },
      { source: 'a', target: 'a2' },
    ],
  });
  const at = layoutGraph(graph),
    axis = timeAxis(graph.nodes);
  assert.equal(axis.to, 40);
  assert.ok(Math.abs(at.get('root').x - (axis.x(0) + axis.x(40)) / 2) < 0.01, 'open spans run on');
  assert.ok(at.get('a1').y < at.get('a2').y && at.get('a2').y < at.get('b').y, 'leaf order');
  assert.ok(Math.abs(at.get('a').y - (at.get('a1').y + at.get('a2').y) / 2) < 0.02);
  // Without any time, the timeline engine still draws a tree.
  const untimed = runLayoutEngine(
    { nodes: graph.nodes.map(({ id, label, kind }) => ({ id, label, kind })), edges: graph.edges },
    'timeline',
    { seed: 0, spacing: 150, iterations: 0 },
  );
  assert.equal(untimed.size, 5);
  assert.ok(untimed.get('a1').x > untimed.get('a').x);
});

test('shapes that hold their label agree between size, hit test and edge attachment', () => {
  assert.equal(estimateTextWidth('中文', 10), 20);
  assert.ok(estimateTextWidth('ill', 10) < estimateTextWidth('MMM', 10));
  const long = insideLabel('一个非常非常长的步骤名称需要换行才能放进方框里面', 3, 1);
  assert.equal(long.lines.length, 2);
  assert.ok(long.lines[1].endsWith('…'));
  assert.ok(long.width <= long.size * 9.5 + 1e-9);
  assert.deepEqual(insideLabel('短', 5, 1.5).lines, ['短']);
  assert.equal(insideLabel('短', 5, 1.5).size, 17 * 1.5);
  // Wrapping is worked out once per text, size and weight, and shared: a
  // frame asks for the same shape many times. What is shared cannot be edited.
  assert.equal(insideLabel('短', 5, 1.5), insideLabel('短', 5, 1.5));
  assert.equal(insideLabel('短', 3, 1, { fontSize: 15, fontWeight: 500 }), insideLabel('短', 3, 1));
  assert.notEqual(insideLabel('短', 3, 1), insideLabel('短', 4, 1));
  assert.notEqual(insideLabel('短', 3, 1), insideLabel('短', 3, 1, { fontWeight: 600 }));
  assert.ok(Object.isFrozen(long) && Object.isFrozen(long.lines));
  assert.throws(() => long.lines.push('x'), TypeError);
  assert.deepEqual(insideLabel('一个非常非常长的步骤名称需要换行才能放进方框里面', 3, 1), long);
  for (const shape of ['box', 'capsule', 'decision']) {
    const style = { ...styleForGraph(load(flowchart).graph), nodes: { step: { shape } } };
    const node = { id: 'n', kind: 'step', label: '检查库存 stock', importance: 3 },
      centre = { x: 300, y: 200 };
    const g = glyphGeometry(node, 1, spec, style);
    assert.equal(g.shape, shape);
    // The text block fits inside the outline with room to spare.
    for (const [sx, sy] of [
      [1, 1],
      [-1, 1],
      [1, -1],
      [-1, -1],
    ])
      assert.ok(
        nodeGlyphContainsPoint(
          node,
          centre,
          { x: centre.x + (sx * g.inside.width) / 2, y: centre.y + (sy * g.inside.height) / 2 },
          1,
          spec,
          style,
        ),
        `${shape}: text corner inside`,
      );
    for (let i = 0; i < 48; i++) {
      const angle = (i / 48) * Math.PI * 2,
        direction = { x: Math.cos(angle), y: Math.sin(angle) };
      const reach = nodeGlyphRayDistance(node, direction, 1, spec, style);
      const at = (distance) => ({
        x: centre.x + direction.x * distance,
        y: centre.y + direction.y * distance,
      });
      assert.equal(nodeGlyphContainsPoint(node, centre, at(reach - 0.05), 1, spec, style), true);
      assert.equal(nodeGlyphContainsPoint(node, centre, at(reach + 0.05), 1, spec, style), false);
    }
    // The size depends on the words, not on the camera.
    assert.equal(glyphGeometry(node, 0.3, spec, style).halfWidth, g.halfWidth);
  }
});

test('every diagram strategy can be chosen for any graph in the studio', () => {
  const { graph } = load(flowchart),
    current = layoutGraph(graph);
  for (const type of ['tree', 'mindmap', 'timeline', 'flow', 'auto']) {
    const result = computeLayout(
      graph,
      { ...DEFAULT_LAYOUT_SETTINGS, type, mode: 'rearrange' },
      current,
    );
    assert.equal(result.size, graph.nodes.length, type);
    for (const point of result.values())
      assert.ok(Number.isFinite(point.x) && Number.isFinite(point.y), type);
    assert.equal(
      new Set([...result.values()].map((q) => `${q.x}/${q.y}`)).size,
      graph.nodes.length,
    );
  }
  // Auto follows the declared kind of diagram.
  assert.deepEqual(
    [
      ...computeLayout(
        graph,
        { ...DEFAULT_LAYOUT_SETTINGS, type: 'auto', mode: 'rearrange' },
        current,
      ),
    ],
    [
      ...computeLayout(
        graph,
        { ...DEFAULT_LAYOUT_SETTINGS, type: 'flow', mode: 'rearrange' },
        current,
      ),
    ],
  );
});
