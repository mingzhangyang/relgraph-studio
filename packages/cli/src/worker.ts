import { writeFileSync } from 'node:fs';
import { parentPort, workerData } from 'node:worker_threads';
import { layoutGraph, parseDocument } from '@relgraph/core';
import { createHeadlessRenderer } from '@relgraph/render/skia';
import { frameFile } from './frames.js';
import type { FilmSettings } from './render.js';

/**
 * One render thread. It loads the document itself and draws whichever frames
 * it is asked for, in any order: frames are pure functions of their index, so
 * the split across threads cannot change a pixel.
 */
export interface WorkerData extends FilmSettings {
  text: string;
  /** PNG file pattern; without it, frames are returned as raw RGBA. */
  pattern?: string;
}
export type WorkerRequest = { frame: number } | { stop: true };
export type WorkerReply =
  { frame: number; pixels?: ArrayBuffer; file?: string } | { error: string; frame?: number };

if (parentPort) {
  const port = parentPort;
  const data = workerData as WorkerData;
  try {
    const result = parseDocument(data.text);
    if (!result.valid) throw new Error('Document is invalid');
    const renderer = createHeadlessRenderer(result.graph, layoutGraph(result.graph), {
      detailAt: result.detailAt,
      frameSpec: data.frameSpec,
      theme: data.theme,
      locale: data.locale,
    });
    port.on('message', (request: WorkerRequest) => {
      if ('stop' in request) {
        port.close();
        return;
      }
      const { frame } = request;
      try {
        if (data.pattern) {
          const file = frameFile(data.pattern, frame);
          writeFileSync(file, renderer.pngAt(frame));
          port.postMessage({ frame, file } satisfies WorkerReply);
        } else {
          const pixels = renderer.rgbaAt(frame);
          // Copy into a transferable buffer that owns exactly the frame.
          const buffer = pixels.slice().buffer;
          port.postMessage({ frame, pixels: buffer } satisfies WorkerReply, [buffer]);
        }
      } catch (error) {
        port.postMessage({ frame, error: String((error as Error)?.stack ?? error) });
      }
    });
  } catch (error) {
    port.postMessage({ error: String((error as Error)?.stack ?? error) } satisfies WorkerReply);
    // Initialization failed before installing the message/stop handler.
    port.close();
  }
}
