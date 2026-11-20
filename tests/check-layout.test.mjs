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
import { nodeOutline } from '../packages/render/src/node-geometry.ts';
import { parseCommand, UsageError } from '../packages/cli/src/args.ts';
import { main } from '../packages/cli/src/index.ts';

const stage = { x: 0, y: 0, w: 1000, h: 600 };
/** A glyph's hit geometry as composeNodes records it: bounds, outline, stroke. */
const glyph = (
  id,
  x,
  y,
  { shape = 'circle', half = 10, halfHeight, corner = 0, stroke = 0 } = {},
) => {
  const g = {
    shape,
    radius: half,
    halfWidth: half,
    halfHeight: halfHeight ?? half,
    cornerRadius: corner,
    halfStroke: stroke,
  };
  return {
    kind: 'node',
    id,
    box: { x: x - g.halfWidth, y: y - g.halfHeight, w: 2 * g.halfWidth, h: 2 * g.halfHeight },
    outline: nodeOutline({ x, y }, g),
    halfStroke: stroke,
  };
};
const circle = (id, x, y, r = 10) => glyph(id, x, y, { half: r });
const line = (id, from, to, { n = 33, width } = {}) => ({
  kind: 'edge',
  id,
  points: Array.from({ length: n }, (_, i) => ({
    x: from.x + ((to.x - from.x) * i) / (n - 1),
    y: from.y + ((to.y - from.y) * i) / (n - 1),
  })),
  ...(width === undefined ? {} : { width }),
});
const options = { clearance: 4, crowding: 2, typeScale: 1 };
const ab = new Map([['ab', { source: 'a', target: 'b' }]]);
const passes = (selection, extra = {}) =>
  frameLayoutIssues({ selectionClip: stage, selection }, ab, { ...options, ...extra }).nearPasses;

test('a relation through or beside a node it does not join is a near pass', () => {
  const at = (cy) =>
    passes([
      circle('a', 100, 300),
      circle('b', 500, 300),
      circle('c', 300, cy),
      line('ab', { x: 112, y: 300 }, { x: 488, y: 300 }),
    ]);
  // Through the glyph: touching, always reported.
  assert.deepEqual(at(300), [{ edge: 'ab', node: 'c', distance: 0 }]);
  // 3 px from the ring: within the 4 px clearance.
  assert.deepEqual(at(313), [{ edge: 'ab', node: 'c', distance: 3 }]);
  // 5 px: clear. Its own ends are never near passes.
  assert.deepEqual(at(315), []);
});

test('glyphs are measured by the outline drawn, not by their bounds', () => {
  const diagonal = line('ab', { x: 100, y: 100 }, { x: 500, y: 500 });
  const ends = [circle('a', 92, 92), circle('b', 508, 508)];
  // The line passes the corner of a circle's square bound, 3.4 px from its ring.
  const [pass] = passes([...ends, circle('c', 309.46, 290.54), diagonal]);
  assert.equal(pass?.distance, 3.4, JSON.stringify(pass));
  // A 60 × 60 rounded square at (300, 300): the line through (325, 325)
  // crosses its rounded corner (review of #55).
  const square = glyph('c', 275, 325, { shape: 'square', half: 30, corner: 6 });
  assert.equal(passes([...ends, square, diagonal])[0]?.distance, 0);
  // Bounds alone (hit geometry without an outline) would read these as touching.
  const boundsOnly = (entry) => ({ ...entry, outline: undefined });
  // A diamond whose bounding corner (300, 300) lies on the line: the
  // diamond itself is 21 px away (its corners of bounds are empty).
  const diamond = glyph('c', 330, 270, { shape: 'diamond', half: 30 });
  assert.deepEqual(passes([...ends, diamond, diagonal]), []);
  assert.equal(passes([...ends, boundsOnly(diamond), diagonal])[0]?.distance, 0);
  assert.equal(
    passes([...ends, glyph('c', 300, 300, { shape: 'diamond', half: 30 }), diagonal])[0]?.distance,
    0,
  );
  // A hexagon whose lower-left bounding corner (298, 298) lies on the line:
  // its slanted sides keep it 10 px away.
  const hexagon = glyph('c', 328, 272, { shape: 'hexagon', half: 30, halfHeight: 26 });
  const [hexPass] = passes([...ends, hexagon, diagonal], { clearance: 12 });
  assert.equal(hexPass?.distance, 10.6);
  assert.equal(passes([...ends, boundsOnly(hexagon), diagonal])[0]?.distance, 0);
  const horizontal = [
    circle('a', 100, 300),
    circle('b', 500, 300),
    line('ab', { x: 112, y: 300 }, { x: 488, y: 300 }),
  ];
  // A box (round rectangle, wider than tall) by its sides and its corners.
  const box = (y, corner) => glyph('c', 300, y, { shape: 'box', half: 40, halfHeight: 15, corner });
  assert.equal(passes([...horizontal, box(317, 0)])[0]?.distance, 2);
  assert.deepEqual(
    passes([
      circle('a', 100, 100),
      circle('b', 500, 500),
      line('ab', { x: 100, y: 100 }, { x: 500, y: 500 }),
      // Its corner reaches toward the line; rounded off, it stays clear.
      box(300 - 40 - 15 - 0.5, 15),
    ]).length,
    0,
  );
});

test('the painted strokes count: a thick relation and a glyph border narrow the gap', () => {
  const selection = (width, stroke) => [
    circle('a', 100, 300),
    circle('b', 500, 300),
    glyph('c', 300, 315, { half: 10, stroke }),
    line('ab', { x: 112, y: 300 }, { x: 488, y: 300 }, { width }),
  ];
  // The centre line is 5 px from the ring: clear for a hairline.
  assert.deepEqual(passes(selection(0, 0)), []);
  // A width-8 stroke leaves 1 px (review of #55).
  assert.deepEqual(passes(selection(8, 0)), [{ edge: 'ab', node: 'c', distance: 1 }]);
  // A border 2 px wide (1 px each side of the ring) closes the last 1 px.
  assert.deepEqual(passes(selection(8, 1)), [{ edge: 'ab', node: 'c', distance: 0 }]);
});

test('distances are reported in 720p pixels whatever the output size', () => {
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
  const [pass] = frameLayoutIssues(list, ab, { ...options, typeScale: k }).nearPasses;
  assert.equal(pass.distance, 3);
});

test('the whole drawn path is checked, up to the rims of its own ends', () => {
  // A long relation: one of 32 sampled pieces spans 30 px, more than a glyph.
  // C sits on the line just past A's rim (review of #55).
  const long = (cx) =>
    passes([
      circle('a', 0, 200),
      circle('b', 990, 200),
      circle('c', cx, 200),
      line('ab', { x: 15, y: 200 }, { x: 975, y: 200 }),
    ]);
  assert.deepEqual(long(30), [{ edge: 'ab', node: 'c', distance: 0 }]);
  // A neighbour of A off the line is not a near pass.
  assert.deepEqual(
    passes([
      circle('a', 100, 300),
      circle('b', 500, 300),
      circle('c', 100, 330, 8),
      line('ab', { x: 112, y: 300 }, { x: 488, y: 300 }),
    ]),
    [],
  );
});

test('crowded glyphs; bars on a time axis may abut but not overlap; off-stage ignored', () => {
  const bar = (id, x, y, w, h = 12) =>
    glyph(id, x + w / 2, y + h / 2, {
      shape: 'span',
      half: w / 2,
      halfHeight: h / 2,
      corner: 4,
    });
  const selection = [
    circle('a', 100, 100),
    circle('b', 121, 100), // 1 px from a
    circle('c', 200, 100),
    circle('d', 223, 100), // 3 px from c: clear
    bar('bar1', 300, 300, 100),
    bar('bar2', 400.2, 300, 100), // abuts bar1, end to start
    bar('bar3', 300, 312.3, 100), // the lane below bar1
    bar('over1', 300, 400, 100),
    bar('over2', 350, 400, 100), // overlaps over1 by 50 px (review of #55)
    circle('e', 506, 306), // overlaps the end of bar2: a bar and a point still count
    circle('far1', 2000, 100),
    circle('far2', 2001, 100),
  ];
  const bars = new Set(['bar1', 'bar2', 'bar3', 'over1', 'over2']);
  const crowded = frameLayoutIssues({ selectionClip: stage, selection }, new Map(), {
    ...options,
    bars,
  }).crowded;
  assert.deepEqual(
    crowded.map((pair) => [...pair.nodes, pair.distance]),
    [
      ['a', 'b', 1],
      ['bar2', 'e', 0],
      ['over1', 'over2', 0],
    ],
  );
  // Without the bars declared, abutting bars count too.
  const all = frameLayoutIssues({ selectionClip: stage, selection }, new Map(), options).crowded;
  assert.ok(all.some((pair) => pair.nodes.join() === 'bar1,bar2'));
  assert.ok(all.some((pair) => pair.nodes.join() === 'bar1,bar3'));
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
