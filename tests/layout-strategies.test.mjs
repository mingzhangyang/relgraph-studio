import {
  configWithLayoutPositions,
  dragHasChanges,
  cancelPositionDrag,
} from '../apps/studio/src/layout-history-model.ts';
import { ProjectHistory } from '../apps/studio/src/project-editor-model.ts';
import { test } from 'vitest';
import assert from 'node:assert/strict';
import literature from '../examples/honglou-provisional.relgraph.json' with { type: 'json' };
import biology from '../examples/biology-signaling-synthetic.json' with { type: 'json' };
import verified from '../datasets/honglou-chengjia-opening/graph.relgraph.json' with { type: 'json' };
import {
  computeLayout,
  DEFAULT_LAYOUT_SETTINGS,
} from '../packages/core/src/director/layout-strategies.ts';
import { loadDocument } from '../packages/core/src/director/load.ts';
import { createProject } from '../packages/core/src/project.ts';
import { layoutGraph } from '../packages/core/src/director/layout.ts';
import { directorFrameAt } from '../packages/core/src/director/state.ts';
const sorted = (map) => [...map].sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0));
for (const [domain, source] of [
  ['literature', literature],
  ['biology', biology],
  ['verified', verified],
])
  for (const type of ['force', 'circle', 'layered']) {
    test(`${domain}/${type}: deterministic, order-independent, immutable and saveable`, () => {
      const { graph } = loadDocument(source),
        before = JSON.stringify(graph),
        settings = { ...DEFAULT_LAYOUT_SETTINGS, type, mode: 'rearrange', seed: 42, spacing: 170 };
      const first = computeLayout(graph, settings),
        shuffled = {
          ...graph,
          nodes: [...graph.nodes].reverse(),
          edges: [...graph.edges].reverse(),
        };
      assert.deepEqual(sorted(computeLayout(shuffled, settings)), sorted(first));
      assert.equal(first.size, graph.nodes.length);
      for (const p of first.values()) assert.ok(Number.isFinite(p.x) && Number.isFinite(p.y));
      const configured = { ...settings, positions: Object.fromEntries(first) },
        round = loadDocument(
          JSON.parse(JSON.stringify(createProject(source, { layout: configured }))),
        );
      assert.equal(round.valid, true);
      assert.deepEqual(sorted(layoutGraph(round.graph)), sorted(first));
      for (const frame of [0, 24, 48, 24])
        assert.deepEqual(
          directorFrameAt(round.graph, first, frame),
          directorFrameAt(graph, first, frame),
        );
      assert.equal(JSON.stringify(graph), before);
    });
  }
test('preserve, missing and rearrange distinguish authored anchors from fallback; locks retain precision', () => {
  const { graph } = loadDocument(biology);
  graph.nodes[0].position = undefined;
  const current = layoutGraph(graph),
    id = graph.nodes[1].id;
  current.set(id, { x: 17.1234567, y: 23.7654321 });
  for (const type of ['force', 'circle', 'layered']) {
    const base = { ...DEFAULT_LAYOUT_SETTINGS, type };
    assert.deepEqual(computeLayout(graph, base, current), current);
    const missing = computeLayout(graph, { ...base, mode: 'missing' }, current);
    for (const node of graph.nodes)
      if (node.position) assert.deepEqual(missing.get(node.id), node.position);
    const locked = computeLayout(graph, { ...base, mode: 'rearrange', locked: [id] }, current);
    assert.deepEqual(locked.get(id), current.get(id));
  }
});
test('layered handles cycles, disconnected nodes, loops and parallel edges without reading labels', () => {
  const nodes = ['a', 'b', 'c', 'd', 'e'].map((id) => ({ id, kind: 'character', label: id }));
  const edge = (id, source, target) => ({
    id,
    source,
    target,
    directed: true,
    kind: 'family',
    label: '兄妹',
  });
  const graph = {
    domain: 'literature',
    meta: { title: 'test' },
    nodes,
    groups: [],
    scenes: [],
    edges: [
      edge('1', 'a', 'b'),
      edge('2', 'b', 'a'),
      edge('3', 'b', 'c'),
      edge('4', 'b', 'c'),
      edge('5', 'd', 'd'),
    ],
  };
  const settings = { ...DEFAULT_LAYOUT_SETTINGS, type: 'layered', mode: 'rearrange' };
  const result = computeLayout(graph, settings);
  assert.equal(result.get('a').y, result.get('b').y);
  assert.ok(result.get('c').y > result.get('b').y);
  assert.equal(new Set([...result.values()].map((p) => `${p.x}/${p.y}`)).size, 5);
  assert.deepEqual(
    computeLayout({ ...graph, edges: graph.edges.map((e) => ({ ...e, label: '父子' })) }, settings),
    result,
  );
});
test('layout validation rejects unsafe and unbounded numerical parameters', () => {
  const { graph } = loadDocument(biology);
  for (const invalid of [
    { seed: -1 },
    { seed: 1.1 },
    { iterations: 2001 },
    { spacing: 0 },
    { type: 'family' },
    { mode: 'random' },
  ])
    assert.throws(
      () => computeLayout(graph, { ...DEFAULT_LAYOUT_SETTINGS, ...invalid }),
      RangeError,
    );
});

test('manual/preserve missing-position fallback also ignores node and edge array order', () => {
  for (const source of [literature, biology, verified]) {
    const { graph } = loadDocument(source);
    graph.nodes = graph.nodes.map((n) => ({ ...n, position: undefined }));
    const reversed = {
      ...graph,
      nodes: [...graph.nodes].reverse(),
      edges: [...graph.edges].reverse(),
    };
    assert.deepEqual(
      sorted(computeLayout(graph, DEFAULT_LAYOUT_SETTINGS)),
      sorted(computeLayout(reversed, DEFAULT_LAYOUT_SETTINGS)),
    );
  }
});

test('individual coordinate/lock edits keep other fallback nodes eligible for missing-position layout', () => {
  const { graph } = loadDocument(literature);
  graph.nodes = graph.nodes.map((n) => ({ ...n, position: undefined }));
  const original = layoutGraph(graph),
    id = graph.nodes[0].id;
  const settings = { ...DEFAULT_LAYOUT_SETTINGS, type: 'force', mode: 'missing', locked: [id] };
  const config = configWithLayoutPositions({}, original, settings, [id]);
  assert.deepEqual(Object.keys(config.layout.positions), [id]);
  const next = computeLayout(graph, config.layout, original);
  assert.deepEqual(next.get(id), original.get(id));
  assert.ok(
    graph.nodes.some(
      (n) =>
        n.id !== id &&
        (next.get(n.id).x !== original.get(n.id).x || next.get(n.id).y !== original.get(n.id).y),
    ),
  );
  const owned = configWithLayoutPositions(config, original, settings, []);
  owned.layout.positions[id].x += 1;
  assert.deepEqual(
    config.layout.positions[id],
    original.get(id),
    'sparse snapshots do not alias previous coordinates',
  );
  const applied = configWithLayoutPositions(config, next, settings);
  assert.equal(Object.keys(applied.layout.positions).length, graph.nodes.length);
});
test('a no-move gesture preserves redo and unfinished movement cancels back to its exact point', () => {
  const current = new Map([['a', { x: 1.123456, y: 2.345678 }]]),
    drag = { id: 'a', pointerId: 1, previous: { ...current.get('a') }, start: { x: 0, y: 0 } };
  const history = new ProjectHistory();
  history.commit({ preset: 'quiet' });
  history.undo();
  if (dragHasChanges(drag, current))
    history.commit(configWithLayoutPositions(history.value, current, undefined, ['a']));
  assert.equal(history.canRedo, true);
  assert.equal(history.canUndo, false);
  current.set('a', { x: 45, y: 67 });
  assert.equal(dragHasChanges(drag, current), true);
  cancelPositionDrag(current, drag);
  assert.deepEqual(current.get('a'), drag.previous);
  assert.equal(dragHasChanges(drag, current), false);
});
test('force spacing preserves extreme finite anchors without scaling them', () => {
  const graph = {
    domain: 'neutral',
    meta: { title: 'huge' },
    nodes: [
      { id: 'a', kind: 'person', label: 'A', position: { x: 1.5e308, y: -1.5e308 } },
      { id: 'b', kind: 'person', label: 'B' },
    ],
    edges: [],
    groups: [],
    scenes: [],
  };
  for (const spacing of [64, 160, 400]) {
    const settings = {
      ...DEFAULT_LAYOUT_SETTINGS,
      type: 'force',
      mode: 'missing',
      spacing,
      locked: ['a'],
    };
    const current = layoutGraph(graph),
      result = computeLayout(graph, settings, current);
    assert.deepEqual(result.get('a'), graph.nodes[0].position);
    for (const point of result.values())
      assert.ok(Number.isFinite(point.x) && Number.isFinite(point.y));
    assert.deepEqual(
      sorted(computeLayout({ ...graph, nodes: [...graph.nodes].reverse() }, settings, current)),
      sorted(result),
    );
  }
});
