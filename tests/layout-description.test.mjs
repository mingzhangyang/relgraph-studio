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
import {
  graphTraits,
  layoutFit,
  strategyParameters,
} from '../packages/core/src/director/layout-strategies.ts';
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
      project: {
        layout: { ...DEFAULT_LAYOUT_SETTINGS, type: 'grid', positions: Object.fromEntries(shown) },
      },
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

test('W3: layoutFit says which strategies suit each example and what the others do', () => {
  const summary = (graph) =>
    Object.entries(layoutFit(graph).strategies)
      .map(([type, fit]) => `${type}:${fit.suits ? '+' : '-'}${fit.note}`)
      .join(' ');
  const byId = Object.fromEntries(graphs);
  assert.deepEqual(graphTraits(byId.exampleGraph), {
    dated: false,
    ranged: false,
    related: true,
    directed: true,
    acyclic: true,
    forest: false,
  });
  assert.equal(
    summary(byId.exampleGraph),
    'manual:+kept auto:+auto force:+any layered:+acyclic flow:+acyclic tree:-cycles ' +
      'mindmap:-cycles timeline:-untimed radial:-cycles circle:+any grid:+order',
  );
  assert.equal(
    summary(byId.exampleTree),
    'manual:+kept auto:+auto force:+any layered:+acyclic flow:+acyclic tree:+forest ' +
      'mindmap:+forest timeline:-untimed radial:+forest circle:+any grid:+order',
  );
  // Dates and no relations at all.
  assert.equal(
    summary(byId.exampleTimeline),
    'manual:+kept auto:+auto force:+any layered:-unrelated flow:-unrelated tree:-unrelated ' +
      'mindmap:-unrelated timeline:+dated radial:-unrelated circle:+any grid:+order',
  );
  // A process with a retry loop: flow reads the loop as feedback, layers do not.
  assert.equal(
    summary(byId.exampleFlowchart),
    'manual:+kept auto:+auto force:+any layered:-cyclic flow:+feedback tree:-cycles ' +
      'mindmap:-cycles timeline:-untimed radial:-cycles circle:+any grid:+order',
  );
  // Mostly undirected relations.
  assert.equal(graphTraits(byId.exampleLiterature).directed, false);
  assert.equal(layoutFit(byId.exampleLiterature).strategies.layered.note, 'undirected');
});

test('W3: what layoutFit says a strategy draws with is what planLayout draws with', () => {
  for (const [id, graph] of graphs) {
    const { strategies } = layoutFit(graph);
    assert.deepEqual(strategies.manual, { suits: true, note: 'kept', engine: null, reason: null });
    for (const type of strategies.auto ? LAYOUT_TYPES.filter((t) => t !== 'manual') : []) {
      const { engine, reason } = strategies[type];
      assert.deepEqual({ engine, reason }, strategyEngine(graph, type), `${id} / ${type}`);
    }
    // An unsuitable timeline says it draws a tree, and does.
    if (!strategies.timeline.suits) {
      assert.equal(strategies.timeline.note, 'untimed', id);
      assert.deepEqual(
        { engine: strategies.timeline.engine, reason: strategies.timeline.reason },
        { engine: 'tree', reason: 'untimed' },
        id,
      );
    }
  }
});

test('#46 review, P2: a stored type without coordinates for every node did not draw the picture', () => {
  const bookshop = Object.fromEntries(graphs).exampleGraph,
    shown = layoutGraph(bookshop),
    [first, second] = bookshop.nodes.map((n) => n.id),
    origin = (positions) =>
      drawingOrigin({
        ...bookshop,
        project: { layout: { ...DEFAULT_LAYOUT_SETTINGS, type: 'grid', positions } },
      });
  // A valid project may store a type with no positions: placeNodes ignores
  // the type and the structure draws, exactly as for manual.
  const automatic = { kind: 'structure', engine: 'flow', reason: 'structure' };
  assert.deepEqual(origin({}), automatic);
  const project = (positions) => ({
    ...bookshop,
    project: { layout: { ...DEFAULT_LAYOUT_SETTINGS, type: 'grid', positions } },
  });
  assert.deepEqual(
    [...layoutGraph(project({}))],
    [...shown],
    'the picture is the structural one, not a grid',
  );
  // Partial positions: placed beside, whatever the type says.
  const partial = { [first]: shown.get(first), [second]: shown.get(second) };
  assert.deepEqual(origin(partial), { kind: 'partial', missing: bookshop.nodes.length - 2 });
  // What Apply writes: a coordinate for every node.
  assert.deepEqual(origin(Object.fromEntries(shown)), { kind: 'strategy', type: 'grid' });
});

test('#46 review, P2: dates at one time are not "no dates"', () => {
  const timeline = example(examples.find((e) => e.id === 'exampleTimeline').file);
  const variant = (keep) => {
    const source = structuredClone(timeline);
    source.nodes.forEach((node, i) => {
      delete node.end;
      if (keep(i)) node.start = 2020;
      else delete node.start;
    });
    return loadDocument(source).graph;
  };
  const undated = variant(() => false),
    single = variant((i) => i === 0),
    same = variant(() => true);
  assert.deepEqual(
    [undated, single, same].map((graph) => {
      const { dated, ranged } = graphTraits(graph);
      return [dated, ranged];
    }),
    [
      [false, false],
      [true, false],
      [true, false],
    ],
  );
  for (const [graph, reason] of [
    [undated, 'untimed'],
    [single, 'instant'],
    [same, 'instant'],
  ]) {
    assert.equal(layoutFit(graph).strategies.timeline.note, reason);
    assert.equal(layoutFit(graph).strategies.timeline.suits, false);
    assert.deepEqual(strategyEngine(graph, 'timeline'), { engine: 'tree', reason });
    assert.deepEqual(strategyEngine(graph, 'auto'), { engine: 'tree', reason });
    const plan = planLayout(
      graph,
      { ...DEFAULT_LAYOUT_SETTINGS, type: 'timeline', mode: 'rearrange' },
      layoutGraph(graph),
    );
    assert.deepEqual([plan.engine, plan.reason], ['tree', reason]);
    assert.deepEqual(drawingOrigin(graph), { kind: 'structure', engine: 'tree', reason });
  }
});

test('#46 re-review, P3: a lone node without coordinates is not "stored coordinates"', () => {
  const lone = (node) =>
    loadDocument({
      format: 'relgraph.graph/1',
      title: 'Lone',
      nodes: [{ id: 'a', label: 'A', ...node }],
      relations: [],
    }).graph;
  // No coordinates anywhere: placeNodes puts it at the origin, no engine runs.
  const bare = lone({});
  assert.deepEqual(drawingOrigin(bare), { kind: 'single' });
  assert.deepEqual([...layoutGraph(bare)], [['a', { x: 0, y: 0 }]]);
  // Stored in the source or by the project, it is a stored coordinate.
  assert.deepEqual(drawingOrigin(lone({ position: { x: 40, y: 20 } })), { kind: 'coordinates' });
  assert.deepEqual(
    drawingOrigin({
      ...bare,
      project: { layout: { ...DEFAULT_LAYOUT_SETTINGS, positions: { a: { x: 40, y: 20 } } } },
    }),
    { kind: 'coordinates' },
  );
  // Two nodes without coordinates are still drawn from the structure.
  assert.equal(
    drawingOrigin({ ...bare, nodes: [...bare.nodes, { ...bare.nodes[0], id: 'b' }] }).kind,
    'structure',
  );
});
