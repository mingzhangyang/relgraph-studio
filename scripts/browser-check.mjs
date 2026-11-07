#!/usr/bin/env node
// Real-browser check of the production build (ADR 003, migration step 1).
//
// Builds the studio, serves it with `vite preview` and drives it in Chromium:
// both examples, file selection and drag-and-drop, playback, seeking, themes,
// deterministic random-access frames and request locality. It also captures
// mid-shot frames of both examples in both themes, which serve as the visual
// baseline for the display-list refactor (migration step 2).
//
//   npm run check:browser                         # build, check, compare frames
//   npm run check:browser -- --no-build           # reuse the existing dist/
//   npm run check:browser -- --update-reference   # save frames as the local baseline
//
// The baseline lives in output/browser-reference/ and is not committed: pixels
// depend on the Chromium version, fonts and rasterizer (ADR 003, D6), so it is
// captured and compared on the same machine. Capture it before a rendering
// change, then rerun after the change. Comparison is enforced only when the
// baseline was captured with the same Chromium version and platform.
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { chromium } from 'playwright';
import { build, preview } from 'vite';

const root = fileURLToPath(new URL('..', import.meta.url));
const referenceDir = join(root, 'output/browser-reference');
const outputDir = join(root, 'output/browser-check');
const args = new Set(process.argv.slice(2));
const updateReference = args.has('--update-reference');
const FPS = 24;
// A pixel differs when any channel moves by more than this amount; a frame
// fails when more than MAX_DIFF_RATIO of its pixels differ.
const CHANNEL_TOLERANCE = 16;
const MAX_DIFF_RATIO = 0.005;

const EXAMPLES = [
  {
    key: 'literature',
    button: '#exampleLiterature',
    file: 'honglou-provisional.relgraph.json',
    name: '红楼梦 · 未经原著核实的技术演示',
  },
  {
    key: 'biology',
    button: '#exampleBiology',
    file: 'biology-signaling-synthetic.json',
    name: '生物信号 · 虚构合成示例',
  },
];

// ---------------------------------------------------------------- utilities

const results = [];
async function check(name, body) {
  try {
    await body();
    results.push({ name, ok: true });
    console.log(`  ✓ ${name}`);
  } catch (error) {
    results.push({ name, ok: false, error });
    console.log(`  ✗ ${name}\n    ${String(error?.stack || error).replaceAll('\n', '\n    ')}`);
  }
}

async function readExample(file) {
  return JSON.parse(await readFile(join(root, 'examples', file), 'utf8'));
}

/** Start and middle frames of every shot, using the studio's frame rounding. */
function shotFrames(document) {
  let start = 0;
  return document.presentation.map((shot) => {
    const frames = {
      start: Math.max(0, Math.ceil(start * FPS - 1e-9)),
      mid: Math.ceil((start + shot.durationSec / 2) * FPS - 1e-9),
    };
    start += shot.durationSec;
    return frames;
  });
}

const text = (page, selector) => page.locator(selector).innerText();
const frameNumber = async (page) => Number((await text(page, '#frameNumber')).replace(/\D+/g, ''));
const status = (page) => page.locator('#status').getAttribute('data-state');

async function waitReady(page) {
  await page.waitForFunction(() => {
    const state = document.getElementById('status')?.getAttribute('data-state');
    return state === 'ready' || state === 'error';
  });
}

async function loadExample(page, example) {
  await page.click(example.button);
  await page.waitForFunction(
    (name) => document.getElementById('sourceName')?.textContent === name,
    example.name,
  );
  await waitReady(page);
}

/** SHA-256 of the canvas pixels, so equal hashes mean identical frames. */
async function canvasHash(page) {
  const bytes = await page.evaluate(() => {
    const canvas = document.getElementById('stage');
    const data = canvas.getContext('2d').getImageData(0, 0, canvas.width, canvas.height).data;
    return Array.from(new Uint8Array(data.buffer, 0, data.length));
  });
  return createHash('sha256').update(Uint8Array.from(bytes)).digest('hex');
}

async function canvasPixel(page, x, y) {
  return page.evaluate(
    ([px, py]) =>
      Array.from(document.getElementById('stage').getContext('2d').getImageData(px, py, 1, 1).data),
    [x, y],
  );
}

/** Distinct colours in a coarse grid: a blank or single-colour stage has very few. */
async function canvasColourCount(page) {
  return page.evaluate(() => {
    const canvas = document.getElementById('stage');
    const ctx = canvas.getContext('2d');
    const seen = new Set();
    for (let y = 8; y < canvas.height; y += 24)
      for (let x = 8; x < canvas.width; x += 24) seen.add(ctx.getImageData(x, y, 1, 1).data.join());
    return seen.size;
  });
}

const luminance = ([r, g, b]) => 0.2126 * r + 0.7152 * g + 0.0722 * b;

async function setScrubber(page, value) {
  await page.evaluate((next) => {
    const scrubber = document.getElementById('scrubber');
    scrubber.value = String(next);
    scrubber.dispatchEvent(new Event('input', { bubbles: true }));
  }, value);
}

/** Focus the page body so global shortcuts are not swallowed by a focused control. */
async function blurControls(page) {
  await page.evaluate(() => document.activeElement?.blur?.());
}

/** Drop a file on the import zone through a real DataTransfer in the page. */
async function dropFile(page, filename, content) {
  await page.evaluate(
    ([name, body]) => {
      const transfer = new DataTransfer();
      transfer.items.add(new File([body], name, { type: 'application/json' }));
      const zone = document.getElementById('dropzone');
      zone.dispatchEvent(new DragEvent('dragover', { bubbles: true, dataTransfer: transfer }));
      zone.dispatchEvent(new DragEvent('drop', { bubbles: true, dataTransfer: transfer }));
    },
    [filename, content],
  );
}

/** Compare the current canvas with a reference PNG inside the browser. */
async function compareWithReference(page, png) {
  return page.evaluate(
    async ([base64, tolerance]) => {
      const blob = await (await fetch(`data:image/png;base64,${base64}`)).blob();
      const bitmap = await createImageBitmap(blob);
      const canvas = document.getElementById('stage');
      const size = `${canvas.width}×${canvas.height}`;
      const baselineSize = `${bitmap.width}×${bitmap.height}`;
      if (size !== baselineSize) return { size, baselineSize, ratio: 1 };
      const scratch = new OffscreenCanvas(bitmap.width, bitmap.height).getContext('2d');
      scratch.drawImage(bitmap, 0, 0);
      const expected = scratch.getImageData(0, 0, bitmap.width, bitmap.height).data;
      const actual = canvas.getContext('2d').getImageData(0, 0, canvas.width, canvas.height).data;
      let differing = 0;
      // Alpha counts too: equal RGB at a different opacity displays differently.
      for (let i = 0; i < actual.length; i += 4) {
        for (let channel = 0; channel < 4; channel += 1) {
          if (Math.abs(actual[i + channel] - expected[i + channel]) > tolerance) {
            differing += 1;
            break;
          }
        }
      }
      return { size, baselineSize, ratio: differing / (actual.length / 4) };
    },
    [png.toString('base64'), CHANNEL_TOLERANCE],
  );
}

async function canvasPng(page) {
  const url = await page.evaluate(() => document.getElementById('stage').toDataURL('image/png'));
  return Buffer.from(url.slice(url.indexOf(',') + 1), 'base64');
}

// -------------------------------------------------------------------- setup

if (!args.has('--no-build')) {
  console.log('Building the production studio…');
  await build({ root, logLevel: 'warn' });
}
const server = await preview({
  root,
  logLevel: 'warn',
  preview: { host: '127.0.0.1', port: 4173, strictPort: false },
});
const origin = new URL(server.resolvedUrls.local[0]).origin;
const studioUrl = `${origin}/demo/index.html`;
const browser = await chromium.launch();
const environment = {
  chromium: browser.version(),
  platform: `${process.platform}-${process.arch}`,
};
const fixtures = await mkdtemp(join(tmpdir(), 'relgraph-browser-'));
const documents = Object.fromEntries(
  await Promise.all(EXAMPLES.map(async (e) => [e.key, await readExample(e.file)])),
);

/** A fresh page that records console errors, page errors and non-local requests. */
async function openStudio({ colorScheme = 'dark', context: existing } = {}) {
  const context =
    existing ??
    (await browser.newContext({ colorScheme, viewport: { width: 1440, height: 1000 } }));
  const page = await context.newPage();
  const problems = [];
  page.on('console', (message) => {
    if (message.type() === 'error') problems.push(`console: ${message.text()}`);
  });
  page.on('pageerror', (error) => problems.push(`pageerror: ${error.message}`));
  page.on('request', (request) => {
    const url = new URL(request.url());
    if (url.protocol !== 'data:' && url.protocol !== 'blob:' && url.origin !== origin)
      problems.push(`external request: ${request.url()}`);
  });
  await page.goto(studioUrl);
  await page.waitForFunction(
    () => document.getElementById('sourceName')?.textContent !== '尚未加载',
  );
  await waitReady(page);
  return { context, page, problems };
}

console.log(`Checking ${studioUrl} in Chromium ${environment.chromium}`);

// ------------------------------------------------------------------- checks

const literatureShots = shotFrames(documents.literature);
const biologyShots = shotFrames(documents.biology);
const literatureFrames = Math.ceil(
  documents.literature.presentation.reduce((sum, shot) => sum + shot.durationSec, 0) * FPS - 1e-9,
);

{
  const { context, page, problems } = await openStudio({ colorScheme: 'dark' });

  await check('startup loads the literary example without diagnostics errors', async () => {
    assert.equal(await status(page), 'ready');
    assert.equal(await text(page, '#sourceName'), EXAMPLES[0].name);
    assert.equal(await page.getAttribute('#exampleLiterature', 'aria-pressed'), 'true');
    assert.equal(await page.getAttribute('#exampleBiology', 'aria-pressed'), 'false');
    assert.equal(await text(page, '#sceneCount'), String(documents.literature.presentation.length));
    assert.equal(await page.getAttribute('#scrubber', 'max'), String(literatureFrames - 1));
    assert.equal(await page.locator('#errors .diagnostic-item').count(), 0);
    assert.equal(await page.locator('#shots .shot').count(), literatureShots.length);
    assert.ok(Number(await text(page, '#nodeCount')) > 0, 'visible nodes');
    assert.ok((await canvasColourCount(page)) > 20, 'stage has drawn content');
    assert.ok((await page.locator('#sceneDescription').textContent()).length > 10);
  });

  await check('renderAt frames are independent of previously drawn frames', async () => {
    const target = literatureShots[2].mid;
    assert.equal(await page.evaluate((f) => window.renderAt(f), target), true);
    const direct = await canvasHash(page);
    await page.evaluate((last) => window.renderAt(last), literatureFrames - 1);
    await page.evaluate(() => window.renderAt(0));
    await page.evaluate((f) => window.renderAt(f), target);
    assert.equal(await canvasHash(page), direct);
    assert.equal(await frameNumber(page), target);
    const state = await page.evaluate(() => window.studioFrame());
    assert.equal(state.playback.index, 2);
    for (const bad of [-1, 1.5, literatureFrames, Number.NaN])
      assert.equal(await page.evaluate((f) => window.renderAt(f), bad), false, `renderAt(${bad})`);
    assert.equal(await frameNumber(page), target, 'invalid frames leave the stage unchanged');
  });

  await check('scrubber, arrow keys and shot buttons seek to exact frames', async () => {
    await setScrubber(page, 100);
    assert.equal(await frameNumber(page), 100);
    assert.equal(await page.inputValue('#scrubber'), '100');
    await blurControls(page);
    await page.keyboard.press('ArrowRight');
    assert.equal(await frameNumber(page), 100 + FPS);
    await page.keyboard.press('ArrowLeft');
    await page.keyboard.press('ArrowLeft');
    assert.equal(await frameNumber(page), 100 - FPS);
    for (let i = 0; i < 4; i += 1) await page.keyboard.press('ArrowLeft');
    assert.equal(await frameNumber(page), 0, 'seeking clamps at the first frame');
    await setScrubber(page, literatureFrames - 10);
    await page.keyboard.press('ArrowRight');
    assert.equal(await frameNumber(page), literatureFrames - 1, 'seeking clamps at the end');

    const shotButtons = page.locator('#shots .shot');
    for (const [index, frames] of literatureShots.entries()) {
      await shotButtons.nth(index).click();
      assert.equal(await frameNumber(page), frames.start, `shot ${index + 1} start`);
      assert.equal(await shotButtons.nth(index).getAttribute('aria-current'), 'step');
      const title = documents.literature.presentation[index].title;
      assert.equal(await shotButtons.nth(index).locator('strong').innerText(), title);
      const others = await shotButtons.locator('strong').allInnerTexts();
      others.forEach((label, other) => {
        if (other !== index) assert.equal(label, `分镜 ${other + 1}`, 'non-active titles hidden');
      });
    }
    // Shortcuts are ignored while a control has focus.
    await shotButtons.nth(0).focus();
    await page.keyboard.press('ArrowRight');
    assert.equal(await frameNumber(page), literatureShots.at(-1).start);
  });

  await check('play, pause, Space and play-from-end behave like a player', async () => {
    await page.click('#restart');
    assert.equal(await frameNumber(page), 0);
    await page.click('#play');
    assert.equal(await page.getAttribute('#play', 'aria-label'), '暂停');
    assert.equal(await status(page), 'playing');
    await page.waitForFunction(
      () => Number(document.getElementById('frameNumber').textContent.replace(/\D+/g, '')) >= 12,
    );
    await page.click('#play');
    assert.equal(await page.getAttribute('#play', 'aria-label'), '播放');
    assert.equal(await status(page), 'ready');
    const paused = await frameNumber(page);
    await page.waitForTimeout(300);
    assert.equal(await frameNumber(page), paused, 'paused playback does not advance');

    await blurControls(page);
    await page.keyboard.press('Space');
    assert.equal(await status(page), 'playing');
    await page.keyboard.press('Space');
    assert.equal(await status(page), 'ready');

    await setScrubber(page, literatureFrames - 6);
    await page.click('#play');
    await page.waitForFunction(
      () => document.getElementById('status').getAttribute('data-state') === 'ready',
    );
    assert.equal(await frameNumber(page), literatureFrames - 1, 'playback stops on the last frame');
    await page.click('#play');
    assert.ok((await frameNumber(page)) < FPS, 'play at the end restarts from the beginning');
    await page.click('#play');
  });

  await check('theme toggle redraws the same frame and persists after reload', async () => {
    await page.evaluate((f) => window.renderAt(f), literatureShots[1].mid);
    assert.equal(await page.locator('.theme-label').innerText(), '深色');
    assert.ok(luminance(await canvasPixel(page, 4, 4)) < 60, 'dark stage background');
    const darkHash = await canvasHash(page);
    await page.click('#themeToggle');
    assert.equal(await page.locator('.theme-label').innerText(), '浅色');
    assert.equal(await page.getAttribute('html', 'data-theme'), 'light');
    assert.equal(await page.evaluate(() => localStorage.getItem('relgraph-theme')), 'light');
    assert.equal(await frameNumber(page), literatureShots[1].mid, 'frame kept');
    assert.ok(luminance(await canvasPixel(page, 4, 4)) > 200, 'light stage background');
    assert.notEqual(await canvasHash(page), darkHash);

    await page.reload();
    await waitReady(page);
    assert.equal(await page.getAttribute('html', 'data-theme'), 'light');
    assert.equal(await page.locator('.theme-label').innerText(), '浅色');
    assert.ok(luminance(await canvasPixel(page, 4, 4)) > 200, 'saved theme used on reload');
    // A pinned theme ignores later operating-system changes.
    await page.emulateMedia({ colorScheme: 'light' });
    await page.emulateMedia({ colorScheme: 'dark' });
    assert.equal(await page.locator('.theme-label').innerText(), '浅色');
  });

  await check('no console errors, page errors or external requests', async () => {
    assert.deepEqual(problems, []);
  });
  await context.close();
}

{
  const { context, page, problems } = await openStudio({ colorScheme: 'light' });

  await check('an unpinned theme follows the operating system', async () => {
    assert.equal(await page.locator('.theme-label').innerText(), '浅色');
    assert.ok(luminance(await canvasPixel(page, 4, 4)) > 200);
    const frame = literatureShots[1].mid;
    await page.evaluate((f) => window.renderAt(f), frame);
    await page.emulateMedia({ colorScheme: 'dark' });
    await page.waitForFunction(() => document.querySelector('.theme-label').textContent === '深色');
    assert.ok(luminance(await canvasPixel(page, 4, 4)) < 60);
    assert.equal(await frameNumber(page), frame);
    assert.equal(await page.evaluate(() => localStorage.getItem('relgraph-theme')), null);
  });

  await check('the biology example plays through domain-time stages', async () => {
    await loadExample(page, EXAMPLES[1]);
    assert.equal(await status(page), 'ready');
    assert.equal(await page.getAttribute('#exampleBiology', 'aria-pressed'), 'true');
    assert.equal(await page.getAttribute('#exampleLiterature', 'aria-pressed'), 'false');
    assert.equal(await text(page, '#sceneCount'), String(documents.biology.presentation.length));
    assert.equal(await page.locator('#errors .diagnostic-item').count(), 0);
    const counts = [];
    for (const [index, frames] of biologyShots.entries()) {
      await page.evaluate((f) => window.renderAt(f), frames.mid);
      const domainAt = documents.biology.presentation[index].domainAt;
      assert.match(await text(page, '#domainTime'), new RegExp(`${domainAt}$`));
      counts.push(Number(await text(page, '#nodeCount')));
    }
    assert.ok(counts.at(-1) > counts[0], `later stages reveal more nodes (${counts.join(' → ')})`);
    assert.ok((await canvasColourCount(page)) > 20);
  });

  await check('no console errors, page errors or external requests', async () => {
    assert.deepEqual(problems, []);
  });
  await context.close();
}

{
  const { context, page, problems } = await openStudio();
  const fileInput = page.locator('#fileInput');
  const biologyPath = join(root, 'examples', EXAMPLES[1].file);

  await check('selecting a valid local file loads it through the same pipeline', async () => {
    await fileInput.setInputFiles(biologyPath);
    await page.waitForFunction(
      (name) => document.getElementById('sourceName').textContent === name,
      EXAMPLES[1].file,
    );
    await waitReady(page);
    assert.equal(await status(page), 'ready');
    assert.equal(await page.getAttribute('#exampleLiterature', 'aria-pressed'), 'false');
    assert.equal(await page.getAttribute('#exampleBiology', 'aria-pressed'), 'false');
    assert.equal(await text(page, '#sceneCount'), String(documents.biology.presentation.length));
    assert.equal(await page.inputValue('#fileInput'), '', 'input cleared for reselection');
  });

  await check('malformed JSON shows an error and disables playback', async () => {
    const broken = join(fixtures, 'broken.json');
    await writeFile(broken, '{"schemaVersion": ');
    await fileInput.setInputFiles(broken);
    await page.waitForFunction(
      () => document.getElementById('status').getAttribute('data-state') === 'error',
    );
    assert.equal(await text(page, '#sourceName'), 'broken.json');
    assert.ok((await page.locator('#errors .diagnostic-item').count()) >= 1);
    assert.equal(await page.isDisabled('#play'), true);
    assert.equal(await page.isDisabled('#scrubber'), true);
    assert.equal(await page.evaluate(() => window.renderAt(0)), false);
    assert.equal(await page.evaluate(() => window.studioFrame()), null);
    assert.equal(await text(page, '#nodeCount'), '0');
  });

  await check('a schema-invalid document lists actionable diagnostics', async () => {
    const invalid = structuredClone(documents.literature);
    invalid.relations[0].target = 'missing-character';
    const path = join(fixtures, 'invalid-reference.json');
    await writeFile(path, JSON.stringify(invalid));
    await fileInput.setInputFiles(path);
    await page.waitForFunction(
      (name) => document.getElementById('sourceName').textContent === name,
      'invalid-reference.json',
    );
    await waitReady(page);
    assert.equal(await status(page), 'error');
    const item = page.locator('#errors .diagnostic-item').first();
    assert.equal(await item.locator('strong').innerText(), 'UNKNOWN_TARGET · r01');
    assert.equal(await item.locator('code').innerText(), 'relations[0].target');
    assert.match(await item.locator('.fix').innerText(), /^建议：/);
    assert.equal(await page.getAttribute('#diagCount', 'data-level'), 'error');
  });

  await check('dropping a file and reselecting the same file both reload', async () => {
    const content = await readFile(join(root, 'examples', EXAMPLES[0].file), 'utf8');
    await dropFile(page, 'dropped.relgraph.json', content);
    await page.waitForFunction(
      () => document.getElementById('sourceName').textContent === 'dropped.relgraph.json',
    );
    await waitReady(page);
    assert.equal(await status(page), 'ready');
    assert.equal(await page.getAttribute('#dropzone', 'class'), 'dropzone');
    assert.equal(await text(page, '#sceneCount'), String(documents.literature.presentation.length));

    await fileInput.setInputFiles(biologyPath);
    await page.waitForFunction(
      (name) => document.getElementById('sourceName').textContent === name,
      EXAMPLES[1].file,
    );
    await waitReady(page);
    await page.evaluate((f) => window.renderAt(f), biologyShots[1].mid);
    await fileInput.setInputFiles(biologyPath);
    await page.waitForFunction(
      () => document.getElementById('frameNumber').textContent === 'FRAME 0',
    );
    assert.equal(await status(page), 'ready');
  });

  await check('no console errors, page errors or external requests', async () => {
    assert.deepEqual(problems, []);
  });
  await context.close();
}

// ---------------------------------------------------------- reference frames

const manifestPath = join(referenceDir, 'manifest.json');
let reference = null;
if (!updateReference) {
  // Only a missing manifest means "no baseline yet"; a broken one must not
  // silently turn every comparison off.
  let manifestText = null;
  try {
    manifestText = await readFile(manifestPath, 'utf8');
  } catch (error) {
    if (error?.code !== 'ENOENT') manifestText = error;
  }
  if (manifestText !== null)
    await check('local baseline manifest is readable', async () => {
      if (manifestText instanceof Error) throw manifestText;
      const parsed = JSON.parse(manifestText);
      assert.equal(typeof parsed?.environment?.chromium, 'string', 'environment.chromium');
      assert.equal(typeof parsed?.environment?.platform, 'string', 'environment.platform');
      assert.ok(Array.isArray(parsed.frames), 'frames list');
      for (const frame of parsed.frames) assert.equal(typeof frame?.file, 'string', 'frame file');
      reference = parsed;
    });
}
const enforce =
  !updateReference &&
  reference?.environment?.chromium === environment.chromium &&
  reference?.environment?.platform === environment.platform;
const captured = [];
// Every frame this run is expected to produce, captured or not.
const expectedFiles = [];
const baselineFiles = new Set(reference?.frames.map((frame) => frame.file) ?? []);
// Start empty so frames left by an earlier run cannot pass for this run's.
await rm(join(outputDir, 'frames'), { recursive: true, force: true });
await mkdir(join(outputDir, 'frames'), { recursive: true });

for (const theme of ['dark', 'light']) {
  const { context, page, problems } = await openStudio({ colorScheme: theme });
  for (const example of EXAMPLES) {
    await loadExample(page, example);
    const shots = shotFrames(documents[example.key]);
    for (const [index, { mid }] of shots.entries()) {
      const file = `${example.key}-${theme}-shot${index + 1}-f${String(mid).padStart(4, '0')}.png`;
      expectedFiles.push(file);
      await check(`frame ${file}`, async () => {
        // Never capture or compare an error stage: the example must be loaded
        // and the requested frame actually drawn.
        assert.equal(await status(page), 'ready', `${example.key} example loaded`);
        assert.equal(await page.evaluate((f) => window.renderAt(f), mid), true, 'renderAt');
        assert.equal(await frameNumber(page), mid);
        const png = await canvasPng(page);
        await writeFile(join(outputDir, 'frames', file), png);
        captured.push({ file, example: example.key, theme, shot: index + 1, frame: mid, png });
        // Frames absent from the manifest are reported by the inventory check.
        if (!reference || !baselineFiles.has(file)) return;
        let expected;
        try {
          expected = await readFile(join(referenceDir, file));
        } catch (error) {
          assert.fail(`baseline frame listed in the manifest is unreadable: ${error.message}`);
        }
        const { ratio, size, baselineSize } = await compareWithReference(page, expected);
        const summary =
          size === baselineSize
            ? `${(ratio * 100).toFixed(3)}% pixels differ from the baseline`
            : `frame is ${size} but the baseline is ${baselineSize}`;
        if (!enforce) {
          console.log(`    (informational, different environment) ${summary}`);
          return;
        }
        assert.ok(ratio <= MAX_DIFF_RATIO, summary);
      });
    }
  }
  await page.screenshot({ path: join(outputDir, `workspace-${theme}.png`), fullPage: true });
  await check(`no console errors while capturing ${theme} frames`, async () => {
    assert.deepEqual(problems, []);
  });
  await context.close();
}

// Added or removed shots change the frame inventory; both need an explicit
// baseline refresh instead of passing on the frames that remain.
if (reference)
  await check('captured frames match the baseline inventory', async () => {
    const expected = new Set(expectedFiles);
    const missing = [...baselineFiles].filter((file) => !expected.has(file));
    const added = expectedFiles.filter((file) => !baselineFiles.has(file));
    if (!missing.length && !added.length) return;
    const summary =
      [
        missing.length && `not captured: ${missing.join(', ')}`,
        added.length && `not in baseline: ${added.join(', ')}`,
      ]
        .filter(Boolean)
        .join('; ') + ' (run with --update-reference if the change is intended)';
    if (!enforce) {
      console.log(`    (informational, different environment) ${summary}`);
      return;
    }
    assert.fail(summary);
  });

const failedSoFar = results.filter((result) => !result.ok).length;
if (updateReference && failedSoFar) {
  console.log(`Baseline not saved: ${failedSoFar} browser checks failed.`);
} else if (updateReference) {
  await rm(referenceDir, { recursive: true, force: true });
  await mkdir(referenceDir, { recursive: true });
  for (const { file, png } of captured) await writeFile(join(referenceDir, file), png);
  const manifest = {
    note: 'Local mid-shot canvas frames of the production studio; regenerate with npm run check:browser -- --update-reference.',
    environment,
    fps: FPS,
    tolerance: { channel: CHANNEL_TOLERANCE, maxDiffRatio: MAX_DIFF_RATIO },
    frames: captured.map(({ file, example, theme, shot, frame, png }) => ({
      file,
      example,
      theme,
      shot,
      frame,
      sha256: createHash('sha256').update(png).digest('hex'),
    })),
  };
  await writeFile(manifestPath, JSON.stringify(manifest, null, 2) + '\n');
  console.log(`Saved ${captured.length} baseline frames to output/browser-reference/`);
} else if (!reference) {
  console.log('No local baseline frames; run with --update-reference to save them.');
}

// ------------------------------------------------------------------ teardown

await browser.close();
await new Promise((resolve) => server.httpServer.close(resolve));
await rm(fixtures, { recursive: true, force: true });

const failed = results.filter((result) => !result.ok);
console.log(
  `\n${results.length - failed.length}/${results.length} browser checks passed` +
    ` · frames and workspace screenshots in output/browser-check/`,
);
process.exitCode = failed.length ? 1 : 0;
