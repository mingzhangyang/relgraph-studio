import { randomUUID } from 'node:crypto';
import { chmod, stat, realpath, rename, unlink, writeFile } from 'node:fs/promises';
import { basename, dirname, join, resolve } from 'node:path';
import {
  anchorToTime,
  applyGraphPositions,
  LAYOUT_DEFAULTS,
  layoutMissingNodes,
  parseDocument,
  structuralLayout,
  type VisualGraph,
} from '@relgraph/core';
import { formatDiagnostics, loadFile } from './document.js';

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

/** Insert missing coordinates while preserving all existing authored positions. */
export function writeBackPositions(
  input: unknown,
  graph: VisualGraph,
  positions: ReadonlyMap<string, { x: number; y: number }>,
): { document: unknown; added: number } {
  const result = applyGraphPositions(input, graph, positions, { onlyMissing: true });
  const missing = graph.nodes.filter((node) => node.position === undefined).length;
  if (result.changed !== missing)
    throw new LayoutError(
      'Position count mismatch: expected ' + missing + ', got ' + result.changed,
    );
  return { document: result.document, added: result.changed };
}

function indentOf(text: string): string | number {
  const match = text.match(/\n([ \t]+)"/);
  return match ? match[1] : 2;
}

/** Place temporary data beside the target so rename is an atomic replacement. */
async function atomicReplace(file: string, text: string): Promise<void> {
  const target = await realpath(file);
  const mode = (await stat(target)).mode & 0o7777;
  const temporary = join(dirname(target), '.' + basename(target) + '.' + randomUUID() + '.tmp');
  try {
    await writeFile(temporary, text, { flag: 'wx', mode });
    // mode during creation is masked by umask; restore the source mode before rename.
    await chmod(temporary, mode);
    await rename(temporary, target);
  } finally {
    await unlink(temporary).catch(() => undefined);
  }
}

export async function layoutFile(request: LayoutRequest): Promise<LayoutSummary> {
  // Enforce write-mode exclusivity even for callers bypassing parseCommand.
  if (request.write && request.out !== undefined)
    throw new LayoutError('layout --write and --out cannot be combined');
  try {
    const { text, result } = await loadFile(request.file);
    if (!result.valid) throw new LayoutError(formatDiagnostics(result).trim());
    const missing = result.graph.nodes.filter((node) => node.position === undefined).length;
    const summary: LayoutSummary = { missing, total: result.graph.nodes.length };
    if (!missing && !request.out) return summary;

    const input: unknown = JSON.parse(text);
    // A document without any coordinates is arranged from its structure, as
    // the player would; otherwise only the gaps are filled around the
    // author's own arrangement, with the player's spacing. On a timeline that
    // keeps time a new dated node goes to its years, in the first free lane.
    let positions: Map<string, { x: number; y: number }>;
    if (missing === summary.total && summary.total > 1)
      positions = structuralLayout(result.graph, request.seed);
    else {
      positions = layoutMissingNodes(result.graph, { seed: request.seed, ...LAYOUT_DEFAULTS });
      anchorToTime(result.graph, positions, {
        unplaced: new Set(result.graph.nodes.filter((n) => !n.position).map((n) => n.id)),
      });
    }
    const output = writeBackPositions(input, result.graph, positions);
    const serialized = JSON.stringify(output.document, null, indentOf(text)) + '\n';
    // Never write a document whose round-trip validation fails.
    const checked = parseDocument(serialized);
    if (!checked.valid)
      throw new LayoutError('Layout validation failed:\n' + formatDiagnostics(checked));

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
