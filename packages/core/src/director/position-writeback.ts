import type { VisualGraph } from '../../types/visual-graph.js';
import { GENERIC_FORMAT, internalIds } from '../domains/generic.js';
import { lanedNodes, sourceKeepsTime } from './time-anchor.js';

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
 *
 * `timeAxis` records whether a timeline's coordinates are on its time axis
 * (`timeAnchor`), so that a drawing taken off the axis stays off it when the
 * file is read again: false writes `"timeAxis": false`, true removes it.
 * Only the generic format has timelines; omitted, the field is left as is.
 *
 * On a timeline that keeps time, a dated node's x is its date, so only its
 * lane is written: `"position": { "y": … }` (`lanedNodes`). Whether it keeps
 * time is the state written to the file (`sourceKeepsTime` of the result),
 * never a strategy the file does not record, so the output always loads. The
 * adapter derives x again on load, so an edited date or a rescaled axis
 * cannot leave a stale x in the file.
 *
 * With onlyMissing=true a lane-only position the adapter could not place (it
 * reports `LANE_ONLY`) counts as missing, as it does for `relgraph layout`.
 */
export function applyGraphPositions(
  input: unknown,
  graph: Pick<VisualGraph, 'nodes'> &
    Partial<Pick<VisualGraph, 'diagram' | 'project' | 'timeAxis' | 'timeline'>>,
  positions: ReadonlyMap<string, Point>,
  { onlyMissing = false, timeAxis }: { onlyMissing?: boolean; timeAxis?: boolean } = {},
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
  } else if (document.format === GENERIC_FORMAT) {
    // Author ids may be free text or numbers; nodes may exist only as edge
    // endpoints. Declare such a node so its coordinate has somewhere to live.
    const author = (value: unknown): string | null =>
      typeof value === 'number' && Number.isFinite(value)
        ? String(value)
        : typeof value === 'string' && value.trim()
          ? value.trim()
          : null;
    const declared: unknown[] = Array.isArray(document.nodes) ? document.nodes : [];
    const entries = declared.map((entry) => (record(entry) ? entry : { id: entry }));
    const present = new Set(entries.map((entry) => author(entry.id)));
    const edges: unknown[] = Array.isArray(document.edges) ? document.edges : [];
    for (const edge of edges)
      if (record(edge))
        for (const end of [edge.source, edge.target]) {
          const id = author(end);
          if (id !== null && !present.has(id)) {
            present.add(id);
            entries.push({ id: end });
          }
        }
    const ids = internalIds([...present].filter((id): id is string => id !== null));
    if (timeAxis === false && document.timeAxis !== false) {
      document.timeAxis = false;
      changed++;
    } else if (timeAxis === true && document.timeAxis !== undefined) {
      delete document.timeAxis;
      changed++;
    }
    // Decided on the file as written, so writer and adapter apply one rule.
    const laned = lanedNodes(graph, sourceKeepsTime(document));
    for (const entry of entries) {
      const raw = author(entry.id),
        id = raw === null ? undefined : ids.get(raw);
      if (!id || !known.has(id)) throw new TypeError('Unknown source node ' + String(entry.id));
      const at = entry.position;
      // The format reads `position: null` as no position, and a lane-only
      // position off the axis as unplaced, so both are gaps to fill.
      if (onlyMissing && record(at) && (at.x !== undefined || laned.has(id))) continue;
      const point = positions.get(id);
      if (!point || !Number.isFinite(point.x) || !Number.isFinite(point.y))
        throw new TypeError('No finite position for ' + String(entry.id));
      const next: { x?: number; y: number } = laned.has(id)
        ? { y: point.y }
        : { x: point.x, y: point.y };
      if (record(at) && at.x === next.x && at.y === next.y) continue;
      entry.position = next;
      changed++;
    }
    document.nodes = entries;
  } else throw new TypeError('Unsupported source format');
  return { document, changed };
}
