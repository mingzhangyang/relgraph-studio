// Frame furniture per frame spec (ADR 004, D7 step 1), checked on composed
// frames over a parameter sweep rather than on single examples:
//
//   spec × example × time direction × theme × card (none; a detail card for
//   the last shot's relation source; an evidence card for that relation) ×
//   text (as shipped, or a long film title, long shot titles and a narration
//   of three and a half lines)
//
// The examples are the shipped ones and the 30-poet Tang network (stored
// coordinates whose x is roughly time). Time direction (ADR 004, D7 step 2)
// is absent, explicitly horizontal, or vertical for every graph whose nodes
// carry times: each is loaded as a Studio project, so the sweep only draws
// directions a project can declare. Absent and horizontal must compose the
// same display list.
//
// Every changed graph is validated first, so the sweep only composes films
// a document could describe (a shot shows one card: D4 rejects a detail card
// and an evidence card together).
//
// On every checked frame (each shot's middle, and the end of the card shot):
// the bands, stage, legend, detail card and evidence card stay inside the
// frame and clear of each other; furniture text stays in its band and safe
// width and never overlaps other furniture text; narration keeps to the
// spec's line count, above the progress track, and is drawn whole when it
// fits; legend plates hold their text and cover no other stage text; no
// node or relation label enters a band or lies under the evidence card; and
// a card shot that can show its card does. With every direction, the
// time-direction invariant holds too (`tests/helpers/time-direction.mjs`):
// nodes are drawn in their stored order, transposed when time runs down,
// timeline bars run along time, and the axis's rules run across it with
// labels in time order, clear of bands, legend, cards and node labels. Text is measured with the
// vendored film fonts through skia-canvas, as `relgraph render` measures it.
import { test } from 'vitest';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { Canvas } from 'skia-canvas';
import manifest from '../examples/manifest.json' with { type: 'json' };
import { loadDocument } from '../packages/core/src/director/load.ts';
import { validateVisualGraph } from '../packages/core/src/graph/core.ts';
import { layoutGraph } from '../packages/core/src/director/layout.ts';
import { frameCount } from '../packages/core/src/director/state.ts';
import { compileTimeline, shotStartFrames } from '../packages/core/src/director/timeline.ts';
import { createProject } from '../packages/core/src/project.ts';
import { hasTimes } from '../packages/core/src/graph/time-axis.ts';
import { glyphGeometry } from '../packages/render/src/node-geometry.ts';
import { createHeadlessRenderer, registerFilmFonts } from '../packages/render/src/backends/skia.ts';
import { canvasTextMeasurer } from '../packages/render/src/backends/canvas2d.ts';
import { FRAME_SPECS, furnitureOf } from '../packages/render/src/frame-spec.ts';
import { VIDEO_THEMES } from '../packages/render/src/theme.ts';
import { furnitureProblems, readFrame } from './helpers/frame-furniture.mjs';
import { timeDirectionProblems } from './helpers/time-direction.mjs';

registerFilmFonts();
const measure = canvasTextMeasurer(new Canvas(1, 1, { gpu: false }).getContext('2d'));

const EXAMPLES = [
  ...manifest.map((entry) => ({
    key: entry.id.replace(/^example/, '').toLowerCase(),
    document: JSON.parse(readFileSync(new URL(`../examples/${entry.file}`, import.meta.url))),
  })),
  {
    key: 'tang30',
    document: JSON.parse(
      readFileSync(
        new URL('../datasets/tang-poets-met/唐代诗人见面网络_30.graph.json', import.meta.url),
      ),
    ),
  },
];
/** Directions a project can declare for an example: vertical needs times. */
function directionsOf(example) {
  const result = loadDocument(structuredClone(example.document));
  return hasTimes(result.graph.nodes)
    ? ['absent', 'horizontal', 'vertical']
    : ['absent', 'horizontal'];
}

const LONG_TITLE = '一部片名很长的关系叙事影片：从开端到结局的全部人物与他们之间的往来';
const LONG_SHOT = '这一幕的标题也相当长，需要在窄画面里完整地放下';
/** A narration of three and a half lines of the spec's narration column. */
function narrationFor(spec) {
  const font = { family: 'sans', size: 16 * spec.typeScale, weight: 400 };
  const column = spec.safe.caption.w - 36 * spec.typeScale;
  const perLine = Math.floor(column / measure('叙', font));
  return '叙'.repeat(Math.floor(perLine * 3.5));
}

/** A loaded example with its texts and card set for one sweep case. */
function film(example, spec, { card, text, direction = 'absent' }) {
  const source = structuredClone(example.document);
  const result = loadDocument(
    direction === 'absent' ? source : createProject(source, { view: { timeAxis: direction } }),
  );
  assert.equal(result.valid, true, `${example.key}: ${JSON.stringify(result.errors)}`);
  const { graph } = result;
  let narration = '';
  if (text === 'long') {
    graph.meta.title = LONG_TITLE;
    narration = narrationFor(spec);
    for (const scene of graph.scenes) {
      scene.title = LONG_SHOT;
      scene.narration = narration;
    }
  }
  let cited = null,
    opened = null;
  if (card !== 'none') {
    // The last shot cites a relation it shows, or opens its source's detail card.
    const last = graph.scenes.length - 1;
    const shown = compileTimeline(graph, spec.fps).shots[last].view.edges[0];
    if (shown) {
      const edge = graph.edges.find((e) => e.id === shown.id);
      const scene = graph.scenes[last];
      scene.durationSec = Math.max(scene.durationSec, 6);
      delete scene.openDetailNodeId;
      delete scene.evidence;
      if (card === 'evidence') {
        edge.evidence = [{ cite: '某书', locator: '第三回', quote: '二人同行，往返三日。' }];
        scene.evidence = { edgeId: edge.id };
        cited = edge.id;
      } else {
        scene.openDetailNodeId = edge.source;
        opened = edge.source;
      }
    }
  }
  const checked = validateVisualGraph(graph);
  assert.equal(checked.valid, true, `${example.key}: ${JSON.stringify(checked.errors)}`);
  const positions = layoutGraph(graph);
  return {
    graph,
    positions,
    narration,
    cited,
    opened,
    detailAt: () => ({ summary: '一段节点说明。' }),
  };
}

function caseProblems(example, specName, theme, card, text, direction = 'absent') {
  const spec = FRAME_SPECS[specName];
  const f = film(example, spec, { card, text, direction });
  const options = { frameSpec: specName, theme, detailAt: f.detailAt, locale: 'zh-CN' };
  const renderer = createHeadlessRenderer(f.graph, f.positions, options);
  // Absent and horizontal draw the same film (ADR 004, D7 step 2).
  const plain = direction === 'horizontal' ? film(example, spec, { card, text }) : null;
  const plainRenderer = plain && createHeadlessRenderer(plain.graph, plain.positions, options);
  const bars = new Set(
    f.graph.nodes
      .filter(
        (node) => glyphGeometry(node, 1, spec, renderer.style, 1, f.graph.project).shape === 'span',
      )
      .map((node) => node.id),
  );
  const fps = spec.fps;
  const starts = shotStartFrames(compileTimeline(f.graph, fps));
  const total = frameCount(f.graph, fps);
  const frames = starts.map((start, i) => {
    const end = (starts[i + 1] ?? total) - 1;
    return Math.floor((start + end) / 2);
  });
  if (card !== 'none') frames.push(total - 1);
  const name = `${specName}/${example.key}/${direction}/${theme}/${card}/${text}`;
  const problems = new Set();
  let cardDrawn = false,
    detailDrawn = false,
    last;
  for (const frame of frames) {
    const list = renderer.displayListAt(frame);
    last = list;
    for (const problem of furnitureProblems(list, spec, VIDEO_THEMES[theme], measure, {
      narration: f.narration,
    }))
      problems.add(`f${frame}: ${problem}`);
    for (const problem of timeDirectionProblems(list, spec, VIDEO_THEMES[theme], measure, {
      vertical: direction === 'vertical',
      positions: f.positions,
      bars,
    }))
      problems.add(`f${frame}: ${problem}`);
    if (
      plainRenderer &&
      JSON.stringify(plainRenderer.displayListAt(frame)) !== JSON.stringify(list)
    )
      problems.add(`f${frame}: horizontal differs from absent`);
    const { cards } = readFrame(list, VIDEO_THEMES[theme], measure);
    if (cards.evidence) cardDrawn = true;
    if (cards.detail) detailDrawn = true;
  }
  if (card === 'detail' && f.opened && !detailDrawn) problems.add('detail card never drawn');
  if (f.cited && !cardDrawn)
    problems.add(
      `card never drawn${last.evidenceOverflow ? ' (overflow)' : ''}${last.evidenceCovers ? ` (covers ${last.evidenceCovers.node ?? 'stroke'})` : ''}`,
    );
  return [...problems].map((problem) => `${name}: ${problem}`);
}

for (const specName of Object.keys(FRAME_SPECS))
  test(`frame furniture invariant over the sweep (${specName})`, () => {
    const failures = [];
    for (const example of EXAMPLES)
      for (const direction of directionsOf(example))
        for (const theme of ['light', 'dark'])
          for (const card of ['none', 'detail', 'evidence'])
            for (const text of ['shipped', 'long'])
              failures.push(...caseProblems(example, specName, theme, card, text, direction));
    assert.deepEqual(failures, [], `${failures.length} failures:\n${failures.join('\n')}`);
  }, 900_000);

test('every preset declares the furniture the sweep relies on', () => {
  for (const spec of Object.values(FRAME_SPECS)) {
    const furniture = furnitureOf(spec);
    assert.ok(furniture.narrationLines >= 2, spec.name);
    assert.equal(spec.width % 2, 0, `${spec.name}: even width for yuv420p`);
    assert.equal(spec.height % 2, 0, `${spec.name}: even height for yuv420p`);
  }
  for (const name of ['portrait-1080x1920', 'portrait-1080x1440', 'square-1080'])
    assert.equal(furnitureOf(FRAME_SPECS[name]).narrationLines, 4, name);
});
