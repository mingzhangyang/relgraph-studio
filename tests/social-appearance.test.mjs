import { test } from 'vitest';
import assert from 'node:assert/strict';
import { loadDocument } from '../packages/core/src/director/load.ts';
import { makeStudio, flush } from './helpers/studio-harness.mjs';

const source = (declaration = { basis: 'inferred' }) => ({
  format: 'relgraph.social/0.1-draft',
  meta: { title: 'Social appearance' },
  nodes: ['a', 'b', 'c'],
  edges: [
    { id: 'first', source: 'a', target: 'b', kind: 'contact' },
    { id: 'second', source: 'a', target: 'c', kind: 'contact' },
  ],
  ...(declaration === null ? {} : { kinds: { edges: { contact: declaration } } }),
  presentation: [{ id: 'overview', title: 'Overview', durationSec: 3 }],
});
const project = (data, edges) => ({
  format: 'relgraph.studio/1',
  source: data,
  config: { edges },
});
function warnings(data) {
  const loaded = loadDocument(data);
  assert.equal(loaded.valid, true, JSON.stringify(loaded.errors));
  return loaded.warnings.filter((entry) => entry.code === 'INFERRED_SOLID');
}
const signatures = (data) => warnings(data).map(({ path, id }) => [path, id]);

test('effective solid overrides warn at all scopes for inferred, implicit and undeclared kinds', () => {
  for (const declaration of [{ basis: 'inferred' }, {}, null]) {
    const data = source(declaration);
    assert.deepEqual(signatures(data), []);
    for (const [edges, path] of [
      [{ defaults: { dash: 'solid' } }, 'config.edges.defaults.dash'],
      [{ categories: { contact: { dash: 'solid' } } }, 'config.edges.categories.contact.dash'],
      [{ objects: { first: { dash: 'solid' } } }, 'config.edges.objects.first.dash'],
    ]) {
      assert.deepEqual(signatures(project(data, edges)), [[path, 'contact']]);
      for (const dash of ['dashed', 'dotted']) {
        const safe = JSON.parse(JSON.stringify(edges).replaceAll('solid', dash));
        assert.deepEqual(signatures(project(data, safe)), []);
      }
      assert.deepEqual(signatures(project(source({ basis: 'attested' }), edges)), []);
      assert.deepEqual(signatures(project({ ...data, format: 'relgraph.graph/1' }, edges)), []);
    }
  }
});

test('social warnings follow the winning dash and deduplicate only identical path-kind pairs', () => {
  const data = source();
  const edges = {
    defaults: { dash: 'solid' },
    categories: { contact: { dash: 'dotted' } },
    objects: { first: { dash: 'solid' } },
  };
  assert.deepEqual(signatures(project(data, edges)), [
    ['config.edges.objects.first.dash', 'contact'],
  ]);
  edges.objects.first.dash = 'dashed';
  assert.deepEqual(signatures(project(data, edges)), []);
  edges.categories.contact.dash = 'solid';
  assert.deepEqual(signatures(project(data, edges)), [
    ['config.edges.categories.contact.dash', 'contact'],
  ]);
  edges.objects.second = { dash: 'dotted' };
  assert.deepEqual(signatures(project(data, edges)), []);
  delete edges.categories;
  delete edges.objects;
  assert.deepEqual(signatures(project(data, edges)), [['config.edges.defaults.dash', 'contact']]);
  data.edges.push({ id: 'other', source: 'b', target: 'c', kind: 'undeclared' });
  assert.deepEqual(signatures(project(data, edges)).sort(), [
    ['config.edges.defaults.dash', 'contact'],
    ['config.edges.defaults.dash', 'undeclared'],
  ]);
});

test('project overrides remove and restore a used source-solid warning without duplicates', () => {
  const data = source({ basis: 'inferred', line: 'solid' });
  const declared = [['kinds.edges.contact.line', 'contact']];
  assert.deepEqual(signatures(data), declared);
  assert.deepEqual(signatures(project(data, { defaults: { dash: 'dashed' } })), []);
  assert.deepEqual(signatures(project(data, { defaults: { dash: 'solid' } })), [
    ['config.edges.defaults.dash', 'contact'],
  ]);
  assert.deepEqual(signatures(project(data, { objects: { first: { dash: 'dotted' } } })), declared);
  assert.deepEqual(signatures(project(data, {})), declared);
  data.kinds.edges.unused = { basis: 'inferred', line: 'solid' };
  assert.deepEqual(
    signatures(data).sort(),
    [...declared, ['kinds.edges.unused.line', 'unused']].sort(),
  );
});

test('warning paths retain internal object ids and normalized unusual kind names', () => {
  for (const kind of ['contact', 'constructor', '__proto__']) {
    const data = source(null);
    data.kinds = { edges: Object.fromEntries([[' ' + kind + ' ', { basis: 'inferred' }]]) };
    data.edges = [{ id: '诗文关系', source: 'a', target: 'b', kind: ' ' + kind + ' ' }];
    const loaded = loadDocument(data);
    assert.equal(loaded.valid, true, JSON.stringify(loaded.errors));
    const id = loaded.graph.edges[0].id;
    assert.notEqual(id, data.edges[0].id, 'the project uses the adapted edge id');
    assert.equal(loaded.graph.edges[0].kind, kind);
    assert.deepEqual(signatures(project(data, { objects: { [id]: { dash: 'solid' } } })), [
      ['config.edges.objects.' + id + '.dash', kind],
    ]);
    assert.deepEqual(signatures(project(data, { categories: { [kind]: { dash: 'solid' } } })), [
      ['config.edges.categories.' + kind + '.dash', kind],
    ]);
  }
});

function control(app, id) {
  const pending = [app.node('appearanceEditor')];
  while (pending.length) {
    const node = pending.pop();
    if (node.id === id) return node;
    pending.push(...(node.children ?? []));
  }
  throw new Error('Missing appearance control: ' + id);
}
async function choose(element, value) {
  element.value = value;
  await element.dispatch('change');
}

// The actual Studio coordinator and editor run against the shared simulated DOM.
test('Studio refreshes social warnings through appearance edits, history, locale and saved reload', async () => {
  const data = source(null);
  // Keep a source warning alongside the live appearance warning to detect accidental loss.
  data.presentation[0].narration =
    'A lengthy caption that cannot be read in this brief shot. '.repeat(8);
  const app = makeStudio({
    fetcher: async () => ({ ok: true, text: async () => JSON.stringify(data) }),
  });
  await app.ready;
  assert.equal(app.node('status').attributes['data-state'], 'ready');
  assert.match(app.node('warnings').textContent, /CAPTION_READING_SPEED/);
  assert.doesNotMatch(app.node('warnings').textContent, /INFERRED_SOLID/);
  assert.equal(app.window.renderAt(36), true);
  await choose(control(app, 'visualKind'), 'edge');
  await choose(control(app, 'visualObject'), 'first');
  await choose(control(app, 'visualScope'), 'category');
  await choose(control(app, 'visual-dash'), 'solid');
  const panel = app.node('warnings');
  assert.match(panel.textContent, /INFERRED_SOLID/);
  assert.match(panel.textContent, /config\.edges\.categories\.contact\.dash/);
  assert.match(panel.textContent, /CAPTION_READING_SPEED/);
  assert.equal((panel.textContent.match(/INFERRED_SOLID/g) ?? []).length, 1);

  await choose(app.node('languageSelect'), 'en');
  assert.match(panel.textContent, /A solid line presents an inferred relation as attested/);
  await choose(control(app, 'visual-dash'), 'dashed');
  assert.doesNotMatch(panel.textContent, /INFERRED_SOLID/);
  assert.match(panel.textContent, /CAPTION_READING_SPEED/);
  await app.node('visualUndo').click();
  assert.match(panel.textContent, /INFERRED_SOLID/);
  await app.node('visualRedo').click();
  assert.doesNotMatch(panel.textContent, /INFERRED_SOLID/);
  await app.node('visualUndo').click();
  assert.match(panel.textContent, /INFERRED_SOLID/);

  await app.node('visualSave').click();
  const saved = JSON.parse(await app.blobs.at(-1).text());
  assert.deepEqual(signatures(saved), [['config.edges.categories.contact.dash', 'contact']]);
  assert.equal(saved.config.edges.categories.contact.dash, 'solid');

  await control(app, 'visual-dash-reset').click();
  assert.doesNotMatch(panel.textContent, /INFERRED_SOLID/);
  await choose(app.node('languageSelect'), 'zh-CN');
  assert.doesNotMatch(panel.textContent, /INFERRED_SOLID/);
  const file = app.node('fileInput');
  file.files = [{ name: 'saved.studio.json', text: async () => JSON.stringify(saved) }];
  await file.dispatch('change');
  await flush();
  assert.match(panel.textContent, /INFERRED_SOLID/);
  assert.match(panel.textContent, /CAPTION_READING_SPEED/);
  assert.equal((panel.textContent.match(/INFERRED_SOLID/g) ?? []).length, 1);
});
