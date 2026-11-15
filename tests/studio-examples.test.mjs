import { test } from 'vitest';
import assert from 'node:assert/strict';
import { existsSync, readFileSync } from 'node:fs';
import examples from '../examples/manifest.json' with { type: 'json' };
import { STUDIO_EXAMPLES } from '../apps/studio/src/examples.ts';
import { hasUiText } from '../apps/studio/src/i18n.ts';
import { parseDocument } from '../packages/core/src/director/load.ts';

test('the studio reads its examples from examples/manifest.json', () => {
  assert.deepEqual(STUDIO_EXAMPLES, examples);
});

test('every example in the manifest is a distinct, valid document with English text', () => {
  assert.ok(examples.length > 0);
  assert.equal(new Set(examples.map((e) => e.id)).size, examples.length, 'ids are unique');
  assert.equal(new Set(examples.map((e) => e.file)).size, examples.length, 'files are unique');
  const fields = ['id', 'file', 'name', 'title', 'subtitle', 'wide'];
  for (const example of examples) {
    assert.match(example.id, /^example[A-Z]\w*$/);
    assert.deepEqual(
      Object.keys(example).filter((k) => !fields.includes(k)),
      [],
      example.id,
    );
    const url = new URL(`../examples/${example.file}`, import.meta.url);
    assert.ok(existsSync(url), `${example.file} exists`);
    const result = parseDocument(readFileSync(url, 'utf8'));
    assert.equal(result.valid, true, `${example.file} loads without errors`);
    for (const text of [example.name, example.title, example.subtitle])
      assert.ok(hasUiText(text), `"${text}" has an English translation`);
  }
});

test('the page leaves one slot for the example buttons and names none of them', () => {
  const html = readFileSync(new URL('../demo/index.html', import.meta.url), 'utf8');
  assert.equal(html.match(/<!-- relgraph:examples\b[^>]*-->/g)?.length, 1);
  for (const { id } of examples) assert.doesNotMatch(html, new RegExp(`id="${id}"`));
});
