// Outputs never overwrite the document, the sound or each other (ADR 004, D3
// review): `relgraph events g.json --out g.json` and `render … --events
// film.mp4` are refused before anything is written.
import { test } from 'vitest';
import assert from 'node:assert/strict';
import {
  linkSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  symlinkSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { exportEvents, EventsError } from '../packages/cli/src/events.ts';
import { renderFilm, RenderError } from '../packages/cli/src/render.ts';
import { main } from '../packages/cli/src/index.ts';
import { sameFile } from '../packages/cli/src/paths.ts';

const graph = JSON.stringify({
  format: 'relgraph.graph/1',
  edges: [{ source: '甲', target: '乙' }],
  presentation: [{ id: 'all', title: '全部', durationSec: 1 }],
});

function workspace() {
  const dir = mkdtempSync(join(tmpdir(), 'relgraph-paths-'));
  const file = join(dir, 'graph.json');
  writeFileSync(file, graph);
  return { dir, file };
}

test('sameFile sees through relative paths, symlinks and hard links', async () => {
  const { dir, file } = workspace();
  symlinkSync(file, join(dir, 'link.json'));
  linkSync(file, join(dir, 'hard.json'));
  mkdirSync(join(dir, 'sub'));
  symlinkSync(dir, join(dir, 'alias'));
  assert.equal(await sameFile(file, join(dir, 'sub', '..', 'graph.json')), true);
  assert.equal(await sameFile(file, join(dir, 'link.json')), true);
  assert.equal(await sameFile(file, join(dir, 'hard.json')), true);
  // Neither exists yet, but they are one place through the linked directory.
  assert.equal(await sameFile(join(dir, 'new.json'), join(dir, 'alias', 'new.json')), true);
  assert.equal(await sameFile(file, join(dir, 'other.json')), false);
});

test('relgraph events refuses to write over its input', async () => {
  const { dir, file } = workspace();
  symlinkSync(file, join(dir, 'link.json'));
  for (const out of [file, join(dir, '.', 'graph.json'), join(dir, 'link.json')])
    await assert.rejects(
      exportEvents({ file, frameSpec: 'landscape-1080p', out }),
      (error) =>
        error instanceof EventsError &&
        /^输入文件(（.*）)? 和 --out|^输入文件（.*）和 --out/.test(error.message),
    );
  assert.equal(readFileSync(file, 'utf8'), graph, 'the document is untouched');

  const err = [];
  const io = { stdout: () => undefined, stderr: (text) => err.push(text) };
  assert.equal(await main(['events', file, '--out', file], io), 1);
  assert.match(err.join(''), /^relgraph events：输入文件 和 --out 指向同一个文件/);
  assert.equal(readFileSync(file, 'utf8'), graph);
  // A different file is fine.
  assert.equal(await main(['events', file, '--out', join(dir, 'events.json')], io), 0);
});

test('relgraph render refuses outputs that alias the document, the sound or each other', async () => {
  const { dir, file } = workspace();
  const track = join(dir, 'track.wav');
  writeFileSync(track, 'not really audio');
  const base = { file, frameSpec: 'landscape-720p', theme: 'light', locale: 'zh-CN', jobs: 1 };
  const film = join(dir, 'film.mp4');
  for (const [request, pattern] of [
    [{ out: film, events: file }, /输入文件 和 --events/],
    [{ out: film, events: film }, /--out 和 --events/],
    [{ out: film, audio: track, events: track }, /--audio 和 --events/],
    [{ out: track, audio: track }, /--audio 和 --out/],
    [{ out: file }, /输入文件 和 --out/],
    // The first frame's file would be the events file.
    [{ frames: join(dir, '%d.json'), events: join(dir, '0.json'), to: 0 }, /--frames 和 --events/],
  ])
    await assert.rejects(
      renderFilm({ ...base, ...request }),
      (error) => error instanceof RenderError && pattern.test(error.message),
      JSON.stringify(request),
    );
  const frames = join(dir, 'frames', '%d.json');
  mkdirSync(join(dir, 'frames'));
  const inFrames = join(dir, 'frames', '0.json');
  writeFileSync(inFrames, graph);
  await assert.rejects(
    renderFilm({ ...base, file: inFrames, frames, to: 0 }),
    (error) => error instanceof RenderError && /--frames 和 输入文件/.test(error.message),
  );
  assert.equal(readFileSync(file, 'utf8'), graph);
  assert.equal(readFileSync(inFrames, 'utf8'), graph);
  assert.equal(readFileSync(track, 'utf8'), 'not really audio');
});

test('frame files are compared by identity, not by name', async () => {
  // `0.png` is the document (or the events file) under another name: writing
  // the frame through it would replace that file (review of #57).
  const base = { frameSpec: 'landscape-720p', theme: 'light', locale: 'zh-CN', jobs: 1, to: 0 };
  for (const link of ['symlink', 'hard link']) {
    const { dir, file } = workspace();
    (link === 'symlink' ? symlinkSync : linkSync)(file, join(dir, '0.png'));
    await assert.rejects(
      renderFilm({ ...base, file, frames: join(dir, '%d.png') }),
      (error) =>
        error instanceof RenderError && /--frames（.*0\.png）和 输入文件/.test(error.message),
      link,
    );
    assert.equal(readFileSync(file, 'utf8'), graph, `${link}: document untouched`);
    // Frame 5 of a longer range, too.
    (link === 'symlink' ? symlinkSync : linkSync)(file, join(dir, 'f5.png'));
    await assert.rejects(
      renderFilm({ ...base, file, frames: join(dir, 'f%d.png'), to: 9 }),
      (error) =>
        error instanceof RenderError &&
        /--frames（.*f5\.png）和 输入文件（.*graph\.json）/.test(error.message),
      `${link} at frame 5`,
    );
    assert.equal(readFileSync(file, 'utf8'), graph);
  }

  // The events file, linked under a frame's name, and a dangling symlink to
  // where the events file will be written.
  const { dir, file } = workspace();
  const events = join(dir, 'events.json');
  writeFileSync(events, '{}');
  linkSync(events, join(dir, '1.png'));
  await assert.rejects(
    renderFilm({ ...base, file, frames: join(dir, '%d.png'), to: 3, events }),
    (error) =>
      error instanceof RenderError && /--frames（.*1\.png）和 --events/.test(error.message),
  );
  const later = join(dir, 'later.json');
  symlinkSync(later, join(dir, 'g2.png'));
  await assert.rejects(
    renderFilm({ ...base, file, frames: join(dir, 'g%d.png'), to: 3, events: later }),
    (error) =>
      error instanceof RenderError && /--frames（.*g2\.png）和 --events/.test(error.message),
  );
  assert.equal(readFileSync(events, 'utf8'), '{}');
});

test('outputs that differ only in case count as one file until the file system says otherwise', async () => {
  // On Windows and default macOS `Film.mp4` and `film.mp4` are one file. Two
  // outputs that do not exist yet have no inode to compare, so names equal
  // but for case (or Unicode normalization) are refused everywhere (review of #57).
  const { dir, file } = workspace();
  assert.equal(await sameFile(join(dir, 'Film.mp4'), join(dir, 'film.mp4')), true);
  assert.equal(await sameFile(join(dir, 'NEW', 'a.json'), join(dir, 'new', 'A.json')), true);
  assert.equal(await sameFile(join(dir, 'caf\u00e9.json'), join(dir, 'cafe\u0301.json')), true);
  // Two existing files that differ in case are two files where the file
  // system keeps them apart (this one does): their inodes decide.
  writeFileSync(join(dir, 'Upper.txt'), 'a');
  writeFileSync(join(dir, 'upper.txt'), 'b');
  if (readFileSync(join(dir, 'Upper.txt'), 'utf8') === 'a')
    assert.equal(await sameFile(join(dir, 'Upper.txt'), join(dir, 'upper.txt')), false);

  const base = { file, frameSpec: 'landscape-720p', theme: 'light', locale: 'zh-CN', jobs: 1 };
  await assert.rejects(
    renderFilm({ ...base, out: join(dir, 'Film.mp4'), events: join(dir, 'film.mp4') }),
    (error) =>
      error instanceof RenderError &&
      /--out（.*Film\.mp4）和 --events（.*film\.mp4）只差大小写/.test(error.message),
  );
  await assert.rejects(
    renderFilm({ ...base, frames: join(dir, 'F%d.png'), to: 0, events: join(dir, 'f0.PNG') }),
    (error) =>
      error instanceof RenderError && /--frames（.*F0\.png）和 --events/.test(error.message),
  );
  await assert.rejects(
    exportEvents({ file, frameSpec: 'landscape-1080p', out: join(dir, 'GRAPH.json') }),
    (error) => error instanceof EventsError && /只差大小写/.test(error.message),
  );
  assert.equal(readFileSync(file, 'utf8'), graph);
  for (const name of ['Film.mp4', 'film.mp4', 'f0.PNG', 'F0.png'])
    assert.throws(() => readFileSync(join(dir, name)), { code: 'ENOENT' }, `${name} not written`);
});
