import { test } from 'vitest';
import assert from 'node:assert/strict';
import { loadDocument } from '../packages/core/src/director/load.ts';
import { layoutGraph } from '../packages/core/src/director/layout.ts';
import { directorFrameAt } from '../packages/core/src/director/state.ts';
import { compileTimeline } from '../packages/core/src/director/timeline.ts';
import { frameStateAt } from '../packages/core/src/graph/core.ts';

function document(domain, shot) {
  const positions = [
    { id: 'a', position: { x: 0, y: 0 } },
    { id: 'b', position: { x: 1000, y: 500 } },
  ];
  const presentation = [{ id: 'shot', title: 'Partial beat changes', durationSec: 5, ...shot }];
  return domain === 'generic'
    ? {
        format: 'relgraph.graph/1',
        groups: [{ id: 'g' }],
        nodes: positions.map((node) => ({ ...node, group: 'g' })),
        edges: [{ id: 'ab', source: 'a', target: 'b' }],
        presentation,
      }
    : {
        format: 'relgraph.bio/0.1-draft',
        meta: { title: 'Partial beat changes' },
        compartments: [{ id: 'g', name: 'Group' }],
        entities: positions.map((node) => ({
          ...node,
          name: node.id,
          kind: 'protein',
          compartmentId: 'g',
        })),
        interactions: [
          {
            id: 'ab',
            source: 'a',
            target: 'b',
            kind: 'physical-association',
            evidenceStatus: 'illustrative',
          },
        ],
        processes: [],
        presentation,
      };
}

function movie(doc) {
  const loaded = loadDocument(doc);
  assert.equal(loaded.valid, true, JSON.stringify(loaded.errors));
  const { graph } = loaded;
  const original = structuredClone(graph);
  const positions = layoutGraph(graph);
  const timeline = compileTimeline(graph, 24);
  return {
    graph,
    frame: (frame) => {
      const state = directorFrameAt(graph, positions, frame, 24, { timeline });
      const direct = frameStateAt(graph, frame);
      assert.deepEqual(state.camera, direct.camera);
      assert.deepEqual(state.highlight, direct.highlight);
      assert.deepEqual(graph, original, 'evaluating beats must not change the authored graph');
      return state;
    },
  };
}

for (const domain of ['generic', 'biology']) {
  test(`${domain}: zoom-only beats retain their focus and edge-only beats retain other highlights`, () => {
    const film = movie(
      document(domain, {
        camera: { focusNodeId: 'a', zoom: 0.5 },
        highlight: { nodeIds: ['a'], groupId: 'g' },
        transitionMs: 500,
        beats: [{ atSec: 1, camera: { zoom: 0.75 }, highlight: { edgeIds: ['ab'] } }],
      }),
    );
    const before = film.frame(23);
    for (const frame of [48, 24, 42, 23, 48]) {
      const state = film.frame(frame);
      assert.equal(state.camera.focusNodeId, 'a');
      assert.equal(state.camera.zoom, frame < 24 ? 0.5 : 0.75);
      assert.deepEqual(state.highlight, {
        nodeIds: ['a'],
        edgeIds: frame < 24 ? [] : ['ab'],
        groupId: 'g',
      });
      assert.equal(state.cameraResolved.x, before.cameraResolved.x);
      assert.equal(state.cameraResolved.y, before.cameraResolved.y);
    }
    assert.ok(film.frame(48).cameraResolved.scale > before.cameraResolved.scale);
  });

  test(`${domain}: camera target switches keep zoom and explicit empty lists clear only their fields`, () => {
    const film = movie(
      document(domain, {
        camera: { focusNodeId: 'a', zoom: 0.5 },
        highlight: { nodeIds: ['a'], edgeIds: ['ab'], groupId: 'g' },
        transitionMs: 0,
        beats: [
          { atSec: 1, camera: { fitIds: ['a', 'b'] }, highlight: { nodeIds: [] } },
          { atSec: 2, camera: { zoom: 0.75 }, highlight: { edgeIds: [] } },
          { atSec: 3, camera: { focusNodeId: 'b' } },
          { atSec: 4, camera: { fitIds: [] } },
        ],
      }),
    );
    const fit = film.frame(24);
    assert.equal(fit.camera.focusNodeId, undefined);
    assert.deepEqual(fit.camera.fitIds, ['a', 'b']);
    assert.equal(fit.camera.zoom, 0.5);
    assert.deepEqual(fit.highlight, { nodeIds: [], edgeIds: ['ab'], groupId: 'g' });
    const zoom = film.frame(48);
    assert.deepEqual(zoom.camera.fitIds, ['a', 'b']);
    assert.equal(zoom.camera.zoom, 0.75);
    assert.deepEqual(zoom.highlight, { nodeIds: [], edgeIds: [], groupId: 'g' });
    const focus = film.frame(72);
    assert.equal(focus.camera.focusNodeId, 'b');
    assert.equal(focus.camera.fitIds, undefined);
    assert.equal(focus.camera.zoom, 0.75);
    const all = film.frame(96);
    assert.equal(all.camera.focusNodeId, undefined);
    assert.deepEqual(all.camera.fitIds, []);
    assert.equal(all.camera.zoom, 0.75);
    assert.deepEqual(all.highlight, { nodeIds: [], edgeIds: [], groupId: 'g' });
    assert.notEqual(all.cameraResolved.x, focus.cameraResolved.x);
    assert.deepEqual(film.frame(24), fit, 'a backward seek restores the earlier partial state');
  });

  test(`${domain}: empty camera and highlight objects preserve all fields on the opening beat`, () => {
    const shot = {
      camera: { focusNodeId: 'a', zoom: 0.5 },
      highlight: { nodeIds: ['a'], edgeIds: ['ab'], groupId: 'g' },
      transitionMs: 0,
    };
    const original = movie(document(domain, shot));
    const film = movie(
      document(domain, {
        ...shot,
        beats: [
          { atSec: 0, camera: {}, highlight: {} },
          { atSec: 1, camera: {}, highlight: {} },
        ],
      }),
    );
    for (const frame of [0, 23, 24, 72]) {
      const state = film.frame(frame);
      const expected = original.frame(frame);
      assert.deepEqual(state.camera, expected.camera);
      assert.deepEqual(state.highlight, expected.highlight);
      assert.deepEqual(state.cameraResolved, expected.cameraResolved);
    }
  });
}
