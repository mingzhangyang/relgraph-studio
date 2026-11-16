// PR 7 · film frame refinement (V1–V4): label rules per diagram kind, one
// type size for a timeline's labels, flowchart relations and the legend.
import { test } from 'vitest';
import assert from 'node:assert/strict';
import tree from '../examples/vertebrates-tree-provisional.graph.json' with { type: 'json' };
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
