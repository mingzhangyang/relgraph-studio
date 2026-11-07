import { test } from 'vitest';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import literature from '../examples/honglou-provisional.relgraph.json' with { type: 'json' };
import biology from '../examples/biology-signaling-synthetic.json' with { type: 'json' };
import { parseCommand, UsageError } from '../packages/cli/src/args.ts';
import { formatDiagnostics } from '../packages/cli/src/document.ts';
import { encodeArgs } from '../packages/cli/src/ffmpeg.ts';
import { frameFile, isFramePattern } from '../packages/cli/src/frames.ts';
import { loadDocument } from '../packages/core/src/director/load.ts';
import { layoutGraph } from '../packages/core/src/director/layout.ts';
import { frameCount } from '../packages/core/src/director/state.ts';
import {
  createHeadlessRenderer,
  SKIA_CANVAS_VERSION,
  uncoveredCharacters,
} from '../packages/render/src/backends/skia.ts';
import { makeStudio } from './helpers/studio-harness.mjs';

const sha256 = (bytes) => createHash('sha256').update(bytes).digest('hex');

test('render defaults: 1080p, light film theme, zh-CN, whole film', () => {
  const command = parseCommand(['render', 'story.json', '--out', 'film.mp4']);
  assert.equal(command.command, 'render');
  assert.equal(command.frameSpec, 'landscape-1080p');
  assert.equal(command.theme, 'light');
  assert.equal(command.locale, 'zh-CN');
  assert.equal(command.from, undefined);
  assert.equal(command.to, undefined);
  assert.ok(command.jobs >= 1);
  const frames = parseCommand(
    ['render', 's.json', '--frames', 'out/%05d.png', '--theme', 'dark'].concat(
      ['--frame-spec', 'landscape-720p', '--locale', 'en', '--from', '3', '--to', '9'],
      ['--jobs', '2', '--ffmpeg', '/opt/ffmpeg'],
    ),
  );
  assert.deepEqual(
    { ...frames },
    {
      command: 'render',
      file: 's.json',
      frames: 'out/%05d.png',
      frameSpec: 'landscape-720p',
      theme: 'dark',
      locale: 'en',
      from: 3,
      to: 9,
      jobs: 2,
      ffmpeg: '/opt/ffmpeg',
    },
  );
});

test('invalid arguments are usage errors', () => {
  for (const argv of [
    ['render', 's.json'],
    ['render', 's.json', '--out', 'a.mp4', '--frames', 'f%d.png'],
    ['render', 's.json', '--out', 'a.mov'],
    ['render', 's.json', '--frames', 'f.png'],
    ['render', 's.json', '--frames', 'f%d-%d.png'],
    ['render', 's.json', '--out', 'a.mp4', '--theme', 'sepia'],
    ['render', 's.json', '--out', 'a.mp4', '--frame-spec', 'portrait'],
    ['render', 's.json', '--out', 'a.mp4', '--locale', 'fr'],
    ['render', 's.json', '--out', 'a.mp4', '--from', '5', '--to', '2'],
    ['render', 's.json', '--out', 'a.mp4', '--from', '-1'],
    ['render', 's.json', '--out', 'a.mp4', '--jobs', '0'],
    ['render', 's.json', '--out', 'a.mp4', '--unknown'],
    ['validate'],
    ['validate', 'a.json', 'b.json'],
    ['layout', 'a.json'],
  ])
    assert.throws(() => parseCommand(argv), UsageError, argv.join(' '));
  assert.deepEqual(parseCommand([]), { command: 'help' });
  assert.deepEqual(parseCommand(['--version']), { command: 'version' });
});

test('frame patterns follow FFmpeg image2 numbering', () => {
  assert.equal(frameFile('out/%05d.png', 42), 'out/00042.png');
  assert.equal(frameFile('f%d.png', 7), 'f7.png');
  assert.equal(frameFile('f%3d.png', 7), 'f007.png');
  assert.ok(isFramePattern('out/%05d.png'));
  assert.ok(!isFramePattern('out/frame.png'));
  assert.ok(!isFramePattern('%d/%d.png'));
});

test('MP4 encoding states pixel format, colour tags and an exact frame rate', () => {
  const args = encodeArgs({ width: 1920, height: 1080, fps: 24, out: 'film.mp4' });
  const after = (flag) => args[args.indexOf(flag) + 1];
  assert.equal(after('-pixel_format'), 'rgba');
  assert.equal(after('-video_size'), '1920x1080');
  assert.equal(after('-framerate'), '24');
  assert.equal(after('-r'), '24');
  assert.equal(after('-c:v'), 'libx264');
  assert.equal(after('-pix_fmt'), 'yuv420p');
  assert.equal(after('-colorspace'), 'bt709');
  assert.equal(after('-color_range'), 'tv');
  assert.equal(args.at(-1), 'film.mp4');
});

test('validate prints the workspace diagnostics text', async () => {
  const invalid = structuredClone(literature);
  invalid.relations[0].target = 'missing-character';
  const result = loadDocument(invalid);
  const text = formatDiagnostics(result);
  assert.match(text, /^错误 · 1\n {2}✗ UNKNOWN_TARGET · r01\n {4}relations\[0\]\.target\n/);
  assert.match(text, /\n {4}建议：/);
  assert.match(text, /\n警告 · \d+\n/);
  assert.equal(formatDiagnostics(loadDocument(biology)), '未发现校验问题。\n');

  // The workspace renders the same entries from the same helpers.
  const fetcher = async () => ({ ok: true, text: async () => JSON.stringify(invalid) });
  const studio = makeStudio({ fetcher });
  await studio.ready;
  const errors = studio.document.getElementById('errors');
  const [heading, item] = errors.children;
  assert.equal(heading.textContent, '错误 · 1');
  const [title, path, message, fix] = item.children.map((child) => child.textContent);
  assert.ok(text.includes(`✗ ${title}\n    ${path}\n    ${message}\n    ${fix}\n`));
});

test('headless frames are pure functions of the frame index', () => {
  const result = loadDocument(biology);
  const layout = layoutGraph(result.graph);
  const options = { detailAt: result.detailAt, frameSpec: 'landscape-720p', theme: 'light' };
  const last = frameCount(result.graph) - 1;
  const target = 100;
  const fresh = createHeadlessRenderer(result.graph, layout, options);
  const direct = sha256(fresh.rgbaAt(target));
  const busy = createHeadlessRenderer(result.graph, layout, options);
  for (const frame of [last, 0, 37]) busy.rgbaAt(frame);
  assert.equal(sha256(busy.rgbaAt(target)), direct, 'same pixels after other frames');
  assert.equal(sha256(fresh.rgbaAt(target)), direct, 'same pixels when redrawn');
  const pixels = fresh.rgbaAt(target);
  assert.equal(pixels.length, 1280 * 720 * 4);
  assert.ok(fresh.pngAt(target).subarray(1, 4).toString('latin1') === 'PNG');
  assert.equal(SKIA_CANVAS_VERSION, '4.0.0');
});

test('the vendored fonts cover both examples', () => {
  const strings = (value) =>
    typeof value === 'string'
      ? [value]
      : value && typeof value === 'object'
        ? Object.values(value).flatMap(strings)
        : [];
  assert.deepEqual(uncoveredCharacters([...strings(literature), ...strings(biology)]), []);
  assert.deepEqual(uncoveredCharacters(['龘 ok']), ['龘']);
  // Requested in charset.txt but absent from every source font.
  assert.deepEqual(uncoveredCharacters(['1⁄2', 'why‽', '‣ item']), ['‣', '‽', '⁄']);
});

test('a golden frame reproduces its committed hash (same skia-canvas and fonts)', async (context) => {
  const { readFile } = await import('node:fs/promises');
  const { join } = await import('node:path');
  const { FILM_FONT_FACES } = await import('../packages/render/src/fonts.ts');
  const { FILM_FONTS_DIR } = await import('../packages/render/src/backends/skia.ts');
  const manifest = JSON.parse(
    await readFile(new URL('../examples/golden-frames.json', import.meta.url), 'utf8'),
  );
  const fonts = createHash('sha256');
  for (const face of FILM_FONT_FACES)
    fonts.update(
      `${face.name}|${face.weight}|${sha256(await readFile(join(FILM_FONTS_DIR, face.file)))}\n`,
    );
  // Like check:export, other versions are not a failure; the full check reports them.
  if (
    manifest.environment.skiaCanvas !== SKIA_CANVAS_VERSION ||
    manifest.environment.fonts !== fonts.digest('hex')
  )
    return context.skip();
  const entry = manifest.frames.find((f) => f.example === 'biology' && f.kind === 'transition');
  const result = loadDocument(biology);
  const renderer = createHeadlessRenderer(result.graph, layoutGraph(result.graph), {
    detailAt: result.detailAt,
    frameSpec: manifest.frameSpec,
    theme: entry.theme,
    locale: manifest.locale,
  });
  assert.equal(sha256(renderer.rgbaAt(entry.frame)), entry.sha256);
});

test('renderFilm rejects non-integer ranges and job counts before writing', async () => {
  const { renderFilm, RenderError } = await import('../packages/cli/src/render.ts');
  const base = {
    file: 'examples/biology-signaling-synthetic.json',
    frames: 'output/never/%05d.png',
    frameSpec: 'landscape-720p',
    theme: 'light',
    locale: 'zh-CN',
    jobs: 1,
  };
  for (const bad of [
    { to: Number.NaN },
    { to: 0.5 },
    { from: -1 },
    { from: 1.5 },
    { jobs: 0 },
    { jobs: Number.NaN },
  ])
    await assert.rejects(renderFilm({ ...base, ...bad }), RenderError, JSON.stringify(bad));
});
