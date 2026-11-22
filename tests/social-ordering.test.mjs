import { test } from 'vitest';
import assert from 'node:assert/strict';
import { loadDocument, styleForGraph } from '../packages/core/src/index.ts';

const SOCIAL_FORMAT = 'relgraph.social/0.1-draft';
const GENERIC_FORMAT = 'relgraph.graph/1';
const document = (kinds, declarations) => ({
  format: SOCIAL_FORMAT,
  nodes: ['a', 'b', 'c'],
  edges: kinds.map((kind, index) => ({
    id: `edge-${index}`,
    source: 'a',
    target: index % 2 ? 'b' : 'c',
    kind,
  })),
  ...(declarations ? { kinds: { edges: declarations } } : {}),
});
const style = (doc) => {
  const loaded = loadDocument(doc);
  assert.equal(loaded.valid, true, JSON.stringify(loaded.errors));
  return styleForGraph(loaded.graph);
};
const edgeOrder = (sheet) => sheet.legend.filter((entry) => entry.of === 'edge').map((e) => e.kind);

test.each([
  ['tied undeclared kinds', ['beta', 'alpha'], undefined, ['alpha', 'beta']],
  [
    'frequency before name',
    ['alpha', 'zeta', 'beta', 'beta'],
    undefined,
    ['beta', 'alpha', 'zeta'],
  ],
  [
    'authored order before undeclared kinds',
    ['alpha', 'beta', 'alpha', 'beta', 'beta', 'zeta'],
    { zeta: { basis: 'attested' }, eta: {} },
    ['zeta', 'eta', 'beta', 'alpha'],
  ],
  ['numeric undeclared kinds', ['1', '10', '2', '2'], undefined, ['2', '1', '10']],
])('social encoding preserves canonical order: %s', (_, kinds, declarations, expected) => {
  const source = document(kinds, declarations);
  const baseline = style(source);
  const generic = style({ ...source, format: GENERIC_FORMAT });
  assert.deepEqual(edgeOrder(baseline), expected);
  assert.deepEqual(edgeOrder(baseline), edgeOrder(generic));
  for (const kind of expected) assert.equal(baseline.edges[kind].tone, generic.edges[kind].tone);
  // Re-exporting the same records in a new order must preserve the full style,
  // including the edge tones, conservative dash defaults and legend sequence.
  for (const edges of [[...source.edges].reverse(), [...source.edges.slice(1), source.edges[0]]]) {
    assert.deepEqual(style({ ...source, edges }), baseline);
  }
});

test('source data cannot mark an authored kind as implicitly declared', () => {
  const source = document(['alpha', 'alpha', 'zeta'], {
    zeta: { implicit: true },
    alpha: {},
  });
  for (const format of [SOCIAL_FORMAT, GENERIC_FORMAT]) {
    assert.deepEqual(edgeOrder(style({ ...source, format })), ['zeta', 'alpha']);
  }
});
