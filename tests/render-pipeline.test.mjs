import { test } from 'vitest';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import literature from '../examples/honglou-provisional.relgraph.json' with { type: 'json' };
import biology from '../examples/biology-signaling-synthetic.json' with { type: 'json' };
import { loadDocument } from '../packages/core/src/director/load.ts';
import { layoutGraph } from '../packages/core/src/director/layout.ts';
import {
  DEFAULT_CAMERA_FIT,
  directorFrameAt,
  frameCount,
} from '../packages/core/src/director/state.ts';
import {
  domainStyle,
  edgeStyleFor,
  localeFor,
  NEUTRAL_STYLE,
  nodeStyleFor,
} from '../packages/core/src/style.ts';
import { composeFrame } from '../packages/render/src/compose.ts';
import { drawDisplayList } from '../packages/render/src/backends/canvas2d.ts';
import { createCanvasRenderer } from '../packages/render/src/canvas.ts';
import {
  cameraFitFor,
  DEFAULT_FRAME_SPEC,
  FRAME_SPECS,
  frameSpecFor,
  scaleFrameSpec,
} from '../packages/render/src/frame-spec.ts';
import { VIDEO_THEMES } from '../packages/render/src/theme.ts';
import { measure, measuringCanvas, paths, texts } from './helpers/display-list.mjs';

const examples = [literature, biology].map((source) => {
  const { graph, detailAt } = loadDocument(source);
  return { graph, detailAt, layout: layoutGraph(graph) };
});

function compose({ graph, layout, detailAt }, frame, spec = DEFAULT_FRAME_SPEC, extra = {}) {
  const state = directorFrameAt(graph, layout, frame, spec.fps, { fit: cameraFitFor(spec) });
  return composeFrame(state, {
    graph,
    positions: layout,
    frame,
    fps: spec.fps,
    measure,
    frameSpec: spec,
    theme: VIDEO_THEMES.light,
    style: domainStyle(graph.domain),
    detailAt,
    ...extra,
  });
}

// Values that are not lengths: opacity, gradient offsets, font weights,
// scene counters and the angles of arc and ellipse commands.
const UNSCALED_KEYS = new Set(['alpha', 'offset', 'weight', 'index', 'count']);
const UNSCALED_ARGS = { A: [4, 5], E: [5, 6, 7] };
function assertScaled(small, large, factor, path = '$') {
  if (typeof small === 'number') {
    const expected = small * factor;
    assert.ok(
      Math.abs(expected - large) <= 1e-9 * Math.max(1, Math.abs(expected)),
      `${path}: ${large} is not ${factor} × ${small}`,
    );
  } else if (Array.isArray(small) && typeof small[0] === 'string') {
    assert.equal(large[0], small[0], path);
    const fixed = UNSCALED_ARGS[small[0]] ?? [];
    small.slice(1).forEach((value, i) => {
      const at = i + 1;
      if (fixed.includes(at)) assert.equal(large[at], value, `${path}[${at}]`);
      else assertScaled(value, large[at], factor, `${path}[${at}]`);
    });
  } else if (small && typeof small === 'object') {
    assert.deepEqual(Object.keys(large).sort(), Object.keys(small).sort(), path);
    for (const [key, value] of Object.entries(small)) {
      // A transformed group carries its scale in the transform; its children
      // are unit shapes.
      if (key === 'items' && small.transform) assert.deepEqual(large[key], value, `${path}.${key}`);
      else if (UNSCALED_KEYS.has(key)) assert.deepEqual(large[key], value, `${path}.${key}`);
      else assertScaled(value, large[key], factor, `${path}.${key}`);
    }
  } else assert.equal(large, small, path);
}

test('1080p frames are the 720p composition scaled by 1.5, with no fixed pixel positions', () => {
  for (const example of examples) {
    const last = frameCount(example.graph) - 1;
    for (const frame of [0, 30, Math.floor(last / 2), last]) {
      const small = compose(example, frame, FRAME_SPECS['landscape-720p']);
      const large = compose(example, frame, FRAME_SPECS['landscape-1080p']);
      assert.equal(large.width, 1920);
      assert.equal(large.height, 1080);
      assertScaled(small, large, 1.5);
    }
  }
});

test('the renderer sizes its canvas from the frame spec', () => {
  const canvas = measuringCanvas();
  const { graph, layout } = examples[0];
  const renderer = createCanvasRenderer(canvas, graph, layout, { frameSpec: 'landscape-1080p' });
  assert.equal(canvas.width, 1920);
  assert.equal(canvas.height, 1080);
  assert.equal(renderer.frameSpec.name, 'landscape-1080p');
  assert.equal(renderer.displayListAt(0).width, 1920);
});

test('frame specs are validated and presets are immutable', () => {
  assert.equal(frameSpecFor(undefined), DEFAULT_FRAME_SPEC);
  assert.equal(frameSpecFor('landscape-1080p'), FRAME_SPECS['landscape-1080p']);
  for (const name of ['portrait', 'constructor', '__proto__'])
    assert.throws(() => frameSpecFor(name), RangeError);
  const outside = structuredClone(DEFAULT_FRAME_SPEC);
  outside.safe.caption.h = 500;
  assert.throws(() => frameSpecFor(outside), /Invalid frame spec/);
  const fractional = { ...structuredClone(DEFAULT_FRAME_SPEC), width: 1280.5 };
  assert.throws(() => frameSpecFor(fractional), /Invalid frame spec/);
  const custom = structuredClone(DEFAULT_FRAME_SPEC);
  assert.equal(frameSpecFor(custom), custom);
  assert.ok(Object.isFrozen(FRAME_SPECS['landscape-720p'].safe.graph));
  assert.deepEqual(cameraFitFor(FRAME_SPECS['landscape-1080p']), DEFAULT_CAMERA_FIT);
});

test('core camera fit defaults to the 720p safe area and scales with it', () => {
  const { graph, layout } = examples[0];
  for (const frame of [0, 200, 500])
    assert.deepEqual(
      directorFrameAt(graph, layout, frame),
      directorFrameAt(graph, layout, frame, 24, { fit: DEFAULT_CAMERA_FIT }),
    );
  const wide = {
    halfWidth: DEFAULT_CAMERA_FIT.halfWidth * 0.5,
    halfHeight: DEFAULT_CAMERA_FIT.halfHeight * 0.5,
  };
  const normal = directorFrameAt(graph, layout, 0).cameraResolved;
  const half = directorFrameAt(graph, layout, 0, 24, { fit: wide }).cameraResolved;
  assert.ok(Math.abs(half.scale - normal.scale / 2) < 1e-12);
  assert.equal(half.x, normal.x);
});

test('the Canvas backend translates items without making drawing decisions', () => {
  const calls = [];
  const gradient = { addColorStop: (...args) => calls.push(['addColorStop', ...args]) };
  const ctx = new Proxy(
    {},
    {
      get(target, key) {
        if (key === 'createLinearGradient' || key === 'createRadialGradient')
          return (...args) => (calls.push([key, ...args]), gradient);
        return (...args) => calls.push([key, ...args]);
      },
      set(target, key, value) {
        calls.push(['set', key, value === gradient ? 'gradient' : value]);
        return true;
      },
    },
  );
  drawDisplayList(ctx, {
    width: 10,
    height: 20,
    a11y: {},
    items: [
      {
        type: 'path',
        d: [['R', 0, 0, 10, 20]],
        fill: {
          type: 'linear',
          x0: 0,
          y0: 0,
          x1: 10,
          y1: 20,
          stops: [{ offset: 0, color: '#000000' }],
        },
      },
      {
        type: 'group',
        alpha: 0.5,
        transform: [2, 0, 0, 3, 4, 5],
        clip: { x: 1, y: 2, w: 3, h: 4 },
        items: [
          {
            type: 'path',
            d: [
              ['M', 0, 0],
              ['L', 1, 1],
            ],
            stroke: '#111111',
            width: 2,
            dash: [1, 2],
            alpha: 0.5,
          },
          {
            type: 'text',
            text: 'Hi',
            x: 1,
            y: 2,
            font: { family: 'sans', size: 12, weight: 600 },
            fill: '#222222',
            baseline: 'top',
            halo: { paint: '#333333', width: 4 },
          },
        ],
      },
    ],
  });
  const names = calls.map((call) => (call[0] === 'set' ? `${call[1]}=${call[2]}` : call[0]));
  // Rectangle fills go through fillRect with a gradient built from the stops.
  assert.deepEqual(
    calls.find((c) => c[0] === 'createLinearGradient'),
    ['createLinearGradient', 0, 0, 10, 20],
  );
  assert.deepEqual(
    calls.find((c) => c[0] === 'fillRect'),
    ['fillRect', 0, 0, 10, 20],
  );
  // Groups save, transform and clip before their children and restore after.
  const order = (name) => names.indexOf(name);
  assert.ok(order('save') < order('transform') && order('transform') < order('clip'));
  assert.ok(order('clip') < order('stroke') && order('fillText') < order('restore'));
  // Alpha multiplies through groups; the halo is stroked before the fill.
  assert.ok(names.includes('globalAlpha=0.25'));
  assert.ok(names.includes('globalAlpha=0.5'));
  assert.ok(
    order('lineJoin=round') < order('strokeText') && order('strokeText') < order('fillText'),
  );
  assert.deepEqual(
    calls.find((c) => c[0] === 'setLineDash' && c[1].length),
    ['setLineDash', [1, 2]],
  );
  assert.ok(
    names.includes('font=600 12px "Noto Sans CJK SC", "PingFang SC", system-ui, sans-serif'),
  );
});

test('domain style sheets own edge and node vocabularies', () => {
  const bio = domainStyle('biology');
  assert.equal(edgeStyleFor(bio, 'catalyst').head, 'hollow-circle');
  assert.deepEqual([...edgeStyleFor(bio, 'catalyst').dash], [2, 5]);
  assert.equal(edgeStyleFor(bio, 'inhibition').head, 'bar');
  assert.equal(nodeStyleFor(bio, 'reaction').shape, 'diamond');
  assert.equal(nodeStyleFor(bio, 'gene').shape, 'pill');
  assert.equal(domainStyle('literature').edges.family.stroke, 'plain');
  for (const domain of [undefined, 'chemistry', 'constructor', '__proto__'])
    assert.equal(domainStyle(domain), NEUTRAL_STYLE, String(domain));
  for (const kind of ['constructor', 'toString', '__proto__']) {
    assert.equal(edgeStyleFor(bio, kind), bio.defaultEdge);
    assert.equal(nodeStyleFor(bio, kind), bio.defaultNode);
  }
  assert.ok(Object.isFrozen(bio.edges.catalyst));
});

test('captions follow the locale and a third domain needs only a style sheet', () => {
  const example = examples[1];
  const frame = Math.floor(frameCount(example.graph) / 2);
  const zh = texts(compose(example, frame));
  const en = texts(compose(example, frame, DEFAULT_FRAME_SPEC, { locale: 'en' }));
  assert.ok(zh.some((t) => t.startsWith('催化')) && !en.some((t) => t.startsWith('催化')));
  assert.ok(en.some((t) => t.startsWith('catalysis')));
  assert.equal(localeFor('fr'), 'zh-CN');
  assert.equal(localeFor('en'), 'en');

  const graph = {
    domain: 'chemistry',
    meta: { title: 'Third domain' },
    groups: [],
    nodes: [
      { id: 'a', label: 'A', kind: 'atom', position: { x: 0, y: 0 } },
      { id: 'b', label: 'B', kind: 'atom', position: { x: 300, y: 0 } },
    ],
    edges: [{ id: 'bond', source: 'a', target: 'b', kind: 'covalent', directed: true }],
    scenes: [{ id: 'one', title: 'One', durationSec: 1 }],
  };
  const style = {
    domain: 'chemistry',
    edges: {
      covalent: {
        stroke: 'physical',
        head: 'bar',
        dash: [3, 3],
        caption: { 'zh-CN': '共价', en: 'covalent' },
      },
    },
    defaultEdge: { stroke: 'plain', head: 'arrow' },
    nodes: { atom: { shape: 'diamond', baseRadius: 12 } },
    defaultNode: { shape: 'circle' },
    legend: [],
  };
  const layout = layoutGraph(graph);
  const neutral = createCanvasRenderer(measuringCanvas(), graph, layout).displayListAt(0);
  const styled = createCanvasRenderer(measuringCanvas(), graph, layout, {
    style,
    locale: 'en',
  }).displayListAt(0);
  assert.ok(!texts(neutral).includes('covalent'));
  assert.ok(texts(styled).includes('covalent'));
  assert.ok(
    paths(styled).some(
      (p) => p.stroke === VIDEO_THEMES.dark.edge.physical && p.dash?.join() === '3,3',
    ),
  );
  assert.ok(paths(styled).filter((p) => p.d.at(-1)?.[0] === 'Z' && p.d.length === 5).length >= 2);
});

test('renderer sources hold no domain vocabulary or 720p pixel positions', () => {
  const read = (path) =>
    readFileSync(new URL(`../packages/render/src/${path}`, import.meta.url), 'utf8');
  const sources = ['compose.ts', 'canvas.ts', 'backends/canvas2d.ts', 'theme.ts', 'locale.ts']
    .map(read)
    .join('\n');
  for (const word of [
    'catalyst',
    'inhibitor',
    'inhibition',
    'physical-association',
    "'protein'",
    "'reaction'",
    '催化',
    '抑制',
  ])
    assert.ok(!sources.includes(word), word);
  assert.doesNotMatch(read('compose.ts'), /\b(640|330|1218|1228|1250|1152|1120|434|540|548|704)\b/);
});

test('scaled frame specs always contain their rectangles and pass validation', () => {
  for (const factor of [0.5, 0.75, 1.01, 1.333, 1.5, 2.5, 3.7]) {
    const spec = scaleFrameSpec(DEFAULT_FRAME_SPEC, factor, `x${factor}`);
    assert.doesNotThrow(() => frameSpecFor(spec), String(factor));
    assert.ok(Number.isInteger(spec.width) && Number.isInteger(spec.height));
    assert.ok(spec.width >= 1280 * factor - 1e-9 && spec.width < 1280 * factor + 1);
    assert.ok(spec.height >= 720 * factor - 1e-9 && spec.height < 720 * factor + 1);
  }
  const hd = scaleFrameSpec(DEFAULT_FRAME_SPEC, 1.5, 'hd');
  assert.equal(hd.width, 1920);
  assert.equal(hd.height, 1080);
  assert.throws(() => scaleFrameSpec(DEFAULT_FRAME_SPEC, 0, 'zero'), RangeError);
});

test('the film title stays inside a narrow title safe area', () => {
  const spec = structuredClone(DEFAULT_FRAME_SPEC);
  spec.safe.title = { x: 600, y: 0, w: 600, h: 104 };
  const example = examples[1];
  const graph = {
    ...example.graph,
    meta: { ...example.graph.meta, title: '很长的影片标题'.repeat(12) },
  };
  const list = compose({ ...example, graph }, 0, frameSpecFor(spec));
  const titleFont = { family: 'serif', size: 27, weight: 600 };
  const title = list.items.find(
    (item) =>
      item.type === 'text' &&
      item.font.family === 'serif' &&
      item.font.size === 27 &&
      item.y === 78,
  );
  const domainTime = list.items.find(
    (item) => item.type === 'text' && item.text === list.a11y.domainTime,
  );
  assert.ok(list.a11y.domainTime, 'the biology example has a domain time on the title row');
  assert.ok(title.text.endsWith('…'));
  const right = title.x + measure(title.text, titleFont);
  const timeLeft = domainTime.x - measure(domainTime.text, domainTime.font);
  assert.ok(
    right <= 1200 && right < timeLeft,
    `title ends at ${right}, domain time starts at ${timeLeft}`,
  );
  // The 720p layout keeps its design maximum.
  const wide = compose({ ...example, graph }, 0);
  const wideTitle = wide.items.find(
    (item) => item.type === 'text' && item.font.size === 27 && item.y === 78,
  );
  assert.ok(measure(wideTitle.text, titleFont) <= 850);
});

test('accessible relations keep the localized type alongside meaningful labels', () => {
  const example = examples[1];
  // Inputs are visible during the reaction stage, products after it.
  const frames = [156, frameCount(example.graph) - 1];
  const relations = (graph, extra) =>
    frames.flatMap(
      (frame) => compose({ ...example, graph }, frame, DEFAULT_FRAME_SPEC, extra).a11y.relations,
    );
  const zh = relations(example.graph);
  const en = relations(example.graph, { locale: 'en' });
  assert.ok(
    zh.some((r) => r.endsWith('：输入')) && zh.some((r) => r.endsWith('：产物')),
    zh.join(' | '),
  );
  assert.ok(
    en.some((r) => r.endsWith(': input')) && en.some((r) => r.endsWith(': product')),
    en.join(' | '),
  );
  assert.ok(!zh.some((r) => r.endsWith('：1')));
  const doubled = structuredClone(example.graph);
  doubled.edges.find((e) => e.kind === 'consumption').label = '2';
  assert.ok(relations(doubled).some((r) => r.endsWith('：输入 · 2')));
  // The drawn caption follows the same policy.
  assert.ok(texts(compose({ ...example, graph: doubled }, frames[0])).includes('输入 · 2'));
});

test('multi-rectangle fills keep path semantics; a lone rectangle uses fillRect', () => {
  const calls = [];
  const ctx = new Proxy(
    {},
    {
      get:
        (target, key) =>
        (...args) =>
          calls.push([key, ...args]),
      set: (target, key, value) => (calls.push(['set', key, value]), true),
    },
  );
  drawDisplayList(ctx, {
    width: 10,
    height: 10,
    a11y: {},
    items: [
      {
        type: 'path',
        d: [
          ['R', 0, 0, 6, 6],
          ['R', 3, 3, 6, 6],
        ],
        fill: '#000000',
        alpha: 0.5,
      },
      { type: 'path', d: [['R', 1, 1, 2, 2]], fill: '#ffffff' },
    ],
  });
  const kinds = calls.map((call) => call[0]);
  assert.deepEqual(
    kinds.filter((k) => k === 'rect' || k === 'fill' || k === 'fillRect'),
    ['rect', 'rect', 'fill', 'fillRect'],
  );
  assert.deepEqual(
    calls.find((call) => call[0] === 'fillRect'),
    ['fillRect', 1, 1, 2, 2],
  );
});

test('frame specs keep the graph safe area on stage and bands tall enough for their rows', () => {
  const variant = (edit) => {
    const spec = structuredClone(DEFAULT_FRAME_SPEC);
    edit(spec);
    return spec;
  };
  assert.throws(
    () => frameSpecFor(variant((s) => (s.stage.h = 100))),
    /safe\.graph must lie within the stage/,
  );
  assert.throws(
    () => frameSpecFor(variant((s) => (s.safe.graph.x = 10))),
    /safe\.graph must lie within the stage/,
  );
  assert.throws(
    () => frameSpecFor(variant((s) => (s.safe.caption = { x: 62, y: 600, w: 1156, h: 120 }))),
    /safe\.caption is shorter than 158px/,
  );
  assert.throws(
    () => frameSpecFor(variant((s) => (s.safe.title.h = 60))),
    /safe\.title is shorter than 88px/,
  );
  // Minimums scale with the type scale; the presets satisfy them.
  for (const spec of Object.values(FRAME_SPECS))
    assert.doesNotThrow(() => frameSpecFor(structuredClone(spec)));
  const hd = structuredClone(FRAME_SPECS['landscape-1080p']);
  hd.safe.caption.h = 158;
  assert.throws(() => frameSpecFor(hd), /shorter than 237px/);
  // The caption track of the tallest allowed short band stays on the canvas.
  const tight = variant((s) => {
    s.safe.caption = { x: 62, y: 720 - 158, w: 1156, h: 158 };
    s.stage.h = 720 - 158 - 108 - 4;
    s.safe.graph.h = s.stage.h - 54;
  });
  const list = compose(examples[0], 0, frameSpecFor(tight));
  const track = paths(list).find((p) => p.fill === VIDEO_THEMES.light.track);
  assert.ok(track.d[0][2] + track.d[0][4] <= 720);
});



test('opt-in camera override freezes authoring gestures without changing default film frames', () => {
  const example = examples[0];
  const canvas = measuringCanvas();
  const frame = 48;
  const base = createCanvasRenderer(canvas, example.graph, example.layout, { theme: 'light' });
  const before = base.displayListAt(frame);
  const original = directorFrameAt(example.graph, example.layout, frame, 24, {
    fit: cameraFitFor(DEFAULT_FRAME_SPEC),
  }).cameraResolved;
  const override = { ...original, x: original.x + 125 };
  const edited = createCanvasRenderer(canvas, example.graph, example.layout, {
    theme: 'light',
    cameraOverride: override,
  });
  const frozen = edited.displayListAt(frame);
  assert.notDeepEqual(frozen, before, 'camera override changes only this opt-in rendering');
  const nodeId = example.graph.nodes[0].id;
  const oldPosition = { ...example.layout.get(nodeId) };
  try {
    example.layout.set(nodeId, { x: oldPosition.x + 75, y: oldPosition.y + 40 });
    assert.notDeepEqual(edited.displayListAt(frame), frozen, 'node movement is drawn under the fixed camera');
  } finally {
    example.layout.set(nodeId, oldPosition);
  }
  const unchanged = createCanvasRenderer(canvas, example.graph, example.layout, {
    theme: 'light',
  });
  assert.deepEqual(unchanged.displayListAt(frame), before);
  assert.throws(
    () => createCanvasRenderer(canvas, example.graph, example.layout, {
      cameraOverride: { x: 0, y: 0, scale: Number.NaN },
    }),
    RangeError,
  );
});
