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
import { layoutGraph, structuralLayout } from '../packages/core/src/director/layout.ts';
import { LAYOUT_DEFAULTS, autoLayout } from '../packages/core/src/director/layout-engines.ts';
import {
  computeLayout,
  DEFAULT_LAYOUT_SETTINGS,
  LAYOUT_TYPES,
  planLayout,
} from '../packages/core/src/director/layout-strategies.ts';
import {
  keepsTime,
  placeInTime,
  runLayoutEngine,
  timeAxis,
  TIME_TOLERANCE,
} from '../packages/core/src/director/layout-engines.ts';
import {
  anchoredPoint,
  anchorToTime,
  timeAnchor,
} from '../packages/core/src/director/time-anchor.ts';
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
  // Manual and timeline strategies keep the anchor; the drawing keeps its legend bars.
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
