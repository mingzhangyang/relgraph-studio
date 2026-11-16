// PR 7 · film frame refinement (V1–V4): label rules per diagram kind, one
// type size for a timeline's labels, flowchart relations and the legend.
import { test } from 'vitest';
import assert from 'node:assert/strict';
import tree from '../examples/vertebrates-tree-provisional.graph.json' with { type: 'json' };
import flowchart from '../examples/order-flowchart-synthetic.graph.json' with { type: 'json' };
import dynasties from '../examples/dynasties-timeline-provisional.graph.json' with { type: 'json' };
import { loadDocument } from '../packages/core/src/director/load.ts';
import { layoutGraph } from '../packages/core/src/director/layout.ts';
import { directorFrameAt, frameCount } from '../packages/core/src/director/state.ts';
import {
  computeLayout,
  DEFAULT_LAYOUT_SETTINGS,
} from '../packages/core/src/director/layout-strategies.ts';
import { styleForGraph } from '../packages/core/src/style.ts';
import { feedbackRelations } from '../packages/core/src/graph/analysis.ts';
import { composeFrame } from '../packages/render/src/compose.ts';
import { TREE_GROWTH, treeReading } from '../packages/render/src/compose/labels.ts';
import {
  cameraFitFor,
  FRAME_SPECS,
  projectCameraPoint,
} from '../packages/render/src/frame-spec.ts';
import { SPAN_LABEL } from '../packages/render/src/importance.ts';
import { LEGEND } from '../packages/render/src/compose/legend.ts';
import { VIDEO_THEMES } from '../packages/render/src/theme.ts';
import { drawables, measure } from './helpers/display-list.mjs';

const spec = FRAME_SPECS['landscape-720p'];
const load = (doc) => {
  const result = loadDocument(doc);
  assert.equal(result.valid, true, JSON.stringify(result.errors));
  return result;
};
const compose = (result, frame, positions = layoutGraph(result.graph), theme = 'light') => {
  const state = directorFrameAt(result.graph, positions, frame, spec.fps, {
    fit: cameraFitFor(spec),
  });
  const list = composeFrame(state, {
    graph: result.graph,
    positions,
    frame,
    fps: spec.fps,
    measure,
    frameSpec: spec,
    theme: VIDEO_THEMES[theme],
    style: styleForGraph(result.graph),
    detailAt: result.detailAt,
  });
  const point = (id) => projectCameraPoint(positions.get(id), state.cameraResolved, spec);
  return { state, list, point };
};
/** The box of the first line of each drawn text, by its text. */
const textBoxes = (list) =>
  new Map(
    drawables(list)
      .filter((item) => item.type === 'text' && item.baseline === 'top')
      .map((item) => [
        item.text,
        { x: item.x, y: item.y, w: measure(item.text, item.font), h: item.font.size * 1.3 },
      ]),
  );

/** Where a label sits relative to its node's centre. */
function sideOf(box, p) {
  if (box.y >= p.y) return 'below';
  if (box.y + box.h <= p.y) return 'above';
  if (box.x >= p.x) return 'right';
  if (box.x + box.w <= p.x) return 'left';
  return 'over';
}

test('V1 · a tree reads its roles from the whole tree and its growth from the drawing', () => {
  const { graph } = load(tree);
  const positions = layoutGraph(graph);
  const reading = treeReading(graph, positions);
  assert.equal(reading.sideways, true);
  assert.equal(reading.forward, 1);
  const role = (label) => reading.roles.get(graph.nodes.find((n) => n.label === label).id);
  assert.equal(role('Vertebrata'), 'root');
  assert.equal(role('Osteichthyes'), 'inner');
  assert.equal(role('Aves'), 'leaf');
  // The same tree turned on its side grows down: the reading follows the drawing.
  const turned = new Map([...positions].map(([id, p]) => [id, { x: p.y, y: p.x }]));
  assert.deepEqual(
    { ...treeReading(graph, turned), roles: undefined },
    { roles: undefined, sideways: false, forward: 1 },
  );
  // Mirrored, it grows to the left.
  const mirrored = new Map([...positions].map(([id, p]) => [id, { x: -p.x, y: p.y }]));
  assert.equal(treeReading(graph, mirrored).forward, -1);
});

test('V1 · tree labels follow the role: leaves ahead, the root behind, inner nodes across', () => {
  const result = load(tree);
  const { graph } = result;
  const { list, point } = compose(result, frameCount(graph) - 1);
  const boxes = textBoxes(list);
  const reading = treeReading(graph, layoutGraph(graph));
  const sides = { leaf: new Set(), root: new Set(), inner: new Set() };
  for (const node of graph.nodes) {
    const box = boxes.get(node.label);
    assert.ok(box, `${node.label} is labelled`);
    sides[reading.roles.get(node.id)].add(sideOf(box, point(node.id)));
  }
  assert.deepEqual([...sides.leaf], ['right']);
  assert.deepEqual([...sides.root], ['left']);
  // Never between a node and its parent or children: above or below only.
  assert.deepEqual([...sides.inner].sort(), ['above', 'below']);
  // Below is the rule; above only where below is taken.
  const inner = graph.nodes.filter((n) => reading.roles.get(n.id) === 'inner');
  const below = inner.filter((n) => sideOf(boxes.get(n.label), point(n.id)) === 'below');
  assert.ok(below.length >= inner.length - 1, `${below.length} of ${inner.length} below`);
  // An inner label below ends where its node ends, clear of the relations
  // that leave towards its children.
  for (const node of below) {
    const box = boxes.get(node.label),
      p = point(node.id);
    assert.ok(box.x + box.w <= p.x + 30, `${node.label} ends at its node`);
  }
});

test('V1 · a branch keeps its label side while the tree unfolds', () => {
  const result = load(tree);
  const { graph } = result;
  const positions = layoutGraph(graph);
  const final = compose(result, frameCount(graph) - 1, positions);
  const finalBoxes = textBoxes(final.list);
  let compared = 0;
  // Mid-shot frames, where an inner node often has no child shown yet.
  for (let frame = 36; frame < frameCount(graph); frame += 72) {
    const { list, point, state } = compose(result, frame, positions);
    const boxes = textBoxes(list);
    const shown = new Set(state.view.edges.map((e) => e.source));
    for (const node of state.view.nodes) {
      const box = boxes.get(node.label);
      if (
        !box ||
        shown.has(node.id) ||
        treeReading(graph, positions).roles.get(node.id) !== 'inner'
      )
        continue;
      // An inner node shown without its children is not labelled as a leaf.
      assert.notEqual(sideOf(box, point(node.id)), 'right', `${node.label} at ${frame}`);
      assert.equal(
        sideOf(box, point(node.id)),
        sideOf(finalBoxes.get(node.label), final.point(node.id)),
        `${node.label} at ${frame}`,
      );
      compared++;
    }
  }
  assert.ok(compared >= 3, `${compared} inner nodes compared before their children appear`);
});

test('V1 · networks keep the free-side search; an authored side still comes first', () => {
  const network = load({ ...tree, diagram: undefined });
  assert.equal(styleForGraph(network.graph).labelSides, undefined);
  assert.equal(styleForGraph(load(tree).graph).labelSides, 'tree');
  const authored = load(tree);
  const node = authored.graph.nodes.find((n) => n.label === 'Osteichthyes');
  authored.graph = {
    ...authored.graph,
    project: { nodes: { objects: { [node.id]: { textPosition: 'top' } } } },
  };
  const { list, point } = compose(authored, frameCount(authored.graph) - 1);
  assert.equal(sideOf(textBoxes(list).get('Osteichthyes'), point(node.id)), 'above');
});

test('V2 · a timeline labels every span at one size, inside its bar or beside it', () => {
  const result = load(dynasties);
  const { graph } = result;
  const labels = new Set(graph.nodes.map((n) => n.label));
  const { list } = compose(result, frameCount(graph) - 1);
  const spans = drawables(list).filter((item) => item.type === 'text' && labels.has(item.text));
  const inside = spans.filter((item) => item.align === 'center'),
    beside = spans.filter((item) => item.align !== 'center');
  // The example has both: long reigns hold their names, short ones do not.
  assert.ok(inside.length >= 8 && beside.length >= 4, `${inside.length} / ${beside.length}`);
  assert.equal(spans.length, graph.nodes.length);
  const fonts = new Set(spans.map((item) => `${item.font.size}/${item.font.weight}`));
  assert.deepEqual([...fonts], [`${SPAN_LABEL.size * spec.typeScale}/${SPAN_LABEL.weight}`]);
});

test('V2 · off the time axis a timeline keeps the importance scale for its points', () => {
  const result = load({ ...dynasties, timeAxis: false });
  const { graph } = result;
  const labels = new Set(graph.nodes.map((n) => n.label));
  const { list } = compose(result, frameCount(graph) - 1);
  const sizes = new Set(
    drawables(list)
      .filter((item) => item.type === 'text' && labels.has(item.text))
      .map((item) => item.font.size),
  );
  assert.ok(![...sizes].includes(SPAN_LABEL.size * spec.typeScale), [...sizes].join());
});

/** WCAG contrast of two #RRGGBB colours. */
function contrast(a, b) {
  const lum = (hex) => {
    const [r, g, bl] = [1, 3, 5].map((i) => {
      const c = parseInt(hex.slice(i, i + 2), 16) / 255;
      return c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
    });
    return 0.2126 * r + 0.7152 * g + 0.0722 * bl;
  };
  const [hi, lo] = [lum(a), lum(b)].sort((m, n) => n - m);
  return (hi + 0.05) / (lo + 0.05);
}
const over = (fg, bg, alpha) =>
  '#' +
  [1, 3, 5]
    .map((i) =>
      Math.round(
        parseInt(fg.slice(i, i + 2), 16) * alpha + parseInt(bg.slice(i, i + 2), 16) * (1 - alpha),
      )
        .toString(16)
        .padStart(2, '0'),
    )
    .join('');
/** The groups that draw relation strokes: their alpha and the stroke of their first path. */
function strokeGroups(list) {
  const found = [];
  const walk = (items) => {
    for (const item of items) {
      if (item.type !== 'group') continue;
      const first = item.items[0];
      if (first?.type === 'path' && first.stroke && !first.fill && item.alpha !== undefined)
        found.push({ alpha: item.alpha, stroke: first.stroke });
      else walk(item.items);
    }
  };
  walk(list.items);
  return found;
}

test('V3 · flowchart relations hold 3:1 against the paper in both themes; networks are unchanged', () => {
  const result = load(flowchart);
  assert.equal(styleForGraph(result.graph).edgeContrast, 'strong');
  for (const theme of ['light', 'dark']) {
    const P = VIDEO_THEMES[theme];
    const { list } = compose(result, frameCount(result.graph) - 1, undefined, theme);
    const strokes = strokeGroups(list).filter((g) => g.stroke === P.edge.strong);
    assert.equal(strokes.length, result.graph.edges.length, theme);
    for (const { alpha } of strokes)
      for (const paper of P.bg)
        assert.ok(contrast(over(P.edge.strong, paper, alpha), paper) >= 3, `${theme} on ${paper}`);
  }
  // The same document as a network keeps its plain strokes.
  const network = load({ ...flowchart, diagram: undefined });
  assert.equal(styleForGraph(network.graph).edgeContrast, undefined);
  const { list } = compose(network, frameCount(network.graph) - 1);
  assert.equal(
    strokeGroups(list).filter((g) => g.stroke === VIDEO_THEMES.light.edge.strong).length,
    0,
  );
});

/** Selection outline of each drawn relation and node, by label or id. */
function outlines(result, list) {
  const label = new Map(result.graph.nodes.map((n) => [n.id, n.label]));
  const nodes = new Map(),
    edges = new Map();
  for (const item of list.selection)
    if (item.kind === 'node') nodes.set(label.get(item.id), item.box);
    else edges.set(item.id, item.points);
  return { nodes, edges };
}
const inside = (q, box) => q.x > box.x && q.x < box.x + box.w && q.y > box.y && q.y < box.y + box.h;

test('V3 · a return runs over the steps it passes and carries its tag on the crossing', () => {
  const result = load(flowchart);
  const { list } = compose(result, frameCount(result.graph) - 1);
  const { nodes, edges } = outlines(result, list);
  const retry = result.graph.edges.find((e) => e.label === '否，重试');
  const path = edges.get(retry.id);
  // It leaves the top of the decision and comes down into the top of the step.
  const from = nodes.get('支付成功？'),
    to = nodes.get('发起支付');
  assert.ok(
    path.every((q) => q.y <= Math.min(from.y, to.y) + 1),
    'above both steps',
  );
  assert.ok(Math.abs(path.at(-1).x - (to.x + to.w / 2)) < 2, 'into the top of its target');
  // The tag sits on the crossing.
  const tag = drawables(list).find((item) => item.type === 'text' && item.text === '否，重试');
  const nearest = Math.min(...path.map((q) => Math.hypot(q.x - tag.x, q.y - tag.y)));
  assert.ok(nearest < 4, `tag ${nearest.toFixed(1)} px from its relation`);
  // The relation it returns along is a plain elbow again, not one of two arcs.
  const forward = result.graph.edges.find(
    (e) => e.source === retry.target && e.target === retry.source,
  );
  const ahead = edges.get(forward.id);
  assert.ok(Math.abs(ahead[0].y - (to.y + to.h / 2)) < 2, 'leaves its step sideways');
});

test('V3 · a long return passes over every step between its ends, never under one', () => {
  const steps = ['收单', '校验', '打包', '出库', '签收'];
  const result = load({
    format: 'relgraph.graph/1',
    diagram: 'flowchart',
    meta: { title: 'return' },
    directed: true,
    nodes: steps.map((id) => ({ id, kind: '步骤' })),
    edges: [
      ...steps.slice(1).map((id, i) => ({ source: steps[i], target: id })),
      { source: '签收', target: '校验', label: '退回' },
    ],
  });
  const { list } = compose(result, frameCount(result.graph) - 1);
  const { nodes, edges } = outlines(result, list);
  const back = result.graph.edges.find((e) => e.label === '退回');
  const path = edges.get(back.id);
  for (const step of ['打包', '出库'])
    assert.ok(!path.some((q) => inside(q, nodes.get(step))), `clear of ${step}`);
  const highest = Math.min(...['校验', '打包', '出库', '签收'].map((s) => nodes.get(s).y));
  assert.ok(Math.min(...path.map((q) => q.y)) < highest, 'over the row');
});

test('V4 · the legend is set no smaller than the frame’s other secondary text', () => {
  const result = load(flowchart);
  const { list } = compose(result, frameCount(result.graph) - 1);
  const entries = new Set(['步骤', '判断', '开始', '结束']);
  const legend = drawables(list).filter(
    (item) => item.type === 'text' && entries.has(item.text) && item.align !== 'center',
  );
  assert.equal(legend.length, 4);
  for (const item of legend) assert.equal(item.font.size, LEGEND.size * spec.typeScale);
  // The scene label (13) is the frame's secondary text; the legend is no smaller.
  const scene = drawables(list).find((item) => item.type === 'text' && /^SCENE/.test(item.text));
  assert.ok(legend[0].font.size >= scene.font.size, `${legend[0].font.size} < ${scene.font.size}`);
  // Its plate still holds a line of it, with room above and below.
  const plate = drawables(list).find(
    (item) => item.type === 'path' && item.fill === VIDEO_THEMES.light.legendPlate,
  );
  const [, , , , h] = plate.d[0];
  assert.ok(h >= legend[0].font.size * 1.8, `plate ${h} for ${legend[0].font.size}`);
});

test('review · a tree that does not grow one way keeps the free-side search', () => {
  const result = load(tree);
  const { graph } = result;
  const drawnBy = (type) =>
    computeLayout(graph, { ...DEFAULT_LAYOUT_SETTINGS, type, mode: 'rearrange' });
  // Strategies that advance one way read as a tree; the others have no "ahead".
  for (const type of ['tree', 'layered', 'flow'])
    assert.ok(treeReading(graph, drawnBy(type)), `${type} grows one way`);
  for (const type of ['radial', 'force', 'circle', 'grid'])
    assert.equal(treeReading(graph, drawnBy(type)), null, `${type} does not`);
  assert.ok(TREE_GROWTH > 0.53 && TREE_GROWTH < 0.75);
  // Drawn radially, the frame is the one the free-side search composes.
  const radial = drawnBy('radial');
  const frame = frameCount(graph) - 1;
  const state = directorFrameAt(graph, radial, frame, spec.fps, { fit: cameraFitFor(spec) });
  const options = { graph, positions: radial, frame, fps: spec.fps, measure, frameSpec: spec };
  const style = styleForGraph(graph);
  const free = { ...style };
  delete free.labelSides;
  assert.deepEqual(
    composeFrame(state, { ...options, style }),
    composeFrame(state, { ...options, style: free }),
  );
});

test('review · tree roles are read from the drawing, whichever way a relation is written', () => {
  const { graph } = load(tree);
  const positions = layoutGraph(graph);
  const expected = treeReading(graph, positions);
  // One relation written child to parent: same drawing, same roles.
  const turned = (every) => ({
    ...graph,
    edges: graph.edges.map((e, i) =>
      i % every ? e : { ...e, source: e.target, target: e.source },
    ),
  });
  const reading = treeReading(turned(graph.edges.length), positions);
  assert.deepEqual([...reading.roles].sort(), [...expected.roles].sort());
  assert.equal(reading.forward, expected.forward);
  assert.equal(reading.sideways, expected.sideways);
  // Written every which way, the relations name no direction: free-side search.
  assert.equal(treeReading(turned(2), positions), null);
});

const flow = (ids, edges) =>
  load({
    format: 'relgraph.graph/1',
    diagram: 'flowchart',
    meta: { title: 'returns' },
    directed: true,
    nodes: ids.map((id) => ({ id, kind: id.endsWith('？') ? '判断' : '步骤' })),
    edges,
  });

test('review · a return never runs through a step over its ends, and returns keep lanes', () => {
  const result = flow(
    ['收单', '有货？', '支付', '缺货登记', '补货', '发货', '签收'],
    [
      { source: '收单', target: '有货？' },
      { source: '有货？', target: '支付', label: '是' },
      { source: '有货？', target: '缺货登记', label: '否' },
      { source: '缺货登记', target: '补货' },
      { source: '支付', target: '发货' },
      { source: '发货', target: '签收' },
      { source: '补货', target: '有货？', label: '到货' },
      { source: '签收', target: '支付', label: '退款' },
      { source: '发货', target: '支付', label: '改址' },
    ],
  );
  const { list } = compose(result, frameCount(result.graph) - 1);
  const { nodes, edges } = outlines(result, list);
  const path = (label) => edges.get(result.graph.edges.find((e) => e.label === label).id);
  // No return touches any step: 补货 sits under 发货, so 到货 goes round below.
  for (const label of ['到货', '退款', '改址'])
    for (const [step, box] of nodes)
      assert.ok(!path(label).some((q) => inside(q, box)), `${label} clear of ${step}`);
  const lowest = Math.max(...[...nodes.values()].map((box) => box.y + box.h));
  assert.ok(Math.max(...path('到货').map((q) => q.y)) > lowest, '到货 crosses below the steps');
  const below = nodes.get('有货？');
  assert.ok(path('到货').at(-1).y >= below.y + below.h, 'and enters its target from below');
  // The two returns above cross at different heights, the shorter inside.
  const crossing = (label) => Math.min(...path(label).map((q) => q.y));
  assert.ok(crossing('退款') < crossing('改址') - 15, `${crossing('退款')} / ${crossing('改址')}`);
  // Each tag is on its own line.
  for (const label of ['到货', '退款', '改址']) {
    const tag = drawables(list).find((item) => item.type === 'text' && item.text === label);
    const nearest = Math.min(...path(label).map((q) => Math.hypot(q.x - tag.x, q.y - tag.y)));
    assert.ok(nearest < 4, `${label} tag ${nearest.toFixed(1)} px from its relation`);
  }
});

test('review · the legend swatch of a neutral relation kind is the stroke that is drawn', () => {
  const result = load({
    format: 'relgraph.graph/1',
    diagram: 'flowchart',
    meta: { title: 'kinds' },
    directed: true,
    nodes: ['a', 'b', 'c', 'd', 'e', 'f', 'g', 'h', 'i', 'j'].map((id) => ({ id, kind: `k${id}` })),
    edges: [
      { source: 'a', target: 'b', kind: 'next' },
      { source: 'b', target: 'c', kind: 'else' },
      ...['d', 'e', 'f', 'g', 'h', 'i', 'j'].map((id) => ({
        source: 'c',
        target: id,
        kind: 'next',
      })),
    ],
  });
  const style = styleForGraph(result.graph);
  const neutral = Object.entries(style.edges).filter(([, s]) => s.tone === undefined && !s.color);
  // Ten node kinds take every palette slot, so the relation kinds are neutral.
  assert.ok(neutral.length >= 1, 'a relation kind without a hue');
  const P = VIDEO_THEMES.light;
  const { list } = compose(result, frameCount(result.graph) - 1);
  const strokes = new Set(
    drawables(list)
      .filter((item) => item.type === 'path' && item.stroke && !item.fill)
      .map((item) => item.stroke),
  );
  assert.ok(strokes.has(P.edge.strong));
  assert.ok(!strokes.has(P.edge.plain), 'no swatch or stroke in the plain neutral');
});

/** A flowchart at fixed coordinates, so the case does not depend on a layout engine. */
const placed = (steps, edges) => {
  const result = flow(Object.keys(steps), edges);
  const ids = new Map(result.graph.nodes.map((n) => [n.label, n.id]));
  const positions = new Map(
    Object.entries(steps).map(([label, [x, y]]) => [ids.get(label), { x, y }]),
  );
  return { result, positions };
};
const returnPath = (result, list, label) =>
  outlines(result, list).edges.get(result.graph.edges.find((e) => e.label === label).id);

test('#47 review · a reciprocal retry and a full cycle still route their return', () => {
  // A ⇄ B: the way out and the way back cancel in distance.
  const pair = placed({ 下单: [0, 0], 支付: [220, 0] }, [
    { source: '下单', target: '支付', label: '去' },
    { source: '支付', target: '下单', label: '重试' },
  ]);
  const one = compose(pair.result, frameCount(pair.result.graph) - 1, pair.positions);
  const boxes = outlines(pair.result, one.list).nodes;
  const top = Math.min(...[...boxes.values()].map((box) => box.y));
  const retry = returnPath(pair.result, one.list, '重试');
  assert.ok(
    retry.every((q) => q.y <= top + 1),
    'the retry crosses above both steps',
  );
  const out = returnPath(pair.result, one.list, '去');
  assert.ok(
    out.every((q) => Math.abs(q.y - out[0].y) < 1),
    'the way out is a plain level line',
  );
  // A → B → C → A, left to right: the return goes round B, not through it.
  const cycle = placed({ 甲: [0, 0], 乙: [220, 0], 丙: [440, 0] }, [
    { source: '甲', target: '乙', label: '一' },
    { source: '乙', target: '丙', label: '二' },
    { source: '丙', target: '甲', label: '回' },
  ]);
  const two = compose(cycle.result, frameCount(cycle.result.graph) - 1, cycle.positions);
  const middle = outlines(cycle.result, two.list).nodes.get('乙');
  const back = returnPath(cycle.result, two.list, '回');
  assert.ok(!back.some((q) => inside(q, middle)), 'clear of 乙');
  assert.ok(Math.min(...back.map((q) => q.y)) < middle.y, 'over the row');
});

test('#47 review · an authored curve cannot bring a return inside its clearance or onto another lane', () => {
  const steps = { 甲: [0, 0], 乙: [220, 0], 丙: [440, 0], 丁: [660, 0] };
  const edges = [
    { source: '甲', target: '乙' },
    { source: '乙', target: '丙' },
    { source: '丙', target: '丁' },
    { source: '丁', target: '甲', label: '长' },
    { source: '丙', target: '乙', label: '短' },
  ];
  const { result, positions } = placed(steps, edges);
  const id = (label) => result.graph.edges.find((e) => e.label === label).id;
  const frame = frameCount(result.graph) - 1;
  const crossing = (curves) => {
    result.graph = {
      ...result.graph,
      project: {
        edges: {
          objects: Object.fromEntries(
            Object.entries(curves).map(([label, curve]) => [id(label), { curve }]),
          ),
        },
      },
    };
    const { list } = compose(result, frame, positions);
    const { nodes } = outlines(result, list);
    const path = (label) => returnPath(result, list, label);
    for (const label of ['长', '短'])
      for (const [step, box] of nodes)
        assert.ok(!path(label).some((q) => inside(q, box)), `${label} clear of ${step}`);
    return (label) => Math.min(...path(label).map((q) => q.y));
  };
  const plain = crossing({});
  // Pulled inwards as far as the project allows: no closer than unauthored.
  const pulled = crossing({ 长: -160, 短: -160 });
  assert.equal(pulled('长'), plain('长'));
  assert.equal(pulled('短'), plain('短'));
  // Pushed out, the short return passes the long one, which moves a lane out.
  const pushed = crossing({ 短: 40 });
  assert.ok(pushed('短') < plain('短') - 30, 'pushed further out');
  assert.ok(Math.abs(pushed('长') - pushed('短')) >= 21, 'still a lane apart');
});

test('#47 re-review · more retries than forward steps do not turn the flow around', () => {
  // A → B → C → D with four feedback relations: more of them than steps forward.
  const edges = [
    { source: '甲', target: '乙', label: '1' },
    { source: '乙', target: '丙', label: '2' },
    { source: '丙', target: '丁', label: '3' },
    { source: '丙', target: '乙', label: '丙回乙' },
    { source: '丁', target: '丙', label: '丁回丙' },
    { source: '丁', target: '乙', label: '丁回乙' },
    { source: '丁', target: '甲', label: '丁回甲' },
  ];
  const feedback = ['丙回乙', '丁回丙', '丁回乙', '丁回甲'];
  for (const [name, x] of [
    ['left to right', (i) => i * 220],
    ['mirrored', (i) => -i * 220],
  ]) {
    const { result, positions } = placed(
      { 甲: [x(0), 0], 乙: [x(1), 0], 丙: [x(2), 0], 丁: [x(3), 0] },
      edges,
    );
    const byLabel = new Map(result.graph.edges.map((e) => [e.label, e.id]));
    // The feedback is structural: the same four, whatever the coordinates.
    assert.deepEqual(
      [...feedbackRelations(result.graph)].sort(),
      feedback.map((label) => byLabel.get(label)).sort(),
      name,
    );
    const { list } = compose(result, frameCount(result.graph) - 1, positions);
    const { nodes } = outlines(result, list);
    const top = Math.min(...[...nodes.values()].map((box) => box.y));
    // Forward steps stay level lines on the row; every return goes round.
    for (const label of ['1', '2', '3']) {
      const path = returnPath(result, list, label);
      assert.ok(
        path.every((q) => Math.abs(q.y - path[0].y) < 1),
        `${name}: step ${label} is a level line`,
      );
    }
    for (const label of feedback) {
      const path = returnPath(result, list, label);
      assert.ok(Math.min(...path.map((q) => q.y)) < top, `${name}: ${label} crosses above`);
      for (const [step, box] of nodes)
        assert.ok(!path.some((q) => inside(q, box)), `${name}: ${label} clear of ${step}`);
    }
  }
});

test('#47 re-review 2 · reordered nodes over the same relations re-read the feedback', () => {
  // A → B → C → A, drawn in a row. Which relation closes the loop depends
  // on where the author's reading starts, i.e. on the order of the nodes.
  const { result, positions } = placed({ 甲: [0, 0], 乙: [220, 0], 丙: [440, 0] }, [
    { source: '甲', target: '乙', label: '甲乙' },
    { source: '乙', target: '丙', label: '乙丙' },
    { source: '丙', target: '甲', label: '丙甲' },
  ]);
  const byLabel = new Map(result.graph.edges.map((e) => [e.label, e.id]));
  const rising = (label, list) => {
    const path = returnPath(result, list, label);
    return path.some((q) => Math.abs(q.y - path[0].y) > 5);
  };
  const frame = frameCount(result.graph) - 1;
  const first = compose(result, frame, positions);
  assert.deepEqual([...feedbackRelations(result.graph)], [byLabel.get('丙甲')]);
  assert.ok(rising('丙甲', first.list), '丙 → 甲 is routed as the return');
  // Same edges array, nodes reordered so the reading starts at 丙.
  const [a, b, c] = result.graph.nodes,
    edges = result.graph.edges;
  result.graph = { ...result.graph, nodes: [c, a, b] };
  assert.equal(result.graph.edges, edges, 'the very same relations');
  assert.deepEqual([...feedbackRelations(result.graph)], [byLabel.get('乙丙')]);
  const second = compose(result, frame, positions);
  assert.ok(rising('乙丙', second.list), '乙 → 丙 is now the return');
  assert.ok(!rising('丙甲', second.list), '丙 → 甲 is no longer routed round');
});
