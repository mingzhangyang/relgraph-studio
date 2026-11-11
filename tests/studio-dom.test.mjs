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
  assert.equal(built.document.createElement('button') instanceof built.HTMLButtonElement, true);
  assert.equal(
    createSimulatedStudioDom({ missingId: 'stage' }).document.getElementById('stage'),
    null,
  );
  const wrong = createSimulatedStudioDom({ wrongId: 'stage' });
  assert.equal(wrong.document.getElementById('stage') instanceof wrong.HTMLCanvasElement, false);
});

test('production and source harnesses use the single DOM implementation without weakening bundle checks', () => {
  for (const path of ['./helpers/studio-harness.mjs', './production-build.test.mjs']) {
    const code = readFileSync(new URL(path, import.meta.url), 'utf8');
    assert.match(code, /createSimulatedStudioDom\(/);
    assert.doesNotMatch(code, /class (?:Element|Document|HTMLCanvasElement)\b/);
  }
  const production = readFileSync(new URL('./production-build.test.mjs', import.meta.url), 'utf8');
  assert.match(production, /await build\(/);
  assert.match(production, /const script = await readFile\(/);
  assert.match(production, /runInNewContext\(/);
});
test('locale only translates registered workspace labels and known diagnostic templates', async () => {
  const {
    captureStaticStudioUi,
    initializeStudioLanguage,
    refreshStudioUi,
    setStudioLanguage,
    uiText,
    uiMessage,
    uiDiagnostic,
  } = await import('../apps/studio/src/i18n.ts');
  initializeStudioLanguage(null);
  const label = {
    textContent: '  导演预览  ',
    isConnected: true,
    parentElement: { closest: () => null },
  };
  const untouched = {
    textContent: '林黛玉',
    isConnected: true,
    parentElement: { closest: () => null },
  };
  const nodes = [label, untouched];
  const header = {
    isConnected: true,
    value: '播放',
    setAttribute(name, value) {
      this[name] = value;
    },
    getAttribute(name) {
      return name === 'aria-label' ? (this['aria-label'] ?? '播放') : null;
    },
  };
  const doc = {
    body: { querySelectorAll: () => [header] },
    createTreeWalker: () => ({
      nextNode: () => nodes.shift() ?? null,
    }),
    documentElement: {
      setAttribute(name, value) {
        this[name] = value;
      },
    },
    querySelectorAll: () => [],
  };
  captureStaticStudioUi(doc);
  setStudioLanguage('en');
  refreshStudioUi(doc);
  assert.equal(label.textContent, '  Director preview  ');
  assert.equal(untouched.textContent, '林黛玉', 'source text is never altered');
  assert.equal(header['aria-label'], 'Play');
  assert.equal(doc.documentElement.lang, 'en');
  assert.equal(uiText('布局策略'), 'Layout strategy');
  assert.match(uiMessage('全局节点样式 · 当前投影 2 个，已描边 1 个'), /2 visible, 1 outlined/);
  assert.equal(uiDiagnostic('建议：修正字段类型。'), 'Suggestion: Correct the field type.');
  setStudioLanguage('zh-CN');
  refreshStudioUi(doc);
  assert.equal(label.textContent, '  导演预览  ');
  assert.equal(header['aria-label'], '播放');
});

test('every built-in image upload rejection has an English message', async () => {
  const { initializeStudioLanguage, setStudioLanguage, uiStatus } =
    await import('../apps/studio/src/i18n.ts');
  const sources = ['node-image.ts', 'image-dimensions.ts'].map((name) =>
    readFileSync(new URL('../apps/studio/src/' + name, import.meta.url), 'utf8'),
  );
  const messages = [
    ...new Set(
      sources.flatMap((source) =>
        source
          .split("new Error('")
          .slice(1)
          .map((part) => part.split("')")[0])
          .filter((message) => /[\u3400-\u9fff]/.test(message)),
      ),
    ),
  ];
  assert.ok(messages.length >= 6, 'exercise the actual preflight and decode error strings');
  initializeStudioLanguage(null);
  try {
    setStudioLanguage('en');
    for (const message of messages) {
      const localized = uiStatus(message);
      assert.notEqual(localized, message, 'missing English catalog entry for: ' + message);
      assert.doesNotMatch(localized, /[\u3400-\u9fff]/);
    }
  } finally {
    setStudioLanguage('zh-CN');
  }
});

test('shared simulated DOM updates static and generated text without remounting nested controls', async () => {
  const {
    captureStaticStudioUi,
    initializeStudioLanguage,
    refreshStudioUi,
    setStudioLanguage,
    uiElement,
  } = await import('../apps/studio/src/i18n.ts');
  initializeStudioLanguage(null);
  const { document } = createSimulatedStudioDom();
  const heading = document.createElement('h1');
  heading.textContent = '导演预览';
  const toolbar = document.createElement('button');
  toolbar.setAttribute('aria-label', '文档操作');
  const sourceName = document.createElement('p');
  sourceName.textContent = '林黛玉';
  document.body.append(heading, toolbar, sourceName);
  captureStaticStudioUi(document);

  // Generated controls appear after the initial static HTML is captured.
  const label = uiElement(document, 'label', '样式作用范围');
  const input = document.createElement('input');
  input.value = '175';
  label.append(input);
  document.body.append(label);
  assert.equal(label.firstChild.nodeType, 3);
  assert.equal(label.lastElementChild, input);
  assert.equal(document.querySelectorAll('[data-ui-key]').includes(label), true);

  try {
    setStudioLanguage('en');
    refreshStudioUi(document);
    assert.equal(heading.textContent, 'Director preview');
    assert.equal(toolbar.getAttribute('aria-label'), 'Document actions');
    assert.equal(label.firstChild.textContent, 'Style scope');
    assert.equal(label.lastElementChild, input);
    assert.equal(input.value, '175');
    assert.equal(sourceName.textContent, '林黛玉');

    setStudioLanguage('zh-CN');
    refreshStudioUi(document);
    assert.equal(heading.textContent, '导演预览');
    assert.equal(toolbar.getAttribute('aria-label'), '文档操作');
    assert.equal(label.firstChild.textContent, '样式作用范围');
    assert.equal(label.lastElementChild, input);
    assert.equal(input.value, '175');
  } finally {
    setStudioLanguage('zh-CN');
  }
});
