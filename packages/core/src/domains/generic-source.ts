/**
 * The parser and validator of `relgraph.graph/1`. One pass per section of the
 * source, in a fixed order so the diagnostics come out in the order the file
 * is read: the size of the lists, the ids, kinds, groups, nodes, relations,
 * the visual hierarchy, meta and timeline, the storyboard, the diagram flags
 * and, last, lane-only positions, which need the complete source.
 *
 * Every section reports through one `Reader`, so validation-only callers and
 * imports see exactly the same errors and warnings.
 */
import {
  DIAGRAM_KINDS,
  EDGE_HEADS,
  LINE_STYLES,
  NODE_SHAPES,
  TONE_COUNT,
  type DiagramKind,
  type GraphKinds,
  type KindDeclaration,
} from '../style.js';
import { timeAxis as axisOf } from '../graph/time-axis.js';
import { lanedNodes, sourceKeepsTime, timeCoordinate } from '../director/time-anchor.js';
import type {
  VisualEdge,
  VisualGroup,
  VisualNode,
  VisualScene,
  Visibility,
} from '../../types/visual-graph.js';

export const GENERIC_FORMAT = 'relgraph.graph/1';
/**
 * Hard limits of a generic graph, and the preview budget: above
 * `previewNodes` nodes or `previewEdges` relations, playback in the studio
 * (compose and draw) falls below 24 fps, so loading warns. Export is not
 * affected. Measured in docs/GENERIC-GRAPH.md, "Size".
 */
export const GENERIC_LIMITS = Object.freeze({
  nodes: 5000,
  edges: 20000,
  text: 2000,
  id: 200,
  previewNodes: 300,
  previewEdges: 600,
});

export interface GenericDiagnostic {
  level: 'error' | 'warning';
  layer: 'graph-source';
  code: string;
  path: string;
  id: unknown;
  message: string;
  fix: string;
}
type Raw = Record<string, unknown>;
const object = (v: unknown): v is Raw => v !== null && typeof v === 'object' && !Array.isArray(v);
const finite = (v: unknown): v is number => typeof v === 'number' && Number.isFinite(v);
const slug = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;
const hex = /^#[0-9a-f]{6}$/i;
const compareText = (a: string, b: string): number => (a < b ? -1 : a > b ? 1 : 0);

/** An author id: a non-empty string, or a number as exported by spreadsheets. */
const rawId = (v: unknown): string | null => {
  if (finite(v)) return String(v);
  if (typeof v !== 'string') return null;
  const id = v.trim();
  return id && id.length <= GENERIC_LIMITS.id ? id : null;
};
const fnv = (value: string): string => {
  let state = 2166136261;
  for (let i = 0; i < value.length; i++)
    state = Math.imul(state ^ value.charCodeAt(i), 16777619) >>> 0;
  return state.toString(16).padStart(8, '0');
};

/**
 * Stable internal ids for arbitrary author ids. A lowercase slug is kept as
 * is; any other id (names, CJK text, spaces, capitals) maps to a hash of its
 * text. The result depends only on the set of ids, never on array order, so
 * styles and coordinates saved for a node survive edits elsewhere in the file.
 */
export function internalIds(ids: Iterable<string>): Map<string, string> {
  const unique = [...new Set(ids)].sort(compareText);
  const result = new Map<string, string>(),
    taken = new Set<string>();
  for (const id of unique)
    if (slug.test(id)) {
      result.set(id, id);
      taken.add(id);
    }
  for (const id of unique) {
    if (result.has(id)) continue;
    const base = 'x-' + fnv(id);
    let candidate = base;
    for (let n = 2; taken.has(candidate); n++) candidate = `${base}-${n}`;
    result.set(id, candidate);
    taken.add(candidate);
  }
  return result;
}

/** A parsed source, before the adapter shapes it into a `VisualGraph`. */
export interface ParsedGenericSource {
  title: string;
  description?: string;
  sourceNote?: string;
  timeline?: { unit: string; total?: number };
  diagram: DiagramKind;
  /** False when the author asked for the whole diagram at once. */
  unfold: boolean;
  /** False when a timeline's coordinates are declared to be off its time axis. */
  timeAxis: boolean;
  /** Whether any node carries an authored weight. */
  weighted: boolean;
  kinds: GraphKinds;
  nodes: (VisualNode & { summary?: string })[];
  edges: VisualEdge[];
  groups: VisualGroup[];
  scenes: VisualScene[];
  /** Internal node id → the id written in the source. */
  sourceIds: Map<string, string>;
}

type Report = (code: string, path: string, id: unknown, message: string, fix: string) => void;
/** Diagnostics and the field readers every section shares. */
interface Reader {
  fail: Report;
  warn: Report;
  text(value: unknown, path: string, id: unknown): string | undefined;
  colour(value: unknown, path: string, id: unknown): string | undefined;
  number(value: unknown, path: string, id: unknown): number | undefined;
  visibility(item: Raw, path: string, id: unknown): Visibility | undefined;
  kindName(value: unknown, fallback: string, path: string, id: unknown): string;
}

function reader(errors: GenericDiagnostic[], warnings: GenericDiagnostic[]): Reader {
  const fail: Report = (code, path, id, message, fix) => {
    errors.push({ level: 'error', layer: 'graph-source', code, path, id: id ?? '', message, fix });
  };
  const warn: Report = (code, path, id, message, fix) => {
    warnings.push({
      level: 'warning',
      layer: 'graph-source',
      code,
      path,
      id: id ?? '',
      message,
      fix,
    });
  };
  const number: Reader['number'] = (value, path, id) => {
    if (value === undefined || value === null) return undefined;
    if (finite(value)) return value;
    fail('TYPE', path, id, '需要有限数值。', '改为数字，或删除该字段。');
    return undefined;
  };
  return {
    fail,
    warn,
    number,
    text(value, path, id) {
      if (value === undefined || value === null) return undefined;
      if (finite(value)) return String(value);
      if (typeof value !== 'string' || value.length > GENERIC_LIMITS.text) {
        fail(
          'TYPE',
          path,
          id,
          '文本字段无效。',
          `使用不超过 ${GENERIC_LIMITS.text} 个字符的文本。`,
        );
        return undefined;
      }
      return value.trim() || undefined;
    },
    colour(value, path, id) {
      if (value === undefined || value === null) return undefined;
      if (typeof value === 'string' && hex.test(value)) return value.toLowerCase();
      fail('COLOR', path, id, '颜色无效。', '使用 #RRGGBB 六位十六进制颜色。');
      return undefined;
    },
    visibility(item, path, id) {
      const from = number(item.visibleFrom, path + '.visibleFrom', id),
        to = number(item.visibleTo, path + '.visibleTo', id);
      if (from !== undefined && to !== undefined && from > to)
        fail('INTERVAL', path, id, '可见区间无效。', '确保 visibleFrom 不大于 visibleTo。');
      return from === undefined && to === undefined
        ? undefined
        : { ...(from === undefined ? {} : { from }), ...(to === undefined ? {} : { to }) };
    },
    kindName(value, fallback, path, id) {
      if (value === undefined || value === null) return fallback;
      const name = finite(value) ? String(value) : typeof value === 'string' ? value.trim() : '';
      if (name && name.length <= 80) return name;
      fail('KIND', path, id, '类别名无效。', '使用不超过 80 个字符的非空文本。');
      return fallback;
    },
  };
}

/** The four lists of a source; a field that is not an array counts as empty. */
interface Sections {
  nodes: unknown[];
  edges: unknown[];
  groups: unknown[];
  scenes: unknown[];
}
function sections(doc: Raw, r: Reader): Sections {
  const list = (key: string): unknown[] => {
    const value = doc[key];
    if (value === undefined) return [];
    if (Array.isArray(value)) return value;
    r.fail('TYPE', key, '', `${key} 必须是数组。`, '改为数组，或删除该字段。');
    return [];
  };
  return {
    nodes: list('nodes'),
    edges: list('edges'),
    groups: list('groups'),
    scenes: list('presentation'),
  };
}

/** Internal ids of nodes and groups, from every author id in the file. */
interface Ids {
  nodes: Map<string, string>;
  groups: Map<string, string>;
  /** Groups only referenced by nodes, in the order nodes name them. */
  groupRefs: string[];
  /** Groups declared in `groups`, in the order they are written. */
  declaredGroups: Set<string>;
}
/** Pass 1: collect author ids so internal ids do not depend on array order. */
function collectIds(raw: Sections, r: Reader): Ids {
  const nodeRaw: string[] = [],
    groupRaw: string[] = [];
  const declared = new Set<string>();
  raw.nodes.forEach((n, i) => {
    const id = object(n) ? rawId(n.id) : rawId(n);
    if (id === null) {
      r.fail('ID', `nodes[${i}].id`, '', '节点缺少有效 id。', '提供非空文本或数字 id。');
      return;
    }
    if (declared.has(id))
      r.fail('DUPLICATE_ID', `nodes[${i}].id`, id, '节点 id 重复。', '每个节点使用唯一 id。');
    declared.add(id);
    nodeRaw.push(id);
    if (object(n)) {
      const group = rawId(n.group);
      if (group !== null) groupRaw.push(group);
    }
  });
  raw.edges.forEach((e, i) => {
    if (!object(e)) {
      r.fail('TYPE', `edges[${i}]`, '', '关系必须是对象。', '使用 { "source": …, "target": … }。');
      return;
    }
    for (const end of ['source', 'target'] as const) {
      const id = rawId(e[end]);
      if (id === null)
        r.fail(
          'EDGE_REF',
          `edges[${i}].${end}`,
          rawId(e.id) ?? '',
          `关系缺少 ${end}。`,
          '填写节点 id。',
        );
      else nodeRaw.push(id);
    }
  });
  const declaredGroups = new Set<string>();
  raw.groups.forEach((g, i) => {
    const id = object(g) ? rawId(g.id) : rawId(g);
    if (id === null) {
      r.fail('ID', `groups[${i}].id`, '', '分组缺少有效 id。', '提供非空文本或数字 id。');
      return;
    }
    if (declaredGroups.has(id))
      r.fail('DUPLICATE_ID', `groups[${i}].id`, id, '分组 id 重复。', '每个分组使用唯一 id。');
    declaredGroups.add(id);
  });
  return {
    nodes: internalIds(nodeRaw),
    groups: internalIds([...declaredGroups, ...groupRaw]),
    groupRefs: groupRaw,
    declaredGroups,
  };
}

/** Kinds: declared presentation per node and edge kind, and each edge kind's direction. */
function parseKinds(doc: Raw, r: Reader) {
  const kinds: { nodes: Record<string, KindDeclaration>; edges: Record<string, KindDeclaration> } =
    { nodes: {}, edges: {} };
  const directed = new Map<string, boolean>();
  if (doc.kinds === undefined) return { kinds, directed };
  if (!object(doc.kinds)) {
    r.fail('TYPE', 'kinds', '', 'kinds 必须是对象。', '使用 { nodes, edges }。');
    return { kinds, directed };
  }
  for (const scope of ['nodes', 'edges'] as const) {
    const table = doc.kinds[scope];
    if (table === undefined) continue;
    if (!object(table)) {
      r.fail('TYPE', `kinds.${scope}`, '', '类别表必须是对象。', '以类别名为键。');
      continue;
    }
    for (const [name, value] of Object.entries(table)) {
      const path = `kinds.${scope}.${name}`;
      if (!name.trim() || name.length > 80 || !object(value)) {
        r.fail('KIND', path, '', '类别声明无效。', '使用 { "label": …, "color": … } 对象。');
        continue;
      }
      const entry: KindDeclaration = {};
      const label = r.text(value.label, path + '.label', '');
      if (label) entry.label = label;
      const c = r.colour(value.color, path + '.color', '');
      if (c) entry.color = c;
      if (scope === 'nodes' && value.shape !== undefined) {
        if ((NODE_SHAPES as readonly unknown[]).includes(value.shape))
          entry.shape = value.shape as KindDeclaration['shape'];
        else r.fail('ENUM', path + '.shape', '', '形状无效。', `可用：${NODE_SHAPES.join('、')}。`);
      }
      if (scope === 'edges') {
        if (value.line !== undefined) {
          if ((LINE_STYLES as readonly unknown[]).includes(value.line))
            entry.line = value.line as KindDeclaration['line'];
          else
            r.fail('ENUM', path + '.line', '', '线型无效。', `可用：${LINE_STYLES.join('、')}。`);
        }
        if (value.head !== undefined) {
          if ((EDGE_HEADS as readonly unknown[]).includes(value.head))
            entry.head = value.head as KindDeclaration['head'];
          else r.fail('ENUM', path + '.head', '', '端点无效。', `可用：${EDGE_HEADS.join('、')}。`);
        }
        if (typeof value.directed === 'boolean') directed.set(name.trim(), value.directed);
        else if (value.directed !== undefined)
          r.fail('TYPE', path + '.directed', '', 'directed 必须是布尔值。', '使用 true 或 false。');
      }
      kinds[scope][name.trim()] = entry;
    }
  }
  return { kinds, directed };
}

/**
 * Whether a relation without its own `directed` points from source to target:
 * the document's choice, else true in a tree, a mind map or a process, where a
 * relation runs from parent to child or from one step to the next.
 */
function defaultDirection(doc: Raw, r: Reader): boolean {
  if (doc.directed !== undefined && typeof doc.directed !== 'boolean')
    r.fail('TYPE', 'directed', '', 'directed 必须是布尔值。', '使用 true 或 false。');
  return typeof doc.directed === 'boolean'
    ? doc.directed
    : doc.diagram === 'tree' || doc.diagram === 'mindmap' || doc.diagram === 'flowchart';
}

/** Groups, declared first; groups only referenced by nodes follow by id. */
function parseGroups(rawGroups: unknown[], ids: Ids, r: Reader): VisualGroup[] {
  const groups: VisualGroup[] = [];
  const seen = new Set<string>();
  rawGroups.forEach((g, i) => {
    const raw = object(g) ? rawId(g.id) : rawId(g);
    if (raw === null || seen.has(raw)) return;
    seen.add(raw);
    const path = `groups[${i}]`;
    const record = object(g) ? g : {};
    groups.push({
      id: ids.groups.get(raw)!,
      label: r.text(record.label, path + '.label', raw) ?? raw,
      kind: r.kindName(record.kind, 'group', path + '.kind', raw),
      color: r.colour(record.color, path + '.color', raw),
    });
  });
  for (const raw of [...new Set(ids.groupRefs)].sort(compareText))
    if (!seen.has(raw)) {
      seen.add(raw);
      groups.push({ id: ids.groups.get(raw)!, label: raw, kind: 'group' });
    }
  // Hue slots follow group order; an authored colour does not consume one.
  let slot = 0;
  for (const group of groups)
    if (!group.color) {
      if (slot < TONE_COUNT) group.tone = slot;
      slot++;
    }
  return groups;
}

interface ParsedNodes {
  nodes: ParsedGenericSource['nodes'];
  /** Author ids already given a node. */
  seen: Set<string>;
  /** Authored weights by internal id. */
  weights: Map<string, number>;
  sourceIds: Map<string, string>;
  /** Lane-only positions (`{ "y": … }`), resolved once the whole source is read. */
  lanes: Map<string, { y: number; index: number }>;
}
function parseNodes(rawNodes: unknown[], ids: Ids, r: Reader): ParsedNodes {
  const nodes: ParsedGenericSource['nodes'] = [];
  const seen = new Set<string>(),
    weights = new Map<string, number>(),
    sourceIds = new Map<string, string>(),
    lanes = new Map<string, { y: number; index: number }>();
  rawNodes.forEach((n, i) => {
    const raw = object(n) ? rawId(n.id) : rawId(n);
    if (raw === null || seen.has(raw)) return;
    seen.add(raw);
    const record = object(n) ? n : {},
      path = `nodes[${i}]`,
      id = ids.nodes.get(raw)!;
    sourceIds.set(id, raw);
    const group = rawId(record.group);
    if (record.group !== undefined && record.group !== null && group === null)
      r.fail('GROUP_REF', path + '.group', raw, '分组引用无效。', '填写分组 id，或删除该字段。');
    const weight = r.number(record.weight, path + '.weight', raw);
    if (weight !== undefined) {
      if (weight < 0) r.fail('WEIGHT', path + '.weight', raw, '权重不能为负。', '使用非负数。');
      else weights.set(id, weight);
    }
    const summary = r.text(record.summary, path + '.summary', raw);
    // A span on the time axis. It never hides the node; it also is when the
    // node first appears unless visibleFrom says otherwise.
    const start = r.number(record.start, path + '.start', raw),
      end = r.number(record.end, path + '.end', raw);
    if (end !== undefined && start === undefined)
      r.fail(
        'INTERVAL',
        path + '.end',
        raw,
        'end 需要同时提供 start。',
        '补充 start，或删除 end。',
      );
    if (start !== undefined && end !== undefined && start > end)
      r.fail('INTERVAL', path, raw, '时间跨度无效。', '确保 start 不大于 end。');
    const shown = r.visibility(record, path, raw);
    // Without visibleFrom the node first appears at its start, so the start
    // is one end of the interval the kernel will be given.
    if (
      start !== undefined &&
      shown !== undefined &&
      shown.from === undefined &&
      shown.to !== undefined &&
      start > shown.to
    )
      r.fail(
        'INTERVAL',
        path,
        raw,
        '可见区间无效。',
        '确保 start 不大于 visibleTo，或用 visibleFrom 指定首次出现的时间。',
      );
    // On a timeline that keeps time a dated node's x is its date, so its
    // position may be its lane alone. Whether x can be derived is decided by
    // the complete source (`lanedNodes`), with the rule the writer uses.
    let position: { x: number; y: number } | undefined;
    if (record.position !== undefined && record.position !== null) {
      const at = record.position;
      if (object(at) && finite(at.x) && finite(at.y)) position = { x: at.x, y: at.y };
      else if (object(at) && at.x === undefined && finite(at.y))
        lanes.set(id, { y: at.y, index: i });
      else
        r.fail(
          'POSITION',
          path + '.position',
          raw,
          '坐标无效。',
          '使用 { "x": 数字, "y": 数字 }。',
        );
    }
    nodes.push({
      id,
      label: r.text(record.label, path + '.label', raw) ?? raw,
      kind: r.kindName(record.kind, 'node', path + '.kind', raw),
      groupId: group === null ? null : ids.groups.get(group)!,
      color: r.colour(record.color, path + '.color', raw),
      position,
      visibility:
        start !== undefined && shown?.from === undefined ? { ...shown, from: start } : shown,
      ...(start === undefined
        ? {}
        : { span: { from: start, ...(end === undefined ? {} : { to: end }) } }),
      ...(summary ? { summary } : {}),
    });
  });
  return { nodes, seen, weights, sourceIds, lanes };
}

interface ParsedEdges {
  edges: VisualEdge[];
  /** Authored relation weights by internal id. */
  strengths: Map<string, number>;
  /** Endpoints never declared as nodes, in the order relations name them. */
  implicit: string[];
  /** Author relation id → internal id, for storyboard references. */
  lookup: Map<string, string>;
}
function parseEdges(
  rawEdges: unknown[],
  ids: Ids,
  declared: Set<string>,
  kindDirected: ReadonlyMap<string, boolean>,
  defaultDirected: boolean,
  r: Reader,
): ParsedEdges {
  const edges: VisualEdge[] = [];
  const edgeRaw: (string | null)[] = rawEdges.map((e) => (object(e) ? rawId(e.id) : null));
  const explicitEdgeIds = internalIds(edgeRaw.filter((id): id is string => id !== null));
  const usedEdgeIds = new Set(explicitEdgeIds.values());
  const edgeSeen = new Set<string>(),
    strengths = new Map<string, number>();
  const implicit: string[] = [];
  rawEdges.forEach((e, i) => {
    if (!object(e)) return;
    const s = rawId(e.source),
      t = rawId(e.target);
    if (s === null || t === null) return;
    for (const end of [s, t])
      if (!declared.has(end)) {
        declared.add(end);
        implicit.push(end);
      }
    const source = ids.nodes.get(s)!,
      target = ids.nodes.get(t)!,
      path = `edges[${i}]`;
    const raw = edgeRaw[i];
    let id: string;
    if (raw !== null) {
      if (edgeSeen.has(raw)) {
        r.fail(
          'DUPLICATE_ID',
          path + '.id',
          raw,
          '关系 id 重复。',
          '每条关系使用唯一 id，或省略 id。',
        );
        return;
      }
      edgeSeen.add(raw);
      id = explicitEdgeIds.get(raw)!;
    } else {
      // ':' is reserved for generated ids, so these never meet an author id.
      const base = `${source}:${target}`;
      id = base;
      for (let n = 2; usedEdgeIds.has(id); n++) id = `${base}:${n}`;
      usedEdgeIds.add(id);
    }
    const kind = r.kindName(e.kind, 'link', path + '.kind', raw ?? '');
    if (e.directed !== undefined && typeof e.directed !== 'boolean')
      r.fail(
        'TYPE',
        path + '.directed',
        raw ?? '',
        'directed 必须是布尔值。',
        '使用 true 或 false。',
      );
    const weight = r.number(e.weight, path + '.weight', raw ?? '');
    if (weight !== undefined) {
      if (weight < 0)
        r.fail('WEIGHT', path + '.weight', raw ?? '', '权重不能为负。', '使用非负数。');
      else strengths.set(id, weight);
    }
    edges.push({
      id,
      source,
      target,
      kind,
      label: r.text(e.label, path + '.label', raw ?? ''),
      directed:
        typeof e.directed === 'boolean' ? e.directed : (kindDirected.get(kind) ?? defaultDirected),
      visibility: r.visibility(e, path, raw ?? ''),
    });
  });
  const lookup = new Map<string, string>([...explicitEdgeIds]);
  for (const edge of edges) if (!lookup.has(edge.id)) lookup.set(edge.id, edge.id);
  return { edges, strengths, implicit, lookup };
}

/** Visual hierarchy: authored weights, otherwise how connected a node is. */
function rankHierarchy(
  nodes: VisualNode[],
  edges: VisualEdge[],
  weights: ReadonlyMap<string, number>,
  strengths: ReadonlyMap<string, number>,
): void {
  const scale = (value: number, min: number, max: number): number =>
    max > min ? 1 + 4 * Math.sqrt((value - min) / (max - min)) : 3;
  if (weights.size) {
    const all = [...weights.values()],
      min = Math.min(...all),
      max = Math.max(...all);
    for (const node of nodes) {
      const w = weights.get(node.id);
      node.importance = w === undefined ? 2 : Math.round(scale(w, min, max));
    }
  } else if (edges.length) {
    const degree = new Map(nodes.map((n) => [n.id, 0]));
    for (const edge of edges) {
      degree.set(edge.source, (degree.get(edge.source) ?? 0) + 1);
      if (edge.target !== edge.source) degree.set(edge.target, (degree.get(edge.target) ?? 0) + 1);
    }
    const all = [...degree.values()],
      min = Math.min(...all),
      max = Math.max(...all);
    for (const node of nodes)
      node.importance = Math.round(scale(degree.get(node.id) ?? 0, min, max));
  }
  if (strengths.size) {
    const all = [...strengths.values()],
      min = Math.min(...all),
      max = Math.max(...all);
    for (const edge of edges) {
      const w = strengths.get(edge.id);
      if (w !== undefined)
        edge.strength = max > min ? Math.round((1 + (4 * (w - min)) / (max - min)) * 100) / 100 : 3;
    }
  }
}

/** `meta`, as a record, and the declared `timeline`. */
function parseMeta(doc: Raw, r: Reader) {
  const meta = doc.meta === undefined ? {} : doc.meta;
  if (!object(meta)) r.fail('TYPE', 'meta', '', 'meta 必须是对象。', '使用 { "title": … }。');
  const record = object(meta) ? meta : {};
  let timeline: ParsedGenericSource['timeline'];
  if (doc.timeline !== undefined) {
    if (object(doc.timeline) && typeof doc.timeline.unit === 'string' && doc.timeline.unit.trim())
      timeline = {
        unit: doc.timeline.unit.trim(),
        ...(finite(doc.timeline.total) ? { total: doc.timeline.total } : {}),
      };
    else r.fail('TYPE', 'timeline', '', 'timeline 无效。', '使用 { "unit": "步骤" }。');
  }
  return { meta: record, timeline };
}

/** Authored storyboard. References use author ids and are mapped here. */
function parseScenes(
  rawScenes: unknown[],
  ids: Ids,
  edgeLookup: ReadonlyMap<string, string>,
  r: Reader,
): VisualScene[] {
  const scenes: VisualScene[] = [];
  // A shot without an id is named after its place in the film. The name
  // steps aside when the author already used it for another shot.
  const authoredScenes = new Set<string>();
  for (const s of rawScenes) {
    const id = object(s) ? rawId(s.id) : null;
    if (id !== null) authoredScenes.add(id);
  }
  const sceneNames = rawScenes.map((s, i) => {
    const id = object(s) ? rawId(s.id) : null;
    if (id !== null) return id;
    let name = `scene-${i + 1}`;
    for (let n = 2; authoredScenes.has(name); n++) name = `scene-${i + 1}-${n}`;
    return name;
  });
  const sceneIds = internalIds(sceneNames),
    sceneSeen = new Set<string>();
  rawScenes.forEach((s, i) => {
    const path = `presentation[${i}]`;
    if (!object(s)) {
      r.fail('TYPE', path, '', '分镜必须是对象。', '使用 { "title": …, "durationSec": … }。');
      return;
    }
    const raw = sceneNames[i];
    if (sceneSeen.has(raw)) {
      r.fail(
        'DUPLICATE_ID',
        path + '.id',
        raw,
        '分镜 id 重复。',
        '每个分镜使用唯一 id，或省略 id。',
      );
      return;
    }
    sceneSeen.add(raw);
    const refs = (
      value: unknown,
      table: ReadonlyMap<string, string>,
      field: string,
    ): string[] | undefined => {
      if (value === undefined || value === null) return undefined;
      if (!Array.isArray(value)) {
        r.fail('TYPE', `${path}.${field}`, raw, `${field} 必须是数组。`, '改为 id 数组。');
        return undefined;
      }
      const out: string[] = [];
      value.forEach((entry, j) => {
        const id = rawId(entry),
          mapped = id === null ? undefined : table.get(id);
        if (mapped) out.push(mapped);
        else
          r.fail(
            'SCENE_REF',
            `${path}.${field}[${j}]`,
            raw,
            '引用了不存在的对象。',
            '使用已有 id。',
          );
      });
      return out;
    };
    const ref = (
      value: unknown,
      table: ReadonlyMap<string, string>,
      field: string,
    ): string | undefined => {
      if (value === undefined || value === null) return undefined;
      const id = rawId(value),
        mapped = id === null ? undefined : table.get(id);
      if (!mapped)
        r.fail('SCENE_REF', `${path}.${field}`, raw, '引用了不存在的对象。', '使用已有 id。');
      return mapped;
    };
    const camera = object(s.camera) ? s.camera : undefined,
      highlight = object(s.highlight) ? s.highlight : undefined;
    if (s.camera !== undefined && !camera)
      r.fail('TYPE', path + '.camera', raw, 'camera 必须是对象。', '使用 { "fitIds": […] }。');
    if (s.highlight !== undefined && !highlight)
      r.fail(
        'TYPE',
        path + '.highlight',
        raw,
        'highlight 必须是对象。',
        '使用 { "nodeIds": […] }。',
      );
    const duration = s.durationSec === undefined ? 4 : s.durationSec;
    if (!finite(duration) || duration <= 0 || duration > 600)
      r.fail('DURATION', path + '.durationSec', raw, '时长无效。', '使用 0 到 600 之间的秒数。');
    const zoom = r.number(camera?.zoom, path + '.camera.zoom', raw);
    if (zoom !== undefined && zoom <= 0)
      r.fail(
        'CAMERA_ZOOM',
        path + '.camera.zoom',
        raw,
        '镜头缩放无效。',
        '使用大于 0 的数值，或删除 zoom。',
      );
    const transition = r.number(s.transitionMs, path + '.transitionMs', raw);
    if (transition !== undefined && transition < 0)
      r.fail(
        'TRANSITION',
        path + '.transitionMs',
        raw,
        '转场时长无效。',
        '使用不小于 0 的毫秒数。',
      );
    const focus = camera ? ref(camera.focusNodeId, ids.nodes, 'camera.focusNodeId') : undefined,
      fit = camera ? refs(camera.fitIds, ids.nodes, 'camera.fitIds') : undefined;
    // One shot looks at one thing: a node, or the frame around several.
    if (focus !== undefined && fit?.length)
      r.fail(
        'CAMERA_CONFLICT',
        path + '.camera',
        raw,
        '镜头目标冲突。',
        'focusNodeId 与 fitIds 只保留一个。',
      );
    scenes.push({
      id: sceneIds.get(raw)!,
      title: r.text(s.title, path + '.title', raw) ?? `${i + 1}`,
      narration: r.text(s.narration, path + '.narration', raw),
      durationSec: finite(duration) ? duration : 4,
      transitionMs: transition,
      domainAt: r.number(s.domainAt, path + '.domainAt', raw),
      camera: camera
        ? { focusNodeId: focus, fitIds: fit, ...(zoom === undefined ? {} : { zoom }) }
        : undefined,
      highlight: highlight
        ? {
            nodeIds: refs(highlight.nodeIds, ids.nodes, 'highlight.nodeIds'),
            edgeIds: refs(highlight.edgeIds, edgeLookup, 'highlight.edgeIds'),
            groupId: ref(highlight.groupId, ids.groups, 'highlight.groupId'),
          }
        : undefined,
      openDetailNodeId: ref(s.openDetailNodeId, ids.nodes, 'openDetailNodeId'),
    });
  });
  return scenes;
}

/** The diagram kind and the two flags that qualify it. */
function parseDiagram(doc: Raw, r: Reader): DiagramKind {
  let diagram: DiagramKind = 'network';
  if (doc.diagram !== undefined) {
    if ((DIAGRAM_KINDS as readonly unknown[]).includes(doc.diagram))
      diagram = doc.diagram as DiagramKind;
    else r.fail('ENUM', 'diagram', '', '图的类型无效。', `可用：${DIAGRAM_KINDS.join('、')}。`);
  }
  if (doc.unfold !== undefined && typeof doc.unfold !== 'boolean')
    r.fail('TYPE', 'unfold', '', 'unfold 必须是布尔值。', '使用 true 或 false。');
  if (doc.timeAxis !== undefined && typeof doc.timeAxis !== 'boolean')
    r.fail('TYPE', 'timeAxis', '', 'timeAxis 必须是布尔值。', '使用 true 或 false。');
  return diagram;
}

/**
 * Resolve lane-only positions once the whole source is read: validation-only
 * callers must see the same warning as imports, before a partial position is
 * discarded. A node whose x its dates give gets that x; any other lane-only
 * node is left unplaced, with a `LANE_ONLY` warning.
 */
function resolveLanes(
  doc: Raw,
  diagram: DiagramKind,
  { nodes, lanes, sourceIds }: Pick<ParsedNodes, 'nodes' | 'lanes' | 'sourceIds'>,
  r: Reader,
): void {
  if (!lanes.size) return;
  const axis = axisOf(nodes),
    laned = lanedNodes({ nodes, diagram }, sourceKeepsTime(doc));
  for (const node of nodes) {
    const lane = lanes.get(node.id);
    if (!lane) continue;
    const x = axis && laned.has(node.id) ? timeCoordinate(node, axis) : null;
    if (x !== null) node.position = { x, y: lane.y };
    else
      r.warn(
        'LANE_ONLY',
        `nodes[${lane.index}].position`,
        sourceIds.get(node.id),
        '坐标只有 y，无法由日期得出 x；布局将重新摆放此节点，原有 y 不会保留。',
        '只有在保持时间轴、且至少有两个不同时间的时间线上，带日期节点才能只写 y；否则补充 x，使用 { "x": 数字, "y": 数字 }。',
      );
  }
}

/**
 * Parse and validate a `relgraph.graph/1` source. Diagnostics are appended to
 * `errors` and `warnings`; the result is null only when the source cannot be
 * read at all (not this format, too large, or empty).
 */
export function parseGenericSource(
  doc: unknown,
  errors: GenericDiagnostic[],
  warnings: GenericDiagnostic[],
): ParsedGenericSource | null {
  const r = reader(errors, warnings);
  if (!object(doc) || doc.format !== GENERIC_FORMAT) {
    r.fail('STRUCTURE', '$', '', '不是通用关系图文档。', `使用 format: "${GENERIC_FORMAT}"。`);
    return null;
  }
  const raw = sections(doc, r);
  if (raw.nodes.length > GENERIC_LIMITS.nodes || raw.edges.length > GENERIC_LIMITS.edges) {
    r.fail(
      'TOO_LARGE',
      '$',
      '',
      `图谱过大（上限 ${GENERIC_LIMITS.nodes} 个节点、${GENERIC_LIMITS.edges} 条关系）。`,
      '先筛选或聚合数据，再制作影片。',
    );
    return null;
  }
  const ids = collectIds(raw, r);
  if (!ids.nodes.size) {
    r.fail('EMPTY', '$', '', '图谱中没有任何节点或关系。', '至少添加一个节点或一条关系。');
    return null;
  }
  if (ids.nodes.size > GENERIC_LIMITS.nodes) {
    r.fail('TOO_LARGE', '$', '', '节点数量超过上限。', '先筛选或聚合数据，再制作影片。');
    return null;
  }
  if (
    ids.nodes.size > GENERIC_LIMITS.previewNodes ||
    raw.edges.length > GENERIC_LIMITS.previewEdges
  )
    r.warn(
      'LARGE_GRAPH',
      '$',
      '',
      `图谱较大（${ids.nodes.size} 个节点、${raw.edges.length} 条关系），超出流畅预览的范围（约 ${GENERIC_LIMITS.previewNodes} 个节点、${GENERIC_LIMITS.previewEdges} 条关系）。`,
      '预览可能卡顿，导出的影片不受影响；如需流畅预览，请先筛选或聚合数据。',
    );

  const { kinds, directed } = parseKinds(doc, r);
  const defaultDirected = defaultDirection(doc, r);
  const groups = parseGroups(raw.groups, ids, r);
  const parsedNodes = parseNodes(raw.nodes, ids, r);
  const { nodes, weights, sourceIds } = parsedNodes;
  const { edges, strengths, implicit, lookup } = parseEdges(
    raw.edges,
    ids,
    parsedNodes.seen,
    directed,
    defaultDirected,
    r,
  );
  // Endpoints that were never declared are nodes too: an edge list is enough.
  for (const name of implicit) {
    const id = ids.nodes.get(name)!;
    sourceIds.set(id, name);
    nodes.push({ id, label: name, kind: 'node', groupId: null });
  }
  rankHierarchy(nodes, edges, weights, strengths);
  const { meta, timeline } = parseMeta(doc, r);
  const scenes = parseScenes(raw.scenes, ids, lookup, r);
  if (implicit.length && raw.nodes.length)
    r.warn(
      'IMPLICIT_NODES',
      'edges',
      '',
      `${implicit.length} 个节点只在关系中出现，已按 id 自动创建。`,
      '如需名称、类别或分组，请在 nodes 中声明它们。',
    );
  const title = r.text(meta.title, 'meta.title', '') ?? '关系图';
  const diagram = parseDiagram(doc, r);
  resolveLanes(doc, diagram, parsedNodes, r);
  return {
    title,
    description: r.text(meta.description, 'meta.description', ''),
    sourceNote: r.text(meta.sourceNote, 'meta.sourceNote', ''),
    timeline,
    diagram,
    unfold: doc.unfold !== false,
    timeAxis: doc.timeAxis !== false,
    weighted: weights.size > 0,
    kinds,
    nodes,
    edges,
    groups,
    scenes,
    sourceIds,
  };
}
