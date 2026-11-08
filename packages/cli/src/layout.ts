import { randomUUID } from 'node:crypto';
import { stat, realpath, rename, unlink, writeFile } from 'node:fs/promises';
import { basename, dirname, join, resolve } from 'node:path';
import { layoutMissingNodes, parseDocument, type VisualGraph } from '@relgraph/core';
import { formatDiagnostics, loadFile } from './document.js';

type Point = { x: number; y: number };
export interface LayoutRequest {
  file: string;
  seed: number;
  write: boolean;
  out?: string;
}
export interface LayoutSummary {
  missing: number;
  total: number;
  written?: string;
}
export class LayoutError extends Error {}

const record = (value: unknown): value is Record<string, unknown> =>
  value !== null && typeof value === 'object' && !Array.isArray(value);

/** Add coordinates only where the source document has none. */
export function writeBackPositions(
  input: unknown,
  graph: VisualGraph,
  positions: ReadonlyMap<string, Point>,
): { document: unknown; added: number } {
  if (!record(input)) throw new LayoutError('Invalid source document');
  const document = structuredClone(input);
  if (!record(document)) throw new LayoutError('Invalid source document');
  const missing = graph.nodes.filter((node) => node.position === undefined).length;
  let added = 0;
  const fill = (collection: unknown, idFor: (id: string) => string): void => {
    if (!Array.isArray(collection)) throw new LayoutError('Missing source node collection');
    for (const entry of collection) {
      if (!record(entry) || typeof entry.id !== 'string')
        throw new LayoutError('Invalid source node');
      if (entry.position !== undefined) continue;
      const point = positions.get(idFor(entry.id));
      if (!point || !Number.isFinite(point.x) || !Number.isFinite(point.y))
        throw new LayoutError('No finite layout position for ' + entry.id);
      entry.position = { x: point.x, y: point.y };
      added++;
    }
  };
  if (document.schemaVersion === '0.1') fill(document.characters, (id) => id);
  else if (document.format === 'relgraph.bio/0.1-draft') {
    fill(document.entities, (id) => id);
    fill(document.processes, (id) => 'bio:process:' + id);
  } else throw new LayoutError('Unsupported document format');
  if (added !== missing)
    throw new LayoutError('Position count mismatch: expected ' + missing + ', got ' + added);
  return { document, added };
}

function indentOf(text: string): string | number {
  const match = text.match(/\n([ \t]+)"/);
  return match ? match[1] : 2;
}

/** Place temporary data beside the target so rename is an atomic replacement. */
async function atomicReplace(file: string, text: string): Promise<void> {
  const target = await realpath(file);
  const mode = (await stat(target)).mode & 0o777;
  const temporary = join(dirname(target), '.' + basename(target) + '.' + randomUUID() + '.tmp');
  try {
    await writeFile(temporary, text, { flag: 'wx', mode });
    await rename(temporary, target);
  } finally {
    await unlink(temporary).catch(() => undefined);
  }
}

export async function layoutFile(request: LayoutRequest): Promise<LayoutSummary> {
  try {
    const { text, result } = await loadFile(request.file);
    if (!result.valid) throw new LayoutError(formatDiagnostics(result).trim());
    const missing = result.graph.nodes.filter((node) => node.position === undefined).length;
    const summary: LayoutSummary = { missing, total: result.graph.nodes.length };
    if (!missing && !request.out) return summary;

    const input: unknown = JSON.parse(text);
    const positions = layoutMissingNodes(result.graph, { seed: request.seed });
    const output = writeBackPositions(input, result.graph, positions);
    const serialized = JSON.stringify(output.document, null, indentOf(text)) + '\n';
    // Never write a document whose round-trip validation fails.
    const checked = parseDocument(serialized);
    if (!checked.valid) throw new LayoutError('Layout validation failed:\n' + formatDiagnostics(checked));

    if (request.write && missing) {
      await atomicReplace(request.file, serialized);
      summary.written = request.file;
    } else if (request.out) {
      if (resolve(request.out) === resolve(request.file))
        throw new LayoutError('--out must differ from the source; use --write to replace it');
      await writeFile(request.out, serialized, { flag: 'wx' });
      summary.written = request.out;
    }
    return summary;
  } catch (error) {
    if (error instanceof LayoutError) throw error;
    throw new LayoutError(error instanceof Error ? error.message : String(error));
  }
}
