import type { VisualBeat } from '../../types/visual-graph.js';

type Kind = 'nodes' | 'edges' | 'groups';
const record = (v: unknown): v is Record<string, unknown> =>
  v !== null && typeof v === 'object' && !Array.isArray(v);

/** Decode both source formats with their own id namespaces and evidence counts. */
export function readBeats(
  input: unknown,
  duration: number,
  resolve: (kind: Kind, id: string) => string | undefined,
  count: (kind: 'nodes' | 'edges', id: string) => number,
  report: (path: string) => void,
  sourceId: (value: unknown) => string | null = (value) =>
    typeof value === 'string' ? value : null,
): VisualBeat[] | undefined {
  if (input === undefined) return undefined;
  if (!Array.isArray(input)) {
    report('beats');
    return undefined;
  }
  const beats: VisualBeat[] = [];
  let previous = -1;
  for (const [i, value] of input.entries()) {
    const path = 'beats[' + i + ']';
    if (!record(value)) {
      report(path);
      continue;
    }
    const at = value.atSec;
    if (
      typeof at !== 'number' ||
      !Number.isFinite(at) ||
      at < 0 ||
      at >= duration ||
      at <= previous
    ) {
      report(path + '.atSec');
      continue;
    }
    previous = at;
    const beat: VisualBeat = { atSec: at };
    const ref = (v: unknown, kind: Kind, field: string) => {
      const raw = sourceId(v);
      const id = raw === null ? undefined : resolve(kind, raw);
      if (id === undefined) report(path + '.' + field);
      return id;
    };
    const list = (v: unknown, kind: Kind, field: string) => {
      if (!Array.isArray(v)) {
        report(path + '.' + field);
        return [];
      }
      return v.flatMap((item, j) => ref(item, kind, field + '[' + j + ']') ?? []);
    };
    for (const key of ['reveal', 'highlight', 'camera', 'evidence'] as const) {
      const part = value[key];
      if (part === undefined) continue;
      if (!record(part)) {
        report(path + '.' + key);
        continue;
      }
      if (key === 'camera') {
        const camera = (beat.camera = {} as NonNullable<VisualBeat['camera']>);
        if (part.focusNodeId !== undefined)
          camera.focusNodeId = ref(part.focusNodeId, 'nodes', 'camera.focusNodeId');
        if (part.fitIds !== undefined) camera.fitIds = list(part.fitIds, 'nodes', 'camera.fitIds');
        if (camera.focusNodeId && camera.fitIds?.length) report(path + '.camera');
        if (part.zoom !== undefined) {
          if (typeof part.zoom === 'number' && Number.isFinite(part.zoom) && part.zoom > 0)
            camera.zoom = part.zoom;
          else report(path + '.camera.zoom');
        }
      } else if (key === 'evidence') {
        const node = part.nodeId !== undefined;
        if (node === (part.edgeId !== undefined)) {
          report(path + '.evidence');
          continue;
        }
        const kind = node ? 'nodes' : 'edges';
        const id = ref(node ? part.nodeId : part.edgeId, kind, 'evidence');
        if (id === undefined) continue;
        const n = count(kind, id);
        const items = part.items;
        if (
          !n ||
          (items !== undefined &&
            (!Array.isArray(items) ||
              !items.length ||
              items.some(
                (j, k) => !Number.isInteger(j) || j < 0 || j >= n || items.indexOf(j) !== k,
              )))
        ) {
          report(path + '.evidence');
          continue;
        }
        beat.evidence = {
          ...(node ? { nodeId: id } : { edgeId: id }),
          ...(Array.isArray(items) ? { items: [...items] } : {}),
        };
      } else {
        const ids: NonNullable<VisualBeat['highlight']> = {};
        if (part.nodeIds !== undefined) ids.nodeIds = list(part.nodeIds, 'nodes', key + '.nodeIds');
        if (part.edgeIds !== undefined) ids.edgeIds = list(part.edgeIds, 'edges', key + '.edgeIds');
        if (key === 'highlight' && part.groupId !== undefined)
          ids.groupId = ref(part.groupId, 'groups', 'highlight.groupId');
        beat[key] = ids;
      }
    }
    beats.push(beat);
  }
  return beats;
}
