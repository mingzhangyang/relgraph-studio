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
