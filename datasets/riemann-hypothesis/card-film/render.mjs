// Render film.html frame by frame (window.setTime) to an H.264 MP4 with FFmpeg.
//   node render.mjs <out.mp4> [--audio track.m4a] [--fps 24] [--jobs 4] [--stills t1,t2,...]
// With --stills, writes PNGs of those seconds next to <out> instead of a film.
import { chromium } from 'playwright';
import { spawn } from 'node:child_process';
import { mkdtempSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
const args = process.argv.slice(2);
const opt = (name, dflt) => {
  const i = args.indexOf(name);
  return i < 0 ? dflt : args[i + 1];
};
const out = path.resolve(args[0]);
const fps = Number(opt('--fps', 24));
const jobs = Number(opt('--jobs', 4));
const audio = opt('--audio', null);
const stills = opt('--stills', null);

const run = (cmd, argv, input) =>
  new Promise((resolve, reject) => {
    const p = spawn(cmd, argv, { stdio: [input ? 'pipe' : 'ignore', 'ignore', 'inherit'] });
    p.on('error', reject);
    p.on('close', (code) => (code === 0 ? resolve() : reject(new Error(`${cmd} exited ${code}`))));
    if (input) input(p.stdin);
  });

async function openPage(browser) {
  const page = await browser.newPage({
    viewport: { width: 1080, height: 1920 },
    deviceScaleFactor: 1,
  });
  await page.goto(pathToFileURL(path.join(here, 'film.html')).href);
  const total = await page.evaluate(() => window.ready);
  return { page, total };
}

const browser = await chromium.launch();
if (stills) {
  const { page } = await openPage(browser);
  for (const s of stills.split(',').map(Number)) {
    await page.evaluate((t) => window.setTime(t), s);
    const file = out.replace(/\.mp4$/, '') + `-t${String(s).padStart(5, '0')}.png`;
    await page.screenshot({ path: file });
    console.log(file);
  }
  await browser.close();
  process.exit(0);
}

const probe = await openPage(browser);
const frames = Math.round(probe.total * fps);
await probe.page.close();
const work = mkdtempSync(path.join(tmpdir(), 'rh-card-film-'));
const per = Math.ceil(frames / jobs);
const started = Date.now();
const segments = await Promise.all(
  Array.from({ length: jobs }, async (_, j) => {
    const from = j * per,
      to = Math.min(frames, from + per);
    const seg = path.join(work, `seg${j}.mp4`);
    const { page } = await openPage(browser);
    await run(
      'ffmpeg',
      [
        '-loglevel',
        'error',
        '-y',
        '-f',
        'image2pipe',
        '-framerate',
        String(fps),
        '-c:v',
        'png',
        '-i',
        '-',
        '-c:v',
        'libx264',
        '-preset',
        'medium',
        '-crf',
        '18',
        '-pix_fmt',
        'yuv420p',
        '-colorspace',
        'bt709',
        '-color_primaries',
        'bt709',
        '-color_trc',
        'bt709',
        seg,
      ],
      async (stdin) => {
        for (let f = from; f < to; f++) {
          await page.evaluate((t) => window.setTime(t), f / fps);
          const png = await page.screenshot({ type: 'png' });
          if (!stdin.write(png)) await new Promise((r) => stdin.once('drain', r));
          if (j === 0 && f % 240 === 0)
            console.log(
              `worker 0: frame ${f}/${to} · ${((Date.now() - started) / 1000).toFixed(0)} s`,
            );
        }
        stdin.end();
      },
    );
    await page.close();
    return seg;
  }),
);
await browser.close();
const list = path.join(work, 'list.txt');
writeFileSync(list, segments.map((s) => `file '${s}'`).join('\n'));
const mux = ['-loglevel', 'error', '-y', '-f', 'concat', '-safe', '0', '-i', list];
if (audio)
  mux.push(
    '-i',
    path.resolve(audio),
    '-map',
    '0:v',
    '-map',
    '1:a',
    '-c:a',
    'aac',
    '-b:a',
    '192k',
    '-shortest',
  );
mux.push('-c:v', 'copy', '-movflags', '+faststart', out);
await run('ffmpeg', mux);
rmSync(work, { recursive: true, force: true });
console.log(
  `${out}: ${frames} frames at ${fps} fps in ${((Date.now() - started) / 1000).toFixed(0)} s`,
);
