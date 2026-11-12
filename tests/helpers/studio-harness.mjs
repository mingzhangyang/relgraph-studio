import { readFileSync } from 'node:fs';
import { runInNewContext } from 'node:vm';
import { createSimulatedStudioDom } from './studio-dom.mjs';
import { parseDocument } from '../../packages/core/src/director/load.ts';
import { layoutGraph } from '../../packages/core/src/director/layout.ts';
import { styleForGraph, styleForPositions } from '../../packages/core/src/style.ts';
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
import bookshop from '../../examples/bookshop-systems-synthetic.graph.json' with { type: 'json' };
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
  // Observe recomposed frames without pretending the simulated DOM rasterizes Canvas.
  onRenderFrame,
  normalizeImage,
} = {}) {
  const {
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
  } = createSimulatedStudioDom({ fonts, loadFont, missingId, wrongId });
  const jobs = new Map();
  const mediaListeners = [];
  const themes = [];
  const blobs = [];
  let nextJob = 0;
  const media = {
    matches: light,
    addEventListener(_name, callback) {
      mediaListeners.push(callback);
    },
  };
  const defaultFetcher = async (path) => ({
    ok: true,
    text: async () =>
      JSON.stringify(
        path.includes('biology')
          ? biology
          : path.includes('bookshop')
            ? bookshop
            : path.includes('.graph.json')
              ? JSON.parse(
                  readFileSync(
                    new URL('../../examples/' + path.split('/').pop(), import.meta.url),
                    'utf8',
                  ),
                )
              : literature,
      ),
  });
  const context = {
    ...studioImports,
    normalizeNodeImage: normalizeImage ?? studioImports.normalizeNodeImage,
    document,
    window,
    Element,
    HTMLElement: Element,
    HTMLCanvasElement,
    HTMLButtonElement,
    HTMLInputElement,
    HTMLLabelElement,
    HTMLSelectElement,
    // Injected callbacks are created outside the VM. Sharing the constructor
    // keeps ordinary cross-boundary `Error` instances recognizable to the
    // workspace code, as they are in the browser's single realm.
    Error,
    structuredClone,
    parseDocument,
    layoutGraph,
    styleForGraph,
    styleForPositions,
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
        onRenderFrame?.({ frame, state, list });
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
