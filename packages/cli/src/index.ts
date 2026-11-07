import { readFileSync } from 'node:fs';
import { SKIA_CANVAS_VERSION } from '@relgraph/render/skia';
import { parseCommand, USAGE, UsageError, type Command } from './args.js';
import { formatDiagnostics, loadFile } from './document.js';
import { renderFilm, RenderError } from './render.js';

export { parseCommand, USAGE, UsageError, type Command } from './args.js';
export { documentStrings, formatDiagnostics, loadFile } from './document.js';
export { encodeArgs, findFfmpeg, FfmpegError } from './ffmpeg.js';
export { frameFile, isFramePattern } from './frames.js';
export {
  renderFilm,
  RenderError,
  type FilmSettings,
  type RenderRequest,
  type RenderSummary,
} from './render.js';

export const CLI_VERSION: string = (
  JSON.parse(readFileSync(new URL('../package.json', import.meta.url), 'utf8')) as {
    version: string;
  }
).version;

export interface Io {
  stdout: (text: string) => void;
  stderr: (text: string) => void;
  /** Whether stderr is a terminal, for the progress line. */
  interactive?: boolean;
}

const defaultIo: Io = {
  stdout: (text) => process.stdout.write(text),
  stderr: (text) => process.stderr.write(text),
  interactive: process.stderr.isTTY,
};

/** Run `relgraph` and return its exit code: 0 success, 1 failure, 2 usage error. */
export async function main(argv: readonly string[], io: Io = defaultIo): Promise<number> {
  let command: Command;
  try {
    command = parseCommand(argv);
  } catch (error) {
    if (!(error instanceof UsageError)) throw error;
    io.stderr(`relgraph：${error.message}\n\n${USAGE}\n`);
    return 2;
  }
  if (command.command === 'help') {
    io.stdout(USAGE + '\n');
    return 0;
  }
  if (command.command === 'version') {
    io.stdout(`relgraph ${CLI_VERSION} (skia-canvas ${SKIA_CANVAS_VERSION})\n`);
    return 0;
  }
  if (command.command === 'validate') {
    const { result } = await loadFile(command.file);
    io.stdout(
      command.json
        ? JSON.stringify(
            { valid: result.valid, errors: result.errors, warnings: result.warnings },
            null,
            2,
          ) + '\n'
        : formatDiagnostics(result),
    );
    return result.valid ? 0 : 1;
  }
  try {
    let lastShown = 0;
    const summary = await renderFilm({
      ...command,
      log: io.stderr,
      progress: (done, total) => {
        const now = performance.now();
        if (!io.interactive || (done < total && now - lastShown < 200)) return;
        lastShown = now;
        io.stderr(`\r渲染 ${done}/${total} 帧${done === total ? '\n' : ''}`);
      },
    });
    const target = summary.out ?? summary.pattern;
    io.stdout(
      `已渲染第 ${summary.first}–${summary.last} 帧（共 ${summary.frames} 帧，影片 ${summary.filmFrames} 帧）` +
        ` · ${summary.width}×${summary.height} · ${summary.fps} fps` +
        `${summary.out ? ' · H.264 yuv420p' : ' · PNG RGBA'} · ${summary.seconds.toFixed(1)} 秒\n→ ${target}\n`,
    );
    return 0;
  } catch (error) {
    if (error instanceof RenderError) {
      io.stderr(`relgraph render：${error.message}\n`);
      return 1;
    }
    throw error;
  }
}
