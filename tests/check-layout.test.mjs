// relgraph check-layout (ADR 004, D2a): relations drawn close to or across a
// node they do not join and crowded glyphs, read from composed frames; and
// order along x against time, read from the stored layout.
import { test } from 'vitest';
import assert from 'node:assert/strict';
import { mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import tang30 from '../datasets/tang-poets-met/唐代诗人见面网络_30.graph.json' with { type: 'json' };
import tang64 from '../datasets/tang-poets-met/唐代诗人见面网络_64.graph.json' with { type: 'json' };
import { loadDocument } from '../packages/core/src/director/load.ts';
import { layoutGraph } from '../packages/core/src/director/layout.ts';
import { chronologyInversions, nodeTimes } from '../packages/core/src/director/chronology.ts';
import { frameLayoutIssues } from '../packages/render/src/frame-check.ts';
import { parseCommand, UsageError } from '../packages/cli/src/args.ts';
import { main } from '../packages/cli/src/index.ts';

const stage = { x: 0, y: 0, w: 1000, h: 600 };
const circle = (id, x, y, r = 10) => ({
  kind: 'node',
  id,
  box: { x: x - r, y: y - r, w: 2 * r, h: 2 * r },
});
const line = (id, from, to, n = 33) => ({
  kind: 'edge',
  id,
  points: Array.from({ length: n }, (_, i) => ({
    x: from.x + ((to.x - from.x) * i) / (n - 1),
    y: from.y + ((to.y - from.y) * i) / (n - 1),
  })),
});
const options = { clearance: 4, crowding: 2, typeScale: 1 };

test('a relation through or beside a node it does not join is a near pass', () => {
  const ends = new Map([['ab', { source: 'a', target: 'b' }]]);
  const list = (cy) => ({
    selectionClip: stage,
    selection: [
      circle('a', 100, 300),
      circle('b', 500, 300),
      circle('c', 300, cy),
      line('ab', { x: 112, y: 300 }, { x: 488, y: 300 }),
    ],
  });
  // Through the glyph: touching, always reported.
  assert.deepEqual(frameLayoutIssues(list(300), ends, options).nearPasses, [
    { edge: 'ab', node: 'c', distance: 0 },
  ]);
  // 3 px from the ring: within the 4 px clearance.
  assert.deepEqual(frameLayoutIssues(list(313), ends, options).nearPasses, [
    { edge: 'ab', node: 'c', distance: 3 },
  ]);
  // 5 px: clear. Its own ends are never near passes.
  assert.deepEqual(frameLayoutIssues(list(315), ends, options).nearPasses, []);
  // Measured on a circle, not its square bound: the line passes the corner
  // of the bound (distance 0 to the square) but is 2.4 px from the ring.
  const corner = {
    selectionClip: stage,
    selection: [
      circle('a', 100, 100),
      circle('b', 500, 500),
      circle('c', 300 + 9.46, 300 - 9.46),
      line('ab', { x: 108, y: 108 }, { x: 492, y: 492 }),
    ],
  };
  const [pass] = frameLayoutIssues(corner, ends, options).nearPasses;
  assert.ok(pass && pass.distance > 0 && pass.distance < 4, JSON.stringify(pass));
});

test('distances are reported in 720p pixels whatever the output size', () => {
  const ends = new Map([['ab', { source: 'a', target: 'b' }]]);
  const k = 1.5;
  const list = {
    selectionClip: { x: 0, y: 0, w: 1500, h: 900 },
    selection: [
      circle('a', 150, 450, 15),
      circle('b', 750, 450, 15),
      circle('c', 450, 450 + 15 + 3 * k, 15),
      line('ab', { x: 168, y: 450 }, { x: 732, y: 450 }),
    ],
  };
  const [pass] = frameLayoutIssues(list, ends, { ...options, typeScale: k }).nearPasses;
  assert.equal(pass.distance, 3);
});

test('a relation leaving its end may pass close to a neighbour of that end', () => {
  const ends = new Map([['ab', { source: 'a', target: 'b' }]]);
  // c sits right beside a, against the first sampled segment only.
  const list = {
    selectionClip: stage,
    selection: [
      circle('a', 100, 300),
      circle('b', 500, 300),
      circle('c', 112, 311, 6),
      line('ab', { x: 110, y: 300 }, { x: 490, y: 300 }),
    ],
  };
  assert.deepEqual(frameLayoutIssues(list, ends, options).nearPasses, []);
});

test('crowded glyphs; bars on a time axis may abut; nodes off the stage are ignored', () => {
  const box = (id, x, y, w, h) => ({ kind: 'node', id, box: { x, y, w, h } });
  const list = {
    selectionClip: stage,
    selection: [
      circle('a', 100, 100),
      circle('b', 121, 100), // 1 px from a
      circle('c', 200, 100),
      circle('d', 223, 100), // 3 px from c: clear
      box('bar1', 300, 300, 100, 10),
      box('bar2', 400.2, 300, 100, 10), // abuts bar1
      circle('e', 505, 305), // overlaps the end of bar2: a bar and a point still count
      circle('far1', 2000, 100),
      circle('far2', 2001, 100),
    ],
  };
  const crowded = frameLayoutIssues(list, new Map(), {
    ...options,
    bars: new Set(['bar1', 'bar2']),
  }).crowded;
  assert.deepEqual(
    crowded.map((pair) => pair.nodes),
    [
      ['a', 'b'],
      ['bar2', 'e'],
    ],
  );
  assert.equal(crowded[0].distance, 1);
  // Without the bars declared, abutting bars count.
  assert.ok(
    frameLayoutIssues(list, new Map(), options).crowded.some(
      (pair) => pair.nodes.join() === 'bar1,bar2',
    ),
  );
});

test("a node's time is the mean first appearance of its timed relations, else its own", () => {
  const graph = {
    nodes: [
      { id: 'a' },
      { id: 'b' },
      { id: 'c', visibility: { from: 5 } },
      { id: 'd', span: { from: 7, to: 9 } },
      { id: 'e' },
    ],
    edges: [
      { id: 'ab', source: 'a', target: 'b', visibility: { from: 10 } },
      { id: 'ac', source: 'a', target: 'c', visibility: { from: 20 } },
      { id: 'ae', source: 'a', target: 'e' },
    ],
  };
  assert.deepEqual([...nodeTimes(graph)].sort(), [
    ['a', 15],
    ['b', 10],
    ['c', 20],
    ['d', 7],
  ]);
});

test('order along x against time, with a tolerance', () => {
  const graph = {
    nodes: ['a', 'b', 'c'].map((id, i) => ({ id, visibility: { from: [0, 10, 30][i] } })),
    edges: [],
  };
  const at = (xa, xb, xc) =>
    new Map([
      ['a', { x: xa, y: 0 }],
      ['b', { x: xb, y: 0 }],
      ['c', { x: xc, y: 0 }],
    ]);
  assert.deepEqual(chronologyInversions(graph, at(0, 1, 2), 0), []);
  // b drawn left of a: 10 apart.
  assert.deepEqual(chronologyInversions(graph, at(1, 0, 2), 0), [
    { earlier: 'a', later: 'b', gap: 10 },
  ]);
  assert.deepEqual(chronologyInversions(graph, at(1, 0, 2), 11), [], 'within the tolerance');
  assert.deepEqual(
    chronologyInversions(graph, at(1, 1, 2), 10),
    [{ earlier: 'a', later: 'b', gap: 10 }],
    'the same column counts, at exactly the tolerance',
  );
  assert.throws(() => chronologyInversions(graph, at(0, 1, 2), -1), RangeError);
});

test('both Tang graphs keep time along x as their generator checks it (20 years)', () => {
  for (const doc of [tang30, tang64]) {
    const { graph } = loadDocument(doc);
    assert.deepEqual(chronologyInversions(graph, layoutGraph(graph), 20), []);
    assert.equal(nodeTimes(graph).size, graph.nodes.length);
  }
});

test('check-layout arguments', () => {
  const command = parseCommand(['check-layout', 'g.json']);
  assert.deepEqual(
    { ...command },
    {
      command: 'check-layout',
      file: 'g.json',
      frameSpec: 'landscape-1080p',
      locale: 'zh-CN',
      json: false,
    },
  );
  const tuned = parseCommand(
    ['check-layout', 'g.json', '--clearance', '2.5', '--crowding', '0'].concat([
      '--chronology-tolerance',
      '20',
      '--json',
      '--frame-spec',
      'landscape-720p',
    ]),
  );
  assert.equal(tuned.clearance, 2.5);
  assert.equal(tuned.crowding, 0);
  assert.equal(tuned.chronologyTolerance, 20);
  assert.equal(tuned.json, true);
  for (const argv of [
    ['check-layout'],
    ['check-layout', 'g.json', '--clearance', '-1'],
    ['check-layout', 'g.json', '--crowding', 'wide'],
    ['check-layout', 'g.json', '--chronology-tolerance'],
    ['check-layout', 'g.json', '--theme', 'dark'],
  ])
    assert.throws(() => parseCommand(argv), UsageError, JSON.stringify(argv));
});

test('relgraph check-layout reports per shot and exits 1, 0 when the layout is clean', async () => {
  const run = async (argv) => {
    let stdout = '',
      stderr = '';
    const code = await main(argv, {
      stdout: (text) => (stdout += text),
      stderr: (text) => (stderr += text),
    });
    return { code, stdout, stderr };
  };
  // 丙 sits on the line from 甲 to 乙, which does not join it; 丁 is dated
  // earlier than 甲 but drawn to its right.
  const dir = mkdtempSync(join(tmpdir(), 'relgraph-layout-'));
  const file = join(dir, 'through.graph.json');
  writeFileSync(
    file,
    JSON.stringify({
      format: 'relgraph.graph/1',
      nodes: [
        { id: '甲', position: { x: 0, y: 0 }, visibleFrom: 10 },
        { id: '乙', position: { x: 400, y: 0 }, visibleFrom: 10 },
        { id: '丙', position: { x: 200, y: 0 }, visibleFrom: 10 },
        { id: '丁', position: { x: 300, y: 200 }, visibleFrom: 1 },
      ],
      edges: [{ source: '甲', target: '乙', visibleFrom: 10 }],
      presentation: [{ id: 'all', title: '全部', durationSec: 3, domainAt: 10 }],
    }),
  );
  const found = await run(['check-layout', file, '--chronology-tolerance', '5']);
  assert.equal(found.code, 1, found.stderr);
  assert.match(found.stdout, /镜头 1\/1「全部」：\n {4}甲—乙 贴近 丙（相距 0）\n/);
  assert.match(
    found.stdout,
    /有 2 对先后颠倒：\n {4}丁 早于 丙 约 9，却画在其右侧或同列\n {4}丁 早于 甲 约 9，却画在其右侧或同列\n$/,
  );

  const json = JSON.parse((await run(['check-layout', file, '--json'])).stdout);
  assert.equal(json.chronology, undefined, 'chronology only on request');
  assert.equal(json.shotIssues[0].issues[0].kind, 'near-pass');

  const clean = await run(['check-layout', 'examples/honglou-provisional.relgraph.json']);
  assert.equal(clean.code, 0, clean.stdout + clean.stderr);
  assert.match(clean.stdout, /没有发现布局问题。\n$/);
});
