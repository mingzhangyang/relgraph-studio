/**
 * Shared simulation for source-VM and production-bundle integration.
 * Does not substitute for a browser, its event propagation or native rasterization.
 * Every instance owns focus, nodes, listeners, and downloads.
 */
export function createSimulatedStudioDom({
  fonts = Promise.resolve(),
  loadFont = async () => [{}],
  missingId,
  wrongId,
  canvasContext,
} = {}) {
  const elements = new Map();
  const windowListeners = new Map();
  const downloads = [];
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
        add: (...names) => {
          this.className = [
            ...new Set([...this.className.split(/\s+/).filter(Boolean), ...names]),
          ].join(' ');
        },
        remove: (...names) => {
          this.className = this.className
            .split(/\s+/)
            .filter((part) => part && !names.includes(part))
            .join(' ');
        },
        contains: (name) => this.className.split(/\s+/).includes(name),
      };
      this.relList = { supports: () => true };
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
    contains(node) {
      return this === node || this.children.some((child) => child?.contains?.(node));
    }
    blur() {
      if (document.activeElement === this) document.activeElement = null;
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
      return canvasContext ? canvasContext() : { fillRect() {}, fillText() {} };
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
      const Constructor =
        {
          button: HTMLButtonElement,
          input: HTMLInputElement,
          label: HTMLLabelElement,
          select: HTMLSelectElement,
          canvas: HTMLCanvasElement,
        }[tag] ?? Element;
      return new Constructor(tag);
    },
    createElementNS(_namespace, tag) {
      return new Element(tag);
    },
  };
  const window = {
    // Native confirmations are an explicit user decision; override in tests.
    confirm: () => true,
    addEventListener(name, callback) {
      (windowListeners.get(name) ?? windowListeners.set(name, []).get(name)).push(callback);
    },
    dispatch(name, event) {
      for (const callback of windowListeners.get(name) ?? []) callback(event);
    },
  };

  return {
    elements,
    document,
    window,
    downloads,
    Element,
    HTMLCanvasElement,
    HTMLButtonElement,
    HTMLInputElement,
    HTMLLabelElement,
    HTMLSelectElement,
  };
}
