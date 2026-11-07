import { test } from 'vitest';
import assert from 'node:assert/strict';
import { frameStateAt, validateVisualGraph } from '../src/graph/core.ts';
import { directorFrameAt, frameCount } from '../src/director/state.ts';
import { layoutGraph } from '../src/director/layout.ts';

function timelineGraph() {
  return {
    domain: 'literature',
    meta: { title: 'Spoiler-safe time jumps' },
    timeline: { unit: 'chapter' },
    nodes: [
      { id: 'early', label: 'Early character', kind: 'person', position: { x: 0, y: 0 } },
      {
        id: 'future-character',
        label: 'Future character',
        kind: 'person',
        groupId: 'future-group',
        position: { x: 300, y: 0 },
        visibility: { from: 5 },
      },
    ],
    edges: [{ id: 'future-relation', source: 'early', target: 'future-character', kind: 'family' }],
    groups: [{ id: 'future-group', label: 'Future group', kind: 'faction' }],
    scenes: [
      {
        id: 'hidden-shot',
        title: 'Future secret',
        narration: 'Future narration',
        durationSec: 2,
        domainAt: 1,
        camera: { fitIds: ['early', 'future-character'] },
        highlight: {
          nodeIds: ['future-character'],
          edgeIds: ['future-relation'],
          groupId: 'future-group',
        },
        openDetailNodeId: 'future-character',
      },
      {
        id: 'reveal',
        title: 'Revealed',
        durationSec: 2,
        domainAt: 5,
        camera: { focusNodeId: 'future-character' },
        highlight: {
          nodeIds: ['future-character'],
          edgeIds: ['future-relation'],
          groupId: 'future-group',
        },
        openDetailNodeId: 'future-character',
      },
      {
        id: 'rewind',
        title: 'Back to the beginning',
        durationSec: 2,
        domainAt: 1,
        transitionMs: 1000,
        camera: { focusNodeId: 'early' },
        highlight: { nodeIds: ['early'] },
      },
    ],
  };
}

test('projection keeps future targets and previous highlights hidden across a backward jump', () => {
  const graph = timelineGraph();
  const before = structuredClone(graph);
  assert.equal(validateVisualGraph(graph).valid, true);
  const layout = layoutGraph(graph);
  const early = directorFrameAt(graph, layout, 0);
  assert.equal(early.playback.scene.redacted, true);
  assert.deepEqual(early.camera.fitIds, ['early']);
  assert.deepEqual(early.highlight, { nodeIds: [], edgeIds: [], groupId: null });
  assert.equal(early.overlay, null);
  for (const secret of [
    'future-character',
    'future-relation',
    'future-group',
    'Future secret',
    'Future narration',
  ]) {
    assert.ok(!JSON.stringify(early).includes(secret), `early frame leaked ${secret}`);
  }
  const revealed = frameStateAt(graph, 48);
  assert.ok(revealed.view.nodes.some((node) => node.id === 'future-character'));
  assert.equal(revealed.overlay.nodeId, 'future-character');

  const rewound = directorFrameAt(graph, layout, 96);
  assert.equal(rewound.playback.domainAt, 1);
  assert.deepEqual(rewound.previousHighlight, { nodeIds: [], edgeIds: [], groupId: null });
  for (const secret of ['future-character', 'future-relation', 'future-group']) {
    assert.ok(!JSON.stringify(rewound).includes(secret), `rewound frame leaked ${secret}`);
  }
  assert.deepEqual(graph, before);
});

test('empty graph playback and director state are safe to inspect', () => {
  const graph = {
    domain: 'test',
    meta: { title: 'Empty' },
    nodes: [],
    edges: [],
    groups: [],
    scenes: [],
  };
  const result = directorFrameAt(graph, new Map(), 0);
  assert.equal(validateVisualGraph(graph).valid, true);
  assert.equal(frameCount(graph), 1);
  assert.equal(result.playback.scene, null);
  assert.deepEqual(result.cameraResolved, { x: 0, y: 0, scale: 1 });
  assert.deepEqual(result.highlight, { nodeIds: [], edgeIds: [], groupId: null });
});

test('the graph validator reports malformed list values at the untrusted input boundary', () => {
  const graph = timelineGraph();
  graph.scenes[0].camera = { fitIds: 'invalid' };
  graph.scenes[0].highlight = { nodeIds: 7, edgeIds: false };
  const diagnostics = validateVisualGraph(graph);
  assert.equal(diagnostics.valid, false);
  assert.deepEqual(
    diagnostics.errors
      .filter((entry) => entry.code === 'SCENE_LIST_TYPE')
      .map((entry) => entry.path),
    ['scenes[0].camera.fitIds', 'scenes[0].highlight.nodeIds', 'scenes[0].highlight.edgeIds'],
  );
});
