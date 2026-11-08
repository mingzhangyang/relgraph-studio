import { test } from 'vitest';
import assert from 'node:assert/strict';
import { chmod, mkdtemp, readFile, rm, stat, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import literature from '../examples/honglou-provisional.relgraph.json' with { type: 'json' };
import biology from '../examples/biology-signaling-synthetic.json' with { type: 'json' };
import { loadDocument } from '../packages/core/src/director/load.ts';
import { layoutMissingNodes } from '../packages/core/src/director/seeded-layout.ts';
import { layoutFile, LayoutError } from '../packages/cli/src/layout.ts';

const graphOf = (document) => {
  const result = loadDocument(document);
  assert.equal(result.valid, true);
  return result.graph;
};

test('seeded missing-node layout is reproducible across graph array order and leaves anchors untouched', () => {
  const source = structuredClone(literature);
  delete source.characters[0].position;
  delete source.characters[3].position;
  delete source.characters[7].position;
  const graph = graphOf(source);
  const first = layoutMissingNodes(graph, { seed: 42 });
  const again = layoutMissingNodes(graph, { seed: 42 });
  assert.deepEqual([...first], [...again]);
  const reordered = {
    ...graph,
    nodes: [...graph.nodes].reverse(),
    edges: [...graph.edges].reverse(),
  };
  assert.deepEqual([...first], [...layoutMissingNodes(reordered, { seed: 42 })]);
  for (const node of graph.nodes) {
    const point = first.get(node.id);
    assert.equal(Number.isFinite(point.x) && Number.isFinite(point.y), true);
    if (node.position) assert.deepEqual(point, node.position);
  }
  assert.notDeepEqual(
    [first.get(graph.nodes[0].id), first.get(graph.nodes[3].id)],
    [layoutMissingNodes(graph, { seed: 77 }).get(graph.nodes[0].id),
      layoutMissingNodes(graph, { seed: 77 }).get(graph.nodes[3].id)],
  );
  assert.throws(() => layoutMissingNodes(graph, { seed: -1 }), RangeError);
});

test('biology process and missing entities receive separate positions without moving authored nodes', () => {
  const source = structuredClone(biology);
  delete source.entities[1].position;
  const graph = graphOf(source);
  const points = layoutMissingNodes(graph, { seed: 1 });
  assert.ok(points.has('bio:process:phosphorylation-test'));
  assert.ok(points.has(source.entities[1].id));
  assert.deepEqual(points.get('kinase-k'), source.entities[0].position);
  const missing = graph.nodes.filter((node) => !node.position);
  for (const node of missing) for (const other of graph.nodes)
    if (other.id !== node.id) {
      const a = points.get(node.id), b = points.get(other.id);
      assert.ok(Math.hypot(a.x - b.x, a.y - b.y) >= 63.99);
    }
});

test('layout preview does not write; --write is deterministic and preserves source fields', async () => {
  const folder = await mkdtemp(join(tmpdir(), 'relgraph-layout-'));
  try {
    const file = join(folder, 'story.json');
    const source = structuredClone(literature);
    delete source.characters[1].position;
    delete source.characters[2].position;
    const original = JSON.stringify(source, null, 2) + '\n';
    await writeFile(file, original);
    const preview = await layoutFile({ file, seed: 8, write: false });
    assert.equal(preview.missing, 2);
    assert.equal(preview.written, undefined);
    assert.equal(await readFile(file, 'utf8'), original);
    const saved = await layoutFile({ file, seed: 8, write: true });
    assert.equal(saved.missing, 2);
    const result = JSON.parse(await readFile(file, 'utf8'));
    assert.equal(graphOf(result).nodes.length, 17);
    assert.deepEqual(result.characters[0], source.characters[0]);
    assert.ok(Number.isFinite(result.characters[1].position.x));
    const repeat = await layoutFile({ file, seed: 8, write: true });
    assert.equal(repeat.missing, 0);
    assert.equal(repeat.written, undefined);
    assert.equal(await readFile(file, 'utf8'), JSON.stringify(result, null, 2) + '\n');
  } finally {
    await rm(folder, { recursive: true, force: true });
  }
});

test('layout out file is exclusive and biology mapping includes reaction nodes', async () => {
  const folder = await mkdtemp(join(tmpdir(), 'relgraph-layout-'));
  try {
    const file = join(folder, 'biology.json'), out = join(folder, 'arranged.json');
    await writeFile(file, JSON.stringify(biology, null, 2) + '\n');
    const before = await readFile(file, 'utf8');
    const summary = await layoutFile({ file, out, seed: 0, write: false });
    assert.equal(summary.missing, 1);
    assert.equal(summary.written, out);
    const saved = JSON.parse(await readFile(out, 'utf8'));
    assert.equal(graphOf(saved).nodes.length, graphOf(biology).nodes.length);
    assert.ok(saved.processes[0].position);
    assert.deepEqual(saved.entities, biology.entities);
    assert.equal(await readFile(file, 'utf8'), before);
    await assert.rejects(layoutFile({ file, out, seed: 0, write: false }), LayoutError);
    await assert.rejects(layoutFile({ file, out: file, seed: 0, write: false }), LayoutError);
  } finally {
    await rm(folder, { recursive: true, force: true });
  }
});


test('atomic --write preserves source mode despite the process umask', async () => {
  const folder = await mkdtemp(join(tmpdir(), 'relgraph-mode-'));
  try {
    const file = join(folder, 'story.json');
    const source = structuredClone(literature);
    delete source.characters[0].position;
    await writeFile(file, JSON.stringify(source));
    await chmod(file, 0o664);
    const before = (await stat(file)).mode & 0o777;
    assert.equal(before, 0o664);
    const result = await layoutFile({ file, seed: 0, write: true });
    assert.equal(result.missing, 1);
    assert.equal((await stat(file)).mode & 0o777, before);
    assert.equal(graphOf(JSON.parse(await readFile(file, 'utf8'))).nodes.length, 17);
  } finally {
    await rm(folder, { recursive: true, force: true });
  }
});

test('programmatic layoutFile rejects conflicting writes before even reading input', async () => {
  const folder = await mkdtemp(join(tmpdir(), 'relgraph-conflict-'));
  try {
    const file = join(folder, 'story.json');
    const out = join(folder, 'other.json');
    const source = structuredClone(literature);
    delete source.characters[0].position;
    const original = JSON.stringify(source, null, 2) + '\n';
    await writeFile(file, original);
    await assert.rejects(
      layoutFile({ file, seed: 0, write: true, out }),
      (error) => error instanceof LayoutError && /--write and --out/.test(error.message),
    );
    assert.equal(await readFile(file, 'utf8'), original);
    await assert.rejects(readFile(out, 'utf8'), { code: 'ENOENT' });
  } finally {
    await rm(folder, { recursive: true, force: true });
  }
});

test('finite extreme authored coordinates cannot overflow the seeded layout', () => {
  const graph = {
    nodes: [
      { id: 'anchor', kind: 'person', label: 'anchor', position: { x: 1e307, y: 0 } },
      { id: 'missing', kind: 'person', label: 'missing' },
    ],
    edges: [{ id: 'e', source: 'anchor', target: 'missing', kind: 'friendship' }],
  };
  const positions = layoutMissingNodes(graph, { seed: 42 });
  assert.deepEqual(positions.get('anchor'), graph.nodes[0].position);
  const candidate = positions.get('missing');
  assert.ok(Number.isFinite(candidate.x) && Number.isFinite(candidate.y));
  assert.ok(Math.hypot(candidate.x - 1e307, candidate.y) >= 64);
  assert.deepEqual([...positions], [...layoutMissingNodes(graph, { seed: 42 })]);
});


test('opposite maximum finite anchors cannot poison spring forces with NaN', () => {
  const graph = {
    nodes: [
      { id: 'left', kind: 'person', label: 'L', position: { x: -1.5e308, y: -1.5e308 } },
      { id: 'right', kind: 'person', label: 'R', position: { x: 1.5e308, y: 1.5e308 } },
      { id: 'missing', kind: 'person', label: 'M' },
    ],
    edges: [
      { id: 'lm', source: 'left', target: 'missing', kind: 'friendship' },
      { id: 'rm', source: 'right', target: 'missing', kind: 'friendship' },
    ],
  };
  const points = layoutMissingNodes(graph, { seed: 123 });
  assert.ok(Number.isFinite(points.get('missing').x));
  assert.ok(Number.isFinite(points.get('missing').y));
  assert.deepEqual(points.get('left'), graph.nodes[0].position);
  assert.deepEqual(points.get('right'), graph.nodes[1].position);
  assert.deepEqual([...points], [...layoutMissingNodes(graph, { seed: 123 })]);
});

test('layout handles thousands of fixed nodes with one missing, without fixed/fixed scans', () => {
  const nodes = Array.from({ length: 3000 }, (_, i) => ({
    id: 'fixed-' + String(i).padStart(5, '0'),
    label: String(i),
    kind: 'person',
    position: { x: i * 130, y: i % 2 },
  }));
  nodes.push({ id: 'missing', kind: 'person', label: 'Missing' });
  const positions = layoutMissingNodes({ nodes, edges: [] }, { iterations: 8 });
  assert.equal(positions.size, nodes.length);
  assert.ok(Number.isFinite(positions.get('missing').x));
  assert.ok(Number.isFinite(positions.get('missing').y));
});

test('shared coordinate rounding leaves extreme finite values finite', async () => {
  const { roundPositionCoordinate } = await import('../packages/core/src/director/seeded-layout.ts');
  for (const value of [0, 123.456, -9.876, 1e307, -1.5e308]) {
    assert.ok(Number.isFinite(roundPositionCoordinate(value)));
  }
  assert.equal(roundPositionCoordinate(123.456), 123.46);
  assert.equal(roundPositionCoordinate(1e307), 1e307);
  assert.throws(() => roundPositionCoordinate(Number.POSITIVE_INFINITY), RangeError);
});


test('collision fallback stays finite beside Number.MAX_VALUE anchors', () => {
  const huge = Number.MAX_VALUE;
  const graph = {
    nodes: [
      { id: 'anchor', kind: 'person', label: 'Anchor', position: { x: huge, y: huge } },
      { id: 'extra', kind: 'person', label: 'Extra' },
    ],
    edges: [{ id: 'e', source: 'anchor', target: 'extra', kind: 'friendship' }],
  };
  const placed = layoutMissingNodes(graph, { seed: 73, iterations: 12 });
  assert.deepEqual(placed.get('anchor'), graph.nodes[0].position);
  assert.ok(Number.isFinite(placed.get('extra').x));
  assert.ok(Number.isFinite(placed.get('extra').y));
  assert.ok(
    Math.hypot(
      placed.get('extra').x - huge,
      placed.get('extra').y - huge,
    ) >= 64,
  );
});


test('both global and connected anchor means stay finite at Number.MAX_VALUE', () => {
  const huge = Number.MAX_VALUE;
  for (const connected of [false, true]) {
    const nodes = Array.from({ length: 3 }, (_, index) => ({
      id: 'anchor-' + index,
      label: 'Anchor ' + index,
      kind: 'person',
      position: { x: huge, y: huge },
    }));
    nodes.push({ id: 'missing', label: 'Missing', kind: 'person' });
    const edges = connected
      ? nodes.slice(0, 3).map((node, index) => ({
          id: 'edge-' + index, source: node.id, target: 'missing', kind: 'friendship',
        }))
      : [];
    const graph = { nodes, edges };
    const placed = layoutMissingNodes(graph, { seed: 42, iterations: 16 });
    const point = placed.get('missing');
    assert.ok(Number.isFinite(point.x) && Number.isFinite(point.y), 'missing position must be finite');
    for (const anchor of nodes.slice(0, 3))
      assert.deepEqual(placed.get(anchor.id), anchor.position, 'authored anchor must remain fixed');
    assert.deepEqual(
      [...placed], [...layoutMissingNodes(graph, { seed: 42, iterations: 16 })],
      'same seed and inputs must be reproducible',
    );
  }
});

test('mixed extreme anchors keep their mean finite without biasing the layout', () => {
  const graph = {
    nodes: [
      { id: 'positive', label: 'P', kind: 'person', position: { x: Number.MAX_VALUE, y: Number.MAX_VALUE } },
      { id: 'negative', label: 'N', kind: 'person', position: { x: -Number.MAX_VALUE, y: -Number.MAX_VALUE } },
      { id: 'missing', label: 'M', kind: 'person' },
    ],
    edges: [
      { id: 'e1', source: 'positive', target: 'missing', kind: 'friendship' },
      { id: 'e2', source: 'negative', target: 'missing', kind: 'friendship' },
    ],
  };
  const result = layoutMissingNodes(graph, { seed: 17, iterations: 12 });
  assert.ok(Number.isFinite(result.get('missing').x));
  assert.ok(Number.isFinite(result.get('missing').y));
  assert.deepEqual(result.get('positive'), graph.nodes[0].position);
  assert.deepEqual(result.get('negative'), graph.nodes[1].position);
});
