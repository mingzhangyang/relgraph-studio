// Behaviour fixes from the review of #37 and #38 (docs/REVIEW-38-FOLLOWUP-PLAN.md, PR 1).
import { test } from 'vitest';
import assert from 'node:assert/strict';
import bookshop from '../examples/bookshop-systems-synthetic.graph.json' with { type: 'json' };
import tree from '../examples/vertebrates-tree-provisional.graph.json' with { type: 'json' };
import dynasties from '../examples/dynasties-timeline-provisional.graph.json' with { type: 'json' };
import mindmap from '../examples/reading-club-mindmap-synthetic.graph.json' with { type: 'json' };
import flowchart from '../examples/order-flowchart-synthetic.graph.json' with { type: 'json' };
import egfr from '../examples/biology-egfr-mapk.json' with { type: 'json' };
import biology from '../examples/biology-signaling-synthetic.json' with { type: 'json' };
import literature from '../examples/honglou-provisional.relgraph.json' with { type: 'json' };
import { loadDocument } from '../packages/core/src/director/load.ts';
import { validateGenericDocument } from '../packages/core/src/domains/generic.ts';
import { layoutGraph, structuralLayout } from '../packages/core/src/director/layout.ts';
import { autoLayout, runLayoutEngine } from '../packages/core/src/director/layout-engines.ts';
import {
  computeLayout,
  DEFAULT_LAYOUT_SETTINGS,
  planLayout,
} from '../packages/core/src/director/layout-strategies.ts';
import { LAYOUT_DEFAULTS, LAYOUT_TYPES } from '../packages/core/src/project-layout.ts';
import {
  keepsTime,
  placeInTime,
  timeAxis,
  TIME_TOLERANCE,
} from '../packages/core/src/graph/time-axis.ts';
import {
  anchoredPoint,
  anchorToTime,
  declaresTimeAxis,
  timeAnchor,
  timeCoordinate,
} from '../packages/core/src/director/time-anchor.ts';
import { layoutMissingNodes } from '../packages/core/src/director/seeded-layout.ts';
import { styleForDrawing } from '../packages/core/src/style.ts';
import { layoutFile } from '../packages/cli/src/layout.ts';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { applyGraphPositions } from '../packages/core/src/director/position-writeback.ts';
import { directorFrameAt, frameCount } from '../packages/core/src/director/state.ts';
import { styleForGraph } from '../packages/core/src/style.ts';
import { composeFrame } from '../packages/render/src/compose.ts';
import { cameraFitFor, FRAME_SPECS } from '../packages/render/src/frame-spec.ts';
import { VIDEO_THEMES } from '../packages/render/src/theme.ts';
import { measure, paths, texts } from './helpers/display-list.mjs';

const EXAMPLES = { bookshop, tree, dynasties, mindmap, flowchart, egfr, biology, literature };
const load = (doc) => {
  const result = loadDocument(doc);
  assert.equal(result.valid, true, JSON.stringify(result.errors));
  return result.graph;
};
const moved = (before, after) =>
  [...after].filter(([id, p]) => {
    const q = before.get(id);
    return !q || q.x !== p.x || q.y !== p.y;
  });

test('F3: one set of layout defaults feeds the player, the CLI and the panel', () => {
  assert.deepEqual({ ...LAYOUT_DEFAULTS }, { spacing: 150, iterations: 300 });
  assert.equal(DEFAULT_LAYOUT_SETTINGS.spacing, LAYOUT_DEFAULTS.spacing);
  assert.equal(DEFAULT_LAYOUT_SETTINGS.iterations, LAYOUT_DEFAULTS.iterations);
  assert.ok(Object.isFrozen(LAYOUT_DEFAULTS));
});

for (const [name, source] of Object.entries(EXAMPLES))
  test(`F3: auto + rearrange with the panel defaults keeps ${name} as it was drawn on load`, () => {
    const graph = load(source);
    // Only documents that the player arranges itself are comparable.
    if (graph.nodes.some((n) => n.position) || graph.project?.layout?.positions) return;
    const shown = layoutGraph(graph),
      settings = { ...DEFAULT_LAYOUT_SETTINGS, type: 'auto', mode: 'rearrange' };
    assert.deepEqual(moved(shown, computeLayout(graph, settings, shown)), []);
    assert.deepEqual(
      moved(shown, structuralLayout(graph)),
      [],
      'the CLI writes what the player draws',
    );
    if (!graph.diagram) assert.equal(autoLayout(graph).size, graph.nodes.length);
  });

const spec = FRAME_SPECS['landscape-720p'];
const byLabel = (graph, label) => graph.nodes.find((n) => n.label === label);
const compose = (graph, positions = layoutGraph(graph), frame = frameCount(graph) - 1) =>
  composeFrame(directorFrameAt(graph, positions, frame, spec.fps, { fit: cameraFitFor(spec) }), {
    graph,
    positions,
    frame,
    fps: spec.fps,
    measure,
    frameSpec: spec,
    theme: VIDEO_THEMES.light,
    style: styleForGraph(graph),
  });
const ticks = (list) => texts(list).filter((t) => /^-?\d+$/.test(t));
/** Every dated node sits at its years, to the stored precision. */
const inTime = (graph, positions) => {
  const axis = timeAxis(graph.nodes);
  for (const node of graph.nodes) {
    const x = placeInTime(node, axis);
    if (x !== null) assert.ok(Math.abs(positions.get(node.id).x - x) <= TIME_TOLERANCE, node.label);
  }
};
/** Outlines of the legend's node miniatures: everything stroked after the plate. */
const legendGlyphs = (list) => {
  const all = paths(list),
    plate = all.findIndex((p) => p.fill === VIDEO_THEMES.light.legendPlate);
  return plate < 0 ? [] : all.slice(plate + 1).filter((p) => p.fill && p.stroke);
};
/** The dynasties example as saved with its coordinates written into the source. */
const saved = () => {
  const graph = load(dynasties);
  return applyGraphPositions(dynasties, graph, layoutGraph(graph)).document;
};

test('F1: a sideways drag cannot take a timeline off its axis', () => {
  const graph = load(dynasties),
    at = layoutGraph(graph),
    tang = byLabel(graph, '唐').id,
    p = at.get(tang);
  assert.ok(timeAnchor(graph), 'a timeline without a stored strategy is anchored');
  // About 12 px at the film's scale, sideways and then diagonally.
  assert.deepEqual(anchoredPoint(graph, tang, { x: p.x + 40, y: p.y }), p);
  const lane = anchoredPoint(graph, tang, { x: p.x - 40, y: p.y + 63 });
  assert.deepEqual(lane, { x: p.x, y: p.y + 63 }, 'only the lane changes');
  const moved = new Map(at).set(tang, lane);
  assert.equal(keepsTime(graph.nodes, moved, styleForGraph(graph).timeAxis), true);
  assert.ok(ticks(compose(graph, moved)).length > 0);
  // No strategy, auto and timeline keep the anchor; the drawing keeps its legend bars.
  for (const type of ['manual', 'auto', 'timeline'])
    assert.ok(timeAnchor({ ...graph, project: { layout: { ...DEFAULT_LAYOUT_SETTINGS, type } } }));
  assert.ok(legendGlyphs(compose(graph, moved)).every((g) => g.d[0][0] === 'RR'));
});

test('F1: a saved timeline keeps its axis when a date is edited or a dated node is added', () => {
  const source = saved();
  assert.ok(source.nodes.every((n) => n.x !== undefined || n.position));
  // One end changed by one year: the axis rescales and every bar follows it.
  const edited = structuredClone(source);
  edited.nodes.find((n) => n.id === '清').end += 1;
  const a = load(edited),
    atA = layoutGraph(a);
  inTime(a, atA);
  assert.ok(ticks(compose(a, atA)).length > 0);
  // Lanes are the author's and stay as saved.
  const before = layoutGraph(load(source));
  for (const node of a.nodes) assert.equal(atA.get(node.id).y, before.get(node.id).y, node.label);

  // A dated node without coordinates takes a free lane at its years.
  const added = structuredClone(source);
  added.nodes.push({ id: '新', kind: '元明清', start: 1300, end: 1400 });
  const b = load(added),
    atB = layoutGraph(b);
  inTime(b, atB);
  assert.ok(ticks(compose(b, atB)).length > 0);
  const fresh = atB.get(byLabel(b, '新').id),
    span = (n) => [n.span.from, n.span.to];
  for (const node of b.nodes) {
    if (node.label === '新' || atB.get(node.id).y !== fresh.y) continue;
    const [from, to] = span(node);
    assert.ok(to <= 1300 || from >= 1400, `${node.label} shares the new lane without overlap`);
  }
  // Saved lanes are untouched.
  for (const node of b.nodes)
    if (node.label !== '新') assert.equal(atB.get(node.id).y, before.get(node.id).y, node.label);
});

test('F1: another strategy is an explicit way off the axis, and the legend follows', () => {
  const graph = load(dynasties),
    at = layoutGraph(graph),
    grid = computeLayout(
      graph,
      { ...DEFAULT_LAYOUT_SETTINGS, type: 'grid', mode: 'rearrange' },
      at,
    );
  const applied = {
    ...graph,
    project: {
      layout: { ...DEFAULT_LAYOUT_SETTINGS, type: 'grid', positions: Object.fromEntries(grid) },
    },
  };
  assert.equal(timeAnchor(applied), null);
  const tang = byLabel(graph, '唐').id,
    p = grid.get(tang),
    asked = { x: p.x + 40, y: p.y };
  assert.deepEqual(anchoredPoint(applied, tang, asked), asked, 'free to move');
  const drawn = layoutGraph(applied);
  assert.equal(anchorToTime(applied, drawn), false);
  assert.deepEqual([...drawn].sort(), [...grid].sort());
  const list = compose(applied, drawn);
  assert.deepEqual(ticks(list), []);
  // Bars became points, and the legend says so.
  const legend = legendGlyphs(list);
  assert.ok(legend.length > 1);
  assert.ok(
    legend.every((g) => g.d[0][0] === 'A'),
    'legend miniatures are drawn as points',
  );
  // A network is never anchored, whatever its dates.
  assert.equal(timeAnchor({ ...graph, diagram: undefined }), null);
});

test('F2: a strategy kept by its policy reports that it moved nothing', () => {
  const graph = load(bookshop),
    shown = layoutGraph(graph);
  for (const type of LAYOUT_TYPES) {
    const plan = planLayout(graph, { ...DEFAULT_LAYOUT_SETTINGS, type, mode: 'preserve' }, shown);
    assert.deepEqual([plan.engine, plan.reason, plan.moved], [null, 'kept', 0], type);
  }
  const manual = planLayout(
    graph,
    { ...DEFAULT_LAYOUT_SETTINGS, type: 'manual', mode: 'rearrange' },
    shown,
  );
  assert.deepEqual([manual.engine, manual.reason, manual.moved], [null, 'kept', 0]);
  // Everything that does move says how much, and computeLayout returns the same drawing.
  const settings = { ...DEFAULT_LAYOUT_SETTINGS, type: 'grid', mode: 'rearrange' },
    grid = planLayout(graph, settings, shown);
  assert.equal(grid.engine, 'grid');
  assert.equal(grid.reason, null);
  assert.ok(grid.moved > 0);
  assert.deepEqual([...grid.positions], [...computeLayout(graph, settings, shown)]);
});

test('F4: the plan names the engine that actually ran, and why', () => {
  const graph = load(bookshop),
    shown = layoutGraph(graph),
    plan = (g, type, current = layoutGraph(g)) =>
      planLayout(g, { ...DEFAULT_LAYOUT_SETTINGS, type, mode: 'rearrange' }, current);
  // A timeline without dates falls back to the tree, and says so.
  const timeline = plan(graph, 'timeline', shown),
    asTree = runLayoutEngine(graph, 'tree', { seed: 0, ...LAYOUT_DEFAULTS });
  assert.deepEqual([timeline.engine, timeline.reason], ['tree', 'untimed']);
  assert.deepEqual(
    [...timeline.positions].map(([id, p]) => [id, Math.round(p.x), Math.round(p.y)]),
    [...asTree].map(([id, p]) => [id, Math.round(p.x), Math.round(p.y)]),
  );
  // With dates, the timeline is the timeline.
  assert.deepEqual(
    [plan(load(dynasties), 'timeline').engine, plan(load(dynasties), 'timeline').reason],
    ['timeline', null],
  );
  // Auto follows the declared kind, or else the structure.
  const auto = plan(graph, 'auto', shown);
  assert.equal(auto.reason, 'structure');
  assert.ok(auto.engine);
  assert.deepEqual(
    [plan(load(tree), 'auto').engine, plan(load(tree), 'auto').reason],
    ['tree', 'diagram'],
  );
  // An undated timeline diagram under auto is still a tree, for the same reason.
  const undated = structuredClone(dynasties);
  for (const node of undated.nodes) {
    delete node.start;
    delete node.end;
  }
  const untimed = plan(load(undated), 'auto');
  assert.deepEqual([untimed.engine, untimed.reason], ['tree', 'untimed']);
});

test('F5: a derived unfolding shows no domain time; real domain time still shows', () => {
  for (const [name, source] of Object.entries({ tree, mindmap, flowchart })) {
    const graph = load(source);
    assert.equal(graph.timeline?.ordinal, true, name);
    assert.ok(
      graph.nodes.some((n) => n.visibility?.from > 1),
      `${name} unfolds`,
    );
    for (let frame = 0; frame < frameCount(graph); frame += 24) {
      const list = compose(graph, layoutGraph(graph), frame);
      assert.equal(list.a11y.domainTime, '', `${name} frame ${frame}`);
      assert.ok(!texts(list).some((t) => /STEP|TIME \d/.test(t)), `${name} frame ${frame}`);
    }
  }
  const timed = load(dynasties);
  assert.equal(timed.timeline?.ordinal, undefined);
  assert.match(compose(timed).a11y.domainTime, /^公元 -?\d+$/);
});

// Review of PR 1 (#40): the declared state is the only source of truth.
const rearrange = (type, extra = {}) => ({
  ...DEFAULT_LAYOUT_SETTINGS,
  type,
  mode: 'rearrange',
  ...extra,
});
/** The graph with `layout` as its applied project layout. */
const withLayout = (graph, layout) => ({
  ...graph,
  project: { ...graph.project, layout: { ...DEFAULT_LAYOUT_SETTINGS, ...layout } },
});
/** No two dated bars share a lane where their years overlap. */
const lanesClear = (graph, positions) => {
  const axis = timeAxis(graph.nodes),
    half = (LAYOUT_DEFAULTS.spacing * 0.42) / 2,
    bars = graph.nodes
      .filter((n) => placeInTime(n, axis) !== null)
      .map((n) => ({
        label: n.label,
        y: positions.get(n.id).y,
        from: n.span?.from ?? n.visibility.from,
        to: n.span ? (n.span.to ?? axis.to) : n.visibility.from,
      }));
  for (const a of bars)
    for (const b of bars)
      if (a !== b && Math.abs(a.y - b.y) < half)
        assert.ok(a.to <= b.from || b.to <= a.from, `${a.label} overlaps ${b.label}`);
};

test('#40 item 1: a timeline taken off its axis stays off it after export and reload', () => {
  const graph = load(dynasties),
    grid = computeLayout(graph, rearrange('grid'), layoutGraph(graph)),
    applied = withLayout(graph, { type: 'grid', positions: Object.fromEntries(grid) });
  assert.equal(timeAnchor(applied), null);
  // The studio writes the declared state with the coordinates.
  const { document } = applyGraphPositions(dynasties, graph, grid, {
    timeAxis: Boolean(timeAnchor(applied)),
  });
  assert.equal(document.timeAxis, false);
  const result = loadDocument(document);
  assert.equal(result.valid, true);
  assert.equal(result.graph.timeAxis, false);
  assert.ok(!result.warnings.some((w) => w.code === 'OFF_TIME_AXIS'));
  assert.equal(timeAnchor(result.graph), null);
  const reread = layoutGraph(result.graph);
  assert.deepEqual(moved(grid, reread), [], 'every grid coordinate survives the reload');
  assert.deepEqual(ticks(compose(result.graph, reread)), []);
  // Putting it back on the axis and exporting again removes the declaration.
  const back = applyGraphPositions(document, result.graph, layoutGraph(graph), { timeAxis: true });
  assert.equal(Object.hasOwn(back.document, 'timeAxis'), false);
  assert.ok(timeAnchor(load(back.document)));
  // Without a declaration, hand-authored off-axis x is drawn in time and the author is told.
  const authored = structuredClone(document);
  delete authored.timeAxis;
  const warned = loadDocument(authored);
  assert.equal(warned.valid, true);
  const notice = warned.warnings.find((w) => w.code === 'OFF_TIME_AXIS');
  assert.match(notice.message, /^\d+ 个带日期的节点横坐标不在其时间上，已按日期绘制。$/);
  assert.match(notice.fix, /"timeAxis": false/);
  inTime(warned.graph, layoutGraph(warned.graph));
  // The field is a boolean.
  assert.equal(loadDocument({ ...dynasties, timeAxis: 'no' }).valid, false);
});

test('#40 item 2: a strategy on the axis never moves a locked node; it refuses instead', () => {
  const graph = load(dynasties),
    sanguo = byLabel(graph, '三国').id,
    grid = computeLayout(graph, rearrange('grid'), layoutGraph(graph)),
    off = withLayout(graph, {
      type: 'grid',
      locked: [sanguo],
      positions: Object.fromEntries(grid),
    });
  for (const type of ['timeline', 'auto']) {
    const plan = planLayout(off, rearrange(type, { locked: [sanguo] }), grid);
    assert.deepEqual(plan.blocked, [sanguo], type);
    assert.equal(plan.moved, 0);
    assert.equal(plan.anchorChanged, false, 'a refused plan changes nothing');
    assert.deepEqual(plan.positions.get(sanguo), grid.get(sanguo));
  }
  // Strategies off the axis keep the lock as before.
  const circle = planLayout(off, rearrange('circle', { locked: [sanguo] }), grid);
  assert.deepEqual(circle.blocked, []);
  assert.deepEqual(circle.positions.get(sanguo), grid.get(sanguo));
});

test('#40 item 3: preview and apply agree when a lock crowds a lane', () => {
  const graph = load(dynasties),
    shown = layoutGraph(graph),
    sui = byLabel(graph, '隋').id,
    tang = byLabel(graph, '唐').id;
  // Lock 隋 in time but in 唐's lane, where their bars would touch.
  const crowded = new Map(shown).set(sui, { x: shown.get(sui).x, y: shown.get(tang).y });
  const settings = rearrange('timeline', { locked: [sui] }),
    current = withLayout(graph, { locked: [sui], positions: Object.fromEntries(crowded) });
  const plan = planLayout(current, settings, crowded);
  assert.deepEqual(plan.blocked, []);
  assert.equal(plan.anchored, true);
  assert.deepEqual(plan.positions.get(sui), crowded.get(sui), 'the lock holds');
  inTime(graph, plan.positions);
  lanesClear(graph, plan.positions);
  // The preview is drawn with its axis, and applying stores exactly what it showed.
  const previewed = withLayout(current, { ...settings, type: 'timeline' });
  assert.ok(ticks(compose(previewed, plan.positions)).length > 0);
  const applied = withLayout(graph, {
    ...settings,
    positions: Object.fromEntries(plan.positions),
  });
  assert.deepEqual(moved(plan.positions, layoutGraph(applied)), []);
});

test('#40 item 4: putting a drawing on the axis is a change even when nothing moves', () => {
  const graph = load(dynasties),
    shown = layoutGraph(graph),
    // Grid applied, then the timeline coordinates restored: not anchored.
    stale = withLayout(graph, { type: 'grid', positions: Object.fromEntries(shown) });
  assert.equal(timeAnchor(stale), null);
  // The renderer reads the same state: no axis, although the x happen to be in time.
  assert.equal(styleForDrawing(styleForGraph(graph), stale, shown).timeAxis, undefined);
  assert.deepEqual(ticks(compose(stale, shown)), []);
  for (const type of ['timeline', 'auto']) {
    const plan = planLayout(stale, rearrange(type), shown);
    assert.deepEqual([plan.moved, plan.anchored, plan.anchorChanged], [0, true, true], type);
  }
  // Manual and "preserve" keep everything, the state included.
  for (const settings of [rearrange('manual'), { ...rearrange('timeline'), mode: 'preserve' }]) {
    const plan = planLayout(stale, settings, shown);
    assert.deepEqual([plan.moved, plan.anchorChanged], [0, false], settings.type);
  }
  // From the axis, a strategy that leaves it is a change too.
  const leaving = planLayout(graph, rearrange('grid'), shown);
  assert.deepEqual([leaving.anchored, leaving.anchorChanged], [false, true]);
});

test('#40 item 6: relgraph layout puts a new dated node at its years, in a free lane', async () => {
  const source = saved();
  source.nodes.push({ id: '新', kind: '元明清', start: 1300, end: 1400 });
  const folder = await mkdtemp(join(tmpdir(), 'relgraph-anchor-'));
  try {
    const file = join(folder, 'dynasties.json'),
      out = join(folder, 'arranged.json');
    await writeFile(file, JSON.stringify(source, null, 2) + '\n');
    const summary = await layoutFile({ file, out, seed: 0, write: false });
    assert.equal(summary.missing, 1);
    const written = JSON.parse(await readFile(out, 'utf8')),
      graph = load(written),
      at = layoutGraph(graph);
    // What the CLI wrote is what the player draws: the lane, with x from the dates (F6).
    const fresh = written.nodes.find((n) => n.id === '新').position;
    assert.deepEqual(Object.keys(fresh), ['y']);
    // The point the CLI placed, computed as it does, independently of the file.
    const before = load(source),
      placed = layoutMissingNodes(before, { seed: 0, ...LAYOUT_DEFAULTS });
    anchorToTime(before, placed, { unplaced: new Set([byLabel(before, '新').id]) });
    const node = byLabel(graph, '新'),
      expected = { x: timeCoordinate(node, timeAnchor(graph)), y: fresh.y };
    assert.deepEqual(placed.get(byLabel(before, '新').id), expected);
    assert.deepEqual(node.position, expected);
    assert.deepEqual(at.get(node.id), expected);
    inTime(graph, at);
    lanesClear(graph, at);
    // The new lane, if any, is one of the drawing's own lane steps below the others.
    const lanes = [...new Set(source.nodes.filter((n) => n.position).map((n) => n.position.y))];
    assert.ok(lanes.includes(fresh.y) || fresh.y > Math.max(...lanes), String(fresh.y));
  } finally {
    await rm(folder, { recursive: true, force: true });
  }
});

test('#40 item 7: the reveal steps of an unfolding are not dates', () => {
  const graph = load(tree);
  assert.equal(graph.timeline?.ordinal, true);
  const plan = planLayout(graph, rearrange('timeline'), layoutGraph(graph));
  assert.deepEqual([plan.engine, plan.reason], ['tree', 'untimed']);
  assert.deepEqual(
    [...plan.positions].map(([id, p]) => [id, Math.round(p.x), Math.round(p.y)]),
    [...runLayoutEngine(graph, 'tree', { seed: 0, ...LAYOUT_DEFAULTS })].map(([id, p]) => [
      id,
      Math.round(p.x),
      Math.round(p.y),
    ]),
  );
  // Real dates on such a graph still make a timeline.
  const dated = structuredClone(tree);
  dated.nodes = (dated.nodes ?? []).map((n, i) =>
    typeof n === 'object' ? { ...n, start: 1000 + i * 10 } : { id: n, start: 1000 + i * 10 },
  );
  if (dated.nodes.length)
    assert.equal(planLayout(load(dated), rearrange('timeline')).engine, 'timeline');
});

test('#40 minor: a new lane follows the drawing’s own lane height', () => {
  const graph = load(dynasties),
    shown = layoutGraph(graph),
    // The same drawing with lanes twice as far apart.
    wide = new Map([...shown].map(([id, p]) => [id, { x: p.x, y: p.y * 2 }])),
    ys = [...new Set([...wide.values()].map((p) => p.y))].sort((a, b) => a - b),
    step = Math.min(...ys.slice(1).map((y, i) => y - ys[i]));
  // A node that overlaps everything: it can only go below.
  const all = { ...dynasties, nodes: [...dynasties.nodes, { id: '全', start: -300, end: 2000 }] },
    g = load(all),
    positions = new Map(wide).set(byLabel(g, '全').id, { x: 0, y: 0 });
  anchorToTime(g, positions, { unplaced: new Set([byLabel(g, '全').id]) });
  assert.equal(positions.get(byLabel(g, '全').id).y, ys.at(-1) + step);
  assert.ok(step > LAYOUT_DEFAULTS.spacing * 0.42, 'not the default lane');
});

test('#40 re-review: an undated timeline is exported as declared, not as off its axis', () => {
  const undated = structuredClone(dynasties);
  for (const node of undated.nodes) {
    delete node.start;
    delete node.end;
  }
  const graph = load(undated);
  assert.equal(timeAnchor(graph), null, 'no dates, no axis');
  assert.equal(declaresTimeAxis(graph), true, 'but nothing took it off the axis');
  const { document } = applyGraphPositions(undated, graph, layoutGraph(graph), {
    timeAxis: declaresTimeAxis(graph),
  });
  assert.equal(Object.hasOwn(document, 'timeAxis'), false);
  // Dates added later draw the axis.
  document.nodes.forEach((node, i) =>
    Object.assign(node, { start: 600 + i * 40, end: 640 + i * 40 }),
  );
  const dated = load(document);
  assert.ok(timeAnchor(dated));
  inTime(dated, layoutGraph(dated));
  assert.ok(ticks(compose(dated)).length > 0);
  // A strategy that leaves the axis is still declared off it, dates or not.
  assert.equal(declaresTimeAxis(withLayout(graph, { type: 'grid' })), false);
  assert.equal(declaresTimeAxis({ ...graph, diagram: undefined }), false);
});

// F6 (re-review of #40, leftover 3): an anchored timeline's x is not authored data.
/** The dynasties example exported as the studio does: positions and the declared state. */
const exported = () => {
  const graph = load(dynasties);
  return applyGraphPositions(dynasties, graph, layoutGraph(graph), {
    timeAxis: declaresTimeAxis(graph),
  }).document;
};
const offAxis = (doc) => {
  const result = loadDocument(doc);
  assert.equal(result.valid, true, JSON.stringify(result.errors));
  return result.warnings.filter((w) => w.code === 'OFF_TIME_AXIS');
};

test('F6: an anchored timeline stores lanes, and a date edit does not read as off the axis', () => {
  const source = exported();
  // Only lanes are written for dated nodes; the drawing reads back exactly.
  for (const node of source.nodes) assert.deepEqual(Object.keys(node.position), ['y'], node.id);
  const graph = load(dynasties),
    drawn = layoutGraph(graph),
    reread = load(source);
  assert.deepEqual(layoutGraph(reread), drawn);
  assert.deepEqual(offAxis(source), []);
  // Exporting again changes nothing.
  assert.equal(
    applyGraphPositions(source, reread, layoutGraph(reread), { timeAxis: true }).changed,
    0,
  );

  // One end changed: one bar, before F6 one warning.
  const one = structuredClone(source);
  one.nodes.find((n) => n.id === '唐').end += 30;
  // The end of the axis moved: the axis rescales, before F6 all 18 warned.
  const axisEnd = structuredClone(source);
  axisEnd.nodes.find((n) => n.id === '清').end += 100;
  // A dated node added: the axis is wider by one node's share.
  const added = structuredClone(source);
  added.nodes.push({ id: '新', kind: '元明清', start: 1300, end: 1400 });
  for (const doc of [one, axisEnd, added]) {
    assert.deepEqual(offAxis(doc), []);
    const g = load(doc),
      at = layoutGraph(g);
    inTime(g, at);
    assert.ok(ticks(compose(g, at)).length > 0);
    // The lanes are the author's.
    for (const node of source.nodes)
      assert.equal(at.get(byLabel(g, node.id).id).y, node.position.y, node.id);
  }
});

test('F6: x written by hand, or by an earlier export, is still told apart and can be re-exported', () => {
  // A file written before F6 stores x as well; after a date edit that x is stale.
  const graph = load(dynasties),
    legacy = applyGraphPositions(dynasties, graph, layoutGraph(graph), {
      timeAxis: false,
    }).document;
  delete legacy.timeAxis;
  assert.deepEqual(offAxis(legacy), []);
  legacy.nodes.find((n) => n.id === '清').end += 100;
  const [notice] = offAxis(legacy);
  assert.match(notice.message, /^18 个带日期的节点横坐标不在其时间上，已按日期绘制。$/);
  assert.match(notice.fix, /只保留 y/);
  assert.match(notice.fix, /"timeAxis": false/);
  // Re-exporting the positioned source keeps the lanes and drops the stale x.
  const stale = load(legacy),
    shown = layoutGraph(stale),
    fixed = applyGraphPositions(legacy, stale, shown, { timeAxis: declaresTimeAxis(stale) });
  assert.equal(fixed.changed, 18);
  assert.deepEqual(offAxis(fixed.document), []);
  assert.deepEqual(layoutGraph(load(fixed.document)), shown);
});

test('F6: a lane-only position that cannot take x from dates is unplaced, not an error', () => {
  const source = exported();
  const laneOnly = (doc, count) => {
    const result = loadDocument(doc);
    assert.equal(result.valid, true, JSON.stringify(result.errors));
    const notices = result.warnings.filter((w) => w.code === 'LANE_ONLY');
    assert.equal(notices.length, count);
    for (const notice of notices) {
      assert.match(notice.path, /^nodes\[\d+\]\.position$/);
      assert.match(notice.message, /原有 y 不会保留/);
    }
    return result.graph;
  };
  // Every hand edit of an exported timeline still loads; layout fills the gaps.
  const undated = structuredClone(source);
  delete undated.nodes.find((n) => n.id === '唐').start;
  delete undated.nodes.find((n) => n.id === '唐').end;
  const g = laneOnly(undated, 1);
  assert.equal(byLabel(g, '唐').position, undefined);
  assert.ok(layoutGraph(g).get(byLabel(g, '唐').id));
  laneOnly({ ...source, timeAxis: false }, 18);
  const network = structuredClone(source);
  delete network.diagram;
  laneOnly(network, 18);
  // x present but not a number is still invalid, as before.
  const broken = structuredClone(dynasties);
  broken.nodes[0].position = { x: null, y: 0 };
  assert.equal(loadDocument(broken).errors[0].message, '坐标无效。');
  // One time for every node: no axis, so no x to take; nothing is stacked at x 0.
  const flat = {
    format: 'relgraph.graph/1',
    diagram: 'timeline',
    nodes: [
      { id: 'a', start: 1900, position: { y: 0 } },
      { id: 'b', start: 1900, position: { y: 0 } },
    ],
    presentation: [{ id: 's', domainAt: 1900 }],
  };
  const f = laneOnly(flat, 2),
    at = layoutGraph(f),
    [a, b] = f.nodes.map((n) => at.get(n.id));
  assert.notDeepEqual(a, b);
});

test('F6 review: the nodes-only writer API uses the source diagram and state', () => {
  const graph = load(dynasties),
    positions = layoutGraph(graph);
  for (const supplied of [
    { nodes: graph.nodes },
    { ...graph, diagram: 'network' },
    { ...graph, timeline: { unit: '', ordinal: true } },
  ]) {
    const written = applyGraphPositions(dynasties, supplied, positions).document;
    for (const node of written.nodes) assert.deepEqual(Object.keys(node.position), ['y']);
    written.nodes.find((n) => n.id === '清').end += 100;
    assert.deepEqual(offAxis(written), []);
    const off = applyGraphPositions(dynasties, supplied, positions, { timeAxis: false }).document;
    for (const node of off.nodes) assert.deepEqual(Object.keys(node.position), ['x', 'y']);
    const on = applyGraphPositions(off, supplied, positions, { timeAxis: true }).document;
    assert.equal(on.timeAxis, undefined);
    assert.deepEqual(offAxis(on), []);
    for (const node of on.nodes) assert.deepEqual(Object.keys(node.position), ['y']);
  }
});

test('F6 review: source validation locates each unplaceable lane without duplicate load warnings', () => {
  for (const diagram of ['network', 'tree', 'mindmap', 'flowchart', 'timeline']) {
    const doc = {
      format: 'relgraph.graph/1',
      diagram,
      nodes: ['plain', { id: '甲', position: { y: 120 } }, { id: 42, position: { y: 240 } }],
    };
    const checked = validateGenericDocument(doc),
      loaded = loadDocument(doc);
    assert.equal(checked.valid, true);
    assert.equal(loaded.valid, true);
    const lanes = (warnings) => warnings.filter((w) => w.code === 'LANE_ONLY');
    assert.deepEqual(
      lanes(checked.warnings).map(({ path, id }) => ({ path, id })),
      [
        { path: 'nodes[1].position', id: '甲' },
        { path: 'nodes[2].position', id: '42' },
      ],
    );
    assert.deepEqual(
      lanes(loaded.warnings).map(({ path, id }) => ({ path, id })),
      lanes(checked.warnings).map(({ path, id }) => ({ path, id })),
    );
  }
  const valid = exported();
  assert.deepEqual(validateGenericDocument(valid).warnings, []);
  valid.nodes[0].position = { x: null, y: 5 };
  assert.ok(validateGenericDocument(valid).errors.some((e) => e.code === 'POSITION'));
});

test('F6 review: onlyMissing preserves invalid supplied values for validation to reject', () => {
  const graph = load(dynasties),
    positions = layoutGraph(graph);
  for (const invalid of [5, false, 'bad', [], {}, { y: '5' }, { x: null, y: 5 }]) {
    const source = exported();
    source.nodes[0].position = invalid;
    const output = applyGraphPositions(source, graph, positions, { onlyMissing: true });
    assert.deepEqual(output.document.nodes[0].position, invalid);
    assert.equal(output.changed, 0);
    assert.equal(validateGenericDocument(output.document).valid, false);
  }
  for (const missing of [undefined, null]) {
    const source = exported();
    source.nodes[0].position = missing;
    const output = applyGraphPositions(source, graph, positions, { onlyMissing: true });
    assert.equal(output.changed, 1);
    assert.deepEqual(Object.keys(output.document.nodes[0].position), ['y']);
    assert.equal(validateGenericDocument(output.document).valid, true);
  }
});

test('F6: relgraph layout fills a lane-only position it cannot place, and the file loads', async () => {
  const source = { ...exported(), timeAxis: false };
  const folder = await mkdtemp(join(tmpdir(), 'relgraph-lane-'));
  try {
    const file = join(folder, 'off.json'),
      out = join(folder, 'filled.json');
    await writeFile(file, JSON.stringify(source, null, 2) + '\n');
    const summary = await layoutFile({ file, out, seed: 0, write: false });
    assert.equal(summary.missing, 18);
    const written = JSON.parse(await readFile(out, 'utf8'));
    for (const node of written.nodes) assert.deepEqual(Object.keys(node.position), ['x', 'y']);
    const result = loadDocument(written);
    assert.equal(result.valid, true, JSON.stringify(result.errors));
    assert.deepEqual(result.warnings, []);
  } finally {
    await rm(folder, { recursive: true, force: true });
  }
});

test('F6: a timeline off its axis, and other formats, still store x', () => {
  const graph = load(dynasties),
    grid = computeLayout(graph, rearrange('grid'), layoutGraph(graph));
  const off = applyGraphPositions(dynasties, graph, grid, { timeAxis: false }).document;
  for (const node of off.nodes) assert.deepEqual(Object.keys(node.position), ['x', 'y']);
  // Without the option the field is left as is, and the file's own state decides.
  const declared = applyGraphPositions(dynasties, graph, layoutGraph(graph)).document;
  for (const node of declared.nodes) assert.deepEqual(Object.keys(node.position), ['y']);
  // A strategy the file does not record cannot make it contradict itself.
  const left = applyGraphPositions(dynasties, withLayout(graph, { type: 'grid' }), grid).document;
  assert.equal(left.timeAxis, undefined);
  for (const node of left.nodes) assert.deepEqual(Object.keys(node.position), ['y']);
  assert.deepEqual(offAxis(left), []);
  const offSource = { ...dynasties, timeAxis: false },
    onProject = withLayout(load(offSource), { type: 'timeline' }),
    kept = applyGraphPositions(offSource, onProject, layoutGraph(graph)).document;
  assert.equal(kept.timeAxis, false);
  for (const node of kept.nodes) assert.deepEqual(Object.keys(node.position), ['x', 'y']);
  assert.equal(loadDocument(kept).valid, true);
  // Written once, read once: exactly the nodes the adapter places from dates.
  const flat = {
    format: 'relgraph.graph/1',
    diagram: 'timeline',
    nodes: [{ id: 'a', start: 1900 }, { id: 'b' }],
    presentation: [{ id: 's', domainAt: 1900 }],
  };
  const fg = load(flat),
    noAxis = applyGraphPositions(flat, fg, layoutGraph(fg)).document;
  for (const node of noAxis.nodes) assert.deepEqual(Object.keys(node.position), ['x', 'y']);
  assert.deepEqual(layoutGraph(load(noAxis)), layoutGraph(fg));
  for (const doc of [bookshop, tree]) {
    const g = load(doc),
      written = applyGraphPositions(doc, g, layoutGraph(g)).document;
    for (const node of written.nodes) assert.deepEqual(Object.keys(node.position), ['x', 'y']);
  }
});
