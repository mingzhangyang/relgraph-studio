import { mkdir } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { Worker } from 'node:worker_threads';
import { frameCount, layoutGraph, type Locale } from '@relgraph/core';
import { frameSpecFor, type FrameSpecName } from '@relgraph/render';
import { uncoveredCharacters } from '@relgraph/render/skia';
import { documentStrings, formatDiagnostics, loadFile } from './document.js';
import { findFfmpeg, FfmpegError, startEncoder } from './ffmpeg.js';
import { frameFile, isFramePattern } from './frames.js';
import type { WorkerData, WorkerReply, WorkerRequest } from './worker.js';

/** Inputs that, with the document and frame index, determine every pixel. */
export interface FilmSettings {
  frameSpec: FrameSpecName;
  theme: 'light' | 'dark';
  locale: Locale;
}

export interface RenderRequest extends FilmSettings {
  file: string;
  /** MP4 output; exactly one of `out` and `frames` is required. */
  out?: string;
  /** PNG pattern such as `out/%05d.png`. */
  frames?: string;
  /** First and last frame, inclusive; default the whole film. */
  from?: number;
  to?: number;
  jobs: number;
  ffmpeg?: string;
  /** Progress and warnings; defaults to silence. */
  log?: (message: string) => void;
  progress?: (done: number, total: number) => void;
}

export interface RenderSummary {
  /** Frames of the whole film, `frameCount(graph, fps)`. */
  filmFrames: number;
  first: number;
  last: number;
  frames: number;
  width: number;
  height: number;
  fps: number;
  out?: string;
  pattern?: string;
  ffmpeg?: string;
  uncovered: string[];
  seconds: number;
}

/** A user-facing failure; `main` prints the message without a stack. */
export class RenderError extends Error {}

class RenderThread {
  private readonly worker: Worker;
  private readonly exited: Promise<void>;
  private readonly pending: { resolve(reply: WorkerReply): void; reject(error: Error): void }[] =
    [];
  private failure: Error | null = null;

  constructor(data: WorkerData) {
    this.worker = new Worker(new URL('./worker.js', import.meta.url), { workerData: data });
    this.exited = new Promise((resolveExit) => this.worker.once('exit', () => resolveExit()));
    this.worker.on('message', (reply: WorkerReply) => {
      if ('error' in reply) {
        const error = new RenderError(
          `渲染线程失败${reply.frame === undefined ? '' : `（第 ${reply.frame} 帧）`}：${reply.error}`,
        );
        if (reply.frame === undefined) this.fail(error);
        else this.pending.shift()?.reject(error);
      } else this.pending.shift()?.resolve(reply);
    });
    this.worker.on('error', (error) => this.fail(error));
    this.worker.on('exit', (code) => {
      if (this.pending.length) this.fail(new RenderError(`渲染线程意外退出（${code}）`));
    });
  }
  private fail(error: Error): void {
    this.failure ??= error;
    for (const job of this.pending.splice(0)) job.reject(this.failure);
  }
  render(frame: number): Promise<WorkerReply> {
    if (this.failure) return Promise.reject(this.failure);
    return new Promise((resolveJob, rejectJob) => {
      this.pending.push({ resolve: resolveJob, reject: rejectJob });
      this.worker.postMessage({ frame } satisfies WorkerRequest);
    });
  }
  async close(): Promise<void> {
    // Preserve the worker's FIFO: finish queued native Skia calls before
    // closing its port. terminate() can interrupt Neon inside a V8 call and
    // abort the entire process instead of reporting the original encoder error.
    this.worker.postMessage({ stop: true } satisfies WorkerRequest);
    await this.exited;
  }
}

/**
 * Render frames in parallel and hand them back in frame order. Frames are
 * assigned round-robin and at most `2 × jobs` are in flight, which bounds the
 * memory held for reordering.
 */
async function renderInOrder(
  data: WorkerData,
  frames: readonly number[],
  jobs: number,
  onFrame: (frame: number, reply: WorkerReply) => Promise<void>,
): Promise<void> {
  const threads = Array.from(
    { length: Math.max(1, Math.min(jobs, frames.length)) },
    () => new RenderThread(data),
  );
  try {
    const window = threads.length * 2;
    const replies: Promise<WorkerReply>[] = [];
    let launched = 0;
    const launch = (): void => {
      const index = launched++;
      const reply = threads[index % threads.length].render(frames[index]);
      // Awaited in order below; avoid unhandled-rejection noise meanwhile.
      reply.catch(() => undefined);
      replies[index] = reply;
    };
    while (launched < Math.min(window, frames.length)) launch();
    for (let index = 0; index < frames.length; index += 1) {
      const reply = await replies[index];
      delete replies[index];
      if (launched < frames.length) launch();
      await onFrame(frames[index], reply);
    }
  } finally {
    await Promise.all(threads.map((thread) => thread.close()));
  }
}

/** Render a document to an MP4 or a PNG sequence without a browser. */
export async function renderFilm(request: RenderRequest): Promise<RenderSummary> {
  const started = performance.now();
  const log = request.log ?? (() => undefined);
  if ((request.out === undefined) === (request.frames === undefined))
    throw new RenderError('需要 out 或 frames 二者之一');
  if (request.frames !== undefined && !isFramePattern(request.frames))
    throw new RenderError(
      `--frames 需要恰好一个帧号占位符，例如 out/%05d.png；收到 ${request.frames}`,
    );
  // The CLI validates these too; the exported API must not trust its callers.
  for (const [name, value, min] of [
    ['from', request.from, 0],
    ['to', request.to, 0],
    ['jobs', request.jobs, 1],
  ] as const)
    if (value !== undefined && !(Number.isSafeInteger(value) && value >= min))
      throw new RenderError(`${name} 需要不小于 ${min} 的整数，收到 ${String(value)}`);
  const { text, result } = await loadFile(request.file);
  if (!result.valid) throw new RenderError(`${formatDiagnostics(result)}文档校验失败，未渲染。`);
  if (result.warnings.length) log(formatDiagnostics({ errors: [], warnings: result.warnings }));
  const graph = result.graph;
  const spec = frameSpecFor(request.frameSpec);
  const fps = spec.fps;
  const filmFrames = frameCount(graph, fps);
  const first = request.from ?? 0;
  const last = request.to ?? filmFrames - 1;
  if (first > last || last >= filmFrames)
    throw new RenderError(
      `帧范围 ${first}–${last} 超出影片范围 0–${filmFrames - 1}（共 ${filmFrames} 帧）`,
    );
  // Layout runs here too so a document the threads cannot lay out fails early.
  layoutGraph(graph);
  const uncovered = uncoveredCharacters(documentStrings(JSON.parse(text)));
  if (uncovered.length)
    log(
      `警告：内置字体不含这些字符，它们会用系统字体绘制，画面在不同机器上可能不同：${uncovered.join('')}\n`,
    );

  const frames = Array.from({ length: last - first + 1 }, (_, i) => first + i);
  const settings: FilmSettings = {
    frameSpec: request.frameSpec,
    theme: request.theme,
    locale: request.locale,
  };
  let done = 0;
  const tick = (): void => request.progress?.(++done, frames.length);
  const summary = {
    filmFrames,
    first,
    last,
    frames: frames.length,
    width: spec.width,
    height: spec.height,
    fps,
    uncovered,
  };

  if (request.frames !== undefined) {
    const pattern = resolve(request.frames);
    // The frame number may sit in a directory name (out/%03d/frame.png), so
    // create every directory the range writes to, not just the first.
    for (const dir of new Set(frames.map((frame) => dirname(frameFile(pattern, frame)))))
      await mkdir(dir, { recursive: true });
    await renderInOrder({ ...settings, text, pattern }, frames, request.jobs, async () => tick());
    return { ...summary, pattern, seconds: (performance.now() - started) / 1000 };
  }

  const out = resolve(request.out ?? '');
  let ffmpeg;
  try {
    ffmpeg = await findFfmpeg(request.ffmpeg);
  } catch (error) {
    if (error instanceof FfmpegError) throw new RenderError(error.message);
    throw error;
  }
  await mkdir(dirname(out), { recursive: true });
  const encoder = startEncoder(ffmpeg.path, { width: spec.width, height: spec.height, fps, out });
  let stderr = '';
  encoder.stderr.setEncoding('utf8').on('data', (chunk: string) => (stderr += chunk));
  const finished = new Promise<void>((resolveEncode, rejectEncode) => {
    encoder.on('error', (error) =>
      rejectEncode(new RenderError(`无法启动 FFmpeg：${error.message}`)),
    );
    encoder.on('close', (code) =>
      code === 0
        ? resolveEncode()
        : rejectEncode(new RenderError(`FFmpeg 编码失败（退出码 ${code}）：\n${stderr.trim()}`)),
    );
  });
  finished.catch(() => undefined);
  // A write error (EPIPE) means FFmpeg exited; `finished` reports why.
  encoder.stdin.on('error', () => undefined);
  // Wait until each frame is handed to FFmpeg before sending the next, so at
  // most one frame sits in the pipe buffer and nothing outlives its write.
  // Only a failed write consults `finished`, for FFmpeg's own error message.
  const write = (bytes: Uint8Array): Promise<void> =>
    new Promise((resolveWrite, rejectWrite) => {
      encoder.stdin.write(bytes, (error) => {
        if (!error) resolveWrite();
        else
          finished.then(
            () => rejectWrite(new RenderError(`FFmpeg 提前结束：${error.message}`)),
            (reason: unknown) => rejectWrite(reason),
          );
      });
    });
  try {
    await renderInOrder({ ...settings, text }, frames, request.jobs, async (frame, reply) => {
      if (!('pixels' in reply) || !reply.pixels)
        throw new RenderError(`第 ${frame} 帧没有像素数据`);
      await write(new Uint8Array(reply.pixels));
      tick();
    });
  } catch (error) {
    encoder.kill();
    throw error;
  }
  encoder.stdin.end();
  await finished;
  return {
    ...summary,
    out,
    ffmpeg: ffmpeg.version,
    seconds: (performance.now() - started) / 1000,
  };
}
