// ADR 004, D2b: neighbour-aware incremental placement. Existing coordinates
// never move, whatever the engine; new nodes go beside the nodes they relate to.
import { test } from 'vitest';
import assert from 'node:assert/strict';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import bookshop from '../examples/bookshop-systems-synthetic.graph.json' with { type: 'json' };
import tree from '../examples/vertebrates-tree-provisional.graph.json' with { type: 'json' };
import dynasties from '../examples/dynasties-timeline-provisional.graph.json' with { type: 'json' };
import flowchart from '../examples/order-flowchart-synthetic.graph.json' with { type: 'json' };
import mindmap from '../examples/reading-club-mindmap-synthetic.graph.json' with { type: 'json' };
import egfr from '../examples/biology-egfr-mapk.json' with { type: 'json' };
import literature from '../examples/honglou-provisional.relgraph.json' with { type: 'json' };
import { loadDocument } from '../packages/core/src/director/load.ts';
import { layoutGraph } from '../packages/core/src/director/layout.ts';
import { runLayoutEngine } from '../packages/core/src/director/layout-engines.ts';
import {
  DEFAULT_LAYOUT_SETTINGS,
  planLayout,
  strategyEngine,
} from '../packages/core/src/director/layout-strategies.ts';
import {
  alignDrawings,
  placeIncrementally,
  typicalGap,
} from '../packages/core/src/director/incremental-placement.ts';
import { LAYOUT_DEFAULTS, LAYOUT_ENGINES } from '../packages/core/src/project-layout.ts';
import { anchorToTime, timeAnchor } from '../packages/core/src/director/time-anchor.ts';
import { placeInTime, timeAxis } from '../packages/core/src/graph/time-axis.ts';
import { prepare } from '../packages/core/src/graph/analysis.ts';
import { applyGraphPositions } from '../packages/core/src/director/position-writeback.ts';
import { layoutFile } from '../packages/cli/src/layout.ts';
import { chronologyInversions } from '../packages/core/src/director/chronology.ts';

const SOURCES = { bookshop, tree, dynasties, flowchart, mindmap, egfr, literature };
const load = (doc) => {
  const result = loadDocument(doc);
  assert.equal(result.valid, true, JSON.stringify(result.errors));
  return result.graph;
};
const byLabel = (graph, label) => graph.nodes.find((n) => n.label === label);
const sortedEntries = (map) => [...map].sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0));
/** Every third node, by id, loses its coordinates; the others keep the player's. */
const partly = (source) => {
  const graph = load(source),
    full = layoutGraph(graph),
    ids = graph.nodes.map((n) => n.id).sort();
  const dropped = new Set(ids.filter((_, i) => i % 3 === 1));
  const positions = Object.fromEntries(
    ids.filter((id) => !dropped.has(id)).map((id) => [id, { ...full.get(id) }]),
  );
  const bare = { ...graph, nodes: graph.nodes.map((n) => ({ ...n, position: undefined })) };
  return { graph: bare, positions, dropped, full };
};
const missing = (type, positions, extra = {}) => ({
  ...DEFAULT_LAYOUT_SETTINGS,
  type,
  mode: 'missing',
  positions,
  ...extra,
});

for (const [name, source] of Object.entries(SOURCES))
  for (const type of LAYOUT_ENGINES)
    test(`${name}/${type}: missing mode moves no existing coordinate and places every new node`, () => {
      const { graph, positions, dropped, full } = partly(source);
      if (!dropped.size) return;
      const settings = missing(type, positions),
        plan = planLayout(graph, settings, full);
      assert.equal(plan.engine, strategyEngine(graph, type).engine);
      assert.equal(plan.positions.size, graph.nodes.length);
      for (const [id, p] of Object.entries(positions))
        assert.deepEqual(plan.positions.get(id), p, `${id} kept`);
      for (const p of plan.positions.values())
        assert.ok(Number.isFinite(p.x) && Number.isFinite(p.y));
      // No two nodes share a point.
      assert.equal(
        new Set([...plan.positions.values()].map((p) => p.x + '/' + p.y)).size,
        graph.nodes.length,
      );
      // A lock holds its current point exactly, even where the source has none.
      const locked = [...dropped][0],
        current = new Map(full).set(locked, { x: 12.345, y: -6.789 }),
        held = planLayout(graph, missing(type, positions, { locked: [locked] }), current);
      const axis = timeAnchor(graph, type);
      if (
        !axis ||
        placeInTime(
          graph.nodes.find((n) => n.id === locked),
          axis,
        ) === null
      )
        assert.deepEqual(held.positions.get(locked), { x: 12.345, y: -6.789 });
      for (const [id, p] of Object.entries(positions))
        assert.deepEqual(held.positions.get(id), p, `${id} kept beside a lock`);
      // Deterministic, and independent of array order wherever the engine is
      // (grid, tree and mind map keep the author's reading order on purpose).
      const engine = strategyEngine(graph, type).engine;
      if (!['force', 'layered', 'flow', 'radial', 'circle'].includes(engine)) return;
      const shuffled = {
        ...graph,
        nodes: [...graph.nodes].reverse(),
        edges: [...graph.edges].reverse(),
      };
      assert.deepEqual(
        sortedEntries(planLayout(shuffled, settings, full).positions),
        sortedEntries(plan.positions),
      );
    });

test('every engine is covered by the no-move invariant on a timeline that keeps time', () => {
  // `timeline` and `auto` keep time on the dynasties example; the others leave the axis.
  const { graph, positions } = partly(dynasties);
  for (const type of LAYOUT_ENGINES) {
    const plan = planLayout(graph, missing(type, positions));
    assert.equal(plan.anchored, type === 'timeline', type);
    for (const [id, p] of Object.entries(positions)) assert.deepEqual(plan.positions.get(id), p);
  }
});

test('relgraph layout keeps every coordinate written in the file, for every diagram kind', async () => {
  const folder = await mkdtemp(join(tmpdir(), 'relgraph-d2b-'));
  try {
    for (const [name, source] of Object.entries(SOURCES)) {
      const graph = load(source);
      if (graph.nodes.length < 3) continue;
      const { document } = applyGraphPositions(source, graph, layoutGraph(graph));
      const entries = [
        ...(document.nodes ?? []),
        ...(document.characters ?? []),
        ...(document.entities ?? []),
        ...(document.processes ?? []),
      ].filter((entry) => typeof entry === 'object');
      entries.forEach((entry, i) => {
        if (i % 3 === 1) delete entry.position;
      });
      const file = join(folder, name + '.json'),
        out = join(folder, name + '.out.json');
      await writeFile(file, JSON.stringify(document, null, 2) + '\n');
      const summary = await layoutFile({ file, out, seed: 0, write: false });
      assert.ok(summary.missing > 0, name);
      const written = JSON.parse(await readFile(out, 'utf8'));
      const after = [
        ...(written.nodes ?? []),
        ...(written.characters ?? []),
        ...(written.entities ?? []),
        ...(written.processes ?? []),
      ].filter((entry) => typeof entry === 'object');
      assert.equal(after.length, entries.length);
      entries.forEach((entry, i) => {
        if (entry.position) assert.deepEqual(after[i].position, entry.position, `${name} ${i}`);
        else assert.ok(after[i].position, `${name} ${i} filled`);
      });
      assert.equal(loadDocument(written).valid, true);
    }
  } finally {
    await rm(folder, { recursive: true, force: true });
  }
});

test('a drawing made by the engine gets each new node back where the engine puts it', () => {
  // A small hierarchy: every engine draws it with room to spare.
  const nodes = ['r', 'a', 'b', 'c', 'a1', 'a2', 'b1', 'c1'].map((id) => ({
    id,
    kind: 'item',
    label: id,
  }));
  const link = (source, target) => ({
    id: source + '-' + target,
    source,
    target,
    kind: 'part',
    directed: true,
  });
  const graph = {
    domain: 'neutral',
    meta: { title: 'hierarchy' },
    nodes,
    edges: [
      link('r', 'a'),
      link('r', 'b'),
      link('r', 'c'),
      link('a', 'a1'),
      link('a', 'a2'),
      link('b', 'b1'),
      link('c', 'c1'),
    ],
    groups: [],
    scenes: [],
  };
  const options = { seed: 0, ...LAYOUT_DEFAULTS };
  for (const engine of ['layered', 'flow', 'tree', 'mindmap', 'radial', 'grid']) {
    const drawn = runLayoutEngine(graph, engine, options);
    const round = (v) => Math.round(v * 100) / 100;
    for (const leaf of ['a2', 'b1', 'c1']) {
      const anchors = new Map(
        [...drawn]
          .filter(([id]) => id !== leaf)
          .map(([id, p]) => [id, { x: round(p.x), y: round(p.y) }]),
      );
      const placed = placeIncrementally(graph, anchors, { engine, ...options });
      const want = drawn.get(leaf),
        got = placed.get(leaf);
      assert.ok(
        Math.hypot(got.x - want.x, got.y - want.y) < 1,
        `${engine}/${leaf}: ${JSON.stringify(got)} vs ${JSON.stringify(want)}`,
      );
    }
  }
});

test('a new node joins the people it knows, clear of everyone else and their relations', () => {
  // Two groups drawn by hand far apart; the newcomer knows only people on the right.
  const person = (id, x, y) => ({ id, kind: 'person', label: id, position: { x, y } });
  const edge = (source, target) => ({ id: source + target, source, target, kind: 'knows' });
  const graph = {
    domain: 'neutral',
    meta: { title: 'two circles' },
    nodes: [
      person('L1', -900, 0),
      person('L2', -700, -120),
      person('L3', -700, 120),
      person('R1', 700, -120),
      person('R2', 700, 120),
      person('R3', 900, 0),
      { id: 'N', kind: 'person', label: 'N' },
    ],
    edges: [
      edge('L1', 'L2'),
      edge('L1', 'L3'),
      edge('R1', 'R2'),
      edge('R1', 'R3'),
      edge('R2', 'R3'),
      edge('N', 'R1'),
      edge('N', 'R2'),
    ],
    groups: [],
    scenes: [],
  };
  const anchors = new Map(graph.nodes.filter((n) => n.position).map((n) => [n.id, n.position]));
  for (const engine of LAYOUT_ENGINES) {
    const placed = placeIncrementally(graph, anchors, { engine, seed: 0, ...LAYOUT_DEFAULTS });
    const n = placed.get('N'),
      dist = (id) => Math.hypot(n.x - placed.get(id).x, n.y - placed.get(id).y);
    assert.ok(Math.max(dist('R1'), dist('R2')) < Math.min(dist('L1'), dist('L2'), dist('L3')));
    assert.ok(Math.max(dist('R1'), dist('R2')) < 600, `${engine}: ${JSON.stringify(n)}`);
    // Keeps the engines' room from every other node.
    for (const [id, p] of placed)
      if (id !== 'N')
        assert.ok(Math.hypot((p.x - n.x) / 108, (p.y - n.y) / 72) >= 1, `${engine}: N near ${id}`);
    // Neither does R1—R2 pass beside N, nor N's relations beside R3.
    const beside = (p, a, b) => {
      const dx = b.x - a.x,
        dy = b.y - a.y,
        u = ((p.x - a.x) * dx + (p.y - a.y) * dy) / (dx * dx + dy * dy);
      return u > 0 && u < 1 && Math.hypot(p.x - a.x - u * dx, p.y - a.y - u * dy) < 45;
    };
    assert.ok(!beside(n, placed.get('R1'), placed.get('R2')), engine);
    assert.ok(!beside(placed.get('R3'), n, placed.get('R1')), engine);
    assert.ok(!beside(placed.get('R3'), n, placed.get('R2')), engine);
  }
});

test('a newcomer known only to another newcomer follows it; one known to nobody joins its group', () => {
  const graph = load({
    format: 'relgraph.graph/1',
    groups: [{ id: 'west' }, { id: 'east' }],
    nodes: [
      { id: 'w1', group: 'west', position: { x: -800, y: 0 } },
      { id: 'w2', group: 'west', position: { x: -600, y: 100 } },
      { id: 'e1', group: 'east', position: { x: 600, y: 0 } },
      { id: 'e2', group: 'east', position: { x: 800, y: 100 } },
      { id: 'n1', group: 'east' },
      { id: 'n2' },
      { id: 'lonely', group: 'west' },
    ],
    edges: [
      { source: 'w1', target: 'w2' },
      { source: 'e1', target: 'e2' },
      { source: 'n1', target: 'e1' },
      { source: 'n2', target: 'n1' },
    ],
  });
  const anchors = new Map(graph.nodes.filter((n) => n.position).map((n) => [n.id, n.position]));
  const placed = placeIncrementally(graph, anchors, {
    engine: 'force',
    seed: 0,
    ...LAYOUT_DEFAULTS,
  });
  const at = (label) => placed.get(byLabel(graph, label).id);
  assert.ok(at('n1').x > 0 && at('n2').x > 0, 'east, through n1');
  assert.ok(at('lonely').x < 0, 'west, with its group');
});

test('on a timeline that keeps time a new dated node takes the free lane nearest its neighbours', () => {
  const graph = load(dynasties),
    saved = applyGraphPositions(dynasties, graph, layoutGraph(graph)).document;
  const lanes = [...new Set(saved.nodes.map((n) => n.position.y))].sort((a, b) => a - b);
  // A short state in the last years of 南宋 (the bottom lane), related to it.
  const song = saved.nodes.find((n) => n.id === '南宋');
  const source = structuredClone(saved);
  source.nodes.push({ id: '新', kind: '宋辽金', start: 1240, end: 1260 });
  source.edges = [{ source: '新', target: '南宋', kind: '相关' }];
  const before = load(source),
    axis = timeAnchor(before);
  assert.ok(axis);
  const anchors = new Map(
    before.nodes.filter((n) => n.position).map((n) => [n.id, { ...n.position }]),
  );
  const placed = placeIncrementally(before, anchors, {
    engine: 'timeline',
    seed: 0,
    ...LAYOUT_DEFAULTS,
    axis,
  });
  const id = byLabel(before, '新').id,
    fresh = placed.get(id);
  assert.equal(fresh.x, Math.round(placeInTime(byLabel(before, '新'), axis) * 100) / 100);
  // 南宋's lane and the one above it (金) are taken at these years, so the
  // nearest free lane is a new one just below 南宋.
  const step = Math.min(...lanes.slice(1).map((y, i) => y - lanes[i]));
  assert.equal(song.position.y, lanes.at(-1));
  assert.equal(fresh.y, song.position.y + step);
  for (const [key, p] of anchors) assert.deepEqual(placed.get(key), p);

  // The first free lane, top down, is what the player still uses: unchanged by D2b.
  const player = layoutGraph(before);
  const first = new Map([...player].filter(([key]) => key !== id)).set(id, { x: 0, y: 0 });
  anchorToTime(before, first, { unplaced: new Set([id]) });
  assert.deepEqual(player.get(id), first.get(id));
  // With neighbours the same call follows them instead.
  const near = new Map(first).set(id, { x: 0, y: 0 });
  anchorToTime(before, near, { unplaced: new Set([id]), neighbours: prepare(before).neighbours });
  assert.deepEqual(near.get(id), fresh);
  // The player's first free lane, top down, is far from 南宋.
  assert.ok(song.position.y - first.get(id).y > step, String(first.get(id).y));
});

test('a new dated node with neighbours in no lane, and none in its group, takes the first free lane', () => {
  const graph = load(dynasties),
    saved = applyGraphPositions(dynasties, graph, layoutGraph(graph)).document;
  const source = structuredClone(saved);
  source.nodes.push({ id: '新', start: 1380, end: 1390 });
  const g = load(source),
    axis = timeAnchor(g);
  const anchors = new Map(g.nodes.filter((n) => n.position).map((n) => [n.id, { ...n.position }]));
  const placed = placeIncrementally(g, anchors, {
    engine: 'timeline',
    seed: 0,
    ...LAYOUT_DEFAULTS,
    axis,
  });
  const player = layoutGraph(g),
    id = byLabel(g, '新').id;
  assert.deepEqual(placed.get(id), player.get(id));
  assert.ok(timeAxis(g.nodes));
});

test('alignDrawings recovers a rotation, a mirror and a scale, and says how well it fits', () => {
  const points = [
    { x: 0, y: 0 },
    { x: 100, y: 0 },
    { x: 0, y: 50 },
    { x: 70, y: 90 },
  ];
  const turn = (p, angle, scale, mirror) => {
    const y = mirror ? -p.y : p.y;
    return {
      x: scale * (Math.cos(angle) * p.x - Math.sin(angle) * y) + 5,
      y: scale * (Math.sin(angle) * p.x + Math.cos(angle) * y) - 7,
    };
  };
  for (const mirror of [false, true]) {
    const target = points.map((p) => turn(p, 0.7, 1.5, mirror)),
      fit = alignDrawings(points.map((p, i) => [p, target[i]]));
    assert.ok(fit.weight > 0.999);
    const v = fit.apply({ x: 10, y: 20 }),
      w = turn({ x: 10, y: 20 }, 0.7, 1.5, mirror);
    assert.ok(Math.hypot(v.x - (w.x - 5), v.y - (w.y + 7)) < 1e-6, JSON.stringify(v));
  }
  // Unrelated drawings explain little of each other.
  const scrambled = alignDrawings(
    points.map((p, i) => [
      p,
      [
        { x: 0, y: 0 },
        { x: 0, y: 100 },
        { x: 100, y: 100 },
        { x: 100, y: 0 },
      ][(i * 3) % 4],
    ]),
  );
  assert.ok(scrambled.weight < 0.5, String(scrambled.weight));
  // Nothing to align: the engine's own orientation.
  assert.deepEqual(
    alignDrawings([
      [
        { x: 1, y: 2 },
        { x: 5, y: 5 },
      ],
    ]).apply({ x: 3, y: 4 }),
    {
      x: 3,
      y: 4,
    },
  );
  assert.equal(
    typicalGap([
      { x: 0, y: 0 },
      { x: 3, y: 4 },
      { x: 100, y: 0 },
    ]),
    5,
  );
});

test('the room scales with the drawing: a sparse drawing gets proportionally more room', () => {
  const nodes = ['a', 'b', 'c', 'd', 'e'].map((id) => ({ id, kind: 'item', label: id }));
  const graph = {
    domain: 'neutral',
    meta: { title: 'chain' },
    nodes,
    edges: [
      { id: '1', source: 'a', target: 'b', kind: 'k' },
      { id: '2', source: 'b', target: 'c', kind: 'k' },
      { id: '3', source: 'c', target: 'd', kind: 'k' },
      { id: '4', source: 'd', target: 'e', kind: 'k' },
    ],
    groups: [],
    scenes: [],
  };
  const options = { engine: 'force', seed: 0, ...LAYOUT_DEFAULTS };
  const drawn = runLayoutEngine(graph, 'force', options);
  const scaled = (k) =>
    new Map(
      [...drawn].filter(([id]) => id !== 'c').map(([id, p]) => [id, { x: p.x * k, y: p.y * k }]),
    );
  const nearest = (placed) =>
    Math.min(
      ...['a', 'b', 'd', 'e'].map((id) =>
        Math.hypot(placed.get(id).x - placed.get('c').x, placed.get(id).y - placed.get('c').y),
      ),
    );
  const one = nearest(placeIncrementally(graph, scaled(1), options)),
    three = nearest(placeIncrementally(graph, scaled(3), options));
  assert.ok(three > one * 2, `${three} vs ${one}`);
});

test('with a chronology tolerance a new node keeps time in order along x', () => {
  // x means time here, but the drawing is a network, not a timeline that keeps it.
  const person = (id, from, x) => ({
    id,
    kind: 'person',
    label: id,
    visibility: { from },
    position: { x, y: 0 },
  });
  const graph = {
    domain: 'neutral',
    meta: { title: 'generations' },
    nodes: [
      person('A', 0, 0),
      person('B', 100, 1000),
      person('C', 200, 2000),
      { id: 'N', kind: 'person', label: 'N', visibility: { from: 150 } },
    ],
    // N knows only A, so its barycentre lies at A, before B in time.
    edges: [{ id: 'NA', source: 'N', target: 'A', kind: 'knows' }],
    groups: [],
    scenes: [],
  };
  const anchors = new Map(graph.nodes.filter((n) => n.position).map((n) => [n.id, n.position]));
  const options = { engine: 'force', seed: 0, ...LAYOUT_DEFAULTS };
  const free = placeIncrementally(graph, anchors, options);
  assert.ok(chronologyInversions(graph, free, 20).length > 0, 'without the option time inverts');
  for (const tolerance of [0, 20, 49]) {
    const kept = placeIncrementally(graph, anchors, { ...options, chronologyTolerance: tolerance });
    assert.deepEqual(chronologyInversions(graph, kept, tolerance), [], String(tolerance));
    const n = kept.get('N');
    assert.ok(n.x > 1000 && n.x < 2000, JSON.stringify(n));
    for (const [id, p] of anchors) assert.deepEqual(kept.get(id), p);
  }
  // Beyond the gap to B and C nothing constrains N.
  const loose = placeIncrementally(graph, anchors, { ...options, chronologyTolerance: 51 });
  assert.deepEqual(loose.get('N'), free.get('N'));
  // Anchors already out of order leave no room: N is still placed, nothing moves.
  const tangled = new Map(anchors).set('B', { x: 2500, y: 0 });
  const placed = placeIncrementally(graph, tangled, { ...options, chronologyTolerance: 20 });
  assert.ok(placed.get('N'));
  for (const [id, p] of tangled) assert.deepEqual(placed.get(id), p);
  // A window narrower than the room still holds the node, above or below.
  const narrow = new Map([
    ['A', { x: 0, y: 0 }],
    ['B', { x: 10, y: 0 }],
    ['C', { x: 20, y: 0 }],
  ]);
  const squeezed = placeIncrementally(graph, narrow, { ...options, chronologyTolerance: 20 });
  assert.ok(squeezed.get('N').x > 10 && squeezed.get('N').x < 20, JSON.stringify(squeezed));
  assert.deepEqual(chronologyInversions(graph, squeezed, 20), []);
  assert.throws(
    () => placeIncrementally(graph, anchors, { ...options, chronologyTolerance: -1 }),
    RangeError,
  );
});

test('relgraph layout --chronology-tolerance keeps time in order while filling gaps', async () => {
  const folder = await mkdtemp(join(tmpdir(), 'relgraph-d2b-chrono-'));
  try {
    const source = {
      format: 'relgraph.graph/1',
      nodes: [
        { id: 'A', visibleFrom: 0, position: { x: 0, y: 0 } },
        { id: 'B', visibleFrom: 100, position: { x: 1000, y: 0 } },
        { id: 'C', visibleFrom: 200, position: { x: 2000, y: 0 } },
        { id: 'N', visibleFrom: 150 },
      ],
      edges: [{ source: 'N', target: 'A' }],
    };
    const file = join(folder, 'chrono.json');
    await writeFile(file, JSON.stringify(source, null, 2) + '\n');
    for (const [name, tolerance] of [
      ['plain.json', undefined],
      ['ordered.json', 20],
    ]) {
      const out = join(folder, name);
      await layoutFile({
        file,
        out,
        seed: 0,
        write: false,
        ...(tolerance === undefined ? {} : { chronologyTolerance: tolerance }),
      });
      const written = JSON.parse(await readFile(out, 'utf8')),
        n = written.nodes.find((node) => node.id === 'N').position;
      assert.deepEqual(
        written.nodes.filter((node) => node.id !== 'N').map((node) => node.position),
        source.nodes.filter((node) => node.position).map((node) => node.position),
      );
      if (tolerance === undefined) assert.ok(n.x < 1000, JSON.stringify(n));
      else assert.ok(n.x > 1000 && n.x < 2000, JSON.stringify(n));
    }
  } finally {
    await rm(folder, { recursive: true, force: true });
  }
});
