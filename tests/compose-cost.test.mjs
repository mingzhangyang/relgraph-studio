// Cost of composing a frame, counted in operations rather than time so that
// the bounds hold on any machine (docs/REVIEW-38-FOLLOWUP-PLAN.md, P2).
//
// The tests count at the predicates themselves: every rectangle test is a
// call of `rectsIntersect` and every distance a call of `Math.hypot`, however
// the composer reaches them. A scan that bypasses the spatial indexes (as
// label placement once scanned every placed label and every labelled node per
// candidate place) still calls the predicate once per item it scans, so it
// raises these counts and fails the bounds.
//
// Two cameras:
// - A fixed camera keeps the density on stage the same at every size. The
//   work per node and relation on stage is then bounded, and work grows in
//   proportion to the graph.
// - The fit camera of a whole-graph shot puts every node on stage, so the
//   density on stage grows with the graph and each label place meets more
//   neighbours. Collision tests there grow faster than the graph (but far
//   slower than its square); the test bounds that growth.
import { test, vi } from 'vitest';
import assert from 'node:assert/strict';
import { loadDocument } from '../packages/core/src/director/load.ts';
import { directorFrameAt } from '../packages/core/src/director/state.ts';
import { styleForGraph } from '../packages/core/src/style.ts';
import { composeFrame } from '../packages/render/src/compose.ts';
import { cameraFitFor, FRAME_SPECS } from '../packages/render/src/frame-spec.ts';
import { measure } from './helpers/display-list.mjs';
import { syntheticGraph } from './helpers/synthetic-graph.mjs';

const tally = vi.hoisted(() => ({ rects: 0 }));
vi.mock('../packages/render/src/node-geometry.ts', async (importOriginal) => {
  const actual = await importOriginal();
  return {
    ...actual,
    rectsIntersect: (a, b) => {
      tally.rects++;
      return actual.rectsIntersect(a, b);
    },
  };
});

const spec = FRAME_SPECS['landscape-720p'];

/** Reads of view.nodes[i] and view.edges[i], however the composer iterates. */
function counted(list, counts) {
  return new Proxy(list, {
    get(target, key, receiver) {
      if (typeof key === 'string' && /^\d+$/.test(key)) counts.viewReads++;
      return Reflect.get(target, key, receiver);
    },
  });
}

/**
 * Operation counts of composing the given shots of the synthetic graph, each
 * read 1.6 s in, when its transition is over. `fixed` replaces the shot's
 * camera with one at scale 1.
 */
function costOf(nodes, { shots, fixed }) {
  const result = loadDocument(syntheticGraph(nodes, nodes * 2, { loops: Math.ceil(nodes / 50) }));
  assert.equal(result.valid, true, JSON.stringify(result.errors));
  const { graph } = result;
  const positions = new Map(graph.nodes.map((node) => [node.id, node.position]));
  const style = styleForGraph(graph);
  const counts = { viewReads: 0, measured: 0, rectTests: 0, distances: 0 };
  for (const shot of shots) {
    const frame = Math.round((shot * 2 + 1.6) * spec.fps);
    const state = directorFrameAt(graph, positions, frame, spec.fps, { fit: cameraFitFor(spec) });
    assert.equal(state.playback.index, shot);
    assert.equal(state.transition, 1);
    const probed = {
      ...state,
      ...(fixed ? { cameraResolved: { x: 0, y: 0, scale: 1 } } : {}),
      view: {
        ...state.view,
        nodes: counted(state.view.nodes, counts),
        edges: counted(state.view.edges, counts),
      },
    };
    const hypot = Math.hypot;
    const distance = vi.spyOn(Math, 'hypot').mockImplementation((...args) => {
      counts.distances++;
      return hypot(...args);
    });
    tally.rects = 0;
    try {
      composeFrame(probed, {
        graph,
        positions,
        frame,
        fps: spec.fps,
        frameSpec: spec,
        style,
        detailAt: result.detailAt,
        measure: (text, font) => {
          counts.measured++;
          return measure(text, font);
        },
      });
    } finally {
      distance.mockRestore();
    }
    counts.rectTests += tally.rects;
  }
  return counts;
}

// Shots 1–3 of the synthetic storyboard: a group, named nodes with a card,
// named relations.
const fixedCost = (nodes) => costOf(nodes, { shots: [1, 2, 3], fixed: true });
// Shot 0 shows the whole graph under the fit camera: every node on stage.
const wholeCost = (nodes) => costOf(nodes, { shots: [0], fixed: false });

test('under a fixed camera, composing costs work in proportion to the graph, not its square', () => {
  const small = fixedCost(400),
    large = fixedCost(1600);
  // Four times the nodes and relations: linear work grows four times,
  // quadratic work sixteen times. Before P1 the view was read 15.9 times as
  // often at the larger size.
  assert.ok(small.rectTests > 0 && small.distances > 0, JSON.stringify(small));
  for (const key of Object.keys(small))
    assert.ok(large[key] <= small[key] * 4.5, `${key}: ${JSON.stringify({ small, large })}`);
});

test('a whole-graph shot keeps collision tests well below the square of the graph', () => {
  const small = wholeCost(400),
    large = wholeCost(1600);
  for (const key of ['viewReads', 'measured', 'distances'])
    assert.ok(large[key] <= small[key] * 4.5, `${key}: ${JSON.stringify({ small, large })}`);
  // Every node is on stage, so each label place meets more neighbours as the
  // graph grows: rectangle tests grow 5.8 times here. With a cell four times
  // as wide they grew 10 times, and with a scan of every placed label 16.
  assert.ok(large.rectTests <= small.rectTests * 7, JSON.stringify({ small, large }));
});

test('the operation counts of fixed frames stay within their recorded budgets', () => {
  // Measured after the review of #41 plus a quarter of headroom. A change that
  // adds work per item raises these counts; raise a budget only for work the
  // frame needs.
  const budgets = [
    // 116,034 reads, 39,948 measured texts, 103,008 rectangle tests, 79,269 distances.
    [
      fixedCost(1600),
      { viewReads: 145_000, measured: 50_000, rectTests: 129_000, distances: 99_000 },
    ],
    // 32,224 reads, 13,316 measured texts, 85,950 rectangle tests, 26,430 distances.
    [
      wholeCost(1600),
      { viewReads: 40_000, measured: 16_700, rectTests: 107_000, distances: 33_000 },
    ],
  ];
  for (const [actual, budget] of budgets)
    for (const key of Object.keys(budget))
      assert.ok(actual[key] <= budget[key], `${key}: ${actual[key]} > ${budget[key]}`);
});
