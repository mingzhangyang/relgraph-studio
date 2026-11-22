import { availableParallelism } from 'node:os';
import { parseArgs } from 'node:util';
import { LOCALES, type Locale } from '@relgraph/core';
import { FRAME_SPECS, type FrameSpecName } from '@relgraph/render';
import { isFramePattern } from './frames.js';

export const defaultJobs = (): number => Math.max(1, Math.min(availableParallelism(), 8));

export const USAGE = `用法：
  relgraph validate <file> [--json]
  relgraph layout <file> [--seed N] [--chronology-tolerance N] [--write | --out output.json]
  relgraph render <file> (--out film.mp4 | --frames out/%05d.png) [选项]
  relgraph check-labels <file> [--frame-spec <name>] [--locale <语言>] [--json]
  relgraph check-layout <file> [--frame-spec <name>] [--locale <语言>] [选项] [--json]
  relgraph events <file> [--frame-spec <name>] [--out events.json]

layout 选项：
  --seed <N>             无符号 32 位整数，固定种子（默认 0）
  --write                验证后原子写回原文件；默认仅预览，不修改
  --out <file.json>      写入新文件；目标已存在时拒绝覆盖
  --chronology-tolerance <N>
                         补全时保持横向时间先后：与已放置节点时间相差至少 N 的新节点，
                         较早者放在左侧（与 check-layout 的同名选项相同）；所有节点都没有坐标时，
                         按结构排出的布局若时间颠倒则报错、不写文件

render 选项：
  --out <file.mp4>        用 FFmpeg 编码为 H.264 MP4（yuv420p，BT.709）
  --frames <pattern>      每帧写一个 PNG；pattern 含 %d 或 %05d 形式的帧号
  --frame-spec <name>     画面规格：${Object.keys(FRAME_SPECS).join(' | ')}（默认 landscape-1080p）
                          时间轴方向只由工作台项目决定（config.view.timeAxis），不随规格变化，
                          也没有命令行开关；竖屏规格横向绘制时间轴时给出警告
  --theme <light|dark>    影片主题（默认 light，与工作台主题无关）
  --locale <${LOCALES.join('|')}>     渲染器文案语言（默认 zh-CN）
  --from <N> --to <M>     只渲染第 N 到第 M 帧（含两端，从 0 起）
  --jobs <N>              并行渲染的线程数（默认 ${defaultJobs()}）
  --ffmpeg <path>         FFmpeg 可执行文件（默认在 PATH 中查找）
  --fail-on-omitted-labels
                          镜头画面稳定后仍有标签放不下时，写出结果后以失败退出
  --audio <file>          用 FFmpeg 把现成的音轨（WAV 等）以 AAC 混入 MP4，只能与 --out 同用；
                          视频流与不带音轨时相同。以视频长度为准：音轨过长截断、过短补静音，
                          长度不一致时告警；只渲染部分帧时，音轨从第一帧的时刻起
  --events <file.json>    写出结果后，另写一份 relgraph.events/1 事件文件（同 relgraph events）

check-labels：不渲染，逐镜头检查画面稳定后（镜头切换和揭示动画结束之后）放不下的标签；
  每个镜头检查稳定段的首、中、末三帧，有省略时退出码为 1。--frame-spec 和 --locale 同 render。

check-layout：在同样的稳定帧中检查连线贴近或穿过它不连接的节点、节点彼此过挤；
  给出 --chronology-tolerance 时，再按存储的坐标检查时间先后是否颠倒（项目把时间轴设为竖向时，
  画面上看上下而非左右）。有问题时退出码为 1。
  --clearance <px>        连线与无关节点之间的最小间隙，720p 像素（默认 4；相接总会报告）
  --crowding <px>         两个节点图形之间的最小间隙，720p 像素（默认 2）
  --chronology-tolerance <N>
                          时间相差至少 N（领域时间单位）的两个节点，较早者必须画在左侧
                          （竖向时间轴为上方）

events：不渲染，导出 relgraph.events/1：镜头、字幕、节点和关系的出现、领域时间的变化，
  帧号与渲染完全一致，另附影片中出现过的节点表（标签、类型、分组、世界坐标）。
  默认写到标准输出；--out 写入文件（覆盖已有文件）。只有 --frame-spec 的帧率影响结果。

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
  chronologyTolerance?: number;
}
export interface CheckLabelsCommand {
  command: 'check-labels';
  file: string;
  frameSpec: FrameSpecName;
  locale: Locale;
  json: boolean;
}
export interface CheckLayoutCommand {
  command: 'check-layout';
  file: string;
  frameSpec: FrameSpecName;
  locale: Locale;
  json: boolean;
  clearance?: number;
  crowding?: number;
  chronologyTolerance?: number;
}
export interface EventsCommand {
  command: 'events';
  file: string;
  frameSpec: FrameSpecName;
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
  failOnOmittedLabels: boolean;
  audio?: string;
  events?: string;
}
export type Command =
  | ValidateCommand
  | LayoutCommand
  | RenderCommand
  | CheckLabelsCommand
  | CheckLayoutCommand
  | EventsCommand
  | { command: 'help' }
  | { command: 'version' };

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
  if (
    command !== 'validate' &&
    command !== 'layout' &&
    command !== 'render' &&
    command !== 'check-labels' &&
    command !== 'check-layout' &&
    command !== 'events'
  )
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
                'chronology-tolerance': { type: 'string' },
              }
            : command === 'check-labels'
              ? {
                  'frame-spec': { type: 'string', default: 'landscape-1080p' },
                  locale: { type: 'string', default: 'zh-CN' },
                  json: { type: 'boolean', default: false },
                }
              : command === 'check-layout'
                ? {
                    'frame-spec': { type: 'string', default: 'landscape-1080p' },
                    locale: { type: 'string', default: 'zh-CN' },
                    json: { type: 'boolean', default: false },
                    clearance: { type: 'string' },
                    crowding: { type: 'string' },
                    'chronology-tolerance': { type: 'string' },
                  }
                : command === 'events'
                  ? {
                      'frame-spec': { type: 'string', default: 'landscape-1080p' },
                      out: { type: 'string' },
                    }
                  : {
                      out: { type: 'string' },
                      audio: { type: 'string' },
                      events: { type: 'string' },
                      frames: { type: 'string' },
                      'frame-spec': { type: 'string', default: 'landscape-1080p' },
                      theme: { type: 'string', default: 'light' },
                      locale: { type: 'string', default: 'zh-CN' },
                      from: { type: 'string' },
                      to: { type: 'string' },
                      jobs: { type: 'string' },
                      ffmpeg: { type: 'string' },
                      'fail-on-omitted-labels': { type: 'boolean', default: false },
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
    const tolerance = (values as Record<string, unknown>)['chronology-tolerance'];
    if (typeof tolerance === 'string' && !/^\d+(\.\d+)?$/.test(tolerance))
      throw new UsageError(
        `--chronology-tolerance 需要不小于 0 的数，收到 ${JSON.stringify(tolerance)}`,
      );
    return {
      command,
      file,
      seed: Number(seedValue),
      write: values.write === true,
      ...(out !== undefined ? { out } : {}),
      ...(typeof tolerance === 'string' ? { chronologyTolerance: Number(tolerance) } : {}),
    };
  }
  const str = (key: string): string | undefined => {
    const value = (values as Record<string, unknown>)[key];
    return typeof value === 'string' ? value : undefined;
  };
  const frameSpec = (): FrameSpecName =>
    oneOf('frame-spec', str('frame-spec') ?? '', Object.keys(FRAME_SPECS) as FrameSpecName[]);
  if (command === 'check-layout') {
    const amount = (name: string): number | undefined => {
      const value = str(name);
      if (value === undefined) return undefined;
      if (!/^\d+(\.\d+)?$/.test(value))
        throw new UsageError(`--${name} 需要不小于 0 的数，收到 ${JSON.stringify(value)}`);
      return Number(value);
    };
    const clearance = amount('clearance'),
      crowding = amount('crowding'),
      chronologyTolerance = amount('chronology-tolerance');
    return {
      command,
      file,
      frameSpec: frameSpec(),
      locale: oneOf('locale', str('locale') ?? '', LOCALES),
      json: (values as Record<string, unknown>).json === true,
      ...(clearance !== undefined ? { clearance } : {}),
      ...(crowding !== undefined ? { crowding } : {}),
      ...(chronologyTolerance !== undefined ? { chronologyTolerance } : {}),
    };
  }
  if (command === 'events') {
    const out = str('out');
    if (out === '') throw new UsageError('--out 不能为空');
    return { command, file, frameSpec: frameSpec(), ...(out !== undefined ? { out } : {}) };
  }
  if (command === 'check-labels')
    return {
      command,
      file,
      frameSpec: frameSpec(),
      locale: oneOf('locale', str('locale') ?? '', LOCALES),
      json: (values as Record<string, unknown>).json === true,
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
  const audio = str('audio'),
    events = str('events');
  if (audio !== undefined && out === undefined)
    throw new UsageError('--audio 只能和 --out 一起使用：PNG 帧序列没有音轨');
  if (audio === '') throw new UsageError('--audio 不能为空');
  if (events === '') throw new UsageError('--events 不能为空');
  const from = integer('from', str('from'), 0),
    to = integer('to', str('to'), 0);
  if (from !== undefined && to !== undefined && from > to)
    throw new UsageError(`--from ${from} 不能大于 --to ${to}`);
  return {
    command,
    file,
    ...(out !== undefined ? { out } : {}),
    ...(frames !== undefined ? { frames } : {}),
    frameSpec: frameSpec(),
    theme: oneOf('theme', str('theme') ?? '', ['light', 'dark'] as const),
    locale: oneOf('locale', str('locale') ?? '', LOCALES),
    ...(from !== undefined ? { from } : {}),
    ...(to !== undefined ? { to } : {}),
    jobs: integer('jobs', str('jobs'), 1) ?? defaultJobs(),
    ...(str('ffmpeg') !== undefined ? { ffmpeg: str('ffmpeg') } : {}),
    failOnOmittedLabels: (values as Record<string, unknown>)['fail-on-omitted-labels'] === true,
    ...(audio !== undefined ? { audio } : {}),
    ...(events !== undefined ? { events } : {}),
  };
}
