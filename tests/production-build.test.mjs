import { test } from 'vitest';
import assert from 'node:assert/strict';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { runInNewContext } from 'node:vm';
import { build } from 'vite';

class Element {
  constructor() {
    this.children = [];
    this.attributes = {};
    this.listeners = {};
    this._text = '';
    this.value = '';
    this.relList = { supports: () => true };
  }
  append(...children) {
    this.children.push(...children);
  }
  replaceChildren(...children) {
    this.children = children;
    this._text = '';
  }
  set textContent(value) {
    this._text = String(value);
    this.children = [];
  }
  get textContent() {
    return this._text + this.children.map((child) => child.textContent ?? child).join('');
  }
  get lastElementChild() {
    return this.children.at(-1);
  }
  setAttribute(name, value) {
    this.attributes[name] = String(value);
  }
  removeAttribute(name) {
    delete this.attributes[name];
  }
  addEventListener(name, callback) {
    (this.listeners[name] ??= []).push(callback);
  }
  async click() {
    for (const callback of this.listeners.click ?? []) await callback({ target: this });
  }
  getContext() {
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
  }
}

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

    const elements = new Map();
    const document = {
      documentElement: new Element(),
      fonts: { ready: Promise.resolve() },
      getElementById(id) {
        if (!elements.has(id)) elements.set(id, new Element());
        return elements.get(id);
      },
      createElement() {
        return new Element();
      },
    };
    const window = { addEventListener() {} };
    const env = {
      document,
      window,
      Element,
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
