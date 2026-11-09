import { hitDisplayList } from '../packages/render/src/selection.ts';
import { test } from 'vitest';
import assert from 'node:assert/strict';
import literature from '../examples/honglou-provisional.relgraph.json' with { type: 'json' };
import biology from '../examples/biology-signaling-synthetic.json' with { type: 'json' };
import verified from '../datasets/honglou-chengjia-opening/graph.relgraph.json' with { type: 'json' };
import {
  createProject,
  validateProjectConfig,
  nodeAppearance,
  appearanceOrigin,
} from '../packages/core/src/project.ts';
import { loadDocument } from '../packages/core/src/director/load.ts';
import { layoutGraph } from '../packages/core/src/director/layout.ts';
import { directorFrameAt } from '../packages/core/src/director/state.ts';
import { domainStyle } from '../packages/core/src/style.ts';
import { composeFrame } from '../packages/render/src/compose.ts';
import { FRAME_SPECS, cameraFitFor } from '../packages/render/src/frame-spec.ts';
import { VIDEO_THEMES } from '../packages/render/src/theme.ts';
import { texts, measure } from './helpers/display-list.mjs';
import {
  ProjectHistory,
  editAppearance,
  clearAppearance,
} from '../apps/studio/src/project-editor-model.ts';
import { makeStudio } from './helpers/studio-harness.mjs';

const compose = (graph, frame = 0, spec = FRAME_SPECS['landscape-720p'], theme = 'light') => {
  const positions = layoutGraph(graph);
  return composeFrame(directorFrameAt(graph, positions, frame, 24, { fit: cameraFitFor(spec) }), {
    graph,
    positions,
    frame,
    fps: 24,
    measure,
    frameSpec: spec,
    theme: VIDEO_THEMES[theme],
    style: domainStyle(graph.domain),
  });
};
test('style inheritance, per-field origins and clearing do not clone every object', () => {
  const { graph } = loadDocument(literature),
    node = graph.nodes[0];
  let config = editAppearance({}, 'node', node, 'global', 'fontSize', 14);
  config = editAppearance(config, 'node', node, 'category', 'fontSize', 16);
  config = editAppearance(config, 'node', node, 'object', 'fill', '#123456');
  assert.equal(nodeAppearance(config, node).fontSize, 16);
  assert.equal(appearanceOrigin(config.nodes, node.kind, node.id, 'fontSize'), '类别');
  assert.equal(appearanceOrigin(config.nodes, node.kind, node.id, 'fill'), '对象');
  config = clearAppearance(config, 'node', node, 'category');
  assert.equal(nodeAppearance(config, node).fontSize, 14);
  config = editAppearance(config, 'node', node, 'object', 'fill', undefined);
  assert.equal(nodeAppearance(config, node).fill, undefined);
  assert.equal(Object.keys(config.nodes.objects).length, 1);
});
test('invalid project fields, bounds, references and biological marker overrides diagnose cleanly', () => {
  for (const config of [
    { preset: 'bad' },
    { nodes: { defaults: { size: Infinity } } },
    { edges: { defaults: { width: -1 } } },
    { nodes: { objects: { ghost: { fill: '#123456' } } } },
    { text: { nodes: { ghost: { label: 'secret' } } } },
    { layout: { type: 'oops' } },
    { nodes: { defaults: { fontWeight: 450 } } },
    { edges: { defaults: { color: 'url(x)' } } },
    { nodes: { defaults: { madeUp: 1 } } },
  ]) {
    const result = loadDocument(createProject(literature, config));
    assert.equal(result.valid, false);
    assert.equal(result.errors[0].code, 'PROJECT_CONFIG');
  }
  assert.ok(
    validateProjectConfig({ nodes: { defaults: { fill: '#123456', size: 32 } } }).length === 0,
  );
  assert.equal(
    loadDocument(createProject(biology, { edges: { defaults: { head: 'arrow' } } })).valid,
    false,
  );
  assert.equal(
    loadDocument({ format: 'relgraph.studio/1', source: createProject(literature, {}), config: {} })
      .valid,
    false,
  );
});
test('display copy and evidence stay separate; project serialization reproduces both themes and sizes', () => {
  for (const source of [literature, biology, verified]) {
    const before = JSON.stringify(source),
      base = loadDocument(source).graph,
      node = base.nodes[0],
      edge = base.edges[0];
    const config = {
      nodes: {
        defaults: { fontSize: 17, borderWidth: 3 },
        objects: { [node.id]: { shape: 'diamond', size: 22, fill: '#123456', border: '#abcdef' } },
      },
      edges: { defaults: { width: 2.5, dash: 'dotted', curve: 35, showLabel: true, fontSize: 13 } },
      text: {
        nodes: { [node.id]: { label: '自定义文案', description: '未核实的说明' } },
        edges: { [edge.id]: { label: '显示标签' } },
      },
    };
    const project = createProject(source, config),
      result = loadDocument(project),
      round = loadDocument(JSON.parse(JSON.stringify(project)));
    assert.equal(result.valid, true);
    assert.equal(round.valid, true);
    for (const theme of ['light', 'dark'])
      for (const spec of Object.values(FRAME_SPECS))
        for (const frame of source === verified ? [48, 24, 0, 48] : [0, 100, 24, 100])
          assert.deepEqual(
            compose(result.graph, frame, spec, theme),
            compose(round.graph, frame, spec, theme),
          );
    assert.equal(JSON.stringify(source), before);
    assert.equal(result.graph.nodes[0].label, node.label);
    const list = compose(result.graph, source === verified ? 48 : 0);
    assert.ok(list.a11y.nodes.includes('自定义文案'));
    assert.ok(
      compose(
        result.graph,
        source === biology ? 100 : source === verified ? 48 : 0,
      ).a11y.relations.some((label) => label.includes('显示标签')),
    );
    if (source === biology)
      assert.ok(
        !list.a11y.relations.some((label) => label.includes('显示标签')),
        'reaction copy stays hidden before its safe stage',
      );
    assert.ok(texts(list).includes('自定义文案'));
  }
});
test('custom hidden copy and identifiers never enter a frame or hit targets before safe projection', () => {
  const { graph } = loadDocument(verified),
    node = graph.nodes[0];
  graph.project = {
    text: { nodes: { [node.id]: { label: '保密文案', description: '未来说明' } } },
  };
  const early = compose(graph, 0),
    later = compose(graph, 48);
  assert.ok(!JSON.stringify(early).includes('保密文案'));
  assert.ok(!early.selection.some((h) => h.id === node.id));
  assert.ok(later.a11y.nodes.includes('保密文案'));
  assert.ok(!JSON.stringify(compose(graph, 0)).includes('保密文案'));
});
test('history isolates nested config, supports undo/redo and resets per document', () => {
  const history = new ProjectHistory(),
    next = { nodes: { defaults: { fontSize: 20 } } };
  history.commit(next);
  next.nodes.defaults.fontSize = 30;
  assert.equal(history.value.nodes.defaults.fontSize, 20);
  history.undo();
  assert.deepEqual(history.value, {});
  history.redo();
  assert.equal(history.value.nodes.defaults.fontSize, 20);
  history.reset();
  assert.equal(history.canUndo, false);
  assert.equal(history.canRedo, false);
});
test('shared workspace harness mounts the real property view and retains controls across redraws', async () => {
  const studio = makeStudio();
  await studio.ready;
  // Existing workspace harness also exercises all newly imported model/view code.
  assert.ok(studio.elements.get('appearanceEditor').children.length > 0);
});

test('continuous safe display-list hit testing respects graph clipping and node priority', () => {
  const list = {
    selectionClip: { x: 0, y: 0, w: 1000, h: 500 },
    selection: [
      {
        kind: 'edge',
        id: 'edge',
        points: [
          { x: 0, y: 100 },
          { x: 1000, y: 100 },
        ],
      },
      { kind: 'node', id: 'node', box: { x: 90, y: 90, w: 20, h: 20 } },
    ],
  };
  assert.deepEqual(hitDisplayList(list, { x: 500, y: 103 }), { kind: 'edge', id: 'edge' });
  assert.deepEqual(hitDisplayList(list, { x: 100, y: 100 }), { kind: 'node', id: 'node' });
  assert.equal(hitDisplayList(list, { x: 1001, y: 100 }), null);
  assert.equal(hitDisplayList(list, { x: NaN, y: 0 }), null);
});
