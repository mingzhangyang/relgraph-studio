#!/usr/bin/env node
// Headless export check (ADR 003, migration step 3).
//
//   npm run check:export                  # build, check golden frames, export and probe MP4s
//   npm run check:export -- --no-build    # reuse the built packages and studio
//   npm run check:export -- --update      # rewrite examples/golden-frames.json
//   npm run check:export -- --no-browser  # skip the informational browser comparison
//
// 1. Golden frames: key frames of both examples in both film themes are
//    rendered with the skia-canvas backend and their RGBA SHA-256 compared with
//    examples/golden-frames.json. Hashes are enforced only when skia-canvas and
//    the vendored fonts are the versions that produced them; otherwise the
//    differences are reported without failing, as in check:browser.
// 2. Export: `relgraph render` writes a complete MP4 of each example. ffprobe
//    must report the codec, pixel format, frame rate, resolution, colour tags,
//    frame count `frameCount(graph, fps)` and the matching duration.
// 3. Round trip: a frame decoded from each MP4 is compared with the PNG that
//    `relgraph render --frames` writes for the same index (lossy H.264, so by
//    PSNR) and must match better than its neighbours. The PNG must equal the
//    in-process render exactly, which also shows that frames do not depend on
//    the worker or on previously drawn frames.
// 4. Informational: pixel differences between the browser preview and the
//    headless export at 720p, mid-shot frames of both examples and themes.
import assert from 'node:assert/strict';
import { execFile, spawn } from 'node:child_process';
import { createHash } from 'node:crypto';
import { mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { promisify } from 'node:util';

const run = promisify(execFile);
const root = fileURLToPath(new URL('..', import.meta.url));
const outputDir = join(root, 'output/export-check');
const manifestPath = join(root, 'examples/golden-frames.json');
const args = new Set(process.argv.slice(2));
const update = args.has('--update');
const relgraph = join(root, 'packages/cli/dist/bin.js');
const GOLDEN_SPEC = 'landscape-1080p';
const LOCALE = 'zh-CN';
const THEMES = ['light', 'dark'];
// The round-trip frame must reproduce the render this closely through H.264.
const MIN_PSNR = 35;
// Browser comparison: a pixel differs when a channel moves by more than this.
const CHANNEL_TOLERANCE = 16;

const EXAMPLES = [
  { key: 'literature', file: 'examples/honglou-provisional.relgraph.json' },
  { key: 'biology', file: 'examples/biology-signaling-synthetic.json' },
];

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
const sha256 = (bytes) => createHash('sha256').update(bytes).digest('hex');

function npm(script) {
  const cli = process.env.npm_execpath;
  return cli
    ? run(process.execPath, [cli, 'run', script], { cwd: root })
    : run('npm', ['run', script], { cwd: root, shell: process.platform === 'win32' });
}

if (!args.has('--no-build')) {
  console.log('Building packages…');
  await npm('build:packages');
}

const { frameCount, layoutGraph, loadDocument } = await import('@relgraph/core');
const { FILM_FONT_FACES, frameSpecFor } = await import('@relgraph/render');
const { createHeadlessRenderer, FILM_FONTS_DIR, SKIA_CANVAS_VERSION } =
  await import('@relgraph/render/skia');
const { Canvas, loadImage } = await import('skia-canvas');

/** Digest of the font files themselves, independent of the manifest text. */
async function fontsDigest() {
  const hash = createHash('sha256');
  for (const face of FILM_FONT_FACES)
    hash.update(
      `${face.name}|${face.weight}|${sha256(await readFile(join(FILM_FONTS_DIR, face.file)))}\n`,
    );
  return hash.digest('hex');
}
const environment = {
  skiaCanvas: SKIA_CANVAS_VERSION,
  fonts: await fontsDigest(),
  platform: `${process.platform}-${process.arch}`,
};

const examples = await Promise.all(
  EXAMPLES.map(async (example) => {
    const document = JSON.parse(await readFile(join(root, example.file), 'utf8'));
    const result = loadDocument(document);
    assert.equal(result.valid, true, `${example.file} is valid`);
    return { ...example, result, layout: layoutGraph(result.graph) };
  }),
);

/** Shot midpoints, mid-transition frames from the second shot, and the last frame. */
function keyFrames(graph, fps) {
  const at = (sec) => Math.ceil(sec * fps - 1e-9);
  const frames = [];
  let start = 0;
  graph.scenes.forEach((scene, index) => {
    const transition = Math.min((scene.transitionMs ?? 1200) / 1000, scene.durationSec);
    if (index > 0)
      frames.push({ shot: index + 1, kind: 'transition', frame: at(start + transition / 2) });
    frames.push({ shot: index + 1, kind: 'mid', frame: at(start + scene.durationSec / 2) });
    start += scene.durationSec;
  });
  frames.push({ shot: graph.scenes.length, kind: 'last', frame: frameCount(graph, fps) - 1 });
  return frames;
}

const renderers = new Map();
function headless(example, theme, frameSpec = GOLDEN_SPEC) {
  const key = `${example.key}|${theme}|${frameSpec}`;
  if (!renderers.has(key))
    renderers.set(
      key,
      createHeadlessRenderer(example.result.graph, example.layout, {
        detailAt: example.result.detailAt,
        frameSpec,
        theme,
        locale: LOCALE,
      }),
    );
  return renderers.get(key);
}

async function decodePng(png) {
  const image = await loadImage(png);
  const canvas = new Canvas(image.width, image.height, { gpu: false });
  const ctx = canvas.getContext('2d');
  ctx.drawImage(image, 0, 0);
  const { data } = ctx.getImageData(0, 0, image.width, image.height);
  return { width: image.width, height: image.height, data: new Uint8Array(data.buffer) };
}

function psnr(a, b) {
  let sum = 0,
    count = 0;
  for (let i = 0; i < a.length; i += 4)
    for (let c = 0; c < 3; c += 1) {
      const d = a[i + c] - b[i + c];
      sum += d * d;
      count += 1;
    }
  const mse = sum / count;
  return mse === 0 ? Infinity : 10 * Math.log10((255 * 255) / mse);
}

await rm(outputDir, { recursive: true, force: true });
await mkdir(outputDir, { recursive: true });

// ------------------------------------------------------------ golden frames

console.log(
  `Golden frames · skia-canvas ${environment.skiaCanvas} · fonts ${environment.fonts.slice(0, 12)} · ${environment.platform}`,
);
let manifest = null;
if (!update) {
  try {
    manifest = JSON.parse(await readFile(manifestPath, 'utf8'));
  } catch (error) {
    if (error?.code !== 'ENOENT') throw error;
    console.log('  No examples/golden-frames.json; run with --update to create it.');
  }
}
const mismatched = manifest
  ? Object.entries({ skiaCanvas: 'skia-canvas', fonts: 'vendored fonts' })
      .filter(([key]) => manifest.environment?.[key] !== environment[key])
      .map(([key, label]) => `${label} ${manifest.environment?.[key] ?? '?'} → ${environment[key]}`)
  : [];
const enforce = manifest !== null && mismatched.length === 0;
if (manifest && !enforce)
  console.log(`  Golden hashes are informational: ${mismatched.join('; ')}`);
if (manifest && manifest.environment?.platform !== environment.platform)
  console.log(
    `  Note: hashes were recorded on ${manifest.environment?.platform}; this is ${environment.platform}.`,
  );

const golden = [];
for (const example of examples) {
  const fps = frameSpecFor(GOLDEN_SPEC).fps;
  for (const theme of THEMES)
    for (const key of keyFrames(example.result.graph, fps)) {
      const pixels = headless(example, theme).rgbaAt(key.frame);
      golden.push({
        example: example.key,
        theme,
        shot: key.shot,
        kind: key.kind,
        frame: key.frame,
        sha256: sha256(pixels),
      });
    }
}
const id = (entry) => `${entry.example}-${entry.theme}-f${entry.frame}`;
if (manifest) {
  const expected = new Map(manifest.frames.map((entry) => [id(entry), entry.sha256]));
  const changed = golden.filter((entry) => expected.get(id(entry)) !== entry.sha256);
  const missing = [...expected.keys()].filter((key) => !golden.some((e) => id(e) === key));
  await check(
    `${golden.length} golden frames ${enforce ? 'match' : 'compared with'} examples/golden-frames.json`,
    async () => {
      const problems = [
        ...changed.map((entry) =>
          expected.has(id(entry)) ? `${id(entry)} changed` : `${id(entry)} not in manifest`,
        ),
        ...missing.map((key) => `${key} no longer rendered`),
      ];
      if (!problems.length) return;
      const summary = `${problems.join(', ')} (run with --update if the change is intended)`;
      if (!enforce) {
        console.log(`    (informational, different skia-canvas or fonts) ${summary}`);
        return;
      }
      assert.fail(summary);
    },
  );
}

// ------------------------------------------------------- export and ffprobe

const ffprobe = async (file, entries) =>
  JSON.parse(
    (
      await run('ffprobe', [
        '-v',
        'error',
        '-count_frames',
        '-select_streams',
        'v:0',
        '-show_entries',
        entries,
        '-of',
        'json',
        file,
      ])
    ).stdout,
  );

/** Decode frame `index` of a video to RGBA with the stream's BT.709 tags. */
function decodeFrame(file, index, width, height) {
  return new Promise((resolve, reject) => {
    const ffmpeg = spawn('ffmpeg', [
      '-v',
      'error',
      '-i',
      file,
      '-vf',
      `select=eq(n\\,${index}),scale=in_color_matrix=bt709:in_range=tv,format=rgba`,
      '-frames:v',
      '1',
      '-f',
      'rawvideo',
      'pipe:1',
    ]);
    const chunks = [];
    let stderr = '';
    ffmpeg.stdout.on('data', (chunk) => chunks.push(chunk));
    ffmpeg.stderr.on('data', (chunk) => (stderr += chunk));
    ffmpeg.on('error', reject);
    ffmpeg.on('close', (code) => {
      const data = Buffer.concat(chunks);
      if (code !== 0 || data.length !== width * height * 4)
        reject(new Error(`ffmpeg decode of frame ${index} failed (${code}): ${stderr}`));
      else resolve(new Uint8Array(data.buffer, data.byteOffset, data.length));
    });
  });
}

const films = [];
for (const example of examples) {
  const spec = frameSpecFor(GOLDEN_SPEC);
  const expectedFrames = frameCount(example.result.graph, spec.fps);
  const out = join(outputDir, `${example.key}.mp4`);
  await check(`relgraph render exports ${example.key}.mp4 (${expectedFrames} frames)`, async () => {
    const started = performance.now();
    await run(process.execPath, [relgraph, 'render', join(root, example.file), '--out', out], {
      cwd: root,
      maxBuffer: 16 << 20,
    });
    console.log(`    exported in ${((performance.now() - started) / 1000).toFixed(1)} s`);
    const { streams, format } = await ffprobe(
      out,
      'stream=codec_name,profile,width,height,pix_fmt,r_frame_rate,avg_frame_rate,nb_read_frames,duration,color_space,color_primaries,color_transfer,color_range:format=duration,format_name',
    );
    const [stream] = streams;
    assert.equal(stream.codec_name, 'h264');
    assert.equal(stream.pix_fmt, 'yuv420p');
    assert.equal(`${stream.width}×${stream.height}`, `${spec.width}×${spec.height}`);
    assert.equal(stream.r_frame_rate, `${spec.fps}/1`);
    assert.equal(stream.avg_frame_rate, `${spec.fps}/1`);
    assert.equal(Number(stream.nb_read_frames), expectedFrames, 'decoded frame count');
    assert.ok(
      Math.abs(Number(stream.duration) - expectedFrames / spec.fps) < 1e-6,
      `stream duration ${stream.duration} s = ${expectedFrames} / ${spec.fps}`,
    );
    assert.ok(Math.abs(Number(format.duration) - expectedFrames / spec.fps) < 0.05);
    for (const key of ['color_space', 'color_primaries', 'color_transfer'])
      assert.equal(stream[key], 'bt709', key);
    assert.equal(stream.color_range, 'tv');
    console.log(
      `    ${stream.codec_name} ${stream.profile} · ${stream.width}×${stream.height} · ${stream.pix_fmt} · ${stream.r_frame_rate} fps · ${stream.nb_read_frames} frames · ${Number(stream.duration).toFixed(3)} s`,
    );
    films.push({ example, out, spec, frames: expectedFrames });
  });
}

// ----------------------------------------------------------------- round trip

for (const { example, out, spec } of films) {
  // A mid-transition frame: the camera moves, so neighbouring frames differ.
  const frame = keyFrames(example.result.graph, spec.fps).find(
    (k) => k.kind === 'transition',
  ).frame;
  await check(`${example.key}: frame ${frame} of the MP4 matches its PNG render`, async () => {
    const pattern = join(outputDir, `${example.key}-%05d.png`);
    await run(
      process.execPath,
      [relgraph, 'render', join(root, example.file)].concat([
        '--frames',
        pattern,
        '--from',
        String(frame - 1),
        '--to',
        String(frame + 1),
        '--jobs',
        '3',
      ]),
    );
    const pngs = [];
    for (const f of [frame - 1, frame, frame + 1]) {
      const file = pattern.replace('%05d', String(f).padStart(5, '0'));
      pngs.push(await decodePng(await readFile(file)));
    }
    const png = pngs[1];
    assert.equal(`${png.width}×${png.height}`, `${spec.width}×${spec.height}`);
    // The worker's PNG is the in-process render, byte for byte in RGBA.
    const direct = headless(example, 'light').rgbaAt(frame);
    assert.equal(sha256(png.data), sha256(direct), 'PNG pixels equal the in-process render');
    const decoded = await decodeFrame(out, frame, spec.width, spec.height);
    const scores = pngs.map((p) => psnr(decoded, p.data));
    console.log(
      `    PSNR of video frame ${frame} against renders ${frame - 1}/${frame}/${frame + 1}: ${scores.map((s) => s.toFixed(2)).join(' / ')} dB`,
    );
    assert.ok(scores[1] >= MIN_PSNR, `PSNR ${scores[1].toFixed(2)} dB < ${MIN_PSNR} dB`);
    assert.ok(scores[1] > scores[0] && scores[1] > scores[2], 'best match is the same index');
  });
}

// ------------------------------------------------- browser vs headless (720p)

if (!args.has('--no-browser') && !update) {
  const { chromium } = await import('playwright');
  const { build, preview } = await import('vite');
  if (!args.has('--no-build')) await build({ root, logLevel: 'warn' });
  const server = await preview({
    root,
    logLevel: 'warn',
    preview: { host: '127.0.0.1', port: 4174, strictPort: false },
  });
  const browser = await chromium.launch();
  console.log(
    `Browser preview vs headless export, landscape-720p, Chromium ${browser.version()} (informational)`,
  );
  const rows = [];
  try {
    for (const theme of THEMES) {
      const context = await browser.newContext({
        colorScheme: theme,
        viewport: { width: 1440, height: 1000 },
      });
      const page = await context.newPage();
      await page.goto(`${server.resolvedUrls.local[0]}demo/index.html`);
      for (const example of examples) {
        await page.click(example.key === 'literature' ? '#exampleLiterature' : '#exampleBiology');
        await page.waitForFunction(
          (title) =>
            document.getElementById('status')?.getAttribute('data-state') === 'ready' &&
            window.studioFrame()?.view.meta.title === title,
          example.result.graph.meta.title,
        );
        for (const key of keyFrames(example.result.graph, 24).filter((k) => k.kind === 'mid')) {
          assert.equal(await page.evaluate((f) => window.renderAt(f), key.frame), true);
          const url = await page.evaluate(() =>
            document.getElementById('stage').toDataURL('image/png'),
          );
          const browserPng = await decodePng(
            Buffer.from(url.slice(url.indexOf(',') + 1), 'base64'),
          );
          const exported = headless(example, theme, 'landscape-720p').rgbaAt(key.frame);
          let differing = 0;
          for (let i = 0; i < exported.length; i += 4)
            for (let c = 0; c < 4; c += 1)
              if (Math.abs(exported[i + c] - browserPng.data[i + c]) > CHANNEL_TOLERANCE) {
                differing += 1;
                break;
              }
          rows.push({
            frame: `${example.key}-${theme}-shot${key.shot}-f${key.frame}`,
            ratio: differing / (exported.length / 4),
            psnr: psnr(exported, browserPng.data),
          });
          await writeFile(
            join(outputDir, `preview-${example.key}-${theme}-f${key.frame}.png`),
            Buffer.from(url.slice(url.indexOf(',') + 1), 'base64'),
          );
          await writeFile(
            join(outputDir, `export-720p-${example.key}-${theme}-f${key.frame}.png`),
            headless(example, theme, 'landscape-720p').pngAt(key.frame),
          );
        }
      }
      await context.close();
    }
  } finally {
    await browser.close();
    await new Promise((resolve) => server.httpServer.close(resolve));
  }
  for (const row of rows)
    console.log(
      `    ${row.frame.padEnd(34)} ${(row.ratio * 100).toFixed(3).padStart(7)}% pixels differ · PSNR ${row.psnr.toFixed(2)} dB`,
    );
  const mean = rows.reduce((sum, row) => sum + row.ratio, 0) / (rows.length || 1);
  console.log(
    `    mean ${(mean * 100).toFixed(3)}% of pixels differ by more than ${CHANNEL_TOLERANCE}/255`,
  );
}

// ------------------------------------------------------------------- update

const failed = results.filter((result) => !result.ok);
if (update && failed.length) {
  console.log(`Golden frames not saved: ${failed.length} checks failed.`);
} else if (update) {
  await writeFile(
    manifestPath,
    JSON.stringify(
      {
        note: 'SHA-256 of RGBA pixels of headless key frames; regenerate with npm run check:export -- --update. Enforced only for the same skia-canvas version and font digest.',
        environment,
        frameSpec: GOLDEN_SPEC,
        locale: LOCALE,
        frames: golden,
      },
      null,
      2,
    ) + '\n',
  );
  console.log(`Saved ${golden.length} golden frame hashes to examples/golden-frames.json`);
}

console.log(
  `\n${results.length - failed.length}/${results.length} export checks passed · videos and frames in output/export-check/`,
);
process.exitCode = failed.length ? 1 : 0;
