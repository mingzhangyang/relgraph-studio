import { runInNewContext } from 'node:vm';
import { parseDocument } from '../../packages/core/src/director/load.ts';
import { layoutGraph } from '../../packages/core/src/director/layout.ts';
import { applyGraphPositions } from '../../packages/core/src/director/position-writeback.ts';
import { roundPositionCoordinate } from '../../packages/core/src/director/seeded-layout.ts';
import { DEFAULT_FRAME_SPEC } from '../../packages/render/src/frame-spec.ts';
import { canvasPoint, graphPosition, hitVisibleNode } from '../../apps/studio/src/position-tool.ts';
import { directorFrameAt, frameCount } from '../../packages/core/src/director/state.ts';
import { domainStyle } from '../../packages/core/src/style.ts';
import { composeFrame } from '../../packages/render/src/compose.ts';
import { measure } from './display-list.mjs';
import literature from '../../examples/honglou-provisional.relgraph.json' with { type: 'json' };
import biology from '../../examples/biology-signaling-synthetic.json' with { type: 'json' };
import { studioImports, studioSource } from './studio-source.mjs';

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
  loadFont = async () => [{}],
  fetcher,
  storage,
  light = false,
  missingId,
  wrongId,
  // Test-only way to provide a frame with incremental a11y semantics while
  // continuing to exercise studio.ts through this shared simulated DOM.
  transformFrameText,
} = {}) {
  const elements = new Map();
  const jobs = new Map();
  const windowListeners = new Map();
  const mediaListeners = [];
  const themes = [];
  const blobs = [];
  const downloads = [];
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
      this.textWrites = 0;
      this.classList = {
        add: (name) =>
          (this.className = [...new Set([...this.className.split(' ').filter(Boolean), name])].join(
            ' ',
          )),
        remove: (name) =>
          (this.className = this.className
            .split(' ')
            .filter((part) => part !== name)
            .join(' ')),
      };
    }
    append(...nodes) {
      this.children.push(...nodes);
    }
    replaceChildren(...nodes) {
      this.children = [...nodes];
      this._text = '';
    }
    set textContent(value) {
      this.textWrites++;
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
      if (this.tagName === 'A') downloads.push({ href: this.href, filename: this.download });
      if (this.disabled) return Promise.resolve([]);
      this.focus();
      return this.dispatch('click');
    }
    remove() {
      if (document.body)
        document.body.children = document.body.children.filter((child) => child !== this);
    }
    getBoundingClientRect() {
      return { left: 0, top: 0, width: 1280, height: 720 };
    }
    setPointerCapture(id) {
      this.pointerCaptured = id;
    }
    hasPointerCapture(id) {
      return this.pointerCaptured === id;
    }
    releasePointerCapture() {
      this.pointerCaptured = null;
    }
    getContext() {
      return { fillRect() {}, fillText() {} };
    }
  }
  class HTMLCanvasElement extends Element {}
  class HTMLButtonElement extends Element {}
  class HTMLInputElement extends Element {}
  class HTMLLabelElement extends Element {}
  class HTMLSelectElement extends Element {}
  const constructors = {
    stage: HTMLCanvasElement,
    play: HTMLButtonElement,
    restart: HTMLButtonElement,
    scrubber: HTMLInputElement,
    fileInput: HTMLInputElement,
    exampleLiterature: HTMLButtonElement,
    exampleBiology: HTMLButtonElement,
    themeToggle: HTMLButtonElement,
    layoutToggle: HTMLButtonElement,
    layoutReset: HTMLButtonElement,
    layoutExport: HTMLButtonElement,
    layoutApply: HTMLButtonElement,
    layoutNode: HTMLSelectElement,
    layoutX: HTMLInputElement,
    layoutY: HTMLInputElement,
    dropzone: HTMLLabelElement,
  };
  document = {
    activeElement: null,
    documentElement: new Element('html'),
    body: new Element('body'),
    fonts: { ready: fonts, load: loadFont },
    getElementById(id) {
      if (id === missingId) return null;
      if (!elements.has(id)) {
        const element = new (id === wrongId ? Element : (constructors[id] ?? Element))();
        if (id === 'stage') {
          element.width = 1280;
          element.height = 720;
        }
        elements.set(id, element);
      }
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
    ...studioImports,
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
    parseDocument,
    layoutGraph,
    applyGraphPositions,
    roundPositionCoordinate,
    canvasPoint,
    graphPosition,
    hitVisibleNode,
    Blob,
    URL: {
      createObjectURL(blob) {
        blobs.push(blob);
        return 'blob:relgraph-' + blobs.length;
      },
      revokeObjectURL() {},
    },
    setTimeout(callback) {
      callback();
    },
    frameCount,
    createCanvasRenderer: (_canvas, graph, layout, options) => {
      themes.push(options.theme);
      const renderFrameWithList = (frame) => {
        const evaluated = directorFrameAt(graph, layout, frame, options.fps);
        const state = options.cameraOverride
          ? { ...evaluated, cameraResolved: { ...options.cameraOverride } }
          : evaluated;
        const list = composeFrame(state, {
          graph,
          positions: layout,
          frame,
          fps: options.fps,
          measure,
          style: domainStyle(graph.domain),
          detailAt: options.detailAt,
        });
        if (transformFrameText) list.a11y = transformFrameText(list.a11y, frame, graph);
        return { state, list };
      };
      return {
        renderFrame: (frame) => renderFrameWithList(frame).state,
        renderFrameWithList,
        frameSpec: DEFAULT_FRAME_SPEC,
      };
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
    blobs,
    downloads,
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
