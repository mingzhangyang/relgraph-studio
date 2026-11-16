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
import { styleForGraph } from '../packages/core/src/style.ts';
import { composeFrame } from '../packages/render/src/compose.ts';
import { treeReading } from '../packages/render/src/compose/labels.ts';
import {
  cameraFitFor,
  FRAME_SPECS,
  projectCameraPoint,
} from '../packages/render/src/frame-spec.ts';
import { SPAN_LABEL } from '../packages/render/src/importance.ts';
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
