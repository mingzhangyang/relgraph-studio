import { test } from 'vitest';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createSimulatedStudioDom } from './helpers/studio-dom.mjs';

test('simulated DOM instances isolate events, focus, classes and downloads', async () => {
  const first = createSimulatedStudioDom();
  const second = createSimulatedStudioDom();
  const a = first.document.getElementById('layoutToggle');
  const b = second.document.getElementById('layoutToggle');
  let clicks = 0;
  a.addEventListener('click', () => {
    clicks++;
  });
  await a.click();
  assert.equal(clicks, 1);
  assert.equal(first.document.activeElement, a);
  assert.equal(second.document.activeElement, null);
  assert.notEqual(a, b);
  assert.equal(b.listeners.click, undefined);
  a.classList.add('editing', 'selected');
  assert.equal(a.classList.contains('selected'), true);
  a.classList.remove('editing');
  assert.equal(a.classList.contains('editing'), false);
  assert.equal(b.className, '');
  let keys = 0;
  first.window.addEventListener('keydown', () => {
    keys++;
  });
  second.window.dispatch('keydown');
  assert.equal(keys, 0);
  first.window.dispatch('keydown');
  assert.equal(keys, 1);
  const link = first.document.createElement('a');
  link.href = 'blob:one';
  link.download = 'one.json';
  await link.click();
  assert.deepEqual(first.downloads, [{ href: 'blob:one', filename: 'one.json' }]);
  assert.deepEqual(second.downloads, []);
});

test('simulated DOM preserves typed elements, injected failures and per-instance canvas', () => {
  const built = createSimulatedStudioDom({ canvasContext: () => ({ marker: 'production' }) });
  const fresh = createSimulatedStudioDom();
  const stage = built.document.getElementById('stage');
  assert.equal(stage instanceof built.HTMLCanvasElement, true);
  assert.equal(stage.getContext('2d').marker, 'production');
  assert.equal(fresh.document.getElementById('stage').getContext('2d').marker, undefined);
  assert.equal(
    built.document.createElement('button') instanceof built.HTMLButtonElement,
    true,
  );
  assert.equal(
    createSimulatedStudioDom({ missingId: 'stage' }).document.getElementById('stage'),
    null,
  );
  const wrong = createSimulatedStudioDom({ wrongId: 'stage' });
  assert.equal(wrong.document.getElementById('stage') instanceof wrong.HTMLCanvasElement, false);
});

test(
  'production and source harnesses use the single DOM implementation without weakening bundle checks',
  () => {
    for (const path of ['./helpers/studio-harness.mjs', './production-build.test.mjs']) {
      const code = readFileSync(new URL(path, import.meta.url), 'utf8');
      assert.match(code, /createSimulatedStudioDom\(/);
      assert.doesNotMatch(code, /class (?:Element|Document|HTMLCanvasElement)\b/);
    }
    const production = readFileSync(new URL('./production-build.test.mjs', import.meta.url), 'utf8');
    assert.match(production, /await build\(/);
    assert.match(production, /const script = await readFile\(/);
    assert.match(production, /runInNewContext\(/);
  },
);
