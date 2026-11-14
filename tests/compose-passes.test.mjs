// Each pass of composeFrame (packages/render/src/compose/) run on its own,
// over the shared frame context, and the order composeFrame runs them in.
import { test } from 'vitest';
import assert from 'node:assert/strict';
import bookshop from '../examples/bookshop-systems-synthetic.graph.json' with { type: 'json' };
import dynasties from '../examples/dynasties-timeline-provisional.graph.json' with { type: 'json' };
import flowchart from '../examples/order-flowchart-synthetic.graph.json' with { type: 'json' };
import biology from '../examples/biology-egfr-mapk.json' with { type: 'json' };
import { loadDocument } from '../packages/core/src/director/load.ts';
import { layoutGraph } from '../packages/core/src/director/layout.ts';
import { directorFrameAt, frameCount } from '../packages/core/src/director/state.ts';
import { NEUTRAL_STYLE, styleForGraph } from '../packages/core/src/style.ts';
import { composeFrame } from '../packages/render/src/compose.ts';
import { composeBackground } from '../packages/render/src/compose/background.ts';
import { frameContext } from '../packages/render/src/compose/context.ts';
import {
  composeDetailCard,
  composeFurniture,
  frameText,
} from '../packages/render/src/compose/furniture.ts';
import { composeGroups } from '../packages/render/src/compose/groups.ts';
import { composeNodeLabels, composeRelationLabels } from '../packages/render/src/compose/labels.ts';
import { composeLegend } from '../packages/render/src/compose/legend.ts';
import { composeNodes, drawnNodes, nodeObstacles } from '../packages/render/src/compose/nodes.ts';
import { composeRelations, relationLayout } from '../packages/render/src/compose/relations.ts';
import { composeTimeAxis } from '../packages/render/src/compose/time-axis.ts';
import { cameraFitFor, FRAME_SPECS } from '../packages/render/src/frame-spec.ts';
import { rectsIntersect } from '../packages/render/src/node-geometry.ts';
import { VIDEO_THEMES } from '../packages/render/src/theme.ts';
import { measure } from './helpers/display-list.mjs';

const spec = FRAME_SPECS['landscape-720p'];

/** The shared context of `frame` (default: the last) of a document, and its inputs. */
function contextOf(doc, { frame, style } = {}) {
  const result = loadDocument(doc);
  assert.equal(result.valid, true, JSON.stringify(result.errors));
  const { graph } = result;
  const positions = layoutGraph(graph);
  const at = frame ?? frameCount(graph, spec.fps) - 1;
  const state = directorFrameAt(graph, positions, at, spec.fps, { fit: cameraFitFor(spec) });
  const options = {
    graph,
    positions,
    frame: at,
    fps: spec.fps,
    measure,
    frameSpec: spec,
    theme: VIDEO_THEMES.light,
    style: style ?? styleForGraph(graph),
    detailAt: result.detailAt,
  };
  return { ctx: frameContext(state, options), state, options, graph };
}

/** Every rectangle held by an index, through its public query. */
const held = (index, spec) => {
  const found = [];
  index.someIntersecting({ x: 0, y: 0, w: spec.width, h: spec.height }, (rect) => {
    found.push(rect);
    return false;
  });
  return found;
};
const texts = (items) => {
  const out = [];
  const walk = (list) => {
    for (const item of list)
      if (item.type === 'group') walk(item.items);
      else if (item.type === 'text') out.push(item.text);
  };
  walk(items);
  return out;
};

test('composeFrame is its passes, run in order over one context', () => {
  for (const doc of [bookshop, dynasties, flowchart, biology]) {
    const { ctx, state, options } = contextOf(doc);
    const items = composeBackground(ctx);
    const drawn = drawnNodes(ctx);
    const occupied = ctx.rectIndex();
    const obstacles = nodeObstacles(ctx, drawn, occupied);
    const axis = composeTimeAxis(ctx, occupied);
    const hulls = composeGroups(ctx, drawn, occupied);
    const layout = relationLayout(ctx.view, ctx.points);
    const relations = composeRelations(
      ctx,
      new Map(drawn.map((entry) => [entry.node.id, entry])),
      layout,
    );
    const glyphs = composeNodes(ctx, drawn);
    const legend = composeLegend(ctx, occupied);
    const labels = composeNodeLabels(
      ctx,
      { drawn, held: glyphs.held, obstacles, pull: layout.pull, relations: relations.obstacles },
      occupied,
    );
    const tags = composeRelationLabels(ctx, relations.labels, occupied);
    const card = composeDetailCard(ctx);
    const expected = {
      width: spec.width,
      height: spec.height,
      items: [
        ...items,
        {
          type: 'group',
          clip: { ...spec.stage },
          items: [
            ...axis,
            ...hulls,
            ...relations.items,
            ...glyphs.items,
            ...labels,
            ...tags,
            ...legend,
          ],
        },
        ...card.items,
        ...composeFurniture(ctx),
      ],
      a11y: frameText(ctx, card.detail),
      selection: [...relations.selection, ...glyphs.selection],
      selectionClip: { ...spec.stage },
    };
    assert.deepEqual(composeFrame(state, options), expected);
  }
});

test('background: a gradient, a light behind the stage and a lattice inside it', () => {
  const { ctx } = contextOf(bookshop);
  const items = composeBackground(ctx);
  assert.deepEqual(
    items.map((item) => item.fill?.type ?? item.fill),
    ['linear', 'radial', VIDEO_THEMES.light.grid],
  );
  const { stage } = spec;
  for (const [command, x, y] of items[2].d)
    if (command === 'A')
      assert.ok(x > stage.x && x < stage.x + stage.w && y > stage.y && y < stage.y + stage.h);
});

test('time axis: nothing without an axis; rules and their labels with one', () => {
  const plain = contextOf(bookshop);
  const none = plain.ctx.rectIndex();
  assert.deepEqual(composeTimeAxis(plain.ctx, none), []);
  assert.equal(held(none, spec).length, 0);

  const timeline = contextOf(dynasties);
  assert.ok(timeline.ctx.style.timeAxis, 'the dynasties drawing keeps its axis');
  const occupied = timeline.ctx.rectIndex();
  const items = composeTimeAxis(timeline.ctx, occupied);
  const years = items.filter((item) => item.type === 'text');
  assert.ok(years.length >= 3);
  for (const year of years) assert.match(year.text, /^-?\d+$/);
  // Each year label keeps its room for the passes that follow.
  assert.equal(held(occupied, spec).length, years.length);
  // Off the axis (a neutral style has none), the same frame has no rules.
  const neutral = contextOf(dynasties, { style: NEUTRAL_STYLE });
  assert.deepEqual(composeTimeAxis(neutral.ctx, neutral.ctx.rectIndex()), []);
});

test('groups: one hull per group in view, named by a tab that keeps its room', () => {
  const { ctx } = contextOf(bookshop);
  const drawn = drawnNodes(ctx);
  const occupied = ctx.rectIndex();
  const hulls = composeGroups(ctx, drawn, occupied);
  const present = new Set(drawn.map((entry) => entry.node.groupId).filter((id) => id != null));
  assert.ok(present.size >= 2);
  assert.equal(hulls.length, present.size);
  const names = texts(hulls);
  assert.ok(names.length >= 1);
  assert.equal(held(occupied, spec).length, names.length);
  // With no free room on the outline, a tab falls back to the visible point
  // nearest the top, pulled inside the label bounds.
  const blocked = ctx.rectIndex();
  blocked.add({ x: 0, y: 0, w: spec.width, h: spec.height });
  const fallback = [];
  const walk = (list) => {
    for (const item of list)
      if (item.type === 'group') walk(item.items);
      else if (item.type === 'text') fallback.push(item);
  };
  walk(composeGroups(ctx, drawn, blocked));
  assert.equal(fallback.length, names.length);
  for (const tab of fallback)
    assert.ok(
      tab.x >= ctx.bounds.left &&
        tab.x <= ctx.bounds.right &&
        tab.y >= ctx.bounds.top &&
        tab.y <= ctx.bounds.bottom,
    );
});

test('relations: a stroke and a selection target per revealed relation', () => {
  const { ctx } = contextOf(bookshop);
  const drawn = drawnNodes(ctx);
  const layout = relationLayout(ctx.view, ctx.points);
  const { items, selection, obstacles, labels } = composeRelations(
    ctx,
    new Map(drawn.map((entry) => [entry.node.id, entry])),
    layout,
  );
  assert.equal(selection.length, ctx.view.edges.length);
  assert.ok(selection.every((entry) => entry.kind === 'edge' && entry.points.length >= 17));
  assert.ok(items.length >= ctx.view.edges.length);
  assert.ok(held(obstacles, spec).length > 0, 'drawn strokes are obstacles for labels');
  for (const label of labels) assert.ok(label.text && label.alpha > 0);
  // Every relation of a node adds a unit direction to its pull.
  for (const node of ctx.view.nodes) assert.ok(layout.pull.has(node.id));
});

test('nodes: glyphs and selection boxes; shapes that hold their label are held', () => {
  const { ctx } = contextOf(flowchart);
  const drawn = drawnNodes(ctx);
  const { items, selection, held: inside } = composeNodes(ctx, drawn);
  assert.equal(selection.length, drawn.length);
  assert.ok(selection.every((entry) => entry.kind === 'node' && entry.box.w > 0));
  assert.ok(items.length >= drawn.length);
  // Flowchart steps are boxes and decisions: every label is inside its shape.
  assert.equal(inside.size, drawn.length);
  assert.deepEqual(
    composeNodeLabels(
      ctx,
      {
        drawn,
        held: inside,
        obstacles: nodeObstacles(ctx, drawn, ctx.rectIndex()),
        pull: new Map(),
        relations: ctx.rectIndex(),
      },
      ctx.rectIndex(),
    ),
    [],
  );
});

test('legend: an entry per kind on screen, on a plate that keeps its room', () => {
  const { ctx } = contextOf(bookshop);
  const occupied = ctx.rectIndex();
  const legend = composeLegend(ctx, occupied);
  assert.equal(legend[0].fill, VIDEO_THEMES.light.legendPlate);
  assert.ok(texts(legend).length >= 2);
  const rooms = held(occupied, spec);
  assert.equal(rooms.length, 1);
  assert.equal(rooms[0].h, legend[0].d[0][4]);
  // One kind needs no legend.
  const single = contextOf({
    format: 'relgraph.graph/1',
    nodes: [
      { id: 'a', label: 'A' },
      { id: 'b', label: 'B' },
    ],
    relations: [{ source: 'a', target: 'b' }],
  });
  assert.deepEqual(composeLegend(single.ctx, single.ctx.rectIndex()), []);
});

test('node labels: never set over a taken room, and each placed label takes one', () => {
  const { ctx } = contextOf(bookshop);
  const drawn = drawnNodes(ctx);
  const occupied = ctx.rectIndex();
  const obstacles = nodeObstacles(ctx, drawn, occupied);
  const before = held(occupied, spec).length;
  const inputs = {
    drawn,
    held: new Set(),
    obstacles,
    pull: relationLayout(ctx.view, ctx.points).pull,
    relations: ctx.rectIndex(),
  };
  const labels = composeNodeLabels(ctx, inputs, occupied);
  assert.ok(labels.length >= drawn.length);
  const rooms = held(occupied, spec).slice(before);
  assert.ok(rooms.length >= 1);
  for (let i = 0; i < rooms.length; i++)
    for (let j = i + 1; j < rooms.length; j++)
      assert.equal(rectsIntersect(rooms[i], rooms[j]), false);
  // With the whole stage taken, no label is placed.
  const full = ctx.rectIndex();
  full.add({ x: 0, y: 0, w: spec.width, h: spec.height });
  assert.deepEqual(composeNodeLabels(ctx, inputs, full), []);
});

test('relation tags: a plate and its text, or nothing where no room is left', () => {
  const { ctx } = contextOf(biology);
  const drawn = drawnNodes(ctx);
  const { labels } = composeRelations(
    ctx,
    new Map(drawn.map((entry) => [entry.node.id, entry])),
    relationLayout(ctx.view, ctx.points),
  );
  assert.ok(labels.length >= 1, 'biology captions its relations');
  const tags = composeRelationLabels(ctx, labels, ctx.rectIndex());
  assert.ok(tags.length >= 2 && tags.length % 2 === 0);
  assert.deepEqual(
    tags.filter((item) => item.type === 'path').map((item) => item.fill),
    Array(tags.length / 2).fill(VIDEO_THEMES.light.edgeLabelBox),
  );
  const full = ctx.rectIndex();
  full.add({ x: 0, y: 0, w: spec.width, h: spec.height });
  assert.deepEqual(composeRelationLabels(ctx, labels, full), []);
});

test('furniture and accessible text: title, frame, shot and every node by name', () => {
  const { ctx, graph } = contextOf(dynasties);
  const written = texts(composeFurniture(ctx));
  assert.ok(written.includes(graph.meta.title));
  assert.ok(written.some((text) => text.startsWith('FRAME ')));
  assert.ok(written.some((text) => text.startsWith('SCENE ')));
  const a11y = frameText(ctx, null);
  assert.equal(a11y.title, graph.meta.title);
  assert.equal(a11y.scene.count, graph.scenes.length);
  assert.equal(a11y.nodes.length, ctx.view.nodes.length);
  assert.equal(a11y.relations.length, ctx.view.edges.length);
  // No shot opens a card here.
  assert.deepEqual(composeDetailCard(ctx), { items: [], detail: null });
});
