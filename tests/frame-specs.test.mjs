// Portrait, 3:4 and square frame specs (ADR 004, D7 step 1): the presets and
// their validation, band heights per spec, the evidence card region and the
// camera fit per spec, and the furniture that differs from landscape
// (stacked title rows, four narration lines, the card at the bottom of its
// region). The furniture
// invariant over all examples is tests/frame-furniture-invariant.test.mjs.
import { test } from 'vitest';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import fixture from './fixtures/evidence-cards.graph.json' with { type: 'json' };
import { loadDocument } from '../packages/core/src/director/load.ts';
import { layoutGraph } from '../packages/core/src/director/layout.ts';
import { directorFrameAt, frameCount } from '../packages/core/src/director/state.ts';
import { compileTimeline, shotStartFrames } from '../packages/core/src/director/timeline.ts';
import { styleForGraph } from '../packages/core/src/style.ts';
import { composeFrame, drawingStyle } from '../packages/render/src/compose.ts';
import { evidenceCameraFit } from '../packages/render/src/camera-fit.ts';
import {
  cameraFitFor,
  cardFreeArea,
  evidenceCardRegion,
  FRAME_SPECS,
  frameSpecFor,
  furnitureOf,
  MIN_BAND_HEIGHT,
  minBandHeight,
  projectCameraPoint,
} from '../packages/render/src/frame-spec.ts';
import { VIDEO_THEMES } from '../packages/render/src/theme.ts';
import { parseCommand, USAGE } from '../packages/cli/src/args.ts';
import { createHeadlessRenderer } from '../packages/render/src/backends/skia.ts';
import { measure } from './helpers/display-list.mjs';
import { readFrame } from './helpers/frame-furniture.mjs';
import { makeStudio } from './helpers/studio-harness.mjs';

const NEW = ['portrait-1080x1920', 'portrait-1080x1440', 'square-1080'];
const clone = (value) => JSON.parse(JSON.stringify(value));

test('the presets: sizes, type scale and furniture per spec', () => {
  const sizes = Object.fromEntries(
    Object.values(FRAME_SPECS).map((s) => [s.name, `${s.width}×${s.height}@${s.typeScale}`]),
  );
  assert.deepEqual(sizes, {
    'landscape-720p': '1280×720@1',
    'landscape-1080p': '1920×1080@1.5',
    'portrait-1080x1920': '1080×1920@1.5',
    'portrait-1080x1440': '1080×1440@1.5',
    'square-1080': '1080×1080@1.5',
  });
  assert.deepEqual(
    Object.fromEntries(Object.values(FRAME_SPECS).map((s) => [s.name, furnitureOf(s)])),
    {
      'landscape-720p': { title: 'inline', narrationLines: 2, card: 'beside' },
      'landscape-1080p': { title: 'inline', narrationLines: 2, card: 'beside' },
      'portrait-1080x1920': { title: 'stacked', narrationLines: 4, card: 'below' },
      'portrait-1080x1440': { title: 'stacked', narrationLines: 4, card: 'below' },
      'square-1080': { title: 'inline', narrationLines: 4, card: 'beside' },
    },
  );
  // Every preset passes its own validation, and is frozen.
  for (const spec of Object.values(FRAME_SPECS)) {
    assert.equal(frameSpecFor(spec), spec);
    assert.equal(frameSpecFor(spec.name), spec);
    assert.ok(Object.isFrozen(spec.safe));
  }
  // Landscape is untouched: no legend strip, no explicit card region.
  for (const name of ['landscape-720p', 'landscape-1080p']) {
    assert.equal(FRAME_SPECS[name].safe.legend, undefined);
    assert.equal(FRAME_SPECS[name].safe.card, undefined);
    assert.equal(FRAME_SPECS[name].furniture, undefined);
  }
});

test('band heights are per spec: stacked titles and four narration lines need more', () => {
  assert.deepEqual(MIN_BAND_HEIGHT, { title: 88, caption: 158 });
  assert.deepEqual(minBandHeight(FRAME_SPECS['landscape-720p']), MIN_BAND_HEIGHT);
  assert.deepEqual(minBandHeight(FRAME_SPECS['portrait-1080x1920']), { title: 120, caption: 200 });
  assert.deepEqual(minBandHeight(FRAME_SPECS['portrait-1080x1440']), { title: 120, caption: 200 });
  assert.deepEqual(minBandHeight(FRAME_SPECS['square-1080']), { title: 88, caption: 200 });
  for (const spec of Object.values(FRAME_SPECS)) {
    const least = minBandHeight(spec);
    for (const band of ['title', 'caption'])
      assert.ok(spec.safe[band].h >= least[band] * spec.typeScale, `${spec.name} ${band}`);
  }
  // The new specs keep the progress track at least 20 reference pixels off
  // the bottom edge, so it does not sit on the frame's border.
  for (const name of NEW) {
    const spec = FRAME_SPECS[name];
    const track = spec.safe.caption.y + (minBandHeight(spec).caption - 2) * spec.typeScale;
    assert.ok(spec.height - track >= 20 * spec.typeScale, `${name}: track at ${track}`);
  }
  // A caption band that holds two lines is too short for four.
  const square = clone(FRAME_SPECS['square-1080']);
  square.safe.caption.h = 180 * 1.5;
  assert.throws(() => frameSpecFor(square), /safe\.caption is shorter than 300px/);
  square.furniture.narrationLines = 2;
  assert.equal(frameSpecFor(square), square);
  const portrait = clone(FRAME_SPECS['portrait-1080x1920']);
  portrait.safe.title.h = 100 * 1.5;
  assert.throws(() => frameSpecFor(portrait), /safe\.title is shorter than 180px/);
});

test('custom specs are validated: bands clear of the stage, strip and card on it', () => {
  const base = () => clone(FRAME_SPECS['portrait-1080x1920']);
  const broken = [
    [(s) => (s.stage.y = s.safe.title.h - 10), /the stage overlaps safe\.title/],
    [(s) => (s.stage.h += 30), /the stage overlaps safe\.caption/],
    [(s) => (s.safe.legend.y = 10), /safe\.legend must lie on the stage/],
    [(s) => (s.safe.legend.h = 200), /safe\.legend overlaps safe\.graph/],
    [(s) => (s.safe.card.x = 0), /safe\.card must lie on the stage/],
    [(s) => ((s.safe.card.y = s.safe.graph.y), (s.safe.card.h = 300)), /leaves no room/],
    [(s) => (s.furniture.card = 'left'), /unknown furniture/],
    [(s) => (s.furniture.narrationLines = 0), /unknown furniture/],
    [(s) => (s.furniture.title = 'center'), /unknown furniture/],
  ];
  for (const [change, error] of broken) {
    const spec = base();
    change(spec);
    assert.throws(() => frameSpecFor(spec), error);
  }
  // The review's case (#61): a 1.5px strip just above the graph passed, yet
  // its 42px legend row reached ~40px into the graph. A strip must hold a row.
  const thin = clone(FRAME_SPECS['square-1080']);
  thin.safe.legend.y = thin.safe.graph.y - 1.5;
  thin.safe.legend.h = 1.5;
  assert.throws(() => frameSpecFor(thin), /safe\.legend is shorter than one legend row \(42px\)/);
  thin.safe.legend.y = thin.safe.graph.y - 42;
  thin.safe.legend.h = 42;
  assert.equal(frameSpecFor(thin), thin, 'exactly one row fits');
  // A custom landscape spec without the new fields behaves as before.
  const custom = clone(FRAME_SPECS['landscape-720p']);
  custom.name = 'custom';
  assert.equal(frameSpecFor(custom), custom);
  assert.deepEqual(evidenceCardRegion(custom), evidenceCardRegion(FRAME_SPECS['landscape-720p']));
});

test('card region and camera fit per spec: beside in landscape and square, below in portrait', () => {
  const landscape = FRAME_SPECS['landscape-720p'];
  // Landscape keeps D4's numbers exactly.
  assert.deepEqual(evidenceCardRegion(landscape), { x: 830, y: 135, w: 370, h: 390 });
  assert.deepEqual(cameraFitFor(landscape), {
    halfWidth: 550,
    halfHeight: 195,
    card: { halfWidth: 360, halfHeight: 195, offsetX: -190, offsetY: 0 },
  });
  assert.deepEqual(cameraFitFor(FRAME_SPECS['landscape-1080p']), cameraFitFor(landscape));
  const fits = Object.fromEntries(NEW.map((name) => [name, cameraFitFor(FRAME_SPECS[name])]));
  assert.deepEqual(fits, {
    'portrait-1080x1920': {
      halfWidth: 320,
      halfHeight: 354,
      card: { halfWidth: 320, halfHeight: 204, offsetX: 0, offsetY: -150 },
    },
    'portrait-1080x1440': {
      halfWidth: 320,
      halfHeight: 244,
      card: { halfWidth: 320, halfHeight: 114, offsetX: 0, offsetY: -130 },
    },
    'square-1080': {
      halfWidth: 320,
      halfHeight: 162,
      card: { halfWidth: 155, halfHeight: 162, offsetX: -165, offsetY: 0 },
    },
  });
  for (const name of NEW) {
    const spec = FRAME_SPECS[name];
    const card = evidenceCardRegion(spec),
      free = cardFreeArea(spec),
      gap = 20 * spec.typeScale;
    assert.deepEqual(card, spec.safe.card);
    if (furnitureOf(spec).card === 'below') {
      // Between the graph and the caption band: the full graph width, at
      // the bottom of the graph area, the free area above it.
      assert.equal(card.x, spec.safe.graph.x);
      assert.equal(card.w, spec.safe.graph.w);
      assert.equal(card.y + card.h, spec.safe.graph.y + spec.safe.graph.h);
      assert.ok(card.y + card.h <= spec.safe.caption.y);
      assert.equal(free.y + free.h + gap, card.y);
    } else {
      assert.equal(card.y, spec.safe.graph.y);
      assert.equal(free.x + free.w + gap, card.x);
    }
  }
});

/** The fixture's film at a spec, as the renderers frame it. */
function film(doc, frameSpec) {
  const result = loadDocument(doc);
  assert.equal(result.valid, true, JSON.stringify(result.errors));
  const { graph } = result;
  const positions = layoutGraph(graph);
  const timeline = compileTimeline(graph, frameSpec.fps);
  const fit = evidenceCameraFit(frameSpec, graph, () =>
    drawingStyle({ graph, positions, style: styleForGraph(graph) }),
  );
  const state = (frame) =>
    directorFrameAt(graph, positions, frame, frameSpec.fps, { fit, timeline });
  const compose = (frame, theme = VIDEO_THEMES.dark) =>
    composeFrame(state(frame), {
      graph,
      positions,
      frame,
      fps: frameSpec.fps,
      measure,
      frameSpec,
      theme,
      style: styleForGraph(graph),
      detailAt: result.detailAt,
    });
  const starts = shotStartFrames(timeline);
  const total = frameCount(graph, frameSpec.fps);
  const lastOf = (index) => (starts[index + 1] ?? total) - 1;
  return { graph, positions, timeline, state, compose, starts, lastOf };
}

test('a card shot frames its ends into the area the card leaves free, at every spec', () => {
  for (const frameSpec of Object.values(FRAME_SPECS)) {
    const { state, starts, lastOf, positions, timeline } = film(fixture, frameSpec);
    const free = cardFreeArea(frameSpec);
    for (const index of [1, 2, 3]) {
      const shot = timeline.shots[index];
      const ends =
        shot.evidence.object === 'node'
          ? [shot.evidence.id]
          : (({ source, target }) => [source, target])(
              shot.view.edges.find((edge) => edge.id === shot.evidence.id),
            );
      for (const frame of [starts[index] + 30, lastOf(index)]) {
        const camera = state(frame).cameraResolved;
        for (const id of ends) {
          const p = projectCameraPoint(positions.get(id), camera, frameSpec);
          const where = `${frameSpec.name} shot ${index} node ${id} at ${p.x},${p.y}`;
          assert.ok(p.x > free.x && p.x < free.x + free.w, where);
          assert.ok(p.y > free.y && p.y < free.y + free.h, where);
        }
      }
    }
  }
});

test('below the graph, the card is as tall as its items from the bottom of its region', () => {
  for (const name of ['portrait-1080x1920', 'portrait-1080x1440']) {
    const frameSpec = FRAME_SPECS[name];
    const { compose, lastOf } = film(fixture, frameSpec);
    const region = evidenceCardRegion(frameSpec);
    const { evidence } = readFrame(compose(lastOf(1)), VIDEO_THEMES.dark, measure).cards;
    assert.ok(evidence, `${name}: card drawn`);
    assert.equal(evidence.box.y + evidence.box.h, region.y + region.h, name);
    assert.ok(evidence.box.h < region.h, `${name}: shorter than its region`);
    for (const text of evidence.texts) assert.ok(text.y > evidence.box.y, text.text);
  }
  // Beside the graph it hangs from the top, as in D4.
  for (const name of ['landscape-720p', 'square-1080']) {
    const frameSpec = FRAME_SPECS[name];
    const { compose, lastOf } = film(fixture, frameSpec);
    const { evidence } = readFrame(compose(lastOf(1)), VIDEO_THEMES.dark, measure).cards;
    assert.equal(evidence.box.y, evidenceCardRegion(frameSpec).y, name);
  }
});

test('stacked title rows: kicker and frame number, the film title, then the domain time', () => {
  for (const name of ['portrait-1080x1920', 'portrait-1080x1440']) {
    const frameSpec = FRAME_SPECS[name];
    const { compose, lastOf } = film(fixture, frameSpec);
    const list = compose(lastOf(1));
    const band = frameSpec.safe.title;
    const top = list.items.filter((item) => item.type === 'text' && item.y < band.y + band.h);
    // Texts of one row share a baseline to within a couple of pixels.
    const rows = [];
    for (const y of top.map((item) => item.y).sort((a, b) => a - b))
      if (!rows.length || y - rows.at(-1) > 3 * frameSpec.typeScale) rows.push(y);
    assert.equal(rows.length, 3, `${name}: ${top.map((t) => `${t.text}@${t.y}`).join(', ')}`);
    const title = top.find((item) => item.text === list.a11y.title);
    assert.ok(Math.abs(title.y - rows[1]) < 1, `${name}: film title on the middle row`);
    assert.equal(title.align, undefined);
    // The rows sit at the bottom of the band, the last just above its rule.
    const u = frameSpec.typeScale;
    assert.ok(band.y + band.h - rows[2] <= 15 * u, `${name}: last row ${rows[2]}`);
    assert.ok(rows[0] - band.y >= 39 * u, `${name}: first row ${rows[0]}`);
  }
});

test('four lines of narration where the spec holds them, then the track', () => {
  const doc = clone(fixture);
  const narration = '叙'.repeat(600);
  for (const shot of doc.presentation) shot.narration = narration;
  for (const frameSpec of Object.values(FRAME_SPECS)) {
    const { compose, lastOf } = film(doc, frameSpec);
    const f = readFrame(compose(lastOf(0)), VIDEO_THEMES.dark, measure);
    const lines = furnitureOf(frameSpec).narrationLines;
    assert.equal(f.narration.length, lines, frameSpec.name);
    assert.ok(f.narration.at(-1).text.endsWith('…'), frameSpec.name);
    assert.ok(f.track.y > f.narration.at(-1).y, frameSpec.name);
  }
});

test('--frame-spec accepts every preset and names them in the help', () => {
  for (const name of Object.keys(FRAME_SPECS)) {
    const parsed = parseCommand(['render', 'film.json', '--out', 'film.mp4', '--frame-spec', name]);
    assert.equal(parsed.frameSpec, name);
    assert.ok(USAGE.includes(name), `help names ${name}`);
  }
  assert.throws(() => parseCommand(['render', 'film.json', '--frame-spec', 'portrait']));
});

test('the headless renderer the CLI workers use draws at the size of the chosen spec', () => {
  // relgraph render --frame-spec itself, through its workers and FFmpeg, is
  // checked by npm run check:export, which reads the expected size from the spec.
  const result = loadDocument(clone(fixture));
  const positions = layoutGraph(result.graph);
  for (const name of NEW) {
    const renderer = createHeadlessRenderer(result.graph, positions, { frameSpec: name });
    const png = renderer.pngAt(40);
    const { width, height } = FRAME_SPECS[name];
    // PNG IHDR: width and height, big-endian, at bytes 16 and 20.
    assert.deepEqual([png.readUInt32BE(16), png.readUInt32BE(20)], [width, height], name);
    assert.equal(renderer.rgbaAt(40).length, width * height * 4, name);
  }
});

test('the studio preview takes its canvas size from the chosen frame spec (simulated DOM)', async () => {
  const app = makeStudio();
  await app.ready;
  const canvas = app.node('stage'),
    select = app.node('frameSpecSelect');
  assert.equal(select.value, 'landscape-720p');
  assert.deepEqual([canvas.width, canvas.height], [1280, 720]);
  assert.equal(app.window.renderAt(48), true);
  for (const name of [...NEW, 'landscape-720p']) {
    select.value = name;
    await select.dispatch('change');
    const { width, height } = FRAME_SPECS[name];
    assert.deepEqual([canvas.width, canvas.height], [width, height], name);
    // The same frame is shown, composed at the new size.
    assert.equal(Number(app.node('scrubber').value), 48, name);
    assert.equal(app.window.renderAt(48), true);
  }
  // An unknown value is refused and the selector shows the spec in use.
  select.value = 'portrait';
  await select.dispatch('change');
  assert.equal(select.value, 'landscape-720p');
  assert.deepEqual([canvas.width, canvas.height], [1280, 720]);
});

test('a legend strip too short for a row draws no legend, even in an unvalidated spec', () => {
  const bookshop = JSON.parse(
    readFileSync(new URL('../examples/bookshop-systems-synthetic.graph.json', import.meta.url)),
  );
  const plates = (frameSpec) => {
    const { compose, lastOf } = film(bookshop, frameSpec);
    const list = compose(lastOf(4));
    const legend = readFrame(list, VIDEO_THEMES.dark, measure).legendPlates;
    return { legend, graph: frameSpec.safe.graph };
  };
  // The preset draws its legend inside the strip, clear of the graph.
  const preset = plates(FRAME_SPECS['square-1080']);
  assert.ok(preset.legend.length > 0);
  for (const plate of preset.legend)
    assert.ok(plate.y + plate.h <= preset.graph.y, 'preset legend above the graph');
  // composeFrame takes a spec as given; a strip shorter than a row is left empty.
  const thin = clone(FRAME_SPECS['square-1080']);
  thin.safe.legend.y = thin.safe.graph.y - 1.5;
  thin.safe.legend.h = 1.5;
  assert.deepEqual(plates(thin).legend, []);
});
