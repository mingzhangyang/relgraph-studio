import { test } from 'vitest';
import assert from 'node:assert/strict';
import bookshop from '../examples/bookshop-systems-synthetic.graph.json' with { type: 'json' };
import {
  AUTO_LAYOUT_NODE_LIMIT,
  autoLayout,
  chooseLayoutEngine,
  LAYOUT_ENGINES,
  runLayoutEngine,
} from '../packages/core/src/director/layout-engines.ts';
import {
  computeLayout,
  DEFAULT_LAYOUT_SETTINGS,
  LAYOUT_TYPES,
} from '../packages/core/src/director/layout-strategies.ts';
import { layoutGraph, structuralLayout } from '../packages/core/src/director/layout.ts';
import { loadDocument } from '../packages/core/src/director/load.ts';
import { validateProjectConfig } from '../packages/core/src/project.ts';

const node = (id, extra = {}) => ({ id, label: id, kind: 'node', ...extra });
const edge = (source, target, extra = {}) => ({
  id: `${source}:${target}`,
  source,
  target,
  kind: 'link',
  ...extra,
});
const options = { seed: 7, spacing: 150, iterations: 300 };
const sorted = (map) => [...map].sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0));
const distance = (a, b) => Math.hypot(a.x - b.x, a.y - b.y);

// Four tight families with a few ties between them.
function families() {
  const nodes = [],
    edges = [];
  for (let g = 0; g < 4; g++)
    for (let i = 0; i < 6; i++) nodes.push(node(`g${g}-n${i}`, { groupId: `g${g}` }));
  for (let g = 0; g < 4; g++)
    for (let i = 0; i < 6; i++) {
      edges.push(edge(`g${g}-n${i}`, `g${g}-n${(i + 1) % 6}`));
      if (i % 2 === 0) edges.push(edge(`g${g}-n${i}`, `g${g}-n${(i + 2) % 6}`));
    }
  for (let g = 0; g < 4; g++) edges.push(edge(`g${g}-n0`, `g${(g + 1) % 4}-n3`));
  return { nodes, edges };
}
const tree = () => ({
  nodes: ['root', 'a', 'b', 'c', 'a1', 'a2', 'b1', 'c1', 'c2', 'c3'].map((id) => node(id)),
  edges: [
    ['root', 'a'],
    ['root', 'b'],
    ['root', 'c'],
    ['a', 'a1'],
    ['a', 'a2'],
    ['b', 'b1'],
    ['c', 'c1'],
    ['c', 'c2'],
    ['c', 'c3'],
  ].map(([s, t]) => edge(s, t)),
});
const pipeline = () => ({
  nodes: ['s1', 's2', 's3', 's4', 's5', 'side'].map((id) => node(id)),
  edges: [
    ['s1', 's2'],
    ['s2', 's3'],
    ['s3', 's4'],
    ['s4', 's5'],
    ['s2', 'side'],
  ].map(([s, t]) => edge(s, t, { directed: true })),
});

test('every engine is finite, complete, collision-free and repeatable', () => {
  for (const graph of [families(), tree(), pipeline(), { nodes: [node('solo')], edges: [] }])
    for (const engine of LAYOUT_ENGINES) {
      const first = runLayoutEngine(graph, engine, options);
      assert.equal(first.size, graph.nodes.length, engine);
      const points = [...first.values()];
      for (const p of points) assert.ok(Number.isFinite(p.x) && Number.isFinite(p.y), engine);
      for (let i = 0; i < points.length; i++)
        for (let j = i + 1; j < points.length; j++)
          assert.ok(distance(points[i], points[j]) > 40, `${engine}: nodes ${i} and ${j} collide`);
      assert.deepEqual(sorted(runLayoutEngine(graph, engine, options)), sorted(first), engine);
      assert.deepEqual([...first.keys()], [...first.keys()].sort(), `${engine}: ids are sorted`);
    }
  assert.equal(runLayoutEngine({ nodes: [], edges: [] }, 'force', options).size, 0);
  assert.equal(autoLayout({ nodes: [], edges: [] }).size, 0);
});

test('structural engines ignore JSON order; the grid keeps the author’s reading order', () => {
  const graph = families(),
    reversed = { nodes: [...graph.nodes].reverse(), edges: [...graph.edges].reverse() };
  for (const engine of ['force', 'layered', 'flow', 'radial', 'circle'])
    assert.deepEqual(
      sorted(runLayoutEngine(reversed, engine, options)),
      sorted(runLayoutEngine(graph, engine, options)),
      engine,
    );
  const list = { nodes: ['third', 'first', 'second'].map((id) => node(id)), edges: [] };
  const grid = runLayoutEngine(list, 'grid', options);
  // Rows read left to right, top to bottom, exactly as written.
  assert.ok(grid.get('third').x < grid.get('first').x);
  assert.equal(grid.get('third').y, grid.get('first').y);
  assert.ok(grid.get('second').y > grid.get('third').y);
  assert.equal(grid.get('second').x, grid.get('third').x);
});

test('the structure chooses the engine', () => {
  assert.equal(chooseLayoutEngine({ nodes: tree().nodes, edges: [] }), 'grid');
  assert.equal(chooseLayoutEngine(tree()), 'radial');
  assert.equal(chooseLayoutEngine(pipeline()), 'flow', 'a deep pipeline runs sideways');
  const broad = {
    nodes: ['top', ...Array.from({ length: 6 }, (_, i) => 'leaf' + i)].map((id) => node(id)),
    edges: Array.from({ length: 6 }, (_, i) => edge('top', 'leaf' + i, { directed: true })),
  };
  assert.equal(chooseLayoutEngine(broad), 'layered', 'a broad hierarchy runs downwards');
  assert.equal(chooseLayoutEngine(families()), 'force');
  const cycle = {
    nodes: ['a', 'b', 'c'].map((id) => node(id)),
    edges: [
      edge('a', 'b', { directed: true }),
      edge('b', 'c', { directed: true }),
      edge('c', 'a', { directed: true }),
    ],
  };
  assert.equal(chooseLayoutEngine(cycle), 'force', 'a directed cycle has no ranks to show');
  const { graph } = loadDocument(bookshop);
  assert.equal(chooseLayoutEngine(graph), 'flow');
});

test('no automatic choice puts a very large graph through the pairwise engine', () => {
  // A mesh: neither ranks nor a tree, so a small one is drawn with forces.
  const mesh = (n) => ({
    nodes: Array.from({ length: n }, (_, i) => node('n' + String(i).padStart(4, '0'))),
    edges: Array.from({ length: n }, (_, i) => [
      edge('n' + String(i).padStart(4, '0'), 'n' + String((i + 1) % n).padStart(4, '0')),
      edge('n' + String(i).padStart(4, '0'), 'n' + String((i * 7 + 3) % n).padStart(4, '0')),
    ])
      .flat()
      .filter((e) => e.source !== e.target),
  });
  assert.equal(chooseLayoutEngine(mesh(40)), 'force');
  const large = mesh(AUTO_LAYOUT_NODE_LIMIT + 1);
  assert.equal(chooseLayoutEngine(large), 'grid');
  const graph = { domain: 'graph', meta: { title: 'mesh' }, groups: [], scenes: [], ...large };
  const grid = sorted(runLayoutEngine(large, 'grid', { seed: 0, spacing: 150, iterations: 300 }));
  // The player, the CLI and the studio's "auto" all take that same choice.
  assert.deepEqual(sorted(autoLayout(large)), grid);
  assert.deepEqual(sorted(layoutGraph(graph)), sorted(structuralLayout(graph)));
  const studio = computeLayout(
    graph,
    { ...DEFAULT_LAYOUT_SETTINGS, type: 'auto', mode: 'rearrange', spacing: 150, iterations: 300 },
    new Map(graph.nodes.map((n) => [n.id, { x: 0, y: 0 }])),
  );
  assert.deepEqual(sorted(studio), sorted(structuralLayout(graph)));
});

test('force keeps groups together and apart from one another, on a landscape canvas', () => {
  const graph = families(),
    at = runLayoutEngine(graph, 'force', options);
  const centroid = (g) => {
    const members = graph.nodes.filter((n) => n.groupId === g).map((n) => at.get(n.id));
    return {
      x: members.reduce((sum, p) => sum + p.x / members.length, 0),
      y: members.reduce((sum, p) => sum + p.y / members.length, 0),
    };
  };
  // Compact groups with clear water between them: any two centres are
  // further apart than the two groups reach from their own centres.
  const names = ['g0', 'g1', 'g2', 'g3'];
  const reach = (g) => {
    const members = graph.nodes.filter((n) => n.groupId === g);
    return members.reduce(
      (sum, n) => sum + distance(at.get(n.id), centroid(g)) / members.length,
      0,
    );
  };
  for (const a of names)
    for (const b of names)
      if (a < b)
        assert.ok(
          distance(centroid(a), centroid(b)) > reach(a) + reach(b),
          `${a} and ${b} are drawn as separate places`,
        );
  const xs = [...at.values()].map((p) => p.x),
    ys = [...at.values()].map((p) => p.y);
  assert.ok(
    Math.max(...xs) - Math.min(...xs) > (Math.max(...ys) - Math.min(...ys)) * 1.2,
    'the arrangement is wider than tall',
  );
  // A group whose members no relation connects is still drawn as one place.
  const split = {
    nodes: [
      ...['a1', 'a2', 'a3', 'b1', 'b2', 'b3'].map((id) => node(id, { groupId: 'shared' })),
      ...['c1', 'c2', 'c3', 'c4'].map((id) => node(id, { groupId: 'other' })),
    ],
    edges: [
      edge('a1', 'a2'),
      edge('a2', 'a3'),
      edge('a3', 'a1'),
      edge('b1', 'b2'),
      edge('b2', 'b3'),
      edge('b3', 'b1'),
      edge('c1', 'c2'),
      edge('c2', 'c3'),
      edge('c3', 'c4'),
    ],
  };
  const placed = runLayoutEngine(split, 'force', options);
  // Nothing of the other group lies inside the shared group's extent.
  const shared = ['a1', 'a2', 'a3', 'b1', 'b2', 'b3'].map((id) => placed.get(id));
  const box = {
    left: Math.min(...shared.map((q) => q.x)),
    right: Math.max(...shared.map((q) => q.x)),
    top: Math.min(...shared.map((q) => q.y)),
    bottom: Math.max(...shared.map((q) => q.y)),
  };
  for (const id of ['c1', 'c2', 'c3', 'c4']) {
    const q = placed.get(id);
    assert.ok(
      q.x < box.left || q.x > box.right || q.y < box.top || q.y > box.bottom,
      `${id} stays outside the shared group`,
    );
  }
});

test('layered ranks run down, flow ranks run sideways, and both keep a rank aligned', () => {
  const graph = pipeline();
  const down = runLayoutEngine(graph, 'layered', options),
    across = runLayoutEngine(graph, 'flow', options);
  const chain = ['s1', 's2', 's3', 's4', 's5'];
  for (let i = 1; i < chain.length; i++) {
    assert.ok(down.get(chain[i]).y > down.get(chain[i - 1]).y);
    assert.ok(across.get(chain[i]).x > across.get(chain[i - 1]).x);
  }
  assert.equal(down.get('side').y, down.get('s3').y, 'siblings share a rank');
  assert.equal(across.get('side').x, across.get('s3').x);
  // A parent sits centred over its children.
  const fan = {
    nodes: ['p', 'c1', 'c2', 'c3'].map((id) => node(id)),
    edges: ['c1', 'c2', 'c3'].map((id) => edge('p', id, { directed: true })),
  };
  const drawn = runLayoutEngine(fan, 'layered', options);
  assert.ok(Math.abs(drawn.get('p').x - drawn.get('c2').x) < 1e-6);
  assert.ok(Math.abs(drawn.get('c1').x + drawn.get('c3').x - 2 * drawn.get('c2').x) < 1e-6);
});

test('layered ordering untangles what id order would cross', () => {
  // Sorted by id the lower row would be a1, a2, b1, b2 under parents z, y: every edge crosses.
  const graph = {
    nodes: ['root', 'y', 'z', 'a1', 'a2', 'b1', 'b2'].map((id) => node(id)),
    edges: [
      ['root', 'y'],
      ['root', 'z'],
      ['z', 'a1'],
      ['z', 'a2'],
      ['y', 'b1'],
      ['y', 'b2'],
    ].map(([s, t]) => edge(s, t, { directed: true })),
  };
  const at = runLayoutEngine(graph, 'layered', options);
  const side = (id) => Math.sign(at.get(id).x - at.get('root').x);
  assert.equal(side('a1'), side('z'));
  assert.equal(side('a2'), side('z'));
  assert.equal(side('b1'), side('y'));
  assert.equal(side('b2'), side('y'));
  assert.notEqual(side('y'), side('z'));
});

test('radial puts the centre of the tree in the middle and its rings in order', () => {
  const graph = tree(),
    at = runLayoutEngine(graph, 'radial', { ...options, seed: 0 });
  const root = at.get('root');
  const ring = (id) => Math.hypot((at.get(id).x - root.x) / 1.45, (at.get(id).y - root.y) / 0.9);
  for (const child of ['a', 'b', 'c']) assert.ok(Math.abs(ring(child) - ring('a')) < 0.02);
  for (const leaf of ['a1', 'a2', 'b1', 'c1', 'c2', 'c3']) assert.ok(ring(leaf) > ring('a') + 50);
});

test('the ring keeps each group contiguous', () => {
  const graph = families(),
    at = runLayoutEngine(graph, 'circle', options);
  const order = [...graph.nodes]
    .map((n) => ({ group: n.groupId, angle: Math.atan2(at.get(n.id).y, at.get(n.id).x) }))
    .sort((a, b) => a.angle - b.angle)
    .map((entry) => entry.group);
  let changes = 0;
  order.forEach((group, i) => {
    if (group !== order[(i + 1) % order.length]) changes++;
  });
  assert.equal(changes, 4, 'four groups, four boundaries');
  const radii = [...at.values()].map((p) => Math.hypot(p.x, p.y));
  assert.ok(Math.max(...radii) - Math.min(...radii) < 0.02);
});

test('force settles free nodes around fixed ones without moving them', () => {
  const graph = families();
  const fixed = new Map([
    ['g0-n0', { x: 1000.125, y: -250.5 }],
    ['g2-n3', { x: 1600, y: 90 }],
  ]);
  const at = runLayoutEngine(graph, 'force', { ...options, fixed });
  for (const [id, p] of fixed) assert.deepEqual(at.get(id), p);
  // Free neighbours of an anchor settle beside it.
  for (const id of ['g0-n2', 'g0-n4'])
    assert.ok(distance(at.get(id), fixed.get('g0-n0')) < options.spacing * 2.5, id);
  for (const p of at.values()) assert.ok(Math.abs(p.x) < 5000 && Math.abs(p.y) < 5000);
});

test('a document without coordinates is drawn from its structure, deterministically', () => {
  const { graph } = loadDocument(bookshop);
  const first = layoutGraph(graph);
  assert.deepEqual(sorted(layoutGraph(graph)), sorted(first));
  assert.equal(first.size, graph.nodes.length);
  // Left to right along the calls: entrances, gateway, services, stores.
  const x = (label) => first.get(graph.nodes.find((n) => n.label === label).id).x;
  assert.ok(x('网页') < x('网关') && x('网关') < x('订单') && x('订单') < x('订单库'));
  for (const p of first.values()) {
    assert.equal(p.x, Math.round(p.x * 100) / 100);
    assert.equal(p.y, Math.round(p.y * 100) / 100);
  }
  // One authored coordinate switches to the conservative fallback that never moves it.
  const pinned = structuredClone(graph);
  pinned.nodes[0].position = { x: 12.5, y: -3 };
  assert.deepEqual(layoutGraph(pinned).get(pinned.nodes[0].id), { x: 12.5, y: -3 });
});

test('every stored strategy computes, honours locks and validates in a project', () => {
  const { graph } = loadDocument(bookshop),
    current = layoutGraph(graph),
    locked = graph.nodes[3].id;
  current.set(locked, { x: 17.1234567, y: 23.7654321 });
  assert.deepEqual([...LAYOUT_TYPES].sort(), ['manual', 'auto', ...LAYOUT_ENGINES].sort());
  for (const type of LAYOUT_TYPES) {
    const settings = { ...DEFAULT_LAYOUT_SETTINGS, type, mode: 'rearrange', locked: [locked] };
    const result = computeLayout(graph, settings, current);
    assert.equal(result.size, graph.nodes.length, type);
    assert.deepEqual(result.get(locked), current.get(locked), `${type}: the lock holds exactly`);
    for (const [id, p] of result) {
      assert.ok(Number.isFinite(p.x) && Number.isFinite(p.y), type);
      if (id !== locked)
        assert.ok(distance(p, current.get(locked)) > 20, `${type}: ${id} avoids the locked node`);
    }
    assert.deepEqual(
      validateProjectConfig(
        { layout: { ...settings, positions: Object.fromEntries(result) } },
        graph,
      ),
      [],
      type,
    );
  }
  assert.ok(
    validateProjectConfig({ layout: { ...DEFAULT_LAYOUT_SETTINGS, type: 'spiral' } }).includes(
      'config.layout.type',
    ),
  );
});
