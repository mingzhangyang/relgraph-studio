// Cost of composing a frame, counted in operations rather than time so that
// the bounds hold on any machine (docs/REVIEW-38-FOLLOWUP-PLAN.md, P2).
//
// The composer must do a bounded amount of work per node and relation: one
// pass over the view per concern, text measured a bounded number of times
// per item, and collision tests only against nearby rectangles. A scan of
// the whole view per item (as `shotAttention` and the legend once did) or of
// every placed label per candidate (as label placement once did) makes these
// counts grow with the square of the graph and fails the growth bounds.
import { test } from 'vitest';
import assert from 'node:assert/strict';
import { loadDocument } from '../packages/core/src/director/load.ts';
import { directorFrameAt } from '../packages/core/src/director/state.ts';
import { styleForGraph } from '../packages/core/src/style.ts';
import { composeFrame } from '../packages/render/src/compose.ts';
import { cameraFitFor, FRAME_SPECS } from '../packages/render/src/frame-spec.ts';
import { measure } from './helpers/display-list.mjs';
import { syntheticGraph } from './helpers/synthetic-graph.mjs';

const spec = FRAME_SPECS['landscape-720p'];
// Shots 1–3 of the synthetic storyboard: a group, named nodes with a card,
// named relations. Each is read 1.6 s in, when its transition is over.
const SHOTS = [1, 2, 3];

/** Reads of view.nodes[i] and view.edges[i], however the composer iterates. */
function counted(list, counts) {
  return new Proxy(list, {
    get(target, key, receiver) {
      if (typeof key === 'string' && /^\d+$/.test(key)) counts.viewReads++;
      return Reflect.get(target, key, receiver);
    },
  });
}

function costOf(nodes) {
  const result = loadDocument(syntheticGraph(nodes, nodes * 2, { loops: Math.ceil(nodes / 50) }));
  assert.equal(result.valid, true, JSON.stringify(result.errors));
  const { graph } = result;
  const positions = new Map(graph.nodes.map((node) => [node.id, node.position]));
  const style = styleForGraph(graph);
  const counts = { viewReads: 0, measured: 0 };
  const cost = { rectTests: 0, pointTests: 0 };
  for (const shot of SHOTS) {
    const frame = Math.round((shot * 2 + 1.6) * spec.fps);
    const state = directorFrameAt(graph, positions, frame, spec.fps, { fit: cameraFitFor(spec) });
    assert.equal(state.playback.index, shot);
    assert.equal(state.transition, 1);
    // A fixed camera keeps the density on stage the same at every size, so
    // the work per node on stage is the same too; the rest is off stage.
    const probed = {
      ...state,
      cameraResolved: { x: 0, y: 0, scale: 1 },
      view: {
        ...state.view,
        nodes: counted(state.view.nodes, counts),
        edges: counted(state.view.edges, counts),
      },
    };
    composeFrame(probed, {
      graph,
      positions,
      frame,
      fps: spec.fps,
      frameSpec: spec,
      style,
      detailAt: result.detailAt,
      cost,
      measure: (text, font) => {
        counts.measured++;
        return measure(text, font);
      },
    });
  }
  return { ...counts, collisions: cost.rectTests + cost.pointTests };
}

test('composing a frame costs work in proportion to the graph, not its square', () => {
  const small = costOf(400),
    large = costOf(1600);
  // Four times the nodes and relations: linear work grows four times,
  // quadratic work sixteen times. Before P1 the view was read 15.9 times as
  // often at the larger size.
  assert.ok(large.viewReads <= small.viewReads * 4.5, JSON.stringify({ small, large }));
  assert.ok(large.measured <= small.measured * 4.5, JSON.stringify({ small, large }));
  // The stage holds about as many nodes at both sizes: collision tests stay
  // near the same, however many labels are placed elsewhere.
  assert.ok(small.collisions > 0, 'collision tests go through the spatial indexes');
  assert.ok(large.collisions <= small.collisions * 2, JSON.stringify({ small, large }));
});

test('the operation count of a fixed frame stays within its recorded budget', () => {
  // Measured at P1 (116,034 reads, 39,948 measured texts, 1,889 collision
  // tests) plus a quarter of headroom. A change that adds work per item
  // raises these counts; raise a budget only for work the frame needs.
  const budget = { viewReads: 145_000, measured: 50_000, collisions: 2_400 };
  const actual = costOf(1600);
  for (const key of Object.keys(budget))
    assert.ok(actual[key] <= budget[key], `${key}: ${actual[key]} > ${budget[key]}`);
});
