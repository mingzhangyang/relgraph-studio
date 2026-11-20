import { randomUUID } from 'node:crypto';
import { mkdir, rename, rm, writeFile } from 'node:fs/promises';
import { basename, dirname, join, resolve } from 'node:path';
import {
  compileTimeline,
  filmEvents,
  formatFilmEvents,
  layoutGraph,
  type AuthoredIds,
  type FilmEvents,
  type VisualGraph,
} from '@relgraph/core';
import { frameSpecFor, type FrameSpecName } from '@relgraph/render';
import { formatDiagnostics, loadFile } from './document.js';
import { conflictingPaths, conflictMessage } from './paths.js';

/**
 * `relgraph events` and `relgraph render --events` (ADR 004, D3): the film's
 * `relgraph.events/1` without rendering it. Events depend on the document
 * and the frame rate of the frame spec only, never on the theme, the locale
 * or how frames are split across threads.
 */

export interface EventsRequest {
  file: string;
  frameSpec: FrameSpecName;
  /** Output file; without it the events are returned only. */
  out?: string;
  /** Warnings from loading the document; defaults to silence. */
  log?: (message: string) => void;
}

/** A user-facing failure; `main` prints the message without a stack. */
export class EventsError extends Error {}

/** The events of a loaded document at `fps`, positioned as the renderer lays it out. */
export const graphEvents = (
  { graph, authoredIds }: { graph: VisualGraph; authoredIds?: AuthoredIds },
  fps: number,
): FilmEvents =>
  filmEvents(graph, layoutGraph(graph), fps, {
    timeline: compileTimeline(graph, fps),
    ...(authoredIds ? { authoredIds } : {}),
  });

/** Write `text` beside `target` and rename it into place, so readers never see half a file. */
export async function writeAtomically(target: string, text: string): Promise<string> {
  const path = resolve(target);
  await mkdir(dirname(path), { recursive: true });
  const temporary = join(dirname(path), `.${basename(path)}.${randomUUID()}.tmp`);
  try {
    await writeFile(temporary, text, { flag: 'wx' });
    await rename(temporary, path);
  } catch (error) {
    await rm(temporary, { force: true });
    throw error;
  }
  return path;
}

/** Load, validate and export the events of a document. */
export async function exportEvents(
  request: EventsRequest,
): Promise<{ events: FilmEvents; text: string; written?: string }> {
  const conflict = await conflictingPaths([
    { label: '输入文件', path: request.file, output: false },
    { label: '--out', path: request.out, output: true },
  ]);
  if (conflict) throw new EventsError(conflictMessage(conflict));
  const { result } = await loadFile(request.file);
  if (!result.valid) throw new EventsError(`${formatDiagnostics(result)}文档校验失败，未导出。`);
  if (result.warnings.length)
    request.log?.(formatDiagnostics({ errors: [], warnings: result.warnings }));
  const events = graphEvents(result, frameSpecFor(request.frameSpec).fps);
  const text = formatFilmEvents(events);
  if (request.out === undefined) return { events, text };
  try {
    return { events, text, written: await writeAtomically(request.out, text) };
  } catch (error) {
    throw new EventsError(`无法写入 ${request.out}：${(error as Error).message}`);
  }
}
