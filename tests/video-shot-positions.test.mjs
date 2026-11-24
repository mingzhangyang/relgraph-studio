import { test } from 'vitest';
import assert from 'node:assert/strict';
import {
  parseDocument,
  createProject,
  DEFAULT_LAYOUT_SETTINGS,
  layoutGraph,
  filmEvents,
} from '@relgraph/core';
import { createCanvasRenderer } from '../packages/render/src/canvas.ts';
import { frameSpecFor } from '../packages/render/src/frame-spec.ts';
import { measuringCanvas } from './helpers/display-list.mjs';
import { applyRecipePositions } from '../scripts/video-shot-positions.mjs';

const point = (x, y) => ({ x, y });
const nodes = [
  { id: 'saved' },
  { id: 'source', position: point(10, 20) },
  { id: 'both', position: point(30, 40) },
  { id: 'fallback' },
  { id: 'auto' },
];
const graph = {
  nodes,
  project: { layout: { positions: { saved: point(0, 0), both: point(50, 60) } } },
};
const layout = () =>
  new Map([
    ['saved', point(0, 0)],
    ['source', point(10, 20)],
    ['both', point(50, 60)],
    ['fallback', point(100, 100)],
    ['auto', point(200, 200)],
  ]);
const ids = { nodes: new Map(nodes.map((n) => [n.id, 'authored-' + n.id])) };

test('project and source coordinates take priority over recipe fallbacks', () => {
  const recipe = Object.fromEntries(
    nodes.slice(0, 4).map((n) => ['authored-' + n.id, point(-75, -75)]),
  );
  const result = applyRecipePositions(graph, layout(), recipe, ids);
  assert.deepEqual(result.get('saved'), point(0, 0));
  assert.deepEqual(result.get('source'), point(10, 20));
  assert.deepEqual(result.get('both'), point(50, 60));
  assert.deepEqual(result.get('fallback'), point(-75, -75));
  assert.deepEqual(result.get('auto'), point(200, 200));
});

test('raw documents still support recipe coordinates; missing recipes leave layout alone', () => {
  assert.deepEqual(applyRecipePositions({ nodes }, layout(), undefined), layout());
  assert.deepEqual(
    applyRecipePositions({ nodes }, layout(), { saved: point(1, 2) }).get('saved'),
    point(1, 2),
  );
});

test('only eligible recipe positions must be finite', () => {
  assert.throws(
    () => applyRecipePositions(graph, layout(), { fallback: { x: 'bad', y: 2 } }),
    /Invalid position for fallback/,
  );
  assert.deepEqual(
    applyRecipePositions(graph, layout(), { saved: { x: 'bad', y: 2 } }).get('saved'),
    point(0, 0),
  );
});

test('saved Studio coordinates reach both film events and the rendered display list', () => {
  const source = {
    format: 'relgraph.graph/1',
    nodes: [
      { id: '甲' },
      { id: '乙', position: point(200, 0) },
      { id: '丙' },
    ],
    edges: [
      { source: '甲', target: '乙' },
      { source: '甲', target: '丙' },
    ],
    presentation: [
      {
        id: 'shot',
        title: 'Shot',
        durationSec: 2,
        camera: { fitIds: ['甲', '乙', '丙'] },
      },
    ],
  };
  const raw = parseDocument(JSON.stringify(source));
  assert.equal(raw.valid, true, JSON.stringify(raw.errors));
  const internal = (name) =>
    [...(raw.authoredIds?.nodes ?? [])].find(([, authored]) => authored === name)?.[0] ?? name;
  const savedId = internal('甲');
  const saved = point(-200, 100);
  const fallback = point(0, 180);
  const stale = point(100, -200);
  const project = createProject(source, {
    layout: { ...DEFAULT_LAYOUT_SETTINGS, positions: { [savedId]: saved } },
  });
  const loaded = parseDocument(JSON.stringify(project));
  assert.equal(loaded.valid, true, JSON.stringify(loaded.errors));
  const panel = loaded.graph;
  assert.equal(panel.nodes.find((node) => node.id === savedId).position, undefined);

  const expected = layoutGraph(panel);
  expected.set(internal('丙'), fallback);
  const positions = applyRecipePositions(
    panel,
    layoutGraph(panel),
    { 甲: stale, 乙: stale, 丙: fallback },
    loaded.authoredIds,
  );
  assert.deepEqual(positions, expected);
  const fps = 60;
  const events = filmEvents(panel, positions, fps, { authoredIds: loaded.authoredIds });
  for (const [name, coordinate] of [
    ['甲', saved],
    ['乙', point(200, 0)],
    ['丙', fallback],
  ]) {
    const event = events.nodes.find((node) => node.id === name);
    assert.ok(event, name);
    assert.deepEqual(point(event.x, event.y), coordinate);
  }

  const frameSpec = { ...frameSpecFor('portrait-1080x1440'), fps };
  const draw = (coordinates) =>
    createCanvasRenderer(measuringCanvas(), panel, coordinates, {
      theme: 'light',
      frameSpec,
      detailAt: loaded.detailAt,
    }).displayListAt(fps);
  const actual = draw(positions);
  assert.deepEqual(actual, draw(expected));
  const overwritten = new Map(expected).set(savedId, stale);
  assert.notDeepEqual(actual, draw(overwritten));
});
