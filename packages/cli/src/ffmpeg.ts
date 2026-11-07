import { execFile, spawn, type ChildProcessByStdio } from 'node:child_process';
import { constants } from 'node:fs';
import { access } from 'node:fs/promises';
import { delimiter, join } from 'node:path';
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
    if (!(await executable(explicit)))
      throw new FfmpegError(`--ffmpeg 指定的文件不存在或不可执行：${explicit}\n${INSTALL_HINT}`);
    path = explicit;
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
    'scale=out_color_matrix=bt709:out_range=tv,format=yuv420p',
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
