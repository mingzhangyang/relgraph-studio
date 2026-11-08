import { availableParallelism } from 'node:os';
import { parseArgs } from 'node:util';
import { LOCALES, type Locale } from '@relgraph/core';
import { FRAME_SPECS, type FrameSpecName } from '@relgraph/render';
import { isFramePattern } from './frames.js';

export const defaultJobs = (): number => Math.max(1, Math.min(availableParallelism(), 8));

export const USAGE = `用法：
  relgraph validate <file> [--json]
  relgraph layout <file> [--seed N] [--write | --out output.json]
  relgraph render <file> (--out film.mp4 | --frames out/%05d.png) [选项]

layout 选项：
  --seed <N>             无符号 32 位整数，固定种子（默认 0）
  --write                验证后原子写回原文件；默认仅预览，不修改
  --out <file.json>      写入新文件；目标已存在时拒绝覆盖

render 选项：
  --out <file.mp4>        用 FFmpeg 编码为 H.264 MP4（yuv420p，BT.709）
  --frames <pattern>      每帧写一个 PNG；pattern 含 %d 或 %05d 形式的帧号
  --frame-spec <name>     画面规格：${Object.keys(FRAME_SPECS).join(' | ')}（默认 landscape-1080p）
  --theme <light|dark>    影片主题（默认 light，与工作台主题无关）
  --locale <${LOCALES.join('|')}>     渲染器文案语言（默认 zh-CN）
  --from <N> --to <M>     只渲染第 N 到第 M 帧（含两端，从 0 起）
  --jobs <N>              并行渲染的线程数（默认 ${defaultJobs()}）
  --ffmpeg <path>         FFmpeg 可执行文件（默认在 PATH 中查找）

其他：
  relgraph --help | --version`;

export class UsageError extends Error {}

export interface ValidateCommand {
  command: 'validate';
  file: string;
  json: boolean;
}
export interface LayoutCommand {
  command: 'layout';
  file: string;
  seed: number;
  write: boolean;
  out?: string;
}
export interface RenderCommand {
  command: 'render';
  file: string;
  out?: string;
  frames?: string;
  frameSpec: FrameSpecName;
  theme: 'light' | 'dark';
  locale: Locale;
  from?: number;
  to?: number;
  jobs: number;
  ffmpeg?: string;
}
export type Command =
  ValidateCommand | LayoutCommand | RenderCommand | { command: 'help' } | { command: 'version' };

function integer(name: string, value: string | undefined, min: number): number | undefined {
  if (value === undefined) return undefined;
  if (!/^\d+$/.test(value) || Number(value) < min)
    throw new UsageError(`--${name} 需要不小于 ${min} 的整数，收到 ${JSON.stringify(value)}`);
  return Number(value);
}

function oneOf<T extends string>(name: string, value: string, allowed: readonly T[]): T {
  if (!(allowed as readonly string[]).includes(value))
    throw new UsageError(`--${name} 只能是 ${allowed.join(' | ')}，收到 ${JSON.stringify(value)}`);
  return value as T;
}

/** Parse `relgraph` arguments; throws `UsageError` with a message for the user. */
export function parseCommand(argv: readonly string[]): Command {
  const [command, ...rest] = argv;
  if (command === undefined || command === '--help' || command === '-h' || command === 'help')
    return { command: 'help' };
  if (command === '--version' || command === '-v') return { command: 'version' };
  if (command !== 'validate' && command !== 'layout' && command !== 'render')
    throw new UsageError(`未知命令 ${JSON.stringify(command)}`);
  let parsed;
  try {
    parsed = parseArgs({
      args: [...rest],
      allowPositionals: true,
      strict: true,
      options:
        command === 'validate'
          ? { json: { type: 'boolean', default: false } }
          : command === 'layout'
            ? {
                seed: { type: 'string', default: '0' },
                write: { type: 'boolean', default: false },
                out: { type: 'string' },
              }
            : {
              out: { type: 'string' },
              frames: { type: 'string' },
              'frame-spec': { type: 'string', default: 'landscape-1080p' },
              theme: { type: 'string', default: 'light' },
              locale: { type: 'string', default: 'zh-CN' },
              from: { type: 'string' },
              to: { type: 'string' },
              jobs: { type: 'string' },
              ffmpeg: { type: 'string' },
            },
    });
  } catch (error) {
    throw new UsageError(error instanceof Error ? error.message : String(error));
  }
  const { values, positionals } = parsed;
  if (positionals.length !== 1) throw new UsageError(`${command} 需要且只需要一个文件参数`);
  const file = positionals[0];
  if (command === 'validate') return { command, file, json: values.json === true };
  if (command === 'layout') {
    const seedValue = values.seed;
    if (typeof seedValue !== 'string' || !/^\d+$/.test(seedValue) || Number(seedValue) > 0xffffffff)
      throw new UsageError('--seed 需要 0–4294967295 之间的整数');
    const out = typeof values.out === 'string' ? values.out : undefined;
    if (values.write && out !== undefined)
      throw new UsageError('layout 的 --write 和 --out 不能同时使用');
    if (out === '') throw new UsageError('--out 不能为空');
    return { command, file, seed: Number(seedValue), write: values.write === true, ...(out !== undefined ? { out } : {}) };
  }
  const str = (key: string): string | undefined => {
    const value = (values as Record<string, unknown>)[key];
    return typeof value === 'string' ? value : undefined;
  };
  const out = str('out'),
    frames = str('frames');
  if ((out === undefined) === (frames === undefined))
    throw new UsageError('render 需要 --out <file.mp4> 或 --frames <pattern> 二者之一');
  if (frames !== undefined && !isFramePattern(frames))
    throw new UsageError(
      `--frames 需要恰好一个帧号占位符，例如 out/%05d.png；收到 ${JSON.stringify(frames)}`,
    );
  if (out !== undefined && !/\.mp4$/i.test(out))
    throw new UsageError(`--out 只支持 .mp4 文件，收到 ${JSON.stringify(out)}`);
  const from = integer('from', str('from'), 0),
    to = integer('to', str('to'), 0);
  if (from !== undefined && to !== undefined && from > to)
    throw new UsageError(`--from ${from} 不能大于 --to ${to}`);
  return {
    command,
    file,
    ...(out !== undefined ? { out } : {}),
    ...(frames !== undefined ? { frames } : {}),
    frameSpec: oneOf(
      'frame-spec',
      str('frame-spec') ?? '',
      Object.keys(FRAME_SPECS) as FrameSpecName[],
    ),
    theme: oneOf('theme', str('theme') ?? '', ['light', 'dark'] as const),
    locale: oneOf('locale', str('locale') ?? '', LOCALES),
    ...(from !== undefined ? { from } : {}),
    ...(to !== undefined ? { to } : {}),
    jobs: integer('jobs', str('jobs'), 1) ?? defaultJobs(),
    ...(str('ffmpeg') !== undefined ? { ffmpeg: str('ffmpeg') } : {}),
  };
}
