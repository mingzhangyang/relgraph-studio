import { test } from 'vitest';
import assert from 'node:assert/strict';
import sample from '../examples/tang-correspondence.social.json' with { type: 'json' };
import {
  directorFrameAt,
  layoutGraph,
  loadDocument,
  styleForGraph,
  validateSocialDocument,
} from '../packages/core/src/index.ts';
import { resolveEdgeForm } from '../packages/render/src/forms.ts';
import { composeFrame } from '../packages/render/src/compose.ts';
import { measure } from './helpers/display-list.mjs';

test('independent social claims and conservative defaults', () => {
  const doc = structuredClone(sample);
  doc.edges.push({ ...doc.edges[0], id: 'other', kind: 'undeclared' });
  doc.kinds.edges['交往推定'].assertsCoPresence = true;
  doc.kinds.edges['交往推定'].line = 'solid';
  const loaded = loadDocument(doc);
  assert.equal(loaded.valid, true);
  assert.deepEqual(
    loaded.warnings.filter((w) => w.code === 'INFERRED_SOLID').map((w) => [w.path, w.id]),
    [['kinds.edges.交往推定.line', '交往推定']],
  );
  const { edges } = styleForGraph(loaded.graph);
  for (const kind of ['当面交往', '交往推定'])
    assert.ok(edges[kind].forms.includes('shared-position'));
  for (const kind of ['诗文往来', 'undeclared'])
    assert.ok(!edges[kind].forms.includes('shared-position'));
  assert.ok(edges.undeclared.dash.length);
  assert.deepEqual(resolveEdgeForm(edges['当面交往'], '当面交往', 'r', 'shared-position'), {
    diagnostic: { code: 'FORM_UNAVAILABLE', id: 'r', kind: '当面交往', form: 'shared-position' },
  });
  assert.equal(loaded.graph.edges[0].evidence[0].quote, doc.edges[0].evidence[0].quote);
  assert.deepEqual(loaded.graph.scenes[0].evidence.edgeId, 'verse');
  doc.kinds.edges['交往推定'] = { basis: 'maybe', assertsCoPresence: 'yes' };
  assert.deepEqual(
    validateSocialDocument(doc).errors.map((e) => e.code),
    ['SOCIAL_CO_PRESENCE', 'SOCIAL_BASIS'],
  );
});

test('composition checks each requested form before drawing its edge', () => {
  for (const format of ['relgraph.social/0.1-draft', 'relgraph.graph/1']) {
    const { graph } = loadDocument({ ...sample, format });
    const positions = layoutGraph(graph),
      style = styleForGraph(graph);
    const state = directorFrameAt(graph, positions, 36, 24);
    const frame = (request, sheet = style) =>
      composeFrame(state, {
        frame: 36,
        fps: 24,
        graph,
        positions,
        style: sheet,
        measure,
        edgeForms: new Map([['verse', request]]),
      });
    const allowed = frame('dotted');
    assert.deepEqual(allowed.formDiagnostics, []);
    assert.ok(allowed.selection.some((s) => s.kind === 'edge' && s.id === 'verse'));
    for (const refused of [
      frame('shared-position'),
      frame('dotted', {
        ...style,
        edges: { 诗文往来: { ...style.edges['诗文往来'], forms: ['solid'] } },
      }),
    ]) {
      assert.equal(refused.formDiagnostics[0].code, 'FORM_NOT_ALLOWED');
      assert.equal(refused.formDiagnostics[0].id, 'verse');
      assert.ok(!refused.selection.some((s) => s.kind === 'edge'));
    }
  }
});
