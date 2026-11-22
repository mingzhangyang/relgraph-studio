import { test } from 'vitest';
import assert from 'node:assert/strict';
import sample from '../examples/tang-absence.social.json' with { type: 'json' };
import {
  loadDocument,
  layoutGraph,
  styleForGraph,
  directorFrameAt,
  frameCount,
  validateSocialDocument,
} from '../packages/core/src/index.ts';
import { composeFrame } from '../packages/render/src/compose.ts';
import { frameContext } from '../packages/render/src/compose/context.ts';
import { drawnNodes } from '../packages/render/src/compose/nodes.ts';
import { composeRelations, relationLayout } from '../packages/render/src/compose/relations.ts';
import { hitDisplayList } from '../packages/render/src/selection.ts';
import { measure, texts, paths } from './helpers/display-list.mjs';

test('only the explicit social marker changes the node body, retaining its outline', () => {
  const doc = structuredClone(sample);
  delete doc.nodes[1].noAttestedRelation;
  const { graph } = loadDocument(doc);
  const positions = layoutGraph(graph);
  const list = composeFrame(directorFrameAt(graph, positions, 36, 24), {
    graph,
    positions,
    frame: 36,
    fps: 24,
    style: styleForGraph(graph),
    measure,
  });
  assert.ok(texts(list).includes('本图未找到有据关系'));
  for (const node of list.selection.filter((entry) => entry.kind === 'node')) {
    const body = paths(list).find(
      (p) => p.stroke && JSON.stringify(p.d) === JSON.stringify(node.outline),
    );
    assert.ok(body);
    assert.equal(Boolean(body.dash), node.id === 'wang');
    assert.equal(Boolean(body.fill), node.id === 'lu');
  }
});
test('incident source and target are diagnosed even when the relation appears later', () => {
  const result = validateSocialDocument({
    ...sample,
    edges: [{ source: 'wang', target: 'lu', visibleFrom: 900 }],
  });
  assert.deepEqual(
    result.errors.map((e) => [e.code, e.path]),
    [
      ['SOCIAL_INCIDENT', 'edges[0].source'],
      ['SOCIAL_INCIDENT', 'edges[0].target'],
    ],
  );
});
test('invalid notes and shot references report the field in the authored source', () => {
  for (const [patch, path] of [
    [{ nodes: ['missing', 'lu'] }, 'nodes[0]'],
    [{ nodes: ['lu', 'lu'] }, 'nodes'],
    [{ reason: ' ' }, 'reason'],
    [{ evidence: [] }, 'evidence'],
    [{ evidence: [{ quote: 'x' }] }, 'evidence[0]'],
  ]) {
    const doc = structuredClone(sample);
    Object.assign(doc.rejectedPairs[0], patch);
    assert.ok(
      validateSocialDocument(doc).errors.some((e) => e.path === 'rejectedPairs[0].' + path),
    );
  }
  const doc = structuredClone(sample);
  doc.presentation[0].evidence.pairNoteId = 'unknown';
  assert.ok(
    validateSocialDocument(doc).errors.some(
      (e) => e.path === 'presentation[0].evidence.pairNoteId',
    ),
  );
});
test('in every frame a selected pair note supplies card text and never a relation path or hit', () => {
  const { graph } = loadDocument(sample);
  const positions = layoutGraph(graph),
    style = styleForGraph(graph);
  for (let frame = 0; frame < frameCount(graph, 24); frame++) {
    const state = directorFrameAt(graph, positions, frame, 24);
    const list = composeFrame(state, { graph, positions, style, measure, frame, fps: 24 });
    assert.equal(state.view.edges.length, 0);
    assert.deepEqual(state.highlight.edgeIds, []);
    assert.ok(list.selection.every((entry) => entry.kind === 'node'));
    const [a, b] = list.selection.map(({ box }) => ({
      x: box.x + box.w / 2,
      y: box.y + box.h / 2,
    }));
    assert.equal(hitDisplayList(list, { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 }), null);
    const ctx = frameContext(state, { graph, positions, style, measure, frame, fps: 24 });
    const geometry = relationLayout(ctx.view, ctx.points, ctx.style, ctx.graph);
    const strokes = composeRelations(
      ctx,
      new Map(drawnNodes(ctx).map((n) => [n.node.id, n])),
      geometry,
    );
    assert.deepEqual(strokes.items, []);
    assert.deepEqual(strokes.selection, []);
    assert.ok(list.a11y.evidence.subject.includes(sample.rejectedPairs[0].reason));
    assert.deepEqual(list.a11y.evidence.items, sample.rejectedPairs[0].evidence);
    if (frame === 36) {
      const printed = texts(list).join('');
      assert.ok(printed.includes(sample.rejectedPairs[0].reason));
      assert.ok(printed.includes('卢照邻条'));
    }
  }
});

test('a future endpoint withholds the note, and an unselected note contributes no ink', () => {
  const doc = structuredClone(sample);
  doc.nodes[1].visibleFrom = 10;
  doc.presentation[0].domainAt = 1;
  const hidden = loadDocument(doc).graph;
  const projected = directorFrameAt(hidden, layoutGraph(hidden), 24, 24);
  assert.deepEqual(projected.view.pairNotes, []);
  assert.equal(projected.evidence, null);

  delete doc.presentation[0].evidence;
  doc.presentation[0].domainAt = 10;
  const withNote = loadDocument(doc).graph;
  delete doc.rejectedPairs;
  const withoutNote = loadDocument(doc).graph;
  const film = (graph) => {
    const positions = layoutGraph(graph);
    const style = styleForGraph(graph);
    return (frame) =>
      composeFrame(directorFrameAt(graph, positions, frame, 24), {
        graph,
        positions,
        style,
        measure,
        frame,
        fps: 24,
      });
  };
  const noted = film(withNote),
    plain = film(withoutNote);
  for (let frame = 0; frame < frameCount(withNote, 24); frame++)
    assert.deepEqual(noted(frame), plain(frame));
});
