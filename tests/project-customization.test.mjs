import { walkDisplayItems } from '../packages/render/src/display-list.ts';
import { hitDisplayList } from '../packages/render/src/selection.ts';
import {
  rectsIntersect,
  nodeGlyphContainsPoint,
  nodeGlyphRayDistance,
  nodeLabelObstacleBounds,
} from '../packages/render/src/node-geometry.ts';
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
  APPEARANCE_FIELD_RULES,
  validAppearanceField,
} from '../packages/core/src/project.ts';
import { loadDocument } from '../packages/core/src/director/load.ts';
import { layoutGraph } from '../packages/core/src/director/layout.ts';
import { directorFrameAt } from '../packages/core/src/director/state.ts';
import { domainStyle } from '../packages/core/src/style.ts';
import { composeFrame } from '../packages/render/src/compose.ts';
import {
  FRAME_SPECS,
  cameraFitFor,
  projectCameraPoint,
} from '../packages/render/src/frame-spec.ts';
import { VIDEO_THEMES } from '../packages/render/src/theme.ts';
import { texts, measure } from './helpers/display-list.mjs';
import {
  ProjectHistory,
  inspectorAppearance,
  inspectorOrigin,
  editAppearance,
  clearAppearance,
} from '../apps/studio/src/project-editor-model.ts';
import { makeStudio } from './helpers/studio-harness.mjs';
import { ProjectSavepoint, workspaceSnapshot } from '../apps/studio/src/unsaved-changes-model.ts';
import { visibleObjectEntries } from '../apps/studio/src/project-editor-view.ts';
import { projectSelectionOverlay } from '../apps/studio/src/selection-overlay-model.ts';
import { appearanceFieldHint, parseAppearanceDraft } from '../apps/studio/src/field-validation-model.ts';

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
test('shared appearance constraints match project validation and documented bounds', () => {
  const samples = [
    ['nodes', 'size', 8, 7],
    ['nodes', 'size', 48, 48.01],
    ['nodes', 'borderWidth', 0, 8.01],
    ['nodes', 'fontSize', 9, 8.99],
    ['nodes', 'fontWeight', 600, 500],
    ['nodes', 'fill', '#AABBcc', '#abc'],
    ['nodes', 'shape', 'pill', 'trapezoid'],
    ['edges', 'width', 0.5, 0.49],
    ['edges', 'curve', -160, -161],
    ['edges', 'fontSize', 32, 33],
    ['edges', 'showLabel', false, 'false'],
    ['edges', 'head', 'arrow', 'none-ish'],
  ];
  for (const [kind, key, valid, invalid] of samples) {
    assert.equal(validAppearanceField(kind, key, valid), true, kind + '.' + key);
    assert.equal(validAppearanceField(kind, key, invalid), false, kind + '.' + key);
    const configFor = (value) => ({ [kind]: { defaults: { [key]: value } } });
    assert.deepEqual(validateProjectConfig(configFor(valid)), [], kind + '.' + key);
    assert.ok(validateProjectConfig(configFor(invalid)).length > 0, kind + '.' + key);
  }
  assert.deepEqual(APPEARANCE_FIELD_RULES.nodes.size, { type: 'number', min: 8, max: 48 });
  assert.deepEqual(APPEARANCE_FIELD_RULES.edges.width, { type: 'number', min: 0.5, max: 8 });
  assert.equal(validAppearanceField('nodes', 'unexpected', 3), false);
});

test('appearance field parser separates inheritance, incomplete numeric input and invalid values', () => {
  assert.deepEqual(parseAppearanceDraft('nodes', 'size', ''), {
    ok: true, value: undefined, message: '',
  });
  const badToken = parseAppearanceDraft('nodes', 'size', '', true);
  assert.equal(badToken.ok, false);
  assert.match(badToken.message, /数字输入/);
  const tooLarge = parseAppearanceDraft('nodes', 'size', '999');
  assert.equal(tooLarge.ok, false);
  assert.match(tooLarge.message, /8–48/);
  assert.match(appearanceFieldHint('nodes', 'size'), /8–48/);
  assert.equal(parseAppearanceDraft('nodes', 'size', '12.5').value, 12.5);
  assert.equal(parseAppearanceDraft('nodes', 'size', '1e999').ok, false);
  assert.equal(parseAppearanceDraft('nodes', 'size', ' ').ok, false);
  assert.equal(parseAppearanceDraft('nodes', 'fill', '#BAD').ok, false);
  assert.equal(parseAppearanceDraft('nodes', 'fill', '#33669900').ok, false);
  assert.equal(parseAppearanceDraft('nodes', 'fill', '#Ab12EF').value, '#Ab12EF');
  assert.match(appearanceFieldHint('nodes', 'fill'), /#RRGGBB/);
  assert.equal(parseAppearanceDraft('nodes', 'fontWeight', '600').value, 600);
  assert.equal(parseAppearanceDraft('nodes', 'fontWeight', '450').ok, false);
  assert.equal(parseAppearanceDraft('edges', 'showLabel', 'false').value, false);
  assert.equal(parseAppearanceDraft('edges', 'showLabel', 'oops').ok, false);
  assert.equal(parseAppearanceDraft('edges', 'curve', '-160').value, -160);
  assert.equal(parseAppearanceDraft('edges', 'curve', '-161').ok, false);
  assert.equal(parseAppearanceDraft('edges', 'unexpected', '1').ok, false);
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
test('full-project savepoint tracks configuration and live positions without depending on Map order', () => {
  const savepoint = new ProjectSavepoint();
  const positions = new Map([
    ['b', { x: 2, y: 3 }],
    ['a', { x: 1, y: 4 }],
  ]);
  assert.equal(savepoint.isDirty({}, positions), false, 'no document is never dirty');
  savepoint.markClean({}, positions);
  assert.equal(savepoint.isDirty({}, new Map([...positions].reverse())), false);
  assert.equal(
    workspaceSnapshot({}, positions),
    workspaceSnapshot({}, new Map([...positions].reverse())),
  );

  const history = new ProjectHistory();
  history.commit({ nodes: { defaults: { size: 24 } } });
  assert.equal(savepoint.isDirty(history.value, positions), true);
  history.undo();
  assert.equal(
    savepoint.isDirty(history.value, positions),
    false,
    'undo reaches the saved baseline',
  );
  history.redo();
  assert.equal(savepoint.isDirty(history.value, positions), true);
  const moved = new Map(positions);
  moved.set('a', { x: 7, y: 4 });
  savepoint.markClean(history.value, positions);
  assert.equal(savepoint.isDirty(history.value, moved), true, 'uncommitted drag still counts');
  assert.equal(savepoint.isDirty(history.value, positions), false);
  savepoint.clear();
  assert.equal(savepoint.isDirty(history.value, moved), false);
});

test('savepoint reuses snapshots across redraws and invalidates live position edits', () => {
  let configReads = 0;
  const config = {
    get preset() {
      ++configReads;
      return 'editorial';
    },
    assets: { large: { data: 'x'.repeat(200_000) } },
  };
  let positionReads = 0;
  const position = {
    get x() {
      ++positionReads;
      return 1;
    },
    y: 2,
  };
  const points = new Map([['node', position]]);
  const savepoint = new ProjectSavepoint();
  savepoint.markClean(config, points);
  const readsAfterSave = { config: configReads, position: positionReads };
  for (let frame = 0; frame < 200; frame++)
    assert.equal(savepoint.isDirty(config, points), false);
  assert.deepEqual(
    { config: configReads, position: positionReads },
    readsAfterSave,
    'playback must not repeatedly serialize images or sort positions',
  );

  points.set('node', { x: 7, y: 2 });
  savepoint.positionsChanged();
  assert.equal(savepoint.isDirty(config, points), true, 'in-place drag must invalidate');
  points.set('node', { x: 1, y: 2 });
  savepoint.positionsChanged();
  assert.equal(savepoint.isDirty(config, points), false, 'cancelled drag returns to savepoint');

  assert.equal(savepoint.isDirty({ preset: 'editorial', assets: config.assets }, points), false);
  assert.equal(savepoint.isDirty({ preset: 'quiet', assets: config.assets }, points), true);
  assert.equal(savepoint.isDirty(config, points), false, 'undo returns to saved configuration');
  savepoint.clear();
  assert.equal(savepoint.isDirty({ preset: 'quiet' }, points), false);
});

test('workspace selection overlay uses safe projected IDs and composed hit geometry only', () => {
  const frame = {
    view: {
      nodes: [
        { id: 'shown-a', kind: 'person' },
        { id: 'shown-b', kind: 'person' },
        { id: 'shown-c', kind: 'other' },
      ],
      edges: [
        { id: 'parallel-1', kind: 'friend' },
        { id: 'parallel-2', kind: 'friend' },
      ],
    },
  };
  const list = {
    width: 1280,
    height: 720,
    selectionClip: { x: 80, y: 90, w: 800, h: 460 },
    selection: [
      { kind: 'node', id: 'shown-a', box: { x: 100, y: 100, w: 60, h: 44 } },
      { kind: 'node', id: 'shown-b', box: { x: 990, y: 100, w: 50, h: 44 } },
      { kind: 'node', id: 'shown-c', box: { x: 220, y: 100, w: 70, h: 44 } },
      { kind: 'node', id: 'hidden-future', box: { x: 0, y: 0, w: 30, h: 30 } },
      { kind: 'edge', id: 'parallel-1', points: [{ x: 120, y: 130 }, { x: 250, y: 200 }] },
      { kind: 'edge', id: 'parallel-2', points: [{ x: 130, y: 130 }, { x: 260, y: 210 }] },
      { kind: 'edge', id: 'hidden-edge', points: [{ x: 1, y: 1 }, { x: 2, y: 2 }] },
    ],
  };
  const node = { kind: 'node', selection: { kind: 'node', id: 'shown-a' }, scope: 'object' };
  const single = projectSelectionOverlay(frame, list, node);
  assert.equal(single.affectedCount, 1);
  assert.deepEqual(single.targets.map(({ hit }) => hit.id), ['shown-a']);
  assert.equal(single.targets[0].selected, true);
  assert.deepEqual(single.clip, list.selectionClip);

  const category = projectSelectionOverlay(frame, list, { ...node, scope: 'category' });
  assert.equal(category.affectedCount, 2, 'off-stage members still belong to the category');
  assert.deepEqual(category.targets.map(({ hit }) => hit.id), ['shown-a']);
  const global = projectSelectionOverlay(frame, list, {
    kind: 'node', selection: null, scope: 'global',
  });
  assert.equal(global.affectedCount, 3);
  assert.deepEqual(global.targets.map(({ hit }) => hit.id), ['shown-a', 'shown-c']);
  assert.ok(global.targets.every((target) => !target.selected));

  const edge = projectSelectionOverlay(frame, list, {
    kind: 'edge', selection: { kind: 'edge', id: 'parallel-2' }, scope: 'category',
  });
  assert.equal(edge.affectedCount, 2);
  assert.deepEqual(edge.targets.map(({ hit }) => hit.id), ['parallel-1', 'parallel-2']);
  assert.equal(edge.targets[1].selected, true);
  assert.ok(!JSON.stringify([single, category, global, edge]).includes('hidden-future'));
  assert.ok(!JSON.stringify([single, category, global, edge]).includes('hidden-edge'));
});

test('workspace overlays exclude invalid geometry and do not invent hidden selections', () => {
  const frame = { view: { nodes: [{ id: 'visible', kind: 'item' }], edges: [] } };
  const list = {
    width: 1280,
    height: 720,
    selection: [
      { kind: 'node', id: 'visible', box: { x: NaN, y: 0, w: 20, h: 20 } },
      { kind: 'node', id: 'visible', points: [{ x: 0, y: 0 }, { x: Infinity, y: 1 }] },
    ],
  };
  const missing = projectSelectionOverlay(frame, list, {
    kind: 'node', selection: { kind: 'node', id: 'future' }, scope: 'object',
  });
  assert.equal(missing.affectedCount, 0);
  assert.deepEqual(missing.targets, []);
  const global = projectSelectionOverlay(frame, list, {
    kind: 'node', selection: null, scope: 'global',
  });
  assert.equal(global.affectedCount, 1);
  assert.deepEqual(global.targets, [], 'neither invalid hit geometry reaches SVG');
});

test('workspace overlay counts only segments intersecting the selection clip', () => {
  const edgeIds = [
    'outside-corner',
    'enters-corner',
    'crosses-stage',
    'two-segment',
    'touches-border',
    'wholly-away',
  ];
  const frame = {
    view: { nodes: [], edges: edgeIds.map((id) => ({ id, kind: 'friend' })) },
  };
  const list = {
    width: 1280,
    height: 720,
    selectionClip: { x: 80, y: 90, w: 800, h: 460 },
    selection: [
      // The bounding box overlaps the clip corner but the line never enters.
      { kind: 'edge', id: 'outside-corner', points: [{ x: 0, y: 120 }, { x: 120, y: 0 }] },
      { kind: 'edge', id: 'enters-corner', points: [{ x: 0, y: 0 }, { x: 130, y: 130 }] },
      // Both endpoints are outside: the segment still crosses the visible clip.
      { kind: 'edge', id: 'crosses-stage', points: [{ x: 0, y: 150 }, { x: 1000, y: 150 }] },
      { kind: 'edge', id: 'two-segment', points: [
        { x: 0, y: 120 }, { x: 120, y: 0 }, { x: 200, y: 130 },
      ] },
      { kind: 'edge', id: 'touches-border', points: [{ x: 0, y: 90 }, { x: 100, y: 90 }] },
      { kind: 'edge', id: 'wholly-away', points: [{ x: 0, y: 0 }, { x: 20, y: 20 }] },
      // A hit outside the current spoiler-safe frame must also stay excluded.
      { kind: 'edge', id: 'hidden-future', points: [{ x: 90, y: 90 }, { x: 100, y: 100 }] },
    ],
  };
  const all = projectSelectionOverlay(frame, list, {
    kind: 'edge', selection: null, scope: 'global',
  });
  assert.equal(all.affectedCount, 6);
  assert.deepEqual(all.targets.map(({ hit }) => hit.id), [
    'enters-corner', 'crosses-stage', 'two-segment', 'touches-border',
  ]);
  assert.match(all.message, /已描边 4 个/);

  const missed = projectSelectionOverlay(frame, list, {
    kind: 'edge', selection: { kind: 'edge', id: 'outside-corner' }, scope: 'object',
  });
  assert.equal(missed.affectedCount, 1, 'the item still belongs to the safe projection');
  assert.deepEqual(missed.targets, [], 'no invisible segment can be counted as outlined');
  assert.match(missed.message, /尚未绘制到当前画面/);
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

test('inspector global/category values remain editable without an object or through object overrides', () => {
  const node = { id: 'a', kind: 'person', label: 'A' },
    config = {
      nodes: {
        defaults: { fontSize: 23 },
        categories: { person: { fontSize: 25 } },
        objects: { a: { fontSize: 27 } },
      },
    };
  assert.equal(inspectorAppearance(config, 'node', undefined, 'global').fontSize, 23);
  assert.equal(inspectorOrigin(config, 'node', undefined, 'global', 'fontSize'), '全局');
  assert.equal(inspectorAppearance(config, 'node', node, 'global').fontSize, 23);
  assert.equal(inspectorAppearance(config, 'node', node, 'category').fontSize, 25);
  assert.equal(inspectorAppearance(config, 'node', node, 'object').fontSize, 27);
});
test('top-positioned multiline text fits above the glyph instead of falling back beside it', () => {
  const node = {
    id: 'a',
    kind: 'person',
    label: 'ABCDEFGHIJKLMNOPQRSTUVWXABCDEFGH',
    position: { x: 0, y: 0 },
  };
  const graph = {
    domain: 'neutral',
    meta: { title: 'test' },
    nodes: [node],
    edges: [],
    groups: [],
    scenes: [{ id: 's', title: 'test', durationSec: 5 }],
    project: { nodes: { defaults: { fontSize: 16, textPosition: 'top' } } },
  };
  const list = compose(graph),
    lines = [...walkDisplayItems(list.items)].filter(
      (i) => i.type === 'text' && i.text && node.label.includes(i.text),
    );
  assert.equal(lines.length, 2);
  for (const line of lines) assert.ok(line.y + line.font.size * 1.3 <= 330 - 8 - 4);
});
test('edge hit targets end at the drawn reveal prefix', () => {
  const graph = {
    domain: 'neutral',
    meta: { title: 't' },
    nodes: [
      { id: 'a', kind: 'person', label: 'A', position: { x: -100, y: 0 } },
      { id: 'b', kind: 'person', label: 'B', position: { x: 100, y: 0 } },
    ],
    edges: [{ id: 'e', kind: 'link', source: 'a', target: 'b' }],
    groups: [],
    scenes: [{ id: 's', title: 't', durationSec: 5 }],
  };
  const positions = layoutGraph(graph),
    state = directorFrameAt(graph, positions, 0),
    options = { graph, positions, frame: 0, fps: 24, measure };
  const complete = composeFrame(state, options).selection.find((s) => s.kind === 'edge');
  state.reveal.edges.e = 0.6;
  const list = composeFrame(state, options),
    prefix = list.selection.find((s) => s.kind === 'edge');
  assert.ok(prefix.points.at(-1).x < complete.points.at(-1).x);
  assert.equal(hitDisplayList(list, complete.points.at(-1)), null);
  assert.deepEqual(hitDisplayList(list, prefix.points.at(-1)), { kind: 'edge', id: 'e' });
});

test('label obstacles include thick authored glyph borders at both output sizes', () => {
  // B's right-side label ends just inside the stroked outline of A when
  // A uses the largest supported border; radius-only obstacles miss it.
  for (const shape of ['circle', 'pill', 'diamond']) {
    for (const spec of Object.values(FRAME_SPECS)) {
      const render = (borderWidth) => {
        const graph = {
          domain: 'neutral',
          meta: { title: 'glyph clearance' },
          nodes: [
            { id: 'a', kind: 'person', label: 'A', position: { x: 100, y: 0 } },
            { id: 'b', kind: 'person', label: 'Label', position: { x: 0, y: 0 } },
          ],
          edges: [],
          groups: [],
          scenes: [{ id: 's', title: 'glyph clearance', durationSec: 5 }],
          project: { nodes: { objects: { a: { size: 30, shape, borderWidth } } } },
        };
        const positions = layoutGraph(graph);
        const state = directorFrameAt(graph, positions, 0, 24, { fit: cameraFitFor(spec) });
        state.cameraResolved = { x: 0, y: 0, scale: 1 };
        state.reveal.nodes = { a: 1, b: 1 };
        const list = composeFrame(state, {
          graph,
          positions,
          frame: 0,
          fps: 24,
          measure,
          frameSpec: spec,
          style: domainStyle('neutral'),
        });
        const glyph = list.selection.find(
          (target) => target.kind === 'node' && target.id === 'a',
        )?.box;
        const label = [...walkDisplayItems(list.items)].find(
          (item) => item.type === 'text' && item.text === 'Label',
        );
        assert.ok(glyph, `${shape} at ${spec.name}: node must be selectable`);
        assert.ok(label, `${shape} at ${spec.name}: neighboring label must remain visible`);
        const labelBox = {
          x: label.x,
          y: label.y,
          w: measure(label.text, label.font),
          h: label.font.size * 1.3,
        };
        return { label, intersects: rectsIntersect(labelBox, glyph) };
      };
      const ordinary = render(2);
      const thick = render(8);
      assert.equal(ordinary.intersects, false);
      assert.equal(thick.intersects, false, `${shape} at ${spec.name}: label crosses border`);
      assert.ok(
        thick.label.x < ordinary.label.x,
        `${shape} at ${spec.name}: thick stroke should move the neighbor's label`,
      );
    }
  }
});

test('stroked glyph ray intersection agrees with shared hit geometry for all shape directions', () => {
  for (const shape of ['circle', 'pill', 'diamond'])
    for (const spec of Object.values(FRAME_SPECS))
      for (const borderWidth of [0, 2, 8]) {
        const node = { id: 'n', kind: 'person', label: 'N', importance: 1 };
        const config = { nodes: { objects: { n: { shape, size: 23, borderWidth } } } };
        const style = domainStyle('neutral');
        for (const angle of [0, 0.12, Math.PI / 6, Math.PI / 4, Math.PI / 2, (3 * Math.PI) / 4]) {
          const direction = { x: Math.cos(angle), y: Math.sin(angle) };
          const radius = nodeGlyphRayDistance(node, direction, 1, spec, style, config);
          const before = { x: direction.x * (radius - 0.01), y: direction.y * (radius - 0.01) };
          const after = { x: direction.x * (radius + 0.01), y: direction.y * (radius + 0.01) };
          assert.equal(
            nodeGlyphContainsPoint(node, { x: 0, y: 0 }, before, 1, spec, style, 1, config),
            true,
            `${shape} ${spec.name} ${borderWidth} at ${angle}: interior`,
          );
          assert.equal(
            nodeGlyphContainsPoint(node, { x: 0, y: 0 }, after, 1, spec, style, 1, config),
            false,
            `${shape} ${spec.name} ${borderWidth} at ${angle}: exterior`,
          );
        }
      }
});

test('directed role bars attach beyond the authored stroked glyph at both endpoints', () => {
  for (const shape of ['circle', 'pill', 'diamond'])
    for (const spec of Object.values(FRAME_SPECS)) {
      const nodes = [
        { id: 'from', kind: 'protein', label: 'From', position: { x: -120, y: 0 } },
        { id: 'to', kind: 'protein', label: 'To', position: { x: 120, y: 0 } },
      ];
      const graph = {
        domain: 'biology',
        meta: { title: 'inhibition' },
        nodes,
        edges: [
          { id: 'inhibit', kind: 'inhibition', source: 'from', target: 'to', directed: true },
        ],
        groups: [],
        scenes: [{ id: 's', title: 'inhibition', durationSec: 5 }],
        project: {
          nodes: {
            objects: {
              from: { shape, size: 23, borderWidth: 8 },
              to: { shape, size: 23, borderWidth: 8 },
            },
          },
        },
      };
      const positions = layoutGraph(graph);
      const state = directorFrameAt(graph, positions, 0, 24, { fit: cameraFitFor(spec) });
      state.cameraResolved = { x: 0, y: 0, scale: 1 };
      state.reveal.nodes = { from: 1, to: 1 };
      state.reveal.edges = { inhibit: 1 };
      const style = domainStyle('biology');
      const list = composeFrame(state, {
        graph,
        positions,
        frame: 0,
        fps: 24,
        measure,
        frameSpec: spec,
        style,
      });
      const points = list.selection.find(
        (entry) => entry.kind === 'edge' && entry.id === 'inhibit',
      )?.points;
      assert.ok(points && points.length > 2, `${shape} ${spec.name}: edge is selectable`);
      const from = projectCameraPoint(nodes[0].position, state.cameraResolved, spec);
      const to = projectCameraPoint(nodes[1].position, state.cameraResolved, spec);
      const first = points[0];
      const last = points.at(-1);
      const sourceDistance = nodeGlyphRayDistance(
        nodes[0],
        { x: 1, y: 0 },
        1,
        spec,
        style,
        graph.project,
      );
      const targetDistance = nodeGlyphRayDistance(
        nodes[1],
        { x: -1, y: 0 },
        1,
        spec,
        style,
        graph.project,
      );
      assert.ok(first.x >= from.x + sourceDistance - 1e-7, `${shape} source clears border`);
      assert.ok(
        last.x <= to.x - targetDistance - 5 * spec.typeScale + 1e-7,
        `${shape} role marker clears target border`,
      );
      assert.equal(
        nodeGlyphContainsPoint(nodes[1], to, last, 1, spec, style, 1, graph.project),
        false,
      );
    }
});

test('authored top labels use the full stroked obstacle, not the unadorned radius', () => {
  const graph = {
    domain: 'neutral',
    meta: { title: 'top label' },
    nodes: [
      {
        id: 'n',
        kind: 'person',
        label: 'ABCDEFGHIJKLMNOPQRSTUVWXABCDEFGH',
        position: { x: 0, y: 0 },
      },
    ],
    edges: [],
    groups: [],
    scenes: [{ id: 's', title: 'top label', durationSec: 5 }],
    project: {
      nodes: { objects: { n: { shape: 'circle', size: 23, borderWidth: 8, textPosition: 'top' } } },
    },
  };
  for (const spec of Object.values(FRAME_SPECS)) {
    const positions = layoutGraph(graph);
    const state = directorFrameAt(graph, positions, 0, 24, { fit: cameraFitFor(spec) });
    state.cameraResolved = { x: 0, y: 0, scale: 1 };
    state.reveal.nodes = { n: 1 };
    const list = composeFrame(state, {
      graph,
      positions,
      frame: 0,
      fps: 24,
      measure,
      frameSpec: spec,
      style: domainStyle('neutral'),
    });
    const lines = [...walkDisplayItems(list.items)].filter(
      (item) =>
        item.type === 'text' && graph.nodes[0].label.includes(item.text) && item.text.length > 0,
    );
    assert.equal(lines.length, 2, `${spec.name}: both label lines shown`);
    const obstacle = nodeLabelObstacleBounds(
      graph.nodes[0],
      projectCameraPoint(graph.nodes[0].position, state.cameraResolved, spec),
      1,
      spec,
      domainStyle('neutral'),
      graph.project,
    );
    const bottom = Math.max(...lines.map((line) => line.y + line.font.size * 1.3));
    assert.ok(
      bottom <= obstacle.y - 0.001,
      `${spec.name}: requested top position clears the stroke`,
    );
    const nodeCenter = projectCameraPoint(graph.nodes[0].position, state.cameraResolved, spec);
    const firstLine = lines[0];
    assert.ok(
      Math.abs(firstLine.x + measure(firstLine.text, firstLine.font) / 2 - nodeCenter.x) <
        20 * spec.typeScale,
      `${spec.name}: text is above its own node, not beside it`,
    );
  }
});

test('relationship options use only projected endpoint names and uniquely identify parallel edges', () => {
  const visible = {
    view: {
      nodes: [
        { id: 'a', kind: 'person', label: 'Alice' },
        { id: 'b', kind: 'person', label: 'Bob' },
        { id: 'c', kind: 'person', label: 'Carol' },
      ],
      edges: [
        { id: 'e1', source: 'a', target: 'b', kind: 'parent', label: '母女', directed: true },
        { id: 'e2', source: 'a', target: 'c', kind: 'parent', label: '母女', directed: true },
        { id: 'e3', source: 'a', target: 'b', kind: 'parent', label: '母女', directed: true },
      ],
    },
  };
  const config = { text: { nodes: { b: { label: 'B Visible' }, c: { label: 'Future Secret' } } } };
  const options = visibleObjectEntries(visible, config, 'edge');
  assert.equal(options.length, 3);
  assert.equal(new Set(options.map((entry) => entry.label)).size, 3);
  assert.match(options[0].label, /Alice → B Visible/);
  assert.match(options[0].label, /ID: e1/);
  assert.match(options[1].label, /Alice → Future Secret/);
  assert.match(options[2].label, /ID: e3/);
  const projected = { view: { ...visible.view, nodes: visible.view.nodes.slice(0, 2) } };
  const safeOptions = visibleObjectEntries(projected, config, 'edge');
  assert.ok(safeOptions[1].label.includes('端点未显示'));
  assert.ok(!safeOptions[1].label.includes('Future Secret'));
  assert.ok(!safeOptions[1].label.includes('Carol'));
  assert.deepEqual(visibleObjectEntries(null, config, 'edge'), []);
});
test('authored curved edge role marks clear the node outline at every supported marker style', () => {
  for (const shape of ['circle', 'pill', 'diamond'])
    for (const head of ['bar', 'hollow-circle', 'arrow', 'none'])
      for (const spec of Object.values(FRAME_SPECS))
        for (const curve of [-160, 0, 160]) {
          const graph = {
            domain: 'neutral',
            meta: { title: 'stroked endpoints' },
            nodes: [
              { id: 'a', kind: 'person', label: 'A', position: { x: -150, y: 0 } },
              { id: 'b', kind: 'person', label: 'B', position: { x: 150, y: 0 } },
            ],
            edges: [{ id: 'edge', kind: 'link', source: 'a', target: 'b', directed: true }],
            groups: [],
            scenes: [{ id: 's', title: 'stroked endpoints', durationSec: 5 }],
            project: {
              nodes: { objects: { b: { shape, size: 23, borderWidth: 8 } } },
              edges: { objects: { edge: { head, curve, width: 8 } } },
            },
          };
          const positions = layoutGraph(graph);
          const state = directorFrameAt(graph, positions, 0, 24, { fit: cameraFitFor(spec) });
          state.cameraResolved = { x: 0, y: 0, scale: 1 };
          state.reveal.nodes = { a: 1, b: 1 };
          state.reveal.edges = { edge: 1 };
          const style = domainStyle('neutral');
          const list = composeFrame(state, {
            graph,
            positions,
            frame: 0,
            fps: 24,
            measure,
            frameSpec: spec,
            style,
          });
          const drawnEnd = list.selection
            .find((entry) => entry.id === 'edge' && entry.kind === 'edge')
            ?.points.at(-1);
          assert.ok(drawnEnd, `${shape} ${head} ${curve} ${spec.name}`);
          const center = projectCameraPoint(graph.nodes[1].position, state.cameraResolved, spec);
          const boundary = nodeGlyphRayDistance(
            graph.nodes[1],
            { x: -1, y: 0 },
            1,
            spec,
            style,
            graph.project,
          );
          const width = 8 * spec.typeScale;
          const reach =
            head === 'hollow-circle'
              ? 4 * spec.typeScale + width / 2
              : head === 'bar'
                ? 5 * spec.typeScale + width / 2
                : head === 'arrow'
                  ? 8 * spec.typeScale
                  : width / 2;
          assert.ok(
            center.x - drawnEnd.x >= boundary + reach + spec.typeScale - 1e-7,
            `${shape} ${head} curve=${curve} at ${spec.name}: role mark within stroked node`,
          );
        }
});
