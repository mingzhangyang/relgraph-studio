// What the workspace says about layouts before and after they run (PR 6):
// pure checks of the core rules the layout panel reads.
import { test } from 'vitest';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import examples from '../examples/manifest.json' with { type: 'json' };
import { loadDocument } from '../packages/core/src/director/load.ts';
import { drawingOrigin, layoutGraph } from '../packages/core/src/director/layout.ts';
import {
  DEFAULT_LAYOUT_SETTINGS,
  planLayout,
  strategyEngine,
} from '../packages/core/src/director/layout-strategies.ts';
import {
  ENGINE_PARAMETERS,
  runLayoutEngine,
} from '../packages/core/src/director/layout-engines.ts';
import { strategyParameters } from '../packages/core/src/director/layout-strategies.ts';
import { LAYOUT_ENGINES, LAYOUT_TYPES } from '../packages/core/src/project-layout.ts';

const example = (file) =>
  JSON.parse(readFileSync(new URL(`../examples/${file}`, import.meta.url), 'utf8'));
const graphs = examples.map(({ id, file }) => [id, loadDocument(example(file)).graph]);
const strategies = LAYOUT_TYPES.filter((type) => type !== 'manual');

test('strategyEngine names the engine and reason planLayout reports, without running it', () => {
  for (const [id, graph] of graphs) {
    const current = layoutGraph(graph);
    for (const type of strategies) {
      const plan = planLayout(
        graph,
        { ...DEFAULT_LAYOUT_SETTINGS, type, mode: 'rearrange' },
        current,
      );
      if (plan.blocked.length) continue;
      assert.deepEqual(
        strategyEngine(graph, type),
        { engine: plan.engine, reason: plan.reason },
        `${id} / ${type}`,
      );
    }
  }
});

test('W1: each engine reads exactly the settings ENGINE_PARAMETERS lists', () => {
  const base = { seed: 0, spacing: 150, iterations: 300 },
    changed = { seed: 977, spacing: 210, iterations: 40 };
  const drawn = (graph, engine, options) =>
    JSON.stringify([...runLayoutEngine(graph, engine, options)]);
  for (const engine of LAYOUT_ENGINES) {
    const listed = ENGINE_PARAMETERS[engine];
    for (const parameter of ['seed', 'spacing', 'iterations']) {
      // Over every example, a listed setting changes some drawing and an
      // unlisted one changes none.
      const changes = graphs.filter(
        ([, graph]) =>
          drawn(graph, engine, base) !==
          drawn(graph, engine, { ...base, [parameter]: changed[parameter] }),
      );
      if (listed.includes(parameter))
        assert.ok(changes.length > 0, `${engine} lists ${parameter} but ignores it`);
      else
        assert.deepEqual(
          changes.map(([id]) => id),
          [],
          `${engine} reads ${parameter} but does not list it`,
        );
    }
  }
});

test('W1: a strategy offers the settings of the engine it draws with', () => {
  for (const [id, graph] of graphs) {
    assert.deepEqual(strategyParameters(graph, 'manual'), [], id);
    for (const type of strategies)
      assert.deepEqual(
        strategyParameters(graph, type),
        ENGINE_PARAMETERS[strategyEngine(graph, type).engine],
        `${id} / ${type}`,
      );
  }
  const bookshop = Object.fromEntries(graphs).exampleGraph,
    tree = Object.fromEntries(graphs).exampleTree;
  assert.deepEqual(strategyParameters(tree, 'auto'), ['spacing']);
  assert.deepEqual(strategyParameters(bookshop, 'force'), ['seed', 'spacing', 'iterations']);
  // Undated, the timeline strategy draws a tree: still spacing only.
  assert.deepEqual(strategyEngine(bookshop, 'timeline'), { engine: 'tree', reason: 'untimed' });
  assert.deepEqual(strategyParameters(bookshop, 'timeline'), ['spacing']);
});

test('W2: drawingOrigin says how layoutGraph drew each document', () => {
  const byId = Object.fromEntries(graphs);
  assert.deepEqual(drawingOrigin(byId.exampleLiterature), { kind: 'coordinates' });
  assert.deepEqual(drawingOrigin(byId.exampleGraph), {
    kind: 'structure',
    engine: 'flow',
    reason: 'structure',
  });
  assert.deepEqual(drawingOrigin(byId.exampleTree), {
    kind: 'structure',
    engine: 'tree',
    reason: 'diagram',
  });
  assert.deepEqual(drawingOrigin(byId.exampleTimeline), {
    kind: 'structure',
    engine: 'timeline',
    reason: 'diagram',
  });
  // Without dates a timeline diagram is drawn as a tree, and says so.
  const undated = {
    ...byId.exampleTimeline,
    nodes: byId.exampleTimeline.nodes.map((node) => ({
      ...node,
      span: undefined,
      visibility: undefined,
    })),
  };
  assert.deepEqual(drawingOrigin(undated), {
    kind: 'structure',
    engine: 'tree',
    reason: 'untimed',
  });
  // A stored strategy wins; positions stored by the project count as coordinates.
  const bookshop = byId.exampleGraph,
    shown = layoutGraph(bookshop),
    first = bookshop.nodes[0].id;
  assert.deepEqual(
    drawingOrigin({
      ...bookshop,
      project: { layout: { ...DEFAULT_LAYOUT_SETTINGS, type: 'grid' } },
    }),
    { kind: 'strategy', type: 'grid' },
  );
  assert.deepEqual(
    drawingOrigin({
      ...bookshop,
      project: { layout: { ...DEFAULT_LAYOUT_SETTINGS, positions: Object.fromEntries(shown) } },
    }),
    { kind: 'coordinates' },
  );
  assert.deepEqual(
    drawingOrigin({
      ...bookshop,
      project: { layout: { ...DEFAULT_LAYOUT_SETTINGS, positions: { [first]: shown.get(first) } } },
    }),
    { kind: 'partial', missing: bookshop.nodes.length - 1 },
  );
});
