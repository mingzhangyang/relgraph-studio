// One source for constants that the style sheets, the glyph geometry, the
// legend and the labels must agree on (S5).
import { test } from 'vitest';
import assert from 'node:assert/strict';
import bookshop from '../examples/bookshop-systems-synthetic.graph.json' with { type: 'json' };
import { LINE_DASH, LINE_STYLES } from '../packages/core/src/line-styles.ts';
import { literatureStyle } from '../packages/core/src/domains/literature.style.ts';
import { biologyStyle } from '../packages/core/src/domains/biology.style.ts';
import { loadDocument } from '../packages/core/src/director/load.ts';
import { layoutGraph } from '../packages/core/src/director/layout.ts';
import { directorFrameAt, frameCount } from '../packages/core/src/director/state.ts';
import { deriveGraphStyle, NEUTRAL_STYLE, styleForGraph } from '../packages/core/src/style.ts';
import { frameContext } from '../packages/render/src/compose/context.ts';
import { composeNodeLabels } from '../packages/render/src/compose/labels.ts';
import { drawnNodes, nodeObstacles } from '../packages/render/src/compose/nodes.ts';
import { relationLayout } from '../packages/render/src/compose/relations.ts';
import { cameraFitFor, FRAME_SPECS } from '../packages/render/src/frame-spec.ts';
import { IMPORTANCE_SCALE, importanceStep } from '../packages/render/src/importance.ts';
import {
  glyphGeometry,
  insideLabel,
  miniatureGeometry,
  nodeRadius,
} from '../packages/render/src/node-geometry.ts';
import { VIDEO_THEMES } from '../packages/render/src/theme.ts';
import { measure } from './helpers/display-list.mjs';

const spec = FRAME_SPECS['landscape-720p'];

test('named line rhythms have one definition, read by every style sheet', () => {
  assert.deepEqual(Object.keys(LINE_DASH), [...LINE_STYLES]);
  assert.equal(LINE_DASH.solid, undefined);
  assert.equal(literatureStyle.edges.rivalry.dash, LINE_DASH.dashed);
  assert.equal(literatureStyle.edges.service.dash, LINE_DASH.dotted);
  assert.equal(biologyStyle.edges.activator.dash, LINE_DASH.dashed);
  // An author's named line goes through the same table.
  const declared = deriveGraphStyle({
    nodes: [],
    edges: [
      { id: 'a', source: 'x', target: 'y', kind: 'k1' },
      { id: 'b', source: 'x', target: 'y', kind: 'k2' },
    ],
    groups: [],
    kinds: { edges: { k1: { line: 'dashed' }, k2: { line: 'dotted' } } },
  });
  assert.equal(declared.edges.k1.dash, LINE_DASH.dashed);
  assert.equal(declared.edges.k2.dash, LINE_DASH.dotted);
});

test('importance has one scale: glyph radius, bar, held words and labels read it', () => {
  const steps = [
    [undefined, 'unrated'],
    [0, 'unrated'],
    [0.5, 'unrated'],
    [1, 'minor'],
    [2, 'minor'],
    [3, 'notable'],
    [4, 'major'],
    [5, 'principal'],
    [7, 'principal'],
  ];
  for (const [importance, name] of steps)
    assert.equal(importanceStep(importance), IMPORTANCE_SCALE[name], String(importance));
  for (const [importance, name] of steps) {
    const scale = IMPORTANCE_SCALE[name];
    const node = { kind: 'k', importance, label: 'Label' };
    assert.equal(nodeRadius(node, 1, spec, NEUTRAL_STYLE), scale.radius, String(importance));
    const held = insideLabel('Label', importance ?? 0, 1);
    assert.equal(held.size, scale.inside);
    assert.equal(held.weight, scale.weight);
  }
  // Principals are larger than every other step in every channel.
  for (const key of ['radius', 'label', 'inside', 'weight'])
    for (const other of ['major', 'notable', 'minor', 'unrated'])
      assert.ok(IMPORTANCE_SCALE.principal[key] >= IMPORTANCE_SCALE[other][key], key);

  // The label beside a node is set at the step's label size and weight.
  const result = loadDocument(bookshop);
  const positions = layoutGraph(result.graph);
  const frame = frameCount(result.graph, spec.fps) - 1;
  const state = directorFrameAt(result.graph, positions, frame, spec.fps, {
    fit: cameraFitFor(spec),
  });
  const ctx = frameContext(state, {
    graph: result.graph,
    positions,
    frame,
    fps: spec.fps,
    measure,
    frameSpec: spec,
    theme: VIDEO_THEMES.light,
    style: styleForGraph(result.graph),
  });
  const drawn = drawnNodes(ctx);
  const labels = composeNodeLabels(
    ctx,
    {
      drawn,
      held: new Set(),
      obstacles: nodeObstacles(ctx, drawn, ctx.rectIndex()),
      pull: relationLayout(ctx.view, ctx.points).pull,
      relations: ctx.rectIndex(),
    },
    ctx.rectIndex(),
  );
  const sizes = new Set();
  for (const { node } of drawn) {
    const matches = labels.filter((item) => item.text === node.label);
    if (matches.length !== 1 || drawn.filter((d) => d.node.label === node.label).length !== 1)
      continue;
    const [text] = matches;
    const scale = importanceStep(node.importance);
    assert.equal(text.font.size, scale.label, node.id);
    assert.equal(text.font.weight, scale.weight, node.id);
    sizes.add(text.font.size);
  }
  assert.ok(sizes.size >= 2, 'the example uses more than one step');
});

test('a legend miniature has the proportions of the glyph it stands for', () => {
  for (const shape of ['circle', 'square', 'hexagon', 'diamond']) {
    const glyph = glyphGeometry({ kind: 'k', importance: 3 }, 1, spec, {
      ...NEUTRAL_STYLE,
      defaultNode: { shape },
    });
    const mini = miniatureGeometry(shape, 5.2);
    assert.equal(glyph.shape, shape);
    const ratio = (g) => [g.halfHeight / g.halfWidth, g.cornerRadius / g.halfWidth];
    for (const [a, b] of ratio(glyph).map((value, i) => [value, ratio(mini)[i]]))
      assert.ok(Math.abs(a - b) < 1e-12, `${shape}: ${a} vs ${b}`);
  }
  // Shapes sized by their words or years have miniature proportions of their own.
  for (const shape of ['pill', 'capsule', 'box', 'span', 'decision']) {
    const mini = miniatureGeometry(shape, 10);
    assert.equal(mini.shape, shape);
    assert.ok(mini.halfWidth > mini.halfHeight, shape);
  }
});
