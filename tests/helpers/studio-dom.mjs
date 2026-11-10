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
      this.parentElement = null;
      this._textNode = null;
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
    get isConnected() {
      return this === document.body ||
        this === document.documentElement ||
        Boolean(this.parentElement?.isConnected);
    }
    get firstChild() {
      return this._textNode ?? this.children[0] ?? null;
    }
    append(...nodes) {
      for (const node of nodes)
        if (node instanceof Element) node.parentElement = this;
      this.children.push(...nodes);
    }
    replaceChildren(...nodes) {
      for (const old of this.children)
        if (old instanceof Element) old.parentElement = null;
      this.children = [];
      this._text = '';
      this._textNode = null;
      this.append(...nodes);
    }
    set textContent(value) {
      this.textWrites++;
      for (const child of this.children)
        if (child instanceof Element) child.parentElement = null;
      this.children = [];
      this._text = String(value);
      if (this._text) {
        const parent = this;
        this._textNode = {
          nodeType: 3,
          parentElement: parent,
          get isConnected() { return parent.isConnected; },
          get textContent() { return parent._text; },
          set textContent(next) { parent._text = String(next); },
        };
      } else this._textNode = null;
    }
    get textContent() {
      return this._text + this.children.map((item) => item.textContent ?? item).join('');
    }
    get lastElementChild() {
      return [...this.children].reverse().find((child) => child instanceof Element) ?? null;
    }
    setAttribute(name, value) {
      this.attributes[name] = String(value);
    }
    getAttribute(name) {
      return this.attributes[name] ?? null;
    }
    querySelectorAll(selector) {
      const found = [];
      const visit = (parent) => {
        for (const child of parent.children) {
          if (!(child instanceof Element)) continue;
          if (selector === '*' ||
              (selector === '[data-ui-key]' && child.getAttribute('data-ui-key') !== null))
            found.push(child);
          visit(child);
        }
      };
      visit(this);
      return found;
    }
    removeAttribute(name) {
      delete this.attributes[name];
    }
    addEventListener(name, callback) {
      (this.listeners[name] ??= []).push(callback);
    }
    closest(selector) {
      if (this.focusSelector && selector.includes(this.focusSelector)) return this;
      if (selector === 'script,style') {
        for (let current = this; current; current = current.parentElement)
          if (current.tagName === 'SCRIPT' || current.tagName === 'STYLE') return current;
      }
      return null;
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
  // getElementById constructs mapped controls without a tag argument. Keep
  // their tagName consistent with real DOM elements, just like createElement.
  class HTMLCanvasElement extends Element {
    constructor(tag = 'canvas') {
      super(tag);
    }
  }
  class HTMLButtonElement extends Element {
    constructor(tag = 'button') {
      super(tag);
    }
  }
  class HTMLInputElement extends Element {
    constructor(tag = 'input') {
      super(tag);
    }
  }
  class HTMLLabelElement extends Element {
    constructor(tag = 'label') {
      super(tag);
    }
  }
  class HTMLSelectElement extends Element {
    constructor(tag = 'select') {
      super(tag);
    }
  }
  const constructors = {
    stage: HTMLCanvasElement,
    play: HTMLButtonElement,
    restart: HTMLButtonElement,
    scrubber: HTMLInputElement,
    fileInput: HTMLInputElement,
    exampleLiterature: HTMLButtonElement,
    exampleBiology: HTMLButtonElement,
    themeToggle: HTMLButtonElement,
    languageSelect: HTMLSelectElement,
    layoutToggle: HTMLButtonElement,
    layoutReset: HTMLButtonElement,
    layoutExport: HTMLButtonElement,
    visualUndo: HTMLButtonElement,
    visualRedo: HTMLButtonElement,
    visualSave: HTMLButtonElement,
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
    createTreeWalker(root, whatToShow) {
      // Support real text-node traversal for localization tests, not only
      // synthetic labels. Existing DOM stubs still do not emulate a browser.
      const texts = [];
      const visit = (parent) => {
        if (parent._textNode) texts.push(parent._textNode);
        for (const child of parent.children)
          if (child instanceof Element) visit(child);
      };
      if (whatToShow === 4) visit(root);
      let index = 0;
      return { nextNode: () => texts[index++] ?? null };
    },
    querySelectorAll(selector) {
      return this.body.querySelectorAll(selector);
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
