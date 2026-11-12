import { test } from 'vitest';
import assert from 'node:assert/strict';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { runInNewContext } from 'node:vm';
import { build } from 'vite';
import { createSimulatedStudioDom } from './helpers/studio-dom.mjs';

test('production build includes every example and the bundled workspace loads them', async () => {
  const output = await mkdtemp(join(tmpdir(), 'relgraph-build-'));
  try {
    await build({ logLevel: 'silent', build: { outDir: output, emptyOutDir: true } });
    const html = await readFile(join(output, 'demo/index.html'), 'utf8');
    // This fixture mirrors static text and nested controls in the built HTML;
    // the shared DOM simulation now implements text traversal and selectors.
    assert.match(html, /<h1 id="previewHeading">导演预览<\/h1>/);
    assert.match(html, /id="appearanceEditor"/);
    const asset = html.match(/<script[^>]+src="([^"]+)"/);
    assert.ok(asset, 'built HTML references a JavaScript bundle');
    const script = await readFile(join(output, 'demo', asset[1]), 'utf8');
    const exampleNames = [
      'honglou-provisional.relgraph.json',
      'biology-egfr-mapk.json',
      'bookshop-systems-synthetic.graph.json',
      'vertebrates-tree-provisional.graph.json',
      'dynasties-timeline-provisional.graph.json',
      'reading-club-mindmap-synthetic.graph.json',
      'order-flowchart-synthetic.graph.json',
    ];
    for (const name of exampleNames) {
      assert.deepEqual(
        await readFile(join(output, 'examples', name)),
        await readFile(new URL(`../examples/${name}`, import.meta.url)),
      );
    }

    const {
      elements,
      document,
      window,
      Element,
      HTMLCanvasElement,
      HTMLButtonElement,
      HTMLInputElement,
      HTMLLabelElement,
      HTMLSelectElement,
    } = createSimulatedStudioDom({
      // Keep Vite's actual bundled modules; stub only Canvas rasterization.
      canvasContext: () => {
        const gradient = { addColorStop() {} };
        return new Proxy(
          {},
          {
            get(target, key) {
              if (key === 'measureText') return (text) => ({ width: String(text).length * 8 });
              if (key === 'createLinearGradient' || key === 'createRadialGradient')
                return () => gradient;
              return target[key] ?? (() => {});
            },
          },
        );
      },
    });
    // Mount static HTML before the bundle initializes its language bindings.
    const staticHeading = document.createElement('h1');
    staticHeading.textContent = '导演预览';
    document.body.append(staticHeading);
    const staticToolbar = document.createElement('div');
    staticToolbar.setAttribute('aria-label', '文档操作');
    document.body.append(staticToolbar);
    const inspector = document.getElementById('appearanceEditor');
    const strategy = document.getElementById('layoutStrategyEditor');
    document.body.append(inspector, strategy);

    const env = {
      document,
      window,
      Element,
      HTMLElement: Element,
      HTMLCanvasElement,
      HTMLButtonElement,
      HTMLInputElement,
      HTMLLabelElement,
      HTMLSelectElement,
      structuredClone,
      requestAnimationFrame: () => 1,
      cancelAnimationFrame() {},
      fetch: async (path) => {
        const url = new URL(path, 'http://localhost/demo/');
        const text = await readFile(join(output, url.pathname), 'utf8');
        return { ok: true, text: async () => text };
      },
    };
    await runInNewContext(`(async () => { ${script}\n})()`, env);
    assert.equal(elements.get('status').attributes['data-state'], 'ready');
    assert.ok(window.studioFrame().view.nodes.length > 0);
    assert.equal(elements.get('layoutEditor').hidden, true, 'position tools start hidden');
    assert.equal(elements.get('layoutToggle').attributes['aria-pressed'], 'false');
    await elements.get('layoutToggle').click();
    assert.equal(elements.get('layoutToggle').attributes['aria-pressed'], 'true');
    assert.equal(elements.get('stage').classList.contains('is-layout-editing'), true);
    await elements.get('layoutToggle').click();
    assert.equal(elements.get('layoutToggle').attributes['aria-pressed'], 'false');
    assert.equal(elements.get('stage').classList.contains('is-layout-editing'), false);
    assert.equal(window.renderAt(48), true);
    const frame = window.studioFrame();
    assert.equal(window.renderAt(0), true);
    assert.equal(window.renderAt(48), true);
    assert.deepEqual(window.studioFrame(), frame);

    // Generated labels must translate without replacing their nested inputs.
    const generated = (host, key) =>
      host
        .querySelectorAll('[data-ui-key]')
        .find((item) => item.getAttribute('data-ui-key') === key);
    const scopeLabel = generated(inspector, '样式作用范围');
    const spacingLabel = generated(strategy, '间距');
    assert.ok(scopeLabel && spacingLabel, 'generated labels must be connected');
    const scopeInput = scopeLabel.lastElementChild;
    const spacingInput = spacingLabel.lastElementChild;
    spacingInput.value = '184';
    await spacingInput.dispatch('input');
    assert.equal(staticHeading.textContent, '导演预览');
    assert.equal(scopeLabel.textContent.startsWith('样式作用范围'), true);

    const beforeLanguageSwitch = JSON.stringify(window.studioFrame());
    elements.get('languageSelect').value = 'en';
    await elements.get('languageSelect').dispatch('change');
    assert.equal(document.documentElement.attributes.lang, 'en');
    assert.equal(elements.get('status').textContent, 'Ready');
    assert.equal(staticHeading.textContent, 'Director preview');
    assert.equal(staticToolbar.getAttribute('aria-label'), 'Document actions');
    assert.match(scopeLabel.textContent, /Style scope/);
    assert.match(spacingLabel.textContent, /Spacing/);
    assert.equal(scopeLabel.lastElementChild, scopeInput);
    assert.equal(spacingLabel.lastElementChild, spacingInput);
    assert.equal(spacingInput.value, '184');
    assert.equal(JSON.stringify(window.studioFrame()), beforeLanguageSwitch);
    elements.get('languageSelect').value = 'zh-CN';
    await elements.get('languageSelect').dispatch('change');
    assert.equal(elements.get('status').textContent, '就绪');
    assert.equal(staticHeading.textContent, '导演预览');
    assert.equal(staticToolbar.getAttribute('aria-label'), '文档操作');
    assert.match(scopeLabel.textContent, /样式作用范围/);
    assert.match(spacingLabel.textContent, /间距/);
    assert.equal(scopeLabel.lastElementChild, scopeInput);
    assert.equal(spacingLabel.lastElementChild, spacingInput);
    assert.equal(spacingInput.value, '184');
    assert.equal(JSON.stringify(window.studioFrame()), beforeLanguageSwitch);

    await elements.get('exampleBiology').click();
    assert.equal(elements.get('status').attributes['data-state'], 'ready');
    assert.ok(window.studioFrame().view.nodes.some((node) => node.id === 'egfr'));
    assert.equal(window.renderAt(48), true);
  } finally {
    await rm(output, { recursive: true, force: true });
  }
});
