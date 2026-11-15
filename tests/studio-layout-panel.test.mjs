// The layout panel of the workspace (PR 6, W1–W4), in the shared simulated DOM.
import { test } from 'vitest';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { flush, makeStudio } from './helpers/studio-harness.mjs';

/** Every element below `root`, depth first. */
function descendants(root) {
  const found = [],
    stack = [...(root.children ?? [])];
  while (stack.length) {
    const element = stack.shift();
    found.push(element);
    stack.unshift(...(element.children ?? []));
  }
  return found;
}

test('W4: the disclosure summary is the layout panel’s one heading', async () => {
  const app = makeStudio();
  await app.ready;
  const panel = app.node('layoutStrategyEditor');
  assert.deepEqual(
    descendants(panel)
      .map((element) => element.tagName)
      .filter((tag) => /^H[1-6]$/.test(tag)),
    [],
    'the panel adds no heading below the disclosure',
  );
  const html = readFileSync(new URL('../demo/index.html', import.meta.url), 'utf8');
  const disclosure = /<details id="layoutStrategies"[^>]*>([\s\S]*?)<\/details>/.exec(html)?.[1];
  assert.ok(disclosure);
  assert.match(disclosure, /<summary>布局策略 · 预览后应用<\/summary>/);
  assert.doesNotMatch(disclosure, /<h[1-6]/);
});
