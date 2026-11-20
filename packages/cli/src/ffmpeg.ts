import { execFile, spawn, type ChildProcessByStdio } from 'node:child_process';
import { constants } from 'node:fs';
import { access } from 'node:fs/promises';
import { delimiter, join, resolve } from 'node:path';
import type { Readable, Writable } from 'node:stream';
import { promisify } from 'node:util';

const run = promisify(execFile);

export class FfmpegError extends Error {}

const INSTALL_HINT = [
  '安装 FFmpeg 后重试：',
  '  macOS：brew install ffmpeg',
  '  Debian / Ubuntu：sudo apt install ffmpeg',
  '  Windows：winget install Gyan.FFmpeg',
  '或用 --ffmpeg <path> 指定可执行文件，或改用 --frames out/%05d.png 只导出 PNG 帧。',
].join('\n');

async function executable(path: string): Promise<boolean> {
  try {
    await access(path, process.platform === 'win32' ? constants.F_OK : constants.X_OK);
    return true;
  } catch {
    return false;
  }
}

/** Find FFmpeg on PATH (or use `explicit`) and check that it has libx264. */
export async function findFfmpeg(explicit?: string): Promise<{ path: string; version: string }> {
  let path: string | undefined;
  if (explicit !== undefined) {
    // Check and run the same file: a bare name such as `custom-ffmpeg` is
    // relative to the working directory, whereas spawning it would search PATH.
    const resolved = resolve(explicit);
    if (!(await executable(resolved)))
      throw new FfmpegError(`--ffmpeg 指定的文件不存在或不可执行：${explicit}\n${INSTALL_HINT}`);
    path = resolved;
  } else {
    const names =
      process.platform === 'win32'
        ? (process.env.PATHEXT ?? '.EXE;.CMD;.BAT')
            .split(';')
            .filter(Boolean)
            .map((ext) => `ffmpeg${ext.toLowerCase()}`)
        : ['ffmpeg'];
    search: for (const dir of (process.env.PATH ?? '').split(delimiter).filter(Boolean))
      for (const name of names)
        if (await executable(join(dir, name))) {
          path = join(dir, name);
          break search;
        }
    if (!path) throw new FfmpegError(`找不到 FFmpeg：PATH 中没有 ffmpeg。\n${INSTALL_HINT}`);
  }
  let version: string, encoders: string;
  try {
    version = (await run(path, ['-hide_banner', '-version'])).stdout.split('\n')[0] ?? '';
    encoders = (await run(path, ['-hide_banner', '-encoders'], { maxBuffer: 8 << 20 })).stdout;
  } catch (error) {
    throw new FfmpegError(
      `无法运行 FFmpeg（${path}）：${error instanceof Error ? error.message : String(error)}\n${INSTALL_HINT}`,
    );
  }
  if (!/^\s*V\S*\s+libx264\s/m.test(encoders))
    throw new FfmpegError(
      `${path} 没有 libx264 编码器，无法输出 H.264 MP4。请安装包含 libx264 的 FFmpeg 构建。`,
    );
  return { path, version };
}

export interface EncodeSettings {
  width: number;
  height: number;
  fps: number;
  out: string;
}

/**
 * FFmpeg arguments for raw RGBA frames on stdin → H.264 MP4. The input is
 * sRGB; it is converted with the BT.709 matrix to limited-range 4:2:0 and
 * tagged BT.709 so players decode the intended colours. The output frame rate
 * equals the input rate, so every rendered frame becomes one video frame.
 */
export function encodeArgs({ width, height, fps, out }: EncodeSettings): string[] {
  return [
    '-hide_banner',
    '-loglevel',
    'error',
    '-y',
    '-f',
    'rawvideo',
    '-pixel_format',
    'rgba',
    '-video_size',
    `${width}x${height}`,
    '-framerate',
    String(fps),
    '-i',
    'pipe:0',
    '-an',
    '-vf',
    // FFmpeg 7 can forward unspecified frame primaries/transfer over the
    // output codec tags. Tag the converted frames as well as the stream.
    'scale=out_color_matrix=bt709:out_range=tv,format=yuv420p,setparams=color_primaries=bt709:color_trc=bt709:colorspace=bt709:range=limited',
    '-c:v',
    'libx264',
    '-preset',
    'medium',
    '-crf',
    '16',
    '-pix_fmt',
    'yuv420p',
    '-r',
    String(fps),
    '-colorspace',
    'bt709',
    '-color_primaries',
    'bt709',
    '-color_trc',
    'bt709',
    '-color_range',
    'tv',
    '-movflags',
    '+faststart',
    out,
  ];
}

export type Encoder = ChildProcessByStdio<Writable, null, Readable>;

export function startEncoder(ffmpeg: string, settings: EncodeSettings): Encoder {
  if (settings.width % 2 || settings.height % 2)
    throw new FfmpegError(`yuv420p 需要偶数尺寸，收到 ${settings.width}×${settings.height}`);
  return spawn(ffmpeg, encodeArgs(settings), { stdio: ['pipe', 'ignore', 'pipe'] });
}

/** What `--audio` needs to know about a sound file before the film is rendered. */
export interface AudioProbe {
  /**
   * Where the first audio stream ends, in seconds from the start the mux
   * reads it at: the end of its last packet. Only when no packet has a
   * timestamp, the container's duration from the header; null without either.
   */
  durationSec: number | null;
  /** FFmpeg's description of the first audio stream, e.g. `pcm_s16le, 48000 Hz, stereo, s16, 1536 kb/s`. */
  stream: string;
}

/**
 * Parse the input description FFmpeg prints for `-i file`: the first audio
 * stream, and the container's `Duration`, which covers every stream (a
 * video file's picture may outlast its sound), so it is only a fallback.
 */
export function parseAudioProbe(stderr: string): AudioProbe | null {
  // Only the input's description: the copy to nothing describes its output too.
  const output = stderr.search(/^Output #/m);
  const input = output < 0 ? stderr : stderr.slice(0, output);
  const stream = /^\s*Stream #\d+:\d+.*?: Audio: (.*)$/m.exec(input)?.[1]?.trim();
  if (stream === undefined) return null;
  const time = /Duration: (\d+):(\d{2}):(\d{2}(?:\.\d+)?)/.exec(input);
  return {
    durationSec: time ? Number(time[1]) * 3600 + Number(time[2]) * 60 + Number(time[3]) : null,
    stream,
  };
}

/**
 * The end of a stream from FFmpeg's `framecrc` listing of its packets
 * (`#tb 0: 1/48000`, then `0, dts, pts, duration, size, crc`): the latest
 * pts + duration, in seconds; null when no packet has both.
 */
export function framecrcEndSec(lines: Iterable<string>): number | null {
  let base: [number, number] | null = null;
  let end: number | null = null;
  for (const line of lines) {
    const tb = /^#tb 0: (\d+)\/(\d+)/.exec(line);
    if (tb) base = [Number(tb[1]), Number(tb[2])];
    const packet = /^0,\s*-?\d+,\s*(-?\d+),\s*(\d+),/.exec(line);
    if (!packet || !base) continue;
    const stop = Number(packet[1]) + Number(packet[2]);
    if (end === null || stop > end) end = stop;
  }
  return end === null || !base ? null : (end * base[0]) / base[1];
}

/** Check that FFmpeg can read an audio stream from `file`, and where it ends. */
export async function probeAudio(ffmpeg: string, file: string): Promise<AudioProbe> {
  // List the first audio stream's packets: fails unless it can be read. The
  // listing goes through the same input timestamp offset as the mux.
  const child = spawn(
    ffmpeg,
    ['-hide_banner', '-nostdin', '-i', file, '-map', '0:a:0', '-c', 'copy', '-f', 'framecrc', '-'],
    { stdio: ['ignore', 'pipe', 'pipe'] },
  );
  let stderr = '';
  child.stderr.setEncoding('utf8').on('data', (chunk: string) => {
    if (stderr.length < 1 << 20) stderr += chunk;
  });
  // Keep the timing, not the listing: one line per packet adds up for long files.
  let base = '',
    pending = '',
    end: number | null = null;
  const take = (line: string): void => {
    if (line.startsWith('#tb 0:')) base = line;
    else if (base && line.startsWith('0,')) {
      const stop = framecrcEndSec([base, line]);
      if (stop !== null && (end === null || stop > end)) end = stop;
    }
  };
  child.stdout
    .setEncoding('utf8')
    .on('data', (chunk: string) => {
      const lines = (pending + chunk).split('\n');
      pending = lines.pop() ?? '';
      lines.forEach(take);
    })
    .on('end', () => take(pending));
  const code = await new Promise<number | null>((resolveExit, rejectExit) => {
    child.on('error', rejectExit);
    child.on('close', resolveExit);
  }).catch((error: Error) => {
    throw new FfmpegError(`无法运行 FFmpeg 读取 --audio 文件：${error.message}`);
  });
  if (code !== 0)
    throw new FfmpegError(`FFmpeg 读不出 --audio 文件中的音轨：${file}\n${stderr.trim()}`);
  const probe = parseAudioProbe(stderr);
  if (!probe) throw new FfmpegError(`--audio 文件中没有音轨：${file}`);
  return end === null ? probe : { ...probe, durationSec: end };
}

export interface MuxSettings {
  /** The MP4 that `encodeArgs` wrote. */
  video: string;
  audio: string;
  out: string;
  /** Where in the sound file the video starts: the first rendered frame's time. */
  offsetSec: number;
  /** The video's length; the sound is cut or padded with silence to it. */
  durationSec: number;
}

/**
 * FFmpeg arguments that add a sound file to an encoded MP4 as AAC. The video
 * stream is copied, not re-encoded, so its frames decode exactly as they do
 * without sound. The output lasts as long as the video: a longer sound is
 * cut, a shorter one ends in silence (`apad`).
 */
export function muxArgs({ video, audio, out, offsetSec, durationSec }: MuxSettings): string[] {
  return [
    '-hide_banner',
    '-loglevel',
    'error',
    '-nostdin',
    '-y',
    '-i',
    video,
    ...(offsetSec > 0 ? ['-ss', offsetSec.toFixed(6)] : []),
    '-i',
    audio,
    '-map',
    '0:v:0',
    '-map',
    '1:a:0',
    '-c:v',
    'copy',
    '-af',
    'apad',
    '-c:a',
    'aac',
    '-b:a',
    '192k',
    '-t',
    durationSec.toFixed(6),
    '-movflags',
    '+faststart',
    out,
  ];
}

/** Run `muxArgs`; FFmpeg's own message on failure. */
export async function muxAudio(ffmpeg: string, settings: MuxSettings): Promise<void> {
  try {
    await run(ffmpeg, muxArgs(settings), { maxBuffer: 8 << 20 });
  } catch (error) {
    const detail = (error as { stderr?: string }).stderr?.trim() || String(error);
    throw new FfmpegError(`FFmpeg 混入音轨失败：\n${detail}`);
  }
}

/**
 * A warning when the sound does not last as long as the video (from the
 * first rendered frame on), by more than a frame; null otherwise.
 */
export function audioLengthWarning(
  probe: AudioProbe,
  { offsetSec, durationSec, fps }: { offsetSec: number; durationSec: number; fps: number },
): string | null {
  if (probe.durationSec === null)
    return `警告：无法从 --audio 文件读出时长；成片以视频长度 ${durationSec.toFixed(3)} 秒为准，音轨过长截断、过短补静音。\n`;
  // A sound that ends before the first rendered frame leaves the whole video silent.
  const available = Math.max(0, probe.durationSec - offsetSec);
  const difference = available - durationSec;
  if (Math.abs(difference) <= 1 / fps) return null;
  const from = offsetSec > 0 ? `（从第 ${offsetSec.toFixed(3)} 秒起）` : '';
  return difference > 0
    ? `警告：音轨${from}比视频长 ${difference.toFixed(3)} 秒（${available.toFixed(3)} / ${durationSec.toFixed(3)} 秒），超出部分截掉。\n`
    : `警告：音轨${from}比视频短 ${(-difference).toFixed(3)} 秒（${available.toFixed(3)} / ${durationSec.toFixed(3)} 秒），结尾补静音。\n`;
}
