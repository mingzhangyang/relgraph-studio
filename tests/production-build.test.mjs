import { test } from 'vitest';
import assert from 'node:assert/strict';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { runInNewContext } from 'node:vm';
import { build } from 'vite';
import { createSimulatedStudioDom } from './helpers/studio-dom.mjs';

test('production build includes both examples and the bundled workspace loads them', async () => {
  const output = await mkdtemp(join(tmpdir(), 'relgraph-build-'));
  try {
    await build({ logLevel: 'silent', build: { outDir: output, emptyOutDir: true } });
    const html = await readFile(join(output, 'demo/index.html'), 'utf8');
    const asset = html.match(/<script[^>]+src="([^"]+)"/);
    assert.ok(asset, 'built HTML references a JavaScript bundle');
    const script = await readFile(join(output, 'demo', asset[1]), 'utf8');
    const exampleNames = ['honglou-provisional.relgraph.json', 'biology-signaling-synthetic.json'];
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

    await elements.get('exampleBiology').click();
    assert.equal(elements.get('status').attributes['data-state'], 'ready');
    assert.ok(window.studioFrame().view.nodes.some((node) => node.id === 'kinase-k'));
    assert.equal(window.renderAt(48), true);
  } finally {
    await rm(output, { recursive: true, force: true });
  }
});
