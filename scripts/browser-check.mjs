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
import { encodedSizeFixtures } from '../tests/helpers/encoded-image-fixtures.mjs';

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
  return page.evaluate(async () => {
    const canvas = document.getElementById('stage');
    const data = canvas.getContext('2d').getImageData(0, 0, canvas.width, canvas.height).data;
    const hash = await crypto.subtle.digest('SHA-256', data);
    return Array.from(new Uint8Array(hash), (b) => b.toString(16).padStart(2, '0')).join('');
  });
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
    // The real browser must retain a focused shot element across frame updates,
    // and metadata for future shots must not leak through hidden DOM/ARIA attributes.
    const stableShots = await page.evaluate(() => {
      const buttons = [...document.querySelectorAll('#shots .shot')];
      buttons[0].focus();
      window.renderAt(0);
      window.renderAt(1);
      return (
        document.activeElement === buttons[0] &&
        buttons.every(
          (button, index) => button === document.querySelectorAll('#shots .shot')[index],
        )
      );
    });
    assert.equal(stableShots, true, 'shot buttons and focus survive frame renders');
    await page.evaluate(() => window.renderAt(0));
    const inactiveMarkup = await page
      .locator('#shots .shot:not(.active)')
      .evaluateAll((buttons) => buttons.map((button) => button.outerHTML).join(' '));
    for (const future of documents.literature.presentation.slice(1)) {
      assert.equal(
        inactiveMarkup.includes(future.title),
        false,
        'future shot names excluded from DOM and ARIA',
      );
    }
    // Shortcuts are ignored while a control has focus, regardless of the
    // current frame left by the preceding focus/spoiler checks.
    const frameBeforeShortcut = await frameNumber(page);
    await shotButtons.nth(0).focus();
    await page.keyboard.press('ArrowRight');
    assert.equal(
      await frameNumber(page),
      frameBeforeShortcut,
      'focused shot button suppresses global ArrowRight seek',
    );
  });

  await check('transcript stays safe without duplicate live mutations', async () => {
    const unchanged = await page.evaluate(() => {
      window.renderAt(0);
      const transcript = document.getElementById('transcript');
      const status = document.getElementById('sceneDescription');
      const firstChild = transcript.firstElementChild;
      const transcriptObserver = new MutationObserver(() => {});
      const liveObserver = new MutationObserver(() => {});
      transcriptObserver.observe(transcript, {
        childList: true,
        characterData: true,
        subtree: true,
      });
      liveObserver.observe(status, { childList: true, characterData: true, subtree: true });
      window.renderAt(0);
      window.renderAt(1);
      const result = {
        sameChild: transcript.firstElementChild === firstChild,
        transcriptMutations: transcriptObserver.takeRecords().length,
        liveMutations: liveObserver.takeRecords().length,
      };
      transcriptObserver.disconnect();
      liveObserver.disconnect();
      return result;
    });
    assert.deepEqual(unchanged, {
      sameChild: true,
      transcriptMutations: 0,
      liveMutations: 0,
    });

    await page.evaluate((frame) => window.renderAt(frame), literatureShots[1].start);
    const visibleNodes = await page.evaluate(() =>
      window.studioFrame().view.nodes.map((node) => node.label),
    );
    assert.deepEqual(
      await page.locator('#transcript ul').first().locator('li').allTextContents(),
      visibleNodes,
      'transcript is sourced from the same spoiler-safe frame as the canvas',
    );
    assert.equal(await text(page, '#nodeCount'), String(visibleNodes.length));
    await page.evaluate(() => window.renderAt(0));
    const returnedNodes = await page.evaluate(() =>
      window.studioFrame().view.nodes.map((node) => node.label),
    );
    assert.deepEqual(
      await page.locator('#transcript ul').first().locator('li').allTextContents(),
      returnedNodes,
      'backward seeking restores prior visible semantic content',
    );
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

  await check(
    'timed imports reveal and retract nodes and relations without hidden DOM text',
    async () => {
      // Synthetic fixture: chapter steps use the production projection/timeline,
      // rather than injecting a11y or implementing a second spoiler filter.
      const timed = {
        schemaVersion: '0.1',
        meta: { title: 'Timed browser regression' },
        timeline: { unit: 'chapter', total: 3 },
        characters: ['OPEN NODE', 'FUTURE NODE B', 'FUTURE NODE C'].map((name, index) => ({
          id: `node-${index}`,
          name,
          firstAppearance: index + 1,
          importance: 2,
          position: { x: index * 150, y: 0 },
          bio: { summary: name },
        })),
        relations: [1, 2].map((index) => ({
          id: `edge-${index}`,
          source: `node-${index - 1}`,
          target: `node-${index}`,
          type: 'other',
          label: `FUTURE EDGE ${index}`,
          strength: 2,
          chapters: { from: index + 1 },
        })),
        presentation: [1, 2, 3].map((chapterAt) => ({
          id: `shot-${chapterAt}`,
          title: `Chapter ${chapterAt}`,
          chapterAt,
          durationSec: 2,
        })),
      };
      await dropFile(page, 'timed.json', JSON.stringify(timed));
      await page.waitForFunction(
        () => document.getElementById('sourceName').textContent === 'timed.json',
      );
      assert.equal(await status(page), 'ready');
      assert.doesNotMatch(await page.locator('body').innerHTML(), /FUTURE NODE|FUTURE EDGE/);
      for (const [frame, nodes, edges] of [
        [48, 2, 1],
        [96, 3, 2],
        [0, 1, 0],
      ]) {
        await page.evaluate((f) => window.renderAt(f), frame);
        assert.equal(await page.locator('#transcript ul').nth(0).locator('li').count(), nodes);
        assert.equal(await page.locator('#transcript ul').nth(1).locator('li').count(), edges);
        if (frame === 48) {
          assert.match(await page.locator('#transcript').textContent(), /FUTURE NODE B/);
          assert.doesNotMatch(
            await page.locator('body').innerHTML(),
            /FUTURE NODE C|FUTURE EDGE 2/,
          );
        }
        if (frame === 0)
          assert.doesNotMatch(await page.locator('body').innerHTML(), /FUTURE NODE|FUTURE EDGE/);
      }
      const mutations = await page.evaluate(() => {
        const observer = new MutationObserver(() => {});
        observer.observe(document.getElementById('transcript'), {
          childList: true,
          subtree: true,
          characterData: true,
        });
        window.renderAt(1);
        const count = observer.takeRecords().length;
        observer.disconnect();
        return count;
      });
      assert.equal(mutations, 0, 'unchanged semantics within a shot retain transcript DOM');
    },
  );

  await check(
    'late example success and invalid data cannot replace a newer local import',
    async () => {
      const pattern = '**/examples/biology-signaling-synthetic.json';
      for (const body of [JSON.stringify(documents.biology), '{']) {
        let acceptRoute;
        const pending = new Promise((resolve) => {
          acceptRoute = resolve;
        });
        await page.route(pattern, (route) => acceptRoute(route));
        try {
          await page.click('#exampleBiology');
          const route = await pending;
          assert.equal(await status(page), 'loading');
          assert.equal(await page.isDisabled('#play'), true);
          assert.equal(await page.locator('#errors .diagnostic-item').count(), 0);
          await dropFile(page, 'current.json', JSON.stringify(documents.literature));
          await page.waitForFunction(
            () => document.getElementById('sourceName').textContent === 'current.json',
          );
          await waitReady(page);
          assert.equal(await status(page), 'ready');
          assert.equal(await page.evaluate(() => window.renderAt(48)), true);
          const warnings = await text(page, '#warnings');
          const response = page.waitForResponse((r) => r.url() === route.request().url());
          await route.fulfill({ status: 200, contentType: 'application/json', body });
          await (await response).finished();
          // Allow the fetch's text/parse microtasks to finish on the page.
          await page.evaluate(() => new Promise((resolve) => setTimeout(resolve, 0)));
          assert.equal(await text(page, '#sourceName'), 'current.json');
          assert.equal(await status(page), 'ready');
          assert.equal(await frameNumber(page), 48);
          assert.equal(await text(page, '#warnings'), warnings);
          assert.equal(await page.locator('#errors .diagnostic-item').count(), 0);
          assert.equal(await page.getAttribute('#exampleLiterature', 'aria-pressed'), 'false');
          assert.equal(await page.getAttribute('#exampleBiology', 'aria-pressed'), 'false');
          assert.match(await page.locator('#transcript').textContent(), /贾宝玉/);
        } finally {
          await page.unroute(pattern);
        }
      }
    },
  );

  await check('no console errors, page errors or external requests', async () => {
    assert.deepEqual(problems, []);
  });
  await context.close();
}

// The curated dataset is a local import, not a replacement built-in example.
for (const theme of ['light', 'dark']) {
  const { context, page, problems } = await openStudio({ colorScheme: theme });
  await check(`source-verified local dataset respects chapter boundaries (${theme})`, async () => {
    const path = join(root, 'datasets/honglou-chengjia-opening/graph.relgraph.json');
    await page.locator('#fileInput').setInputFiles(path);
    await page.waitForFunction(
      () => document.getElementById('sourceName').textContent === 'graph.relgraph.json',
    );
    await waitReady(page);
    assert.equal(await status(page), 'ready');
    assert.equal(await page.locator('#errors .diagnostic-item').count(), 0);
    assert.equal(await page.locator('#warnings .diagnostic-item').count(), 0);
    const names = ['林如海', '贾敏', '林黛玉', '贾母', '贾政', '贾宝玉'];
    for (const [frame, nodes, edges] of [
      [0, 0, 0],
      [24, 6, 6],
      [48, 6, 9],
      [0, 0, 0],
    ]) {
      assert.equal(await page.evaluate((f) => window.renderAt(f), frame), true);
      assert.equal(await text(page, '#nodeCount'), String(nodes));
      assert.equal(await text(page, '#edgeCount'), String(edges));
      const markup = await page.locator('body').innerHTML();
      if (frame === 0) for (const name of names) assert.ok(!markup.includes(name));
      if (frame === 24) assert.doesNotMatch(markup, /外祖母与外孙女|姑表兄妹/);
      if (frame === 48) assert.match(await page.locator('#transcript').textContent(), /亲缘推导/);
    }
    await page.evaluate(() => window.renderAt(48));
    const direct = await canvasPng(page);
    await page.evaluate(() => window.renderAt(0));
    await page.evaluate(() => window.renderAt(48));
    assert.deepEqual(await canvasPng(page), direct, 'local dataset pixels reproduce after rewind');
    await page.screenshot({ path: join(outputDir, `dataset-${theme}.png`), fullPage: true });
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
// Layout preview is transient; only explicit application enters document history.
{
  const { context, page, problems } = await openStudio();
  await check('layout preview, cancel, locks, apply, undo/redo and project reload', async () => {
    await page.evaluate(() => window.renderAt(84));
    await page.locator('#layoutStrategies').evaluate((e) => (e.open = true));
    const original = await canvasPng(page),
      firstId = await page.inputValue('#strategyNode');
    await page.selectOption('#strategyType', 'circle');
    await page.selectOption('#strategyMode', 'rearrange');
    await page.fill('#strategySeed', '42');
    await page.fill('#strategySpacing', '188');
    await page.fill('#strategyIterations', '123');
    // The controls are a draft until Preview/Apply. Locking alone must not
    // discard these values or persist them as a completed layout.
    await page.check('#strategyLock');
    for (const [id, value] of [
      ['strategyType', 'circle'],
      ['strategyMode', 'rearrange'],
      ['strategySeed', '42'],
      ['strategySpacing', '188'],
      ['strategyIterations', '123'],
    ])
      assert.equal(await page.inputValue('#' + id), value, id + ' survives lock');
    await page.click('#strategyPreview');
    const preview = await canvasPng(page);
    assert.notDeepEqual(preview, original);
    await page.click('#strategyCancel');
    assert.deepEqual(await canvasPng(page), original);
    await page.click('#strategyPreview');
    assert.deepEqual(await canvasPng(page), preview);
    await page.click('#strategyApply');
    assert.equal(await page.locator('#strategyApply').isDisabled(), true);
    await page.click('#visualUndo');
    assert.deepEqual(await canvasPng(page), original);
    assert.equal(await page.inputValue('#strategyType'), 'manual');
    assert.equal(await page.inputValue('#strategySeed'), '0');
    await page.click('#visualRedo');
    assert.deepEqual(await canvasPng(page), preview);
    assert.equal(await page.inputValue('#strategyType'), 'circle');
    assert.equal(await page.inputValue('#strategySeed'), '42');
    const promise = page.waitForEvent('download');
    await page.click('#visualSave');
    const d = await promise;
    const project = JSON.parse(await readFile(await d.path(), 'utf8'));
    assert.equal(project.config.layout.type, 'circle');
    assert.equal(project.config.layout.seed, 42);
    assert.equal(project.config.layout.spacing, 188);
    assert.equal(project.config.layout.iterations, 123);
    assert.ok(project.config.layout.locked.includes(firstId));
    assert.deepEqual(
      project.config.layout.positions[firstId],
      documents.literature.characters.find((n) => n.id === firstId).position,
    );
    await page.locator('#fileInput').setInputFiles({
      name: 'layout.studio.json',
      mimeType: 'application/json',
      buffer: Buffer.from(JSON.stringify(project)),
    });
    await page.waitForFunction(
      () => document.getElementById('sourceName').textContent === 'layout.studio.json',
    );
    await waitReady(page);
    await page.evaluate(() => window.renderAt(84));
    assert.deepEqual(await canvasPng(page), preview);
    await page.selectOption('#strategyType', 'layered');
    await page.click('#strategyPreview');
    // The pending preview/draft now requires explicit acceptance of discarding work.
    page.once('dialog', (dialog) => void dialog.accept());
    await loadExample(page, EXAMPLES[1]);
    assert.equal(await page.locator('#strategyApply').isDisabled(), true);
    assert.equal(await page.inputValue('#strategyType'), 'manual');
    assert.deepEqual(problems, []);
  });
  await context.close();
}

// Real Canvas layout previews in both domains/themes; retain evidence for visual review.
for (const theme of ['light', 'dark'])
  for (const example of EXAMPLES) {
    const { context, page, problems } = await openStudio({ colorScheme: theme });
    await check(`layout visuals ${example.key}/${theme}: layered, force and circle`, async () => {
      await loadExample(page, example);
      await page.evaluate((f) => window.renderAt(f), example.key === 'biology' ? 156 : 84);
      await page.locator('#layoutStrategies').evaluate((e) => (e.open = true));
      await page.selectOption('#strategyMode', 'rearrange');
      await page.fill('#strategySeed', '42');
      for (const type of ['layered', 'force', 'circle']) {
        await page.selectOption('#strategyType', type);
        await page.click('#strategyPreview');
        const first = await canvasPng(page);
        await writeFile(join(outputDir, `layout-${example.key}-${theme}-${type}.png`), first);
        await page.click('#strategyCancel');
        await page.click('#strategyPreview');
        assert.deepEqual(await canvasPng(page), first);
        await page.click('#strategyCancel');
      }
      assert.deepEqual(problems, []);
    });
    await context.close();
  }

// Uploaded rasters become embedded project pixels; no network/image load during playback.
for (const theme of ['light', 'dark']) {
  const { context, page, problems } = await openStudio({ colorScheme: theme });
  await check(
    `node image upload, fit, undo, removal and project round trip (${theme})`,
    async () => {
      await page.evaluate(() => window.renderAt(84));
      await page.selectOption('#visualObject', { index: 1 });
      const id = await page.inputValue('#visualObject'),
        original = await canvasPng(page);
      const data = await page.evaluate(() => {
        const c = document.createElement('canvas');
        c.width = 128;
        c.height = 64;
        const ctx = c.getContext('2d');
        ctx.fillStyle = '#e64750';
        ctx.fillRect(0, 0, 64, 64);
        ctx.fillStyle = '#3b8fce';
        ctx.fillRect(64, 0, 64, 64);
        return c.toDataURL('image/png').split(',')[1];
      });
      assert.deepEqual(
        await page
          .locator('#visualImageStatus')
          .evaluate((status) => [
            status.getAttribute('role'),
            status.getAttribute('aria-live'),
            status.getAttribute('aria-atomic'),
          ]),
        ['status', 'polite', 'true'],
      );
      await page.evaluate(() => {
        window.imageStatusChanges = [];
        const status = document.getElementById('visualImageStatus');
        const observer = new MutationObserver(() => {
          window.imageStatusChanges.push(status.textContent);
        });
        observer.observe(status, { childList: true, characterData: true, subtree: true });
      });
      await page.locator('#visualImageFile').setInputFiles({
        name: 'portrait.png',
        mimeType: 'image/png',
        buffer: Buffer.from(data, 'base64'),
      });
      await page.waitForFunction(() =>
        document.getElementById('visualImageStatus').textContent.startsWith('已设置图片'),
      );
      const changesAtCompletion = await page.evaluate(() => {
        // Flush pending live-region observer callbacks after the upload settles.
        return Promise.resolve().then(() => window.imageStatusChanges.length);
      });
      assert.ok(changesAtCompletion >= 1, 'completed upload changes the live region');
      await page.evaluate(() => {
        window.renderAt(85);
        window.renderAt(86);
        window.renderAt(84);
      });
      const changesAfterPlayback = await page.evaluate(() =>
        Promise.resolve().then(() => window.imageStatusChanges.length),
      );
      assert.equal(
        changesAfterPlayback,
        changesAtCompletion,
        'unchanged image status is not rewritten during playback',
      );
      const cover = await canvasPng(page);
      assert.notDeepEqual(cover, original);
      await page.click('#visualUndo');
      assert.deepEqual(await canvasPng(page), original);
      await page.click('#visualRedo');
      assert.deepEqual(await canvasPng(page), cover);
      await page.selectOption('#visualImageFit', 'contain');
      assert.notDeepEqual(await canvasPng(page), cover);
      await page.selectOption('#visualImageFit', 'cover');
      assert.deepEqual(await canvasPng(page), cover);
      // Image inheritance is object-only even while category/global styles are selected.
      for (const imageScope of ['category', 'global']) {
        await page.selectOption('#visualScope', imageScope);
        await page.click('#visualImageInherit');
        assert.notDeepEqual(await canvasPng(page), cover);
        await page.click('#visualUndo');
        assert.deepEqual(await canvasPng(page), cover);
      }
      await page.selectOption('#visualScope', 'object');
      await page.locator('#visualImageFile').setInputFiles({
        name: 'bad.png',
        mimeType: 'image/png',
        buffer: Buffer.from('broken image'),
      });
      await page.waitForFunction(
        () => document.getElementById('visualError').textContent.length > 0,
      );
      assert.deepEqual(await canvasPng(page), cover);
      const pending = page.waitForEvent('download');
      await page.click('#visualSave');
      const download = await pending;
      const project = JSON.parse(await readFile(await download.path(), 'utf8'));
      assert.equal(project.config.assets[project.config.nodes.objects[id].image].format, 'rgba8');
      assert.deepEqual(project.source, documents.literature);
      assert.ok(!JSON.stringify(project).includes('portrait.png'));
      await page.locator('#fileInput').setInputFiles({
        name: 'image.studio.json',
        mimeType: 'application/json',
        buffer: Buffer.from(JSON.stringify(project)),
      });
      await page.waitForFunction(
        () => document.getElementById('sourceName').textContent === 'image.studio.json',
      );
      await waitReady(page);
      await page.evaluate(() => window.renderAt(84));
      assert.deepEqual(await canvasPng(page), cover);
      await page.selectOption('#visualObject', id);
      await page.click('#visualImageRemove');
      assert.notDeepEqual(await canvasPng(page), cover);
      await page.click('#visualUndo');
      assert.deepEqual(await canvasPng(page), cover);
      await writeFile(join(outputDir, `node-image-${theme}-canvas.png`), cover);
      await page.evaluate(() => window.scrollTo(0, 0));
      await page.screenshot({ path: join(outputDir, `node-image-${theme}.png`), fullPage: true });
      assert.deepEqual(problems, []);
    },
  );
  await context.close();
}
{
  const { context, page, problems } = await openStudio();
  await check(
    'review: oversized PNG/JPEG/WebP headers are rejected before bitmap decoding',
    async () => {
      await page.selectOption('#visualObject', { index: 1 });
      const original = await canvasPng(page);
      await page.evaluate(() => {
        window.nodeImageDecoderCalls = 0;
        window.createImageBitmap = async () => {
          window.nodeImageDecoderCalls++;
          throw new Error('Decoder must not run for an oversized header');
        };
      });
      for (const [name, buffer] of encodedSizeFixtures(4097, 4096)) {
        await page.locator('#visualImageFile').setInputFiles({
          name,
          mimeType: name.endsWith('png')
            ? 'image/png'
            : name.endsWith('jpeg')
              ? 'image/jpeg'
              : 'image/webp',
          buffer,
        });
        await page.waitForFunction(() =>
          document.getElementById('visualError').textContent.includes('尺寸过大'),
        );
        assert.equal(await page.evaluate(() => window.nodeImageDecoderCalls), 0);
        assert.deepEqual(await canvasPng(page), original);
      }
      assert.deepEqual(problems, []);
    },
  );
  await context.close();
}
{
  const { context, page, problems } = await openStudio();
  await check(
    'review: restore node-image inheritance ignores global/category style scope',
    async () => {
      const id = documents.literature.characters[0].id;
      for (const scope of ['global', 'category'])
        for (const override of ['b', null]) {
          const config = {
            assets: {
              a: { format: 'rgba8', width: 1, height: 1, data: '/wAA/w==' },
              b: { format: 'rgba8', width: 1, height: 1, data: 'AAD//w==' },
            },
            nodes: {
              defaults: { image: 'a' },
              categories: { person: { image: 'a' } },
              objects: { [id]: { image: override } },
            },
          };
          await page.locator('#fileInput').setInputFiles({
            name: `inherit-${scope}-${override}.studio.json`,
            mimeType: 'application/json',
            buffer: Buffer.from(
              JSON.stringify({ format: 'relgraph.studio/1', source: documents.literature, config }),
            ),
          });
          await page.waitForFunction(
            (name) => document.getElementById('sourceName').textContent === name,
            `inherit-${scope}-${override}.studio.json`,
          );
          await waitReady(page);
          await page.evaluate(() => window.renderAt(84));
          await page.selectOption('#visualObject', id);
          await page.selectOption('#visualScope', scope);
          await page.click('#visualImageInherit');
          assert.match(await page.locator('#visualImageStatus').textContent(), /全局|类别/);
          const pending = page.waitForEvent('download');
          await page.click('#visualSave');
          const download = await pending;
          const saved = JSON.parse(await readFile(await download.path(), 'utf8'));
          assert.equal(Object.hasOwn(saved.config.nodes.objects[id], 'image'), false);
          assert.deepEqual(saved.config.nodes.defaults, config.nodes.defaults);
          assert.deepEqual(saved.config.nodes.categories, config.nodes.categories);
          assert.deepEqual(saved.config.assets.a, config.assets.a);
          assert.ok(!Object.hasOwn(saved.config.assets, 'b'));
          assert.deepEqual(saved.source, documents.literature);
        }
      assert.deepEqual(problems, []);
    },
  );
  await context.close();
}
{
  const { context, page, problems } = await openStudio();
  await check('pending image uploads cannot revive after A -> B -> A selection', async () => {
    await page.evaluate(() => window.renderAt(84));
    const ids = await page
      .locator('#visualObject option')
      .evaluateAll((options) => options.map((o) => o.value).filter(Boolean));
    assert.ok(ids.length >= 2, 'need two safe nodes for the selection regression');
    const [a, b] = ids;
    await page.selectOption('#visualObject', a);
    const before = await canvasPng(page);
    const data = await page.evaluate(() => {
      const canvas = document.createElement('canvas');
      canvas.width = 4;
      canvas.height = 4;
      canvas.getContext('2d').fillRect(0, 0, 4, 4);
      return canvas.toDataURL('image/png').split(',')[1];
    });
    await page.evaluate(() => {
      const original = window.createImageBitmap;
      window.createImageBitmap = (...args) =>
        new Promise((resolve, reject) => {
          window.releaseOldSelectionImage = () => original(...args).then(resolve, reject);
        });
    });
    await page.locator('#visualImageFile').setInputFiles({
      name: 'stale-selection.png',
      mimeType: 'image/png',
      buffer: Buffer.from(data, 'base64'),
    });
    await page.waitForFunction(() => typeof window.releaseOldSelectionImage === 'function');
    await page.selectOption('#visualObject', b);
    assert.ok(
      !(await page.locator('#visualImageStatus').textContent()).includes('正在本地处理图片'),
      'leaving A clears its pending upload indicator',
    );
    await page.selectOption('#visualObject', a);
    await page.evaluate(() => window.releaseOldSelectionImage());
    await page.waitForTimeout(150);
    assert.equal(await page.inputValue('#visualObject'), a);
    assert.deepEqual(await canvasPng(page), before, 'stale image must not alter Canvas');
    const waitingForDownload = page.waitForEvent('download');
    await page.click('#visualSave');
    const saved = JSON.parse(await readFile(await (await waitingForDownload).path(), 'utf8'));
    assert.equal(saved.config.nodes?.objects?.[a]?.image, undefined);
    assert.equal(Object.keys(saved.config.assets ?? {}).length, 0);
    assert.deepEqual(problems, []);
  });
  await context.close();
}

{
  const { context, page } = await openStudio();
  await check('late image decode cannot modify a newer document', async () => {
    await page.selectOption('#visualObject', { index: 1 });
    const data = await page.evaluate(() => {
      const c = document.createElement('canvas');
      c.width = 2;
      c.height = 2;
      c.getContext('2d').fillRect(0, 0, 2, 2);
      return c.toDataURL().split(',')[1];
    });
    await page.evaluate(() => {
      const original = window.createImageBitmap;
      window.createImageBitmap = (...args) =>
        new Promise((resolve, reject) => {
          window.releaseNodeImage = () => original(...args).then(resolve, reject);
        });
    });
    await page.locator('#visualImageFile').setInputFiles({
      name: 'late.png',
      mimeType: 'image/png',
      buffer: Buffer.from(data, 'base64'),
    });
    await page.waitForFunction(() => typeof window.releaseNodeImage === 'function');
    // An in-flight image is also protected; this test explicitly discards it.
    page.once('dialog', (dialog) => void dialog.accept());
    await loadExample(page, EXAMPLES[1]);
    const expected = await canvasPng(page);
    await page.evaluate(() => window.releaseNodeImage());
    await page.waitForTimeout(150);
    assert.deepEqual(await canvasPng(page), expected);
    assert.ok(!(await page.locator('#visualImageStatus').textContent()).startsWith('已设置图片'));
  });
  await context.close();
}

{
  const { context, page, problems } = await openStudio();
  await check(
    'JPEG and WebP uploads normalize locally into the same node-image pipeline',
    async () => {
      await page.selectOption('#visualObject', { index: 1 });
      for (const [format, mime] of [
        ['jpg', 'image/jpeg'],
        ['webp', 'image/webp'],
      ]) {
        const data = await page.evaluate((type) => {
          const c = document.createElement('canvas');
          c.width = 16;
          c.height = 16;
          const ctx = c.getContext('2d');
          ctx.fillStyle = '#3b8fce';
          ctx.fillRect(0, 0, 16, 16);
          return c.toDataURL(type).split(',')[1];
        }, mime);
        await page.locator('#visualImageFile').setInputFiles({
          name: 'portrait.' + format,
          mimeType: mime,
          buffer: Buffer.from(data, 'base64'),
        });
        await page.waitForFunction(() =>
          document.getElementById('visualImageStatus').textContent.startsWith('已设置图片'),
        );
        assert.equal(await page.locator('#visualError').textContent(), '');
        assert.equal(await page.locator('#visualImageRemove').isDisabled(), false);
      }
      assert.deepEqual(problems, []);
    },
  );
  await context.close();
}

{
  const { context, page, problems } = await openStudio();
  await check(
    'review: sparse locks, preview export, no-op redo and Escape cancellation',
    async () => {
      const source = structuredClone(documents.literature);
      for (const node of source.characters) delete node.position;
      await page.locator('#fileInput').setInputFiles({
        name: 'missing-review.json',
        mimeType: 'application/json',
        buffer: Buffer.from(JSON.stringify(source)),
      });
      await page.waitForFunction(
        () => document.getElementById('sourceName').textContent === 'missing-review.json',
      );
      await waitReady(page);
      await page.locator('#layoutStrategies').evaluate((e) => (e.open = true));
      const id = await page.inputValue('#strategyNode'),
        baseline = await canvasPng(page);
      await page.check('#strategyLock');
      await page.selectOption('#strategyType', 'force');
      await page.selectOption('#strategyMode', 'missing');
      await page.click('#strategyPreview');
      assert.notDeepEqual(
        await canvasPng(page),
        baseline,
        'locking one fallback does not author every other point',
      );
      await page.click('#strategyCancel');
      const exportPositions = async () => {
        const promise = page.waitForEvent('download');
        await page.click('#layoutExport');
        const download = await promise;
        return JSON.parse(await readFile(await download.path(), 'utf8'));
      };
      const expected = await exportPositions();
      await page.selectOption('#strategyType', 'circle');
      await page.selectOption('#strategyMode', 'rearrange');
      await page.click('#strategyPreview');
      assert.notDeepEqual(await canvasPng(page), baseline);
      assert.deepEqual(await exportPositions(), expected);
      assert.equal(await page.locator('#strategyApply').isDisabled(), true);
      await page.uncheck('#strategyLock');
      await page.click('#strategyPreview');
      await page.click('#strategyApply');
      await page.click('#visualUndo');
      assert.equal(await page.locator('#visualRedo').isDisabled(), false);
      await page.click('#layoutToggle');
      await page.selectOption('#layoutNode', id);
      const before = { x: await page.inputValue('#layoutX'), y: await page.inputValue('#layoutY') };
      await page.locator('#stage').scrollIntoViewIfNeeded();
      const point = await page.evaluate(({ x, y }) => {
        const s = window.studioFrame(),
          r = document.getElementById('stage').getBoundingClientRect();
        return {
          x:
            r.left +
            ((640 + (Number(x) - s.cameraResolved.x) * s.cameraResolved.scale) * r.width) / 1280,
          y:
            r.top +
            ((330 + (Number(y) - s.cameraResolved.y) * s.cameraResolved.scale) * r.height) / 720,
        };
      }, before);
      await page.mouse.click(point.x, point.y);
      assert.equal(await page.locator('#visualRedo').isDisabled(), false);
      await page.mouse.move(point.x, point.y);
      await page.mouse.down();
      await page.mouse.move(point.x + 30, point.y + 20);
      assert.notEqual(await page.inputValue('#layoutX'), before.x);
      await page.keyboard.press('Escape');
      await page.mouse.up();
      await page.click('#layoutToggle');
      await page.selectOption('#layoutNode', id);
      assert.equal(await page.inputValue('#layoutX'), before.x);
      assert.equal(await page.inputValue('#layoutY'), before.y);
      assert.equal(await page.locator('#visualRedo').isDisabled(), false);
      assert.deepEqual(problems, []);
    },
  );
  await context.close();
}

{
  const { context, page, problems } = await openStudio();
  await check(
    'review: global values, pending edits on Canvas selection, and invalid project save',
    async () => {
      await page.locator('#appearanceEditor details').evaluate((e) => (e.open = true));
      await page.selectOption('#visualScope', 'global');
      await page.fill('#visual-fontSize', '23');
      await page.locator('#visual-fontSize').dispatchEvent('change');
      await page.focus('#visualPreset');
      await page.evaluate(() => window.renderAt(1));
      assert.equal(await page.inputValue('#visual-fontSize'), '23');
      await page.selectOption('#visualScope', 'object');
      const ids = await page
        .locator('#visualObject option')
        .evaluateAll((options) => options.map((o) => o.value).filter(Boolean));
      const [a, b] = ids;
      const pointFor = async (id) => {
        await page.locator('#stage').scrollIntoViewIfNeeded();
        return page.evaluate((id) => {
          const state = window.studioFrame(),
            node = state.view.nodes.find((n) => n.id === id),
            r = document.getElementById('stage').getBoundingClientRect();
          return {
            x:
              r.left +
              ((640 + (node.position.x - state.cameraResolved.x) * state.cameraResolved.scale) *
                r.width) /
                1280,
            y:
              r.top +
              ((330 + (node.position.y - state.cameraResolved.y) * state.cameraResolved.scale) *
                r.height) /
                720,
          };
        }, id);
      };
      await page.selectOption('#visualObject', a);
      await page.fill('#visualLabel', 'Pending A');
      let point = await pointFor(b);
      await page.mouse.click(point.x, point.y);
      assert.equal(await page.inputValue('#visualObject'), b);
      assert.notEqual(await page.inputValue('#visualLabel'), 'Pending A');
      await page.selectOption('#visualObject', a);
      assert.equal(await page.inputValue('#visualLabel'), 'Pending A');
      await page.locator('#appearanceEditor details').evaluate((e) => (e.open = true));
      await page.fill('#visual-fontSize', '27');
      point = await pointFor(b);
      await page.mouse.click(point.x, point.y);
      assert.equal(await page.inputValue('#visualObject'), b);
      assert.equal(await page.inputValue('#visual-fontSize'), '23');
      await page.selectOption('#visualObject', a);
      assert.equal(await page.inputValue('#visual-fontSize'), '27');
      await page.click('#layoutToggle');
      await page.selectOption('#layoutNode', a);
      await page.fill('#layoutX', '10000001');
      await page.fill('#layoutY', '0');
      await page.click('#layoutApply');
      let downloads = 0;
      page.on('download', () => downloads++);
      await page.click('#visualSave');
      assert.ok((await page.locator('#visualError').textContent()).includes('保存失败'));
      assert.equal(downloads, 0);
      assert.deepEqual(problems, []);
    },
  );
  await context.close();
}

// Property authoring uses the production projection and both render backends read saved config.
for (const theme of ['light', 'dark']) {
  const { context, page, problems } = await openStudio({ colorScheme: theme });
  await check(`project styles, text, history, focus and round trip (${theme})`, async () => {
    const options = await page.locator('#visualObject option').allTextContents();
    assert.ok(options.length > 1);
    await page.selectOption('#visualObject', { index: 1 });
    const selected = await page.inputValue('#visualObject');
    await page.locator('#appearanceEditor details').evaluate((e) => (e.open = true));
    await page.fill('#visual-fontSize', '23');
    await page.locator('#visual-fontSize').dispatchEvent('change');
    assert.equal(await page.inputValue('#visual-fontSize'), '23');
    await page.click('#visualUndo');
    assert.notEqual(await page.inputValue('#visual-fontSize'), '23');
    await page.click('#visualRedo');
    assert.equal(await page.inputValue('#visual-fontSize'), '23');
    await page.fill('#visualLabel', '显示文案测试');
    await page.locator('#visualLabel').dispatchEvent('change');
    assert.ok((await page.locator('#transcript').textContent()).includes('显示文案测试'));
    await page.focus('#visualLabel');
    await page.evaluate(() => window.renderAt(1));
    assert.equal(await page.evaluate(() => document.activeElement.id), 'visualLabel');
    const expected = await canvasPng(page);
    const downloadPromise = page.waitForEvent('download');
    await page.click('#visualSave');
    const download = await downloadPromise,
      data = JSON.parse(await readFile(await download.path(), 'utf8'));
    assert.equal(data.format, 'relgraph.studio/1');
    assert.equal(data.config.text.nodes[selected].label, '显示文案测试');
    assert.deepEqual(data.source, documents.literature);
    await page.locator('#fileInput').setInputFiles({
      name: 'roundtrip.studio.json',
      mimeType: 'application/json',
      buffer: Buffer.from(JSON.stringify(data)),
    });
    await page.waitForFunction(
      () => document.getElementById('sourceName').textContent === 'roundtrip.studio.json',
    );
    await waitReady(page);
    await page.evaluate(() => window.renderAt(1));
    assert.deepEqual(await canvasPng(page), expected);
    await page.selectOption('#visualObject', selected);
    await page.click('#visualRestoreText');
    assert.ok(!(await page.locator('#transcript').textContent()).includes('显示文案测试'));
    assert.deepEqual(problems, []);
  });
  await context.close();
}
{
  const { context, page } = await openStudio();
  await check(
    'property controls withdraw custom hidden text on rewind and document switch',
    async () => {
      const source = JSON.parse(
        await readFile(join(root, 'datasets/honglou-chengjia-opening/graph.relgraph.json'), 'utf8'),
      );
      const id = source.characters[0].id;
      const project = {
        format: 'relgraph.studio/1',
        source,
        config: { text: { nodes: { [id]: { label: '保密显示文案' } } } },
      };
      await page.locator('#fileInput').setInputFiles({
        name: 'safe-project.json',
        mimeType: 'application/json',
        buffer: Buffer.from(JSON.stringify(project)),
      });
      await page.waitForFunction(
        () => document.getElementById('sourceName').textContent === 'safe-project.json',
      );
      await waitReady(page);
      assert.ok(!(await page.locator('body').textContent()).includes('保密显示文案'));
      await page.evaluate(() => window.renderAt(48));
      await page.selectOption('#visualObject', id);
      await page.focus('#visualLabel');
      assert.equal(await page.inputValue('#visualLabel'), '保密显示文案');
      await page.evaluate(() => window.renderAt(0));
      assert.equal(await page.inputValue('#visualLabel'), '');
      assert.ok(!(await page.locator('#appearanceEditor').textContent()).includes('保密显示文案'));
      await loadExample(page, EXAMPLES[1]);
      assert.equal(await page.inputValue('#visualObject'), '');
    },
  );
  await context.close();
}

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

// Unsaved project protection must work with real browser dialogs and downloads.
{
  const { context, page, problems } = await openStudio();
  await check('unsaved project confirmation and complete-project export in Chromium', async () => {
    const initialSource = await text(page, '#sourceName');
    assert.equal(await page.getAttribute('#saveState', 'data-dirty'), 'false');
    await page.selectOption('#visualPreset', 'presentation');
    assert.equal(await page.getAttribute('#saveState', 'data-dirty'), 'true');

    page.once('dialog', (dialog) => void dialog.dismiss());
    await page.click('#exampleBiology');
    assert.equal(
      await text(page, '#sourceName'),
      initialSource,
      'cancel keeps the original source',
    );
    assert.equal(await page.getAttribute('#saveState', 'data-dirty'), 'true');

    const download = page.waitForEvent('download');
    await page.click('#visualSave');
    assert.match((await download).suggestedFilename(), /\.studio\.json$/);
    assert.equal(await page.getAttribute('#saveState', 'data-dirty'), 'false');

    await page.evaluate(() => window.renderAt(84));
    await page.selectOption('#visualObject', { index: 1 });
    await page.locator('#appearanceEditor details').evaluate((element) => {
      element.open = true;
    });
    await page.fill('#visual-size', '999');
    await page.locator('#visual-size').evaluate((element) => element.blur());
    assert.equal(await page.getAttribute('#saveState', 'data-dirty'), 'true');
    await page.evaluate(() => window.renderAt(85));
    assert.equal(await page.inputValue('#visual-size'), '999');
    await page.click('#visualSave');
    assert.match(await text(page, '#visualError'), /未提交/);
    await page.fill('#visual-size', '24');
    await page.locator('#visual-size').evaluate((element) => element.blur());
    const correctedDownload = page.waitForEvent('download');
    await page.click('#visualSave');
    await correctedDownload;
    assert.equal(await page.getAttribute('#saveState', 'data-dirty'), 'false');

    // A successful empty override inherits the preset's 18px font size.
    await page.fill('#visual-fontSize', '22');
    await page.locator('#visual-fontSize').evaluate((element) => element.blur());
    await page.fill('#visual-fontSize', '');
    await page.locator('#visual-fontSize').evaluate((element) => element.blur());
    assert.equal(await page.inputValue('#visual-fontSize'), '18');
    const inheritedDownload = page.waitForEvent('download');
    await page.click('#visualSave');
    await inheritedDownload;
    assert.equal(await page.getAttribute('#saveState', 'data-dirty'), 'false');

    await page.click('#layoutToggle');
    assert.equal(await page.isDisabled('#layoutX'), false);
    const chooserIds = await page.locator('#layoutNode option').evaluateAll((options) =>
      options.map((option) => option.value),
    );
    assert.ok(chooserIds.length >= 2);
    const firstNode = chooserIds[0];
    const secondNode = chooserIds[1];
    await page.selectOption('#layoutNode', firstNode);
    const originalX = await page.inputValue('#layoutX');
    const draftX = String(Number(originalX) + 13);
    await page.fill('#layoutX', draftX);
    assert.equal(await page.getAttribute('#saveState', 'data-dirty'), 'true');
    await page.selectOption('#layoutNode', secondNode);
    assert.equal(await page.getAttribute('#saveState', 'data-dirty'), 'true');
    await page.selectOption('#layoutNode', firstNode);
    assert.equal(await page.inputValue('#layoutX'), draftX);
    await page.click('#visualSave');
    assert.match(await text(page, '#visualError'), /未提交/);
    page.once('dialog', (dialog) => void dialog.dismiss());
    await page.click('#exampleBiology');
    assert.equal(await text(page, '#sourceName'), initialSource);
    await page.fill('#layoutX', originalX);
    assert.equal(await page.getAttribute('#saveState', 'data-dirty'), 'false');
    await page.click('#layoutToggle');

    await page.selectOption('#visualPreset', 'quiet');
    assert.equal(await page.getAttribute('#saveState', 'data-dirty'), 'true');
    page.once('dialog', (dialog) => void dialog.accept());
    await loadExample(page, EXAMPLES[1]);
    assert.equal(await page.getAttribute('#saveState', 'data-dirty'), 'false');
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
