import { runInNewContext } from 'node:vm';
import { parseDocument } from '../../packages/core/src/director/load.ts';
import { layoutGraph } from '../../packages/core/src/director/layout.ts';
import { directorFrameAt, frameCount } from '../../packages/core/src/director/state.ts';
import literature from '../../examples/honglou-provisional.relgraph.json' with { type: 'json' };
import biology from '../../examples/biology-signaling-synthetic.json' with { type: 'json' };
import { studioSource } from './studio-source.mjs';

export function deferred() {
  let resolve;
  let reject;
  const promise = new Promise((yes, no) => {
    resolve = yes;
    reject = no;
  });
  return { promise, resolve, reject };
}

export function makeStudio({
  source = studioSource(),
  fonts = Promise.resolve(),
  fetcher,
  storage,
  light = false,
  missingId,
  wrongId,
} = {}) {
  const elements = new Map();
  const jobs = new Map();
  const windowListeners = new Map();
  const mediaListeners = [];
  const themes = [];
  let nextJob = 0;
  let document;

  class Element {
    constructor(tag = 'div') {
      this.tagName = tag.toUpperCase();
      this.children = [];
      this.attributes = {};
      this.listeners = {};
      this.className = '';
      this.value = '';
      this.disabled = false;
      this.hidden = false;
      this._text = '';
    }
    append(...nodes) {
      this.children.push(...nodes);
    }
    replaceChildren(...nodes) {
      this.children = [...nodes];
      this._text = '';
    }
    set textContent(value) {
      this._text = String(value);
      this.children = [];
    }
    get textContent() {
      return this._text + this.children.map((item) => item.textContent ?? item).join('');
    }
    get lastElementChild() {
      return this.children.at(-1) ?? null;
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
    closest(selector) {
      return this.focusSelector && selector.includes(this.focusSelector) ? this : null;
    }
    focus() {
      document.activeElement = this;
    }
    dispatch(name, event = {}) {
      return Promise.all(
        (this.listeners[name] ?? []).map((callback) =>
          callback({ target: this, preventDefault() {}, ...event }),
        ),
      );
    }
    click() {
      if (this.disabled) return Promise.resolve([]);
      this.focus();
      return this.dispatch('click');
    }
    getContext() {
      return { fillRect() {}, fillText() {} };
    }
  }
  class HTMLCanvasElement extends Element {}
  class HTMLButtonElement extends Element {}
  class HTMLInputElement extends Element {}
  class HTMLLabelElement extends Element {}
  const constructors = {
    stage: HTMLCanvasElement,
    play: HTMLButtonElement,
    restart: HTMLButtonElement,
    scrubber: HTMLInputElement,
    fileInput: HTMLInputElement,
    exampleLiterature: HTMLButtonElement,
    exampleBiology: HTMLButtonElement,
    themeToggle: HTMLButtonElement,
    dropzone: HTMLLabelElement,
  };
  document = {
    activeElement: null,
    documentElement: new Element('html'),
    fonts: { ready: fonts },
    getElementById(id) {
      if (id === missingId) return null;
      if (!elements.has(id))
        elements.set(id, new (id === wrongId ? Element : (constructors[id] ?? Element))());
      return elements.get(id);
    },
    createElement(tag) {
      return tag === 'button' ? new HTMLButtonElement(tag) : new Element(tag);
    },
  };
  const window = {
    addEventListener(name, callback) {
      (windowListeners.get(name) ?? windowListeners.set(name, []).get(name)).push(callback);
    },
    dispatch(name, event) {
      for (const callback of windowListeners.get(name) ?? []) callback(event);
    },
  };
  const media = {
    matches: light,
    addEventListener(_name, callback) {
      mediaListeners.push(callback);
    },
  };
  const defaultFetcher = async (path) => ({
    ok: true,
    text: async () => JSON.stringify(path.includes('biology') ? biology : literature),
  });
  const context = {
    document,
    window,
    Element,
    HTMLElement: Element,
    HTMLCanvasElement,
    HTMLButtonElement,
    HTMLInputElement,
    HTMLLabelElement,
    structuredClone,
    parseDocument,
    layoutGraph,
    frameCount,
    createCanvasRenderer: (_canvas, graph, layout, options) => {
      themes.push(options.theme);
      return { renderFrame: (frame) => directorFrameAt(graph, layout, frame, options.fps) };
    },
    fetch: fetcher ?? defaultFetcher,
    matchMedia: () => media,
    localStorage: storage,
    requestAnimationFrame: (callback) => {
      const id = ++nextJob;
      jobs.set(id, callback);
      return id;
    },
    cancelAnimationFrame: (id) => jobs.delete(id),
  };
  const ready = runInNewContext(`(async () => { ${source}\n})()`, context);
  return {
    ready,
    document,
    window,
    jobs,
    themes,
    elements,
    node: (id) => document.getElementById(id),
    setOSTheme(matches) {
      media.matches = matches;
      for (const callback of mediaListeners) callback({ matches });
    },
    tick(time) {
      const job = jobs.entries().next().value;
      if (!job) throw new Error('No animation frame scheduled');
      jobs.delete(job[0]);
      job[1](time);
    },
  };
}

export async function flush() {
  await new Promise((resolve) => setImmediate(resolve));
}
