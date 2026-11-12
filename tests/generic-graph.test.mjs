import { test } from 'vitest';
import assert from 'node:assert/strict';
import bookshop from '../examples/bookshop-systems-synthetic.graph.json' with { type: 'json' };
import literature from '../examples/honglou-provisional.relgraph.json' with { type: 'json' };
import { loadDocument } from '../packages/core/src/director/load.ts';
import { layoutGraph } from '../packages/core/src/director/layout.ts';
import { directorFrameAt, frameCount } from '../packages/core/src/director/state.ts';
import { applyGraphPositions } from '../packages/core/src/director/position-writeback.ts';
import {
  autoStoryboard,
  internalIds,
  validateGenericDocument,
} from '../packages/core/src/domains/generic.ts';
import {
  deriveGraphStyle,
  domainStyle,
  NODE_SHAPES,
  styleForGraph,
  TONE_COUNT,
} from '../packages/core/src/style.ts';
import { validateRelGraph } from '../packages/core/src/relgraph.ts';
import { composeFrame, hullOutline } from '../packages/render/src/compose.ts';
import { cameraFitFor, FRAME_SPECS } from '../packages/render/src/frame-spec.ts';
import {
  glyphGeometry,
  nodeGlyphContainsPoint,
  nodeGlyphRayDistance,
  nodeOutline,
} from '../packages/render/src/node-geometry.ts';
import { mixHex, toneOf, VIDEO_THEMES } from '../packages/render/src/theme.ts';
import { measure, paths, texts } from './helpers/display-list.mjs';

const FORMAT = 'relgraph.graph/1';
const load = (doc) => {
  const result = loadDocument(doc);
  assert.equal(result.valid, true, JSON.stringify(result.errors));
  return result;
};
const compose = (result, frame, spec = FRAME_SPECS['landscape-720p'], extra = {}) => {
  const positions = layoutGraph(result.graph);
  const state = directorFrameAt(result.graph, positions, frame, spec.fps, {
    fit: cameraFitFor(spec),
  });
  return composeFrame(state, {
    graph: result.graph,
    positions,
    frame,
    fps: spec.fps,
    measure,
    frameSpec: spec,
    theme: VIDEO_THEMES.light,
    style: styleForGraph(result.graph),
    detailAt: result.detailAt,
    ...extra,
  });
};

test('an edge list alone becomes a playable, laid out, styled film', () => {
  const doc = {
    format: FORMAT,
    edges: [
      { source: 'Coffee', target: 'Caffeine', kind: 'contains' },
      { source: 'Tea', target: 'Caffeine', kind: 'contains' },
      { source: 'Caffeine', target: 'Adenosine receptor', kind: 'blocks' },
      { source: 42, target: 'Caffeine', kind: 'contains' },
    ],
  };
  const { graph, warnings } = load(doc);
  assert.deepEqual(warnings, [], 'undeclared endpoints are not a problem when no node is declared');
  assert.equal(graph.domain, 'graph');
  assert.deepEqual(graph.nodes.map((n) => n.label).sort(), [
    '42',
    'Adenosine receptor',
    'Caffeine',
    'Coffee',
    'Tea',
  ]);
  // Free-text ids never reach the kernel: every internal id is a stable slug.
  for (const item of [...graph.nodes, ...graph.edges, ...graph.scenes])
    assert.match(item.id, /^[a-z0-9]+(?:[-:][a-z0-9]+)*$/);
  const caffeine = graph.nodes.find((n) => n.label === 'Caffeine');
  assert.equal(caffeine.importance, 5, 'the best-connected node leads the hierarchy');
  assert.ok(graph.nodes.filter((n) => n !== caffeine).every((n) => n.importance < 5));
  assert.ok(graph.scenes.length >= 2, 'a storyboard is derived when none is authored');
  assert.ok(frameCount(graph) > 24);
  const positions = layoutGraph(graph);
  assert.equal(positions.size, 5);
  assert.equal(new Set([...positions.values()].map((p) => `${p.x}/${p.y}`)).size, 5);
  for (const frame of [0, 60, frameCount(graph) - 1]) {
    const list = compose({ graph }, frame);
    assert.ok(list.items.length > 0);
    assert.ok(list.a11y.nodes.includes('Caffeine'));
  }
});

test('internal ids depend on the id set alone and never collide', () => {
  const ids = ['alpha', '贾宝玉', 'Alice Smith', 'x-1', 'UPPER', 'a_b'];
  const forward = internalIds(ids),
    backward = internalIds([...ids].reverse());
  assert.deepEqual([...forward].sort(), [...backward].sort());
  assert.equal(forward.get('alpha'), 'alpha', 'a slug is kept verbatim');
  assert.equal(forward.get('x-1'), 'x-1');
  assert.match(forward.get('贾宝玉'), /^x-[0-9a-f]{8}$/);
  assert.equal(new Set(forward.values()).size, ids.length);
  // A literal slug that looks like a hashed id keeps its name; the hashed one moves.
  const hashed = internalIds(['Zed']).get('Zed');
  const clash = internalIds(['Zed', hashed]);
  assert.equal(clash.get(hashed), hashed);
  assert.notEqual(clash.get('Zed'), hashed);
  // Adding an unrelated id does not rename existing ones.
  const extended = internalIds([...ids, 'Another One']);
  for (const id of ids) assert.equal(extended.get(id), forward.get(id));
});

test('node and edge array order never changes ids, hierarchy, style or layout', () => {
  const a = load(bookshop),
    b = load({
      ...bookshop,
      nodes: [...bookshop.nodes].reverse(),
      edges: [...bookshop.edges].filter((e) => e.source !== e.target).reverse(),
    }),
    c = load({ ...bookshop, edges: bookshop.edges.filter((e) => e.source !== e.target) });
  const byId = (graph) => Object.fromEntries(graph.nodes.map((n) => [n.id, n]));
  assert.deepEqual(byId(b.graph), byId(c.graph));
  assert.deepEqual(
    [...layoutGraph(b.graph)].sort(([m], [n]) => (m < n ? -1 : 1)),
    [...layoutGraph(c.graph)].sort(([m], [n]) => (m < n ? -1 : 1)),
  );
  assert.deepEqual(styleForGraph(b.graph).edges, styleForGraph(c.graph).edges);
  assert.equal(a.graph.nodes.length, c.graph.nodes.length);
});

test('diagnostics name the field, the record and a repair', () => {
  const invalid = (doc, code, path) => {
    const result = loadDocument({ format: FORMAT, ...doc });
    assert.equal(result.valid, false, `${code} should be rejected`);
    const found = result.errors.find((e) => e.code === code);
    assert.ok(found, `${code} in ${JSON.stringify(result.errors.map((e) => e.code))}`);
    assert.ok(found.fix && found.message);
    if (path) assert.equal(found.path, path);
  };
  invalid({}, 'EMPTY');
  invalid({ nodes: [{ id: 'a' }, { id: 'a' }] }, 'DUPLICATE_ID', 'nodes[1].id');
  invalid({ nodes: [{ id: '' }] }, 'ID', 'nodes[0].id');
  invalid({ nodes: [{ id: 'a', color: 'red' }] }, 'COLOR', 'nodes[0].color');
  invalid({ nodes: [{ id: 'a', position: { x: 1 } }] }, 'POSITION', 'nodes[0].position');
  invalid({ nodes: [{ id: 'a', weight: -1 }] }, 'WEIGHT', 'nodes[0].weight');
  invalid({ edges: [{ source: 'a' }] }, 'EDGE_REF', 'edges[0].target');
  invalid({ edges: 'a-b' }, 'TYPE', 'edges');
  invalid({ nodes: [{ id: 'a', visibleFrom: 3, visibleTo: 1 }] }, 'INTERVAL', 'nodes[0]');
  invalid(
    { nodes: [{ id: 'a' }], kinds: { nodes: { node: { shape: 'star' } } } },
    'ENUM',
    'kinds.nodes.node.shape',
  );
  invalid(
    { nodes: [{ id: 'a' }], presentation: [{ title: 'One', highlight: { nodeIds: ['ghost'] } }] },
    'SCENE_REF',
    'presentation[0].highlight.nodeIds[0]',
  );
  invalid(
    { nodes: [{ id: 'a' }], presentation: [{ title: 'One', durationSec: 0 }] },
    'DURATION',
    'presentation[0].durationSec',
  );
  // A node that only appears in a relation is created, and reported once.
  const implicit = loadDocument({
    format: FORMAT,
    nodes: [{ id: 'a' }],
    edges: [{ source: 'a', target: 'b' }],
  });
  assert.equal(implicit.valid, true);
  assert.deepEqual(
    implicit.warnings.map((w) => w.code),
    ['IMPLICIT_NODES'],
  );
  // Unknown formats still explain every accepted one.
  const unknown = loadDocument({ nodes: [] });
  assert.match(unknown.errors[0].fix, /relgraph\.graph\/1/);
});

test('what the source validator accepts, the kernel accepts: no error leaves the author’s terms', () => {
  const nodes = [{ id: 'a' }, { id: 'b' }];
  const rejected = (doc, code, path) => {
    const source = validateGenericDocument({ format: FORMAT, ...doc });
    const found = source.errors.find((e) => e.code === code);
    assert.ok(found, `${code} in ${JSON.stringify(source.errors.map((e) => e.code))}`);
    assert.equal(found.path, path);
    assert.equal(found.layer, 'graph-source');
    // The kernel is never the first to speak: its paths are not the author's.
    const loaded = loadDocument({ format: FORMAT, ...doc });
    assert.equal(loaded.valid, false);
    assert.deepEqual(
      loaded.errors.filter((e) => e.layer !== 'graph-source'),
      [],
    );
  };
  // A node that first appears at its start cannot leave before it.
  rejected({ nodes: [{ id: 'a', start: 10, visibleTo: 5 }] }, 'INTERVAL', 'nodes[0]');
  rejected(
    { nodes, presentation: [{ camera: { zoom: 0 } }] },
    'CAMERA_ZOOM',
    'presentation[0].camera.zoom',
  );
  rejected(
    { nodes, presentation: [{ camera: { zoom: -2 } }] },
    'CAMERA_ZOOM',
    'presentation[0].camera.zoom',
  );
  rejected(
    { nodes, presentation: [{ camera: { focusNodeId: 'a', fitIds: ['a', 'b'] } }] },
    'CAMERA_CONFLICT',
    'presentation[0].camera',
  );
  rejected(
    { nodes, presentation: [{ transitionMs: -1 }] },
    'TRANSITION',
    'presentation[0].transitionMs',
  );
  rejected(
    { nodes, presentation: [{ id: 's' }, { id: 's' }] },
    'DUPLICATE_ID',
    'presentation[1].id',
  );
  // An explicit first appearance settles it, and an empty frame list is no target.
  load({
    format: FORMAT,
    nodes: [{ id: 'a', start: 10, visibleFrom: 1, visibleTo: 5 }, { id: 'b' }],
    presentation: [{ domainAt: 1 }],
  });
  load({ format: FORMAT, nodes, presentation: [{ camera: { focusNodeId: 'a', fitIds: [] } }] });
  // A shot without an id never takes the name the author gave another shot.
  for (const presentation of [
    [{ id: 'scene-2' }, {}],
    [{}, { id: 'scene-1' }],
    [{ id: 'scene-2' }, {}, { id: 'scene-2-2' }],
  ]) {
    const ids = load({ format: FORMAT, nodes, presentation }).graph.scenes.map((s) => s.id);
    assert.equal(new Set(ids).size, presentation.length, JSON.stringify(ids));
    presentation.forEach((shot, i) => {
      if (shot.id) assert.equal(ids[i], shot.id, 'an authored id is kept');
    });
  }
  // Names that do not clash are the ones they always were.
  assert.deepEqual(
    load({ format: FORMAT, nodes, presentation: [{}, { id: 'finale' }, {}] }).graph.scenes.map(
      (s) => s.id,
    ),
    ['scene-1', 'finale', 'scene-3'],
  );
});

test('an authored storyboard refers to author ids, and summaries feed the detail card', () => {
  const result = load({
    format: FORMAT,
    meta: { title: 'Authored' },
    nodes: [
      { id: 'Alice Smith', summary: 'Keeps the ledger.' },
      { id: 'bob', label: 'Bob' },
    ],
    edges: [{ id: 'Edge One', source: 'Alice Smith', target: 'bob', label: 'trusts' }],
    presentation: [
      {
        id: 'Opening Shot',
        title: 'Trust',
        durationSec: 2,
        camera: { fitIds: ['Alice Smith', 'bob'] },
        highlight: { nodeIds: ['Alice Smith'], edgeIds: ['Edge One'] },
        openDetailNodeId: 'Alice Smith',
      },
    ],
  });
  const [scene] = result.graph.scenes,
    alice = result.graph.nodes.find((n) => n.label === 'Alice Smith');
  assert.deepEqual(scene.highlight.nodeIds, [alice.id]);
  assert.deepEqual(scene.highlight.edgeIds, [result.graph.edges[0].id]);
  assert.equal(scene.openDetailNodeId, alice.id);
  assert.deepEqual(result.detailAt(alice.id, null), { summary: 'Keeps the ledger.' });
  assert.equal(result.detailAt('bob', null), undefined);
  const list = compose(result, 24);
  assert.deepEqual(list.a11y.detail, { label: 'Alice Smith', summary: 'Keeps the ledger.' });
  assert.ok(texts(list).includes('trusts'), 'a highlighted relation shows its label');
});

test('a timed graph grows along its domain time and never shows the future', () => {
  const result = load({
    format: FORMAT,
    meta: { title: 'Growth' },
    timeline: { unit: 'step' },
    nodes: [
      { id: 'a', visibleFrom: 1 },
      { id: 'b', visibleFrom: 2 },
      { id: 'c', label: 'Secret', visibleFrom: 3 },
    ],
    edges: [
      { source: 'a', target: 'b', visibleFrom: 2 },
      { source: 'b', target: 'c', visibleFrom: 3 },
    ],
  });
  assert.deepEqual(
    result.graph.scenes.map((s) => s.domainAt),
    [1, 2, 3],
  );
  assert.equal(result.graph.scenes[0].title, 'step 1');
  const early = compose(result, 12);
  assert.deepEqual(early.a11y.nodes, ['a']);
  assert.ok(!JSON.stringify(early).includes('Secret'));
  const late = compose(result, frameCount(result.graph) - 1);
  assert.deepEqual([...late.a11y.nodes].sort(), ['Secret', 'a', 'b']);
});

test('the derived storyboard walks the whole, each group and the hub, in author text only', () => {
  const { graph } = load(bookshop);
  const ids = graph.scenes.map((s) => s.id);
  assert.equal(ids[0], 'auto-overview');
  assert.equal(ids.at(-1), 'auto-closing');
  assert.equal(ids.filter((id) => id.startsWith('auto-group-')).length, graph.groups.length);
  const hub = graph.scenes.find((s) => s.id === 'auto-hub');
  assert.equal(hub.title, '订单');
  assert.equal(hub.openDetailNodeId, graph.nodes.find((n) => n.label === '订单').id);
  assert.ok(hub.highlight.edgeIds.length >= 2);
  // No scene is generated for a graph too small to need a tour.
  assert.equal(
    autoStoryboard({
      meta: { title: 'Pair' },
      nodes: [
        { id: 'a', label: 'A', kind: 'node' },
        { id: 'b', label: 'B', kind: 'node' },
      ],
      edges: [{ id: 'a:b', source: 'a', target: 'b', kind: 'link' }],
      groups: [],
    }).length,
    1,
  );
});

test('a relation of a node with itself is drawn as a loop; curated domains still refuse it', () => {
  const result = load({
    format: FORMAT,
    directed: true,
    nodes: [{ id: 'a' }, { id: 'b' }],
    edges: [
      { id: 'again', source: 'a', target: 'a', label: 'retry' },
      { source: 'a', target: 'b' },
    ],
    presentation: [{ title: 'Loop', durationSec: 2, highlight: { edgeIds: ['again'] } }],
  });
  const list = compose(result, 40);
  const loop = list.selection.find((entry) => entry.kind === 'edge' && entry.id === 'again');
  assert.ok(loop && loop.points.length > 8, 'the loop can be selected along its arc');
  assert.ok(
    paths(list).some((p) => p.stroke && p.d.length === 2 && p.d[1][0] === 'A'),
    'the loop is a stroked arc',
  );
  assert.ok(texts(list).includes('retry'));
  assert.ok(list.a11y.relations.some((line) => line.includes('retry')));
  const literary = structuredClone(literature);
  literary.relations[0].target = literary.relations[0].source;
  assert.ok(validateRelGraph(literary).errors.some((e) => e.code === 'SELF_LOOP'));
});

test('positions write back to author ids, declaring nodes that only relations mention', () => {
  const doc = {
    format: FORMAT,
    nodes: [{ id: 'Alice Smith', position: { x: 5, y: 6 } }],
    edges: [{ source: 'Alice Smith', target: 7 }],
  };
  const { graph } = load(doc),
    positions = layoutGraph(graph);
  const filled = applyGraphPositions(doc, graph, positions, { onlyMissing: true });
  assert.equal(filled.changed, 1);
  assert.deepEqual(filled.document.nodes[0], doc.nodes[0], 'authored coordinates are untouched');
  assert.equal(filled.document.nodes[1].id, 7, 'the id keeps its authored type');
  const again = load(filled.document);
  assert.deepEqual([...layoutGraph(again.graph)].sort(), [...positions].sort());
  assert.deepEqual(doc.nodes.length, 1, 'the caller keeps its own document');
  const all = applyGraphPositions(
    doc,
    graph,
    new Map([...positions].map(([id]) => [id, { x: 1, y: 2 }])),
  );
  assert.equal(all.changed, 2);
  // `position: null` reads as no position, so it is a gap like any other.
  const blank = {
    format: FORMAT,
    nodes: [
      { id: 'a', position: null },
      { id: 'b', position: { x: 0, y: 0 } },
    ],
    edges: [{ source: 'a', target: 'b' }],
  };
  const loaded = load(blank),
    gaps = loaded.graph.nodes.filter((n) => n.position === undefined).length;
  assert.equal(gaps, 1);
  const repaired = applyGraphPositions(blank, loaded.graph, layoutGraph(loaded.graph), {
    onlyMissing: true,
  });
  assert.equal(repaired.changed, gaps);
  assert.deepEqual(repaired.document.nodes[1], blank.nodes[1]);
  assert.ok(Number.isFinite(repaired.document.nodes[0].position.x));
});

test('hue, shape and rhythm are allocated once, in a fixed order, and never cycled', () => {
  const node = (id, kind, groupId) => ({ id, label: id, kind, groupId });
  const edge = (id, kind) => ({ id, source: 'a', target: 'b', kind });
  const grouped = {
    domain: 'graph',
    groups: [
      { id: 'g1', label: 'G1', kind: 'group', tone: 0 },
      { id: 'g2', label: 'G2', kind: 'group', tone: 1 },
    ],
    nodes: [node('a', 'person', 'g1'), node('b', 'place', 'g2'), node('c', 'person', 'g1')],
    edges: [edge('e1', 'visits'), edge('e2', 'visits'), edge('e3', 'owns')],
  };
  const style = deriveGraphStyle(grouped);
  // Groups own the node hue, so kinds differ by shape only.
  assert.equal(style.nodes.person.tone, undefined);
  assert.deepEqual([style.nodes.person.shape, style.nodes.place.shape], ['circle', 'pill']);
  // Edge hues start after the group hues: one hue never means two things.
  assert.deepEqual([style.edges.visits.tone, style.edges.owns.tone], [2, 3]);
  assert.deepEqual(
    style.legend.map((entry) => `${entry.of}:${entry.kind}`),
    ['node:person', 'node:place', 'edge:visits', 'edge:owns'],
  );
  // Without groups, node kinds take the hue as well as the shape.
  const flat = deriveGraphStyle({ ...grouped, groups: [] });
  assert.deepEqual([flat.nodes.person.tone, flat.nodes.place.tone], [0, 1]);
  assert.deepEqual([flat.edges.visits.tone, flat.edges.owns.tone], [2, 3]);
  // A single kind needs no encoding and no legend.
  const plain = deriveGraphStyle({
    ...grouped,
    groups: [],
    nodes: grouped.nodes.map((n) => ({ ...n, kind: 'node' })),
    edges: grouped.edges.map((e) => ({ ...e, kind: 'link' })),
  });
  assert.equal(plain.nodes.node.tone, undefined);
  assert.equal(plain.edges.link.tone, undefined);
  assert.deepEqual(plain.legend, []);
  // Past the palette, kinds fold to the neutral stroke and keep a dash rhythm.
  const many = deriveGraphStyle({
    ...grouped,
    groups: [],
    nodes: grouped.nodes.map((n) => ({ ...n, kind: 'node' })),
    edges: Array.from({ length: 12 }, (_, i) =>
      edge('e' + i, 'kind-' + String(i).padStart(2, '0')),
    ),
  });
  const tones = Object.values(many.edges).map((e) => e.tone);
  assert.deepEqual(tones.slice(0, TONE_COUNT), [0, 1, 2, 3, 4, 5, 6, 7]);
  assert.ok(tones.slice(TONE_COUNT).every((tone) => tone === undefined));
  assert.equal(new Set(tones.filter((t) => t !== undefined)).size, TONE_COUNT);
  // Declarations win, in the order they are written.
  const declared = deriveGraphStyle({
    ...grouped,
    kinds: {
      nodes: { place: { shape: 'hexagon', label: 'Places' } },
      edges: { owns: { color: '#123456', line: 'dotted', head: 'none', label: 'Owns' } },
    },
  });
  assert.equal(declared.nodes.place.shape, 'hexagon');
  assert.deepEqual(
    { ...declared.edges.owns },
    { stroke: 'plain', head: 'none', color: '#123456', dash: [2, 4] },
  );
  assert.equal(declared.legend.find((entry) => entry.kind === 'owns').label.en, 'Owns');
  // Registered domains keep their curated sheets.
  assert.equal(styleForGraph({ ...grouped, domain: 'literature' }), domainStyle('literature'));
  assert.equal(styleForGraph(grouped), styleForGraph(grouped), 'derived sheets are cached');
});

test('both film palettes provide every categorical tone', () => {
  for (const theme of Object.values(VIDEO_THEMES)) {
    assert.equal(theme.tones.length, TONE_COUNT);
    assert.equal(new Set(theme.tones).size, TONE_COUNT);
    for (const tone of theme.tones) assert.match(tone, /^#[0-9a-f]{6}$/);
    assert.equal(toneOf(theme, 0), theme.tones[0]);
    for (const outside of [undefined, -1, TONE_COUNT, 1.5])
      assert.equal(toneOf(theme, outside), undefined);
  }
  assert.equal(mixHex('#ffffff', '#000000', 0.5), '#808080');
  assert.equal(mixHex('#102030', '#405060', 1), '#102030');
  assert.equal(mixHex('#102030', '#405060', 0), '#405060');
});

test('the legend explains only what is on screen, and only when there is a choice', () => {
  const result = load(bookshop);
  const legendTexts = (list) =>
    texts(list).filter((t) =>
      ['入口', '服务', '存储', '外部系统', '调用', '读写', '事件'].includes(t),
    );
  assert.deepEqual(legendTexts(compose(result, 60)), [
    '入口',
    '服务',
    '存储',
    '外部系统',
    '调用',
    '读写',
    '事件',
  ]);
  // Kinds that are not visible yet are not announced.
  const timed = load({
    format: FORMAT,
    nodes: [{ id: 'a' }, { id: 'b' }, { id: 'c' }],
    edges: [
      { source: 'a', target: 'b', kind: 'now', visibleFrom: 1 },
      { source: 'b', target: 'c', kind: 'later', visibleFrom: 2 },
      { source: 'a', target: 'c', kind: 'now', visibleFrom: 1 },
    ],
    presentation: [
      { title: 'One', durationSec: 2, domainAt: 1 },
      { title: 'Two', durationSec: 2, domainAt: 2 },
    ],
  });
  assert.ok(!texts(compose(timed, 40)).includes('later'));
  assert.ok(!texts(compose(timed, 40)).includes('now'), 'one visible kind needs no legend');
  const both = texts(compose(timed, 95));
  assert.ok(both.includes('now') && both.includes('later'));
});

test('a hull encloses its members with a smooth closed outline', () => {
  const circles = [
    { x: 0, y: 0, r: 20 },
    { x: 200, y: 30, r: 30 },
    { x: 80, y: 160, r: 10 },
  ];
  const { d, points } = hullOutline(circles);
  assert.equal(d[0][0], 'M');
  assert.equal(d.at(-1)[0], 'Z');
  assert.ok(d.slice(1, -1).every((command) => command[0] === 'Q'));
  // Every sampled point of every circle lies inside or on the hull polygon.
  const inside = (q) =>
    points.every((a, i) => {
      const b = points[(i + 1) % points.length];
      return (b.x - a.x) * (q.y - a.y) - (b.y - a.y) * (q.x - a.x) >= -1e-6;
    });
  for (const c of circles)
    for (let i = 0; i < 16; i++)
      assert.ok(
        inside({
          x: c.x + Math.cos((i / 16) * Math.PI * 2) * c.r,
          y: c.y + Math.sin((i / 16) * Math.PI * 2) * c.r,
        }),
      );
  assert.deepEqual(
    hullOutline(circles),
    hullOutline([...circles].reverse()),
    'member order is irrelevant',
  );
  assert.ok(hullOutline([circles[0]]).d.length > 8, 'one member gives a disc');
});

test('square and hexagon glyphs agree between outline, hit test and edge attachment', () => {
  const spec = FRAME_SPECS['landscape-720p'];
  assert.deepEqual(
    [...NODE_SHAPES],
    ['circle', 'pill', 'diamond', 'square', 'hexagon', 'box', 'capsule', 'decision', 'span'],
  );
  for (const shape of ['square', 'hexagon']) {
    const style = {
      ...domainStyle('neutral'),
      nodes: { thing: { shape } },
    };
    const node = { id: 'n', kind: 'thing', importance: 3 },
      centre = { x: 400, y: 300 };
    const g = glyphGeometry(node, 1, spec, style);
    assert.equal(g.shape, shape);
    assert.equal(nodeOutline(centre, g).at(-1)[0] === 'Z' || shape === 'square', true);
    for (let i = 0; i < 48; i++) {
      const angle = (i / 48) * Math.PI * 2,
        direction = { x: Math.cos(angle), y: Math.sin(angle) };
      const reach = nodeGlyphRayDistance(node, direction, 1, spec, style);
      assert.ok(reach > g.radius * 0.7 && reach < g.radius * 1.6, `${shape} ${i}: ${reach}`);
      const at = (distance) => ({
        x: centre.x + direction.x * distance,
        y: centre.y + direction.y * distance,
      });
      assert.equal(
        nodeGlyphContainsPoint(node, centre, at(reach - 0.05), 1, spec, style),
        true,
        `${shape} ${i}: just inside the stroked outline`,
      );
      assert.equal(
        nodeGlyphContainsPoint(node, centre, at(reach + 0.05), 1, spec, style),
        false,
        `${shape} ${i}: just outside the stroked outline`,
      );
    }
  }
});

test('relations carry strength as weight and their kind as hue and rhythm', () => {
  const result = load(bookshop);
  const list = compose(result, 60);
  const style = styleForGraph(result.graph);
  const strokes = paths(list).filter((p) => p.stroke && p.d.some((c) => c[0] === 'Q') && !p.fill);
  const widths = new Set(strokes.map((p) => p.width));
  assert.ok(widths.size >= 4, 'weights map to several line weights');
  for (const kind of ['调用', '读写', '事件']) {
    const colour = VIDEO_THEMES.light.tones[style.edges[kind].tone];
    assert.ok(
      strokes.some((p) => p.stroke === colour),
      `${kind} is drawn in its tone`,
    );
  }
  const dashed = strokes.filter((p) => p.dash);
  assert.ok(
    dashed.length > 0 &&
      dashed.every((p) => p.stroke === VIDEO_THEMES.light.tones[style.edges['事件'].tone]),
  );
  // Dark and light use the same slots, each with its own validated step.
  const dark = compose(result, 60, FRAME_SPECS['landscape-720p'], { theme: VIDEO_THEMES.dark });
  assert.ok(
    paths(dark).some((p) => p.stroke === VIDEO_THEMES.dark.tones[style.edges['调用'].tone]),
  );
});
