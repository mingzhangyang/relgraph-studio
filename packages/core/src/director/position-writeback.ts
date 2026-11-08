import type { VisualGraph } from '../../types/visual-graph.js';

// Node 20+ and modern browsers provide this host API. Keep its declaration
// local so the ES-only core build needs neither DOM nor Node ambient types.
declare function structuredClone<T>(value: T): T;

type Point = { x: number; y: number };
type RecordValue = Record<string, unknown>;
const record = (value: unknown): value is RecordValue =>
  value !== null && typeof value === 'object' && !Array.isArray(value);

/**
 * Apply neutral graph coordinates to either source format without changing its
 * other fields. The source is cloned; the caller retains ownership of its data.
 *
 * With onlyMissing=true, all authored positions are preserved verbatim. The
 * default writes the complete static layout for export from the workbench.
 */
export function applyGraphPositions(
  input: unknown,
  graph: Pick<VisualGraph, 'nodes'>,
  positions: ReadonlyMap<string, Point>,
  { onlyMissing = false }: { onlyMissing?: boolean } = {},
): { document: unknown; changed: number } {
  if (!record(input)) throw new TypeError('Invalid source document');
  const document: unknown = structuredClone(input);
  if (!record(document)) throw new TypeError('Invalid source document');
  let changed = 0;
  const known = new Set(graph.nodes.map((node) => node.id));
  const fill = (collection: unknown, idFor: (id: string) => string): void => {
    if (!Array.isArray(collection)) throw new TypeError('Missing source node collection');
    for (const entry of collection) {
      if (!record(entry) || typeof entry.id !== 'string')
        throw new TypeError('Invalid source node');
      const id = idFor(entry.id);
      if (!known.has(id)) throw new TypeError('Unknown source node ' + entry.id);
      if (onlyMissing && entry.position !== undefined) continue;
      const point = positions.get(id);
      if (!point || !Number.isFinite(point.x) || !Number.isFinite(point.y))
        throw new TypeError('No finite position for ' + entry.id);
      if (record(entry.position) && entry.position.x === point.x && entry.position.y === point.y)
        continue;
      entry.position = { x: point.x, y: point.y };
      changed++;
    }
  };
  if (document.schemaVersion === '0.1') fill(document.characters, (id) => id);
  else if (document.format === 'relgraph.bio/0.1-draft') {
    fill(document.entities, (id) => id);
    fill(document.processes, (id) => 'bio:process:' + id);
  } else throw new TypeError('Unsupported source format');
  return { document, changed };
}
