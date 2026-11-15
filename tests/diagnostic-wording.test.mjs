import { test } from 'vitest';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import {
  DIAGNOSTIC_WORDING,
  diagnosticKey,
  worded,
} from '../packages/core/src/diagnostic-wording.ts';
import { loadDocument, parseDocument } from '../packages/core/src/director/load.ts';
import { GENERIC_FORMAT, GENERIC_LIMITS } from '../packages/core/src/domains/generic.ts';
import { ENGLISH_DIAGNOSTICS, WORKSPACE_WORDING } from '../apps/studio/src/diagnostic-text.ts';
import {
  initializeStudioLanguage,
  setStudioLanguage,
  uiDiagnosticText,
} from '../apps/studio/src/i18n.ts';

const CJK = /[㐀-鿿]/;
/** Every key the studio must word: core's tables and the workspace's own. */
const SOURCE = {
  ...DIAGNOSTIC_WORDING,
  studio: { ...DIAGNOSTIC_WORDING.studio, ...WORKSPACE_WORDING },
};

/** Render a wording with a sample for every parameter, recording which it names. */
function sample(wording) {
  const named = new Set();
  const params = new Proxy(
    {},
    {
      get(_target, key) {
        if (typeof key === 'string') named.add(key);
        return key === 'allowed' ? ['a', 'b'] : key === 'count' ? 3 : `«${String(key)}»`;
      },
    },
  );
  return { message: wording.message(params), fix: wording.fix(params), named };
}

test('every diagnostic core words has an English text, keyed by layer and code', () => {
  assert.deepEqual(Object.keys(ENGLISH_DIAGNOSTICS).sort(), Object.keys(SOURCE).sort());
  for (const [layer, table] of Object.entries(SOURCE)) {
    const english = ENGLISH_DIAGNOSTICS[layer];
    for (const key of Object.keys(table))
      assert.ok(Object.hasOwn(english, key), `no English text for ${layer}/${key}`);
    for (const key of Object.keys(english))
      assert.ok(Object.hasOwn(table, key), `English text for unknown ${layer}/${key}`);
  }
});

test('a key is a code, or a code and its variant', () => {
  for (const [layer, table] of Object.entries(SOURCE))
    for (const key of Object.keys(table))
      assert.match(key, /^[A-Z][A-Z_]*(?:\.[a-z][A-Za-z]*)?$/, `${layer}/${key}`);
  assert.equal(diagnosticKey({ code: 'TYPE' }), 'TYPE');
  assert.equal(diagnosticKey({ code: 'TYPE', variant: 'array' }), 'TYPE.array');
  const entry = worded(DIAGNOSTIC_WORDING['graph-source'], 'TYPE.array', { field: 'edges' });
  assert.deepEqual(entry, {
    code: 'TYPE',
    variant: 'array',
    params: { field: 'edges' },
    message: 'edges 必须是数组。',
    fix: '改为数组，或删除该字段。',
  });
  assert.equal(diagnosticKey(entry), 'TYPE.array');
});

test('the English text names the same values as the original, and no Chinese', () => {
  for (const [layer, table] of Object.entries(SOURCE))
    for (const [key, wording] of Object.entries(table)) {
      const original = sample(wording),
        english = sample(ENGLISH_DIAGNOSTICS[layer][key]);
      const where = `${layer}/${key}`;
      assert.deepEqual([...english.named].sort(), [...original.named].sort(), where);
      for (const text of [english.message, english.fix]) {
        assert.ok(text.trim(), where);
        assert.doesNotMatch(text, CJK, where);
        assert.doesNotMatch(text, /undefined|\[object /, where);
      }
    }
});

/** Documents that between them produce most diagnostics of every worded layer. */
const G = GENERIC_FORMAT;
const CORPUS = [
  { format: G, edges: {} },
  { format: G, nodes: [{ id: 'a', label: 'x'.repeat(GENERIC_LIMITS.text + 1), kind: '' }] },
  { format: G, nodes: Array.from({ length: GENERIC_LIMITS.nodes + 1 }, (_, i) => i) },
  { format: G, nodes: Array.from({ length: GENERIC_LIMITS.previewNodes + 1 }, (_, i) => i) },
  { format: G, edges: [{ source: 'a' }] },
  {
    format: G,
    nodes: ['a'],
    kinds: {
      nodes: { node: { shape: 'star' } },
      edges: { e: { line: 'x', head: 'y', directed: 2 } },
    },
    diagram: 'pie',
    directed: 1,
    unfold: 1,
    timeAxis: 2,
  },
  { format: G, nodes: ['a'], kinds: { nodes: 1, edges: { '': 1 } } },
  { format: G, nodes: ['a'], kinds: 1, meta: 1, timeline: 1 },
  { format: G, nodes: ['a'], presentation: [{ camera: { fitIds: 'a' }, highlight: 1 }] },
  { format: G, nodes: ['a'], presentation: [{ camera: 1, highlight: { nodeIds: ['zz'] } }] },
  {
    format: G,
    nodes: ['a'],
    presentation: [
      1,
      { id: 's' },
      {
        id: 's',
        durationSec: 999,
        transitionMs: -1,
        camera: { zoom: 0, focusNodeId: 'a', fitIds: ['a'] },
      },
    ],
  },
  { format: G, edges: [{ source: 'a', target: 'b' }] },
  {
    format: G,
    nodes: ['a'],
    edges: [
      { source: 'a', target: 'b', id: 'e' },
      { source: 'a', target: 'b', id: 'e', weight: -1, directed: 3 },
    ],
  },
  {
    format: G,
    nodes: [
      { id: 'a', position: { y: 5 } },
      { id: 'b', position: { y: 10 } },
    ],
  },
  {
    format: G,
    diagram: 'timeline',
    nodes: [
      { id: 'a', position: { x: 999, y: 5 }, start: 1 },
      { id: 'b', position: { x: 3, y: 10 }, start: 5 },
    ],
  },
  {
    format: G,
    nodes: [
      { id: 'a', start: 5, end: 1, visibleFrom: 9, visibleTo: 2, weight: -3, group: 1 },
      { id: 'b', end: 1, color: 'red', position: 'x', kind: 'x'.repeat(81) },
      { id: 'c', start: 9, visibleTo: 2, weight: 'x' },
      { id: 'a' },
      { id: null },
    ],
    groups: [{ id: 'g' }, { id: 'g' }, {}],
  },
  { format: G },
  { format: 'unknown' },
  { schemaVersion: '0.2', characters: 1, extra: true },
  {
    format: 'relgraph.studio/1',
    source: { format: G, nodes: ['a'] },
    config: { preset: 'nope' },
  },
];
const documents = [
  ...CORPUS.map((doc) => loadDocument(doc)),
  parseDocument('{ nope'),
  ...[
    'honglou-provisional.relgraph.json',
    'biology-egfr-mapk.json',
    'dynasties-timeline-provisional.graph.json',
  ].map((file) => {
    // Break each example in the ways its own checks report.
    const doc = JSON.parse(readFileSync(new URL(`../examples/${file}`, import.meta.url), 'utf8'));
    if (doc.characters) {
      doc.characters[0].factionId = 'nobody';
      doc.relations[0].target = 'nobody';
      doc.relations[1].source = doc.relations[1].target;
      doc.presentation[0].durationSec = -1;
      doc.presentation[0].camera = { focusNodeId: 'nobody', fitIds: ['x'] };
    }
    if (doc.nodes) delete doc.presentation;
    return loadDocument(doc);
  }),
];
const produced = documents.flatMap((result) => [...result.errors, ...result.warnings]);

test('every diagnostic the loader produces is worded from its key and parameters', () => {
  const layers = new Set(produced.map((entry) => entry.layer));
  for (const layer of ['structure', 'semantic', 'graph-source', 'studio'])
    assert.ok(layers.has(layer), `the corpus reaches the ${layer} layer`);
  let worded = 0;
  for (const entry of produced) {
    const table = DIAGNOSTIC_WORDING[entry.layer];
    if (!table) continue;
    const key = diagnosticKey(entry),
      wording = table[key];
    assert.ok(wording, `${entry.layer}/${key} is in its table`);
    assert.equal(wording.message(entry.params ?? {}), entry.message, `${entry.layer}/${key}`);
    assert.equal(wording.fix(entry.params ?? {}), entry.fix, `${entry.layer}/${key}`);
    worded++;
  }
  assert.ok(worded >= 40, `exercise the actual validators, found ${worded}`);
});

test('the studio shows produced diagnostics in English by key, with their values', () => {
  initializeStudioLanguage(null);
  try {
    setStudioLanguage('en');
    for (const entry of produced) {
      if (!DIAGNOSTIC_WORDING[entry.layer]) continue;
      const text = uiDiagnosticText(entry);
      for (const part of [text.title, text.message, text.fix])
        assert.doesNotMatch(part, CJK, `${entry.layer}/${diagnosticKey(entry)}: ${part}`);
    }
    const find = (layer, key) =>
      produced.find((entry) => entry.layer === layer && diagnosticKey(entry) === key);
    assert.equal(
      uiDiagnosticText(find('graph-source', 'TYPE.array')).message,
      'edges must be an array.',
    );
    assert.equal(
      uiDiagnosticText(find('graph-source', 'ENUM.line')).fix,
      'Suggestion: Allowed: solid, dashed, dotted.',
    );
    assert.equal(
      uiDiagnosticText(find('graph-source', 'TOO_LARGE.limits')).message,
      `The graph is too large (limit: ${GENERIC_LIMITS.nodes} nodes, ${GENERIC_LIMITS.edges} relations).`,
    );
    assert.equal(
      uiDiagnosticText(find('studio', 'JSON')).message,
      find('studio', 'JSON').message.replace('JSON 语法错误：', 'JSON syntax error: '),
    );
    // A reworded Chinese message no longer matters: the key and values do.
    const reworded = { ...find('graph-source', 'IMPLICIT_NODES'), message: '改写过的句子' };
    assert.match(uiDiagnosticText(reworded).message, /^\d+ nodes? appears? only in relations/);
    // Text no table words is shown as written.
    const biology = { ...reworded, layer: 'biology', code: 'X', message: 'As written', fix: 'Fix' };
    assert.equal(uiDiagnosticText(biology).message, 'As written');
    setStudioLanguage('zh-CN');
    assert.equal(uiDiagnosticText(reworded).message, '改写过的句子');
  } finally {
    setStudioLanguage('zh-CN');
  }
});

test('core validators write no diagnostic text outside the wording tables', () => {
  const files = [
    'domains/generic-source.ts',
    'domains/generic.ts',
    'relgraph.ts',
    'director/load.ts',
  ];
  for (const file of files) {
    const source = readFileSync(new URL(`../packages/core/src/${file}`, import.meta.url), 'utf8');
    // The whole argument list of every report, and every message or fix property.
    for (const call of source.matchAll(/\b(?:fail|warn|issue)\(/g)) {
      let depth = 1,
        end = call.index + call[0].length;
      for (; depth && end < source.length; end++)
        depth += source[end] === '(' ? 1 : source[end] === ')' ? -1 : 0;
      const body = source.slice(call.index, end);
      assert.doesNotMatch(body, CJK, `${file}: ${body}`);
    }
    for (const property of source.matchAll(/\b(?:message|fix):([^\n]*)\n([^\n]*)/g)) {
      // A value prettier wrapped onto the next line belongs to the property.
      const value = property[1].trim() ? property[1] : property[2];
      // diagnosticText's fallbacks for a partial entry are shown as plain UI text.
      if (/\bentry\.(?:message|fix) \|\|/.test(value)) continue;
      assert.doesNotMatch(value, CJK, `${file}: ${property[0]}`);
    }
  }
});
