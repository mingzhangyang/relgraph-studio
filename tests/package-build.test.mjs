import { test } from 'vitest';
import assert from 'node:assert/strict';
import { execFile } from 'node:child_process';
import { realpathSync } from 'node:fs';
import { cp, mkdir, mkdtemp, readFile, rm, symlink, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { basename, delimiter, dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { promisify } from 'node:util';

const run = promisify(execFile);
const rootPackage = JSON.parse(await readFile(new URL('../package.json', import.meta.url), 'utf8'));
const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const executablePath = process.env.PATH ?? process.env.Path ?? '';
const env = {
  ...process.env,
  PATH: `${join(root, 'node_modules/.bin')}${delimiter}${executablePath}`,
};

// npm.cmd is a batch file on Windows, so resolve npm's JS entry and run it
// with Node. The PATH fallback also supports invoking Vitest directly.
function npmCliPath() {
  const nodeDir = dirname(process.execPath);
  const candidates = [
    process.env.npm_execpath,
    join(nodeDir, 'node_modules/npm/bin/npm-cli.js'),
    join(nodeDir, '../lib/node_modules/npm/bin/npm-cli.js'),
    ...executablePath
      .split(delimiter)
      .flatMap((dir) =>
        dir ? [join(dir, 'npm'), join(dir, 'node_modules/npm/bin/npm-cli.js')] : [],
      ),
  ];
  for (const candidate of candidates) {
    if (!candidate) continue;
    try {
      const path = realpathSync(candidate);
      if (basename(path).toLowerCase() === 'npm-cli.js') return path;
    } catch {
      // Try the next installation location.
    }
  }
  throw new Error('Cannot locate npm-cli.js; run this test with npm test or put npm on PATH.');
}

function runNpm(args, options, cli = npmCliPath()) {
  return run(process.execPath, [cli, ...args], options);
}

async function copySource(from, to) {
  const dist = join(from, 'dist');
  await cp(from, to, { recursive: true, filter: (path) => path !== dist });
}

test('npm CLI paths with spaces preserve literal arguments', async () => {
  const temp = await mkdtemp(join(tmpdir(), 'relgraph npm cli '));
  try {
    const cli = join(temp, 'npm-cli.js');
    await writeFile(cli, 'process.stdout.write(JSON.stringify(process.argv.slice(2)));\n');
    const args = ['install', 'a file.tgz', 'a&b'];
    const { stdout } = await runNpm(args, { cwd: temp, env }, cli);
    assert.deepEqual(JSON.parse(stdout), args);
  } finally {
    await rm(temp, { recursive: true, force: true });
  }
});

test('separately built packages work as packed Node and TypeScript dependencies', async () => {
  const temp = await mkdtemp(join(tmpdir(), 'relgraph-package-consumer-'));
  const builder = join(temp, 'builder');
  const core = join(builder, 'core');
  const render = join(builder, 'render');
  const cli = join(builder, 'cli');
  const packs = join(temp, 'packs');
  const consumer = join(temp, 'consumer');
  try {
    await mkdir(builder, { recursive: true });
    await mkdir(packs);
    await mkdir(consumer);
    await copySource(join(root, 'packages/core'), core);
    await copySource(join(root, 'packages/render'), render);
    await copySource(join(root, 'packages/cli'), cli);
    // The builds have their own configs. Render and the CLI resolve the built
    // packages, just as a workspace install would, without accessing the
    // repository source; skia-canvas and Node types come from the root install.
    await mkdir(join(builder, 'node_modules/@relgraph'), { recursive: true });
    await mkdir(join(builder, 'node_modules/@types'), { recursive: true });
    await symlink(core, join(builder, 'node_modules/@relgraph/core'), 'junction');
    await symlink(render, join(builder, 'node_modules/@relgraph/render'), 'junction');
    for (const name of ['skia-canvas', '@types/node'])
      await symlink(
        join(root, 'node_modules', name),
        join(builder, 'node_modules', name),
        'junction',
      );
    await runNpm(['run', 'build'], { cwd: core, env });
    await runNpm(['run', 'build'], { cwd: render, env });
    await runNpm(['run', 'build'], { cwd: cli, env });

    const originalSchema = JSON.parse(
      await readFile(join(core, 'schema/relationship-graph.schema.json'), 'utf8'),
    );
    const builtSchema = JSON.parse(
      await readFile(join(core, 'dist/schema/relationship-graph.schema.json'), 'utf8'),
    );
    assert.deepEqual(builtSchema, originalSchema);

    const tarballs = [];
    for (const path of [core, render, cli]) {
      const { stdout } = await runNpm(
        ['pack', '--ignore-scripts', '--json', '--pack-destination', packs],
        { cwd: path, env },
      );
      const [info] = JSON.parse(stdout);
      tarballs.push(join(packs, info.filename));
      assert.ok(info.files.some((file) => file.path.endsWith('.d.ts')));
      if (path === render) {
        // The headless backend registers the vendored fonts from the package.
        const packed = new Set(info.files.map((file) => file.path));
        for (const file of ['fonts/LICENSE', 'fonts/fonts.json', 'fonts/charset.txt'])
          assert.ok(packed.has(file), file);
        assert.equal([...packed].filter((file) => file.endsWith('.woff2')).length, 5);
      }
      if (path === cli) assert.ok(info.files.some((file) => file.path === 'dist/bin.js'));
    }
    // No ancestor of the consumer can resolve the builder or source workspace.
    await rm(builder, { recursive: true, force: true });
    await writeFile(join(consumer, 'package.json'), '{"private":true,"type":"module"}\n');
    await runNpm(
      [
        'install',
        '--offline',
        '--ignore-scripts',
        '--no-audit',
        '--no-fund',
        '--package-lock=false',
        ...tarballs,
        // Resolved from the npm cache that installing the repository filled.
        '@types/node@' + rootPackage.devDependencies['@types/node'],
      ],
      { cwd: consumer, env },
    );
    for (const name of ['honglou-provisional.relgraph.json', 'biology-signaling-synthetic.json']) {
      await cp(join(root, 'examples', name), join(consumer, name));
    }
    await writeFile(join(consumer, 'source-schema.json'), JSON.stringify(originalSchema));

    await writeFile(
      join(consumer, 'check.mjs'),
      `
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import schema from '@relgraph/core/schema/relationship-graph.schema.json' with { type: 'json' };
import { loadDocument, layoutGraph, frameCount, directorFrameAt, validateRelGraph, domainStyle } from '@relgraph/core';
import { createCanvasRenderer, VIDEO_WIDTH, FRAME_SPECS } from '@relgraph/render';
const read = async (path) => JSON.parse(await readFile(new URL(path, import.meta.url), 'utf8'));
assert.deepEqual(schema, await read('./source-schema.json'));
assert.equal(VIDEO_WIDTH, 1280);
assert.equal(FRAME_SPECS['landscape-1080p'].width, 1920);
assert.equal(domainStyle('biology').edges.catalyst.head, 'hollow-circle');
const gradient = { addColorStop() {} };
const ctx = new Proxy({}, { get(target, key) {
  if (key === 'measureText') return (text) => ({ width: String(text).length * 8 });
  if (key === 'createLinearGradient' || key === 'createRadialGradient') return () => gradient;
  return target[key] ?? (() => {});
}});
for (const [filename, domain] of [['honglou-provisional.relgraph.json', 'literature'], ['biology-signaling-synthetic.json', 'biology']]) {
  const doc = await read('./' + filename);
  const result = loadDocument(doc);
  assert.equal(result.valid, true, filename);
  assert.equal(result.graph.domain, domain);
  const layout = layoutGraph(result.graph);
  const renderer = createCanvasRenderer({ getContext: () => ctx }, result.graph, layout, { detailAt: result.detailAt });
  const last = frameCount(result.graph) - 1;
  for (const frame of [0, Math.min(48, last), last, 0]) {
    assert.deepEqual(renderer.renderFrame(frame), directorFrameAt(result.graph, layout, frame));
  }
  const list = renderer.displayListAt(0);
  assert.equal(list.width, 1280);
  assert.ok(list.items.length > 0 && list.a11y.nodes.length > 0);
  if (domain === 'literature') {
    doc.schemaVersion = 'invalid';
    assert.equal(validateRelGraph(doc).valid, false);
  }
}
await assert.rejects(import('@relgraph/core/src/graph/core.js'), { code: 'ERR_PACKAGE_PATH_NOT_EXPORTED' });
`,
    );
    await run(process.execPath, ['check.mjs'], { cwd: consumer, env });

    // The installed `relgraph` binary validates like the workspace and renders
    // frames headlessly from the packed fonts and worker.
    const relgraph = join(consumer, 'node_modules/@relgraph/cli/dist/bin.js');
    const valid = await run(
      process.execPath,
      [relgraph, 'validate', 'biology-signaling-synthetic.json'],
      { cwd: consumer, env },
    );
    assert.equal(valid.stdout, '未发现校验问题。\n');
    const broken = JSON.parse(await readFile(join(consumer, 'honglou-provisional.relgraph.json')));
    broken.relations[0].target = 'missing-character';
    await writeFile(join(consumer, 'broken.json'), JSON.stringify(broken));
    const invalid = await run(process.execPath, [relgraph, 'validate', 'broken.json'], {
      cwd: consumer,
      env,
    }).then(
      () => assert.fail('validate must exit non-zero for an invalid document'),
      (error) => error,
    );
    assert.equal(invalid.code, 1);
    assert.match(
      invalid.stdout,
      /^错误 · 1\n {2}✗ UNKNOWN_TARGET · r01\n {4}relations\[0\]\.target\n/,
    );
    const binLink = join(consumer, 'node_modules/.bin/relgraph');
    const linked = await run(binLink, ['--version'], { cwd: consumer, env }).catch(() => null);
    if (process.platform !== 'win32')
      assert.match(linked?.stdout ?? '', /^relgraph 0\.0\.0 \(skia-canvas 4\.0\.0\)/);
    await run(
      process.execPath,
      [relgraph, 'render', 'biology-signaling-synthetic.json'].concat([
        '--frames',
        'frames/%03d/frame.png',
        '--frame-spec',
        'landscape-720p',
        '--from',
        '24',
        '--to',
        '25',
      ]),
      { cwd: consumer, env },
    );
    if (process.platform !== 'win32') {
      // FFmpeg dying mid-stream is reported with its exit code and stderr.
      const fake = join(consumer, 'fake-ffmpeg');
      await writeFile(
        fake,
        [
          '#!/bin/sh',
          'case "$*" in',
          '  *-version*) echo "ffmpeg version fake"; exit 0;;',
          '  *-encoders*) echo " V....D libx264  libx264 H.264"; exit 0;;',
          'esac',
          'head -c 4000000 > /dev/null',
          'echo "fake encoder crashed" >&2',
          'exit 3',
        ].join('\n') + '\n',
        { mode: 0o755 },
      );
      const crashed = await run(
        process.execPath,
        [relgraph, 'render', 'biology-signaling-synthetic.json'].concat(
          ['--out', 'crash.mp4', '--ffmpeg', fake, '--frame-spec', 'landscape-720p'],
          ['--to', '23'],
        ),
        { cwd: consumer, env },
      ).then(
        () => assert.fail('render must fail when FFmpeg exits early'),
        (error) => error,
      );
      assert.equal(crashed.code, 1);
      assert.match(crashed.stderr, /退出码 3/);
      assert.match(crashed.stderr, /fake encoder crashed/);
    }
    for (const file of ['frames/024/frame.png', 'frames/025/frame.png']) {
      const png = await readFile(join(consumer, file));
      assert.equal(png.subarray(1, 4).toString('latin1'), 'PNG');
      assert.equal(png.readUInt32BE(16), 1280, `${file} width`);
      assert.equal(png.readUInt32BE(20), 720, `${file} height`);
    }

    await writeFile(
      join(consumer, 'typecheck.ts'),
      `
import { layoutGraph, type VisualGraph, type DirectorFrameState, type GraphDoc } from '@relgraph/core';
import { createCanvasRenderer } from '@relgraph/render';
declare const graph: VisualGraph;
declare const canvas: HTMLCanvasElement;
declare const source: GraphDoc;
const state: DirectorFrameState = createCanvasRenderer(canvas, graph, layoutGraph(graph)).renderFrame(0);
void state;
// @ts-expect-error A frame index must be numeric.
createCanvasRenderer(canvas, graph, layoutGraph(graph)).renderFrame('0');
// @ts-expect-error The schema version is fixed.
source.schemaVersion = '1.0';
`,
    );
    await writeFile(
      join(consumer, 'tsconfig.json'),
      JSON.stringify({
        compilerOptions: {
          target: 'ES2022',
          module: 'NodeNext',
          moduleResolution: 'NodeNext',
          strict: true,
          noEmit: true,
          skipLibCheck: false,
          types: [],
        },
        include: ['typecheck.ts'],
      }),
    );
    const tsc = (project) =>
      run(process.execPath, [join(root, 'node_modules/typescript/bin/tsc'), '-p', project], {
        cwd: consumer,
        env,
      }).catch((error) => assert.fail(`${project} failed:\n${error.stdout}${error.stderr}`));
    await tsc('tsconfig.json');

    // The headless API in Node. skia-canvas's own declarations need sharp and
    // ES2025 typed arrays, so library checking is skipped for this project;
    // the consumer code and its expected errors are still checked.
    await writeFile(
      join(consumer, 'headless.ts'),
      `
import { layoutGraph, type VisualGraph } from '@relgraph/core';
import { createHeadlessRenderer, FILM_FONTS_DIR } from '@relgraph/render/skia';
import { parseCommand, renderFilm, type RenderSummary } from '@relgraph/cli';
declare const graph: VisualGraph;
const pixels: Uint8Array = createHeadlessRenderer(graph, layoutGraph(graph), { theme: 'light' }).rgbaAt(0);
const dir: string = FILM_FONTS_DIR;
const summary: Promise<RenderSummary> = renderFilm({ file: 'a.json', out: 'a.mp4', frameSpec: 'landscape-1080p', theme: 'light', locale: 'zh-CN', jobs: 2 });
void [pixels, dir, summary, parseCommand(['validate', 'a.json'])];
// @ts-expect-error Only the preset frame specs are accepted.
void renderFilm({ file: 'a.json', out: 'a.mp4', frameSpec: 'portrait', theme: 'light', locale: 'zh-CN', jobs: 2 });
// @ts-expect-error The film theme is light or dark.
void renderFilm({ file: 'a.json', out: 'a.mp4', frameSpec: 'landscape-1080p', theme: 'sepia', locale: 'zh-CN', jobs: 2 });
`,
    );
    await writeFile(
      join(consumer, 'tsconfig.headless.json'),
      JSON.stringify({
        compilerOptions: {
          target: 'ES2022',
          module: 'NodeNext',
          moduleResolution: 'NodeNext',
          strict: true,
          noEmit: true,
          skipLibCheck: true,
          types: ['node'],
        },
        include: ['headless.ts'],
      }),
    );
    await tsc('tsconfig.headless.json');
  } finally {
    await rm(temp, { recursive: true, force: true });
  }
}, 60000);
