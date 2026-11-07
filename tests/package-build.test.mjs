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
  const packs = join(temp, 'packs');
  const consumer = join(temp, 'consumer');
  try {
    await mkdir(builder, { recursive: true });
    await mkdir(packs);
    await mkdir(consumer);
    await copySource(join(root, 'packages/core'), core);
    await copySource(join(root, 'packages/render'), render);
    // The builds have their own configs. Render resolves the built core package,
    // just as a workspace install would, without accessing the repository source.
    await mkdir(join(builder, 'node_modules/@relgraph'), { recursive: true });
    await symlink(core, join(builder, 'node_modules/@relgraph/core'), 'junction');
    await runNpm(['run', 'build'], { cwd: core, env });
    await runNpm(['run', 'build'], { cwd: render, env });

    const originalSchema = JSON.parse(
      await readFile(join(core, 'schema/relationship-graph.schema.json'), 'utf8'),
    );
    const builtSchema = JSON.parse(
      await readFile(join(core, 'dist/schema/relationship-graph.schema.json'), 'utf8'),
    );
    assert.deepEqual(builtSchema, originalSchema);

    const tarballs = [];
    for (const path of [core, render]) {
      const { stdout } = await runNpm(
        ['pack', '--ignore-scripts', '--json', '--pack-destination', packs],
        { cwd: path, env },
      );
      const [info] = JSON.parse(stdout);
      tarballs.push(join(packs, info.filename));
      assert.ok(info.files.some((file) => file.path.endsWith('.d.ts')));
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
import { loadDocument, layoutGraph, frameCount, directorFrameAt, validateRelGraph } from '@relgraph/core';
import { createCanvasRenderer, VIDEO_WIDTH } from '@relgraph/render';
const read = async (path) => JSON.parse(await readFile(new URL(path, import.meta.url), 'utf8'));
assert.deepEqual(schema, await read('./source-schema.json'));
assert.equal(VIDEO_WIDTH, 1280);
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
  if (domain === 'literature') {
    doc.schemaVersion = 'invalid';
    assert.equal(validateRelGraph(doc).valid, false);
  }
}
await assert.rejects(import('@relgraph/core/src/graph/core.js'), { code: 'ERR_PACKAGE_PATH_NOT_EXPORTED' });
`,
    );
    await run(process.execPath, ['check.mjs'], { cwd: consumer, env });

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
    await run(
      process.execPath,
      [join(root, 'node_modules/typescript/bin/tsc'), '-p', 'tsconfig.json'],
      { cwd: consumer, env },
    );
  } finally {
    await rm(temp, { recursive: true, force: true });
  }
}, 60000);
