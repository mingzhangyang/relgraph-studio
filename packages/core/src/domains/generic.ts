/**
 * Adapter for `relgraph.graph/1`, the domain-free source format: anything
 * that can be written as "things and the relations between them".
 *
 * Only `format` and one node or edge are required. Everything else has a
 * deterministic default: undeclared edge endpoints become nodes, kinds get a
 * derived visual encoding, weights or degree set the visual hierarchy, missing
 * coordinates are laid out, and a document without a `presentation` receives
 * a storyboard that walks through its own structure.
 */
import { validateVisualGraph } from '../graph/core.js';
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
import {
  diagramStructure,
  placeInTime,
  TIME_TOLERANCE,
  timeAxis as axisOf,
  timedNodes,
} from '../director/layout-engines.js';
import type {
  VisualEdge,
  VisualGraph,
  VisualGroup,
  VisualNode,
  VisualScene,
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

interface Parsed {
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

function parse(doc: unknown, errors: GenericDiagnostic[], warnings: GenericDiagnostic[]) {
  const fail = (code: string, path: string, id: unknown, message: string, fix: string): void => {
    errors.push({ level: 'error', layer: 'graph-source', code, path, id: id ?? '', message, fix });
  };
  const warn = (code: string, path: string, id: unknown, message: string, fix: string): void => {
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
  if (!object(doc) || doc.format !== GENERIC_FORMAT) {
    fail('STRUCTURE', '$', '', '不是通用关系图文档。', `使用 format: "${GENERIC_FORMAT}"。`);
    return null;
  }
  const list = (key: string): unknown[] => {
    const value = doc[key];
    if (value === undefined) return [];
    if (Array.isArray(value)) return value;
    fail('TYPE', key, '', `${key} 必须是数组。`, '改为数组，或删除该字段。');
    return [];
  };
  const text = (value: unknown, path: string, id: unknown): string | undefined => {
    if (value === undefined || value === null) return undefined;
    if (finite(value)) return String(value);
    if (typeof value !== 'string' || value.length > GENERIC_LIMITS.text) {
      fail('TYPE', path, id, '文本字段无效。', `使用不超过 ${GENERIC_LIMITS.text} 个字符的文本。`);
      return undefined;
    }
    return value.trim() || undefined;
  };
  const colour = (value: unknown, path: string, id: unknown): string | undefined => {
    if (value === undefined || value === null) return undefined;
    if (typeof value === 'string' && hex.test(value)) return value.toLowerCase();
    fail('COLOR', path, id, '颜色无效。', '使用 #RRGGBB 六位十六进制颜色。');
    return undefined;
  };
  const number = (value: unknown, path: string, id: unknown): number | undefined => {
    if (value === undefined || value === null) return undefined;
    if (finite(value)) return value;
    fail('TYPE', path, id, '需要有限数值。', '改为数字，或删除该字段。');
    return undefined;
  };
  const visibility = (item: Raw, path: string, id: unknown) => {
    const from = number(item.visibleFrom, path + '.visibleFrom', id),
      to = number(item.visibleTo, path + '.visibleTo', id);
    if (from !== undefined && to !== undefined && from > to)
      fail('INTERVAL', path, id, '可见区间无效。', '确保 visibleFrom 不大于 visibleTo。');
    return from === undefined && to === undefined
      ? undefined
      : { ...(from === undefined ? {} : { from }), ...(to === undefined ? {} : { to }) };
  };
  const kindName = (value: unknown, fallback: string, path: string, id: unknown): string => {
    if (value === undefined || value === null) return fallback;
    const name = finite(value) ? String(value) : typeof value === 'string' ? value.trim() : '';
    if (name && name.length <= 80) return name;
    fail('KIND', path, id, '类别名无效。', '使用不超过 80 个字符的非空文本。');
    return fallback;
  };

  const rawNodes = list('nodes'),
    rawEdges = list('edges'),
    rawGroups = list('groups'),
    rawScenes = list('presentation');
  if (rawNodes.length > GENERIC_LIMITS.nodes || rawEdges.length > GENERIC_LIMITS.edges) {
    fail(
      'TOO_LARGE',
      '$',
      '',
      `图谱过大（上限 ${GENERIC_LIMITS.nodes} 个节点、${GENERIC_LIMITS.edges} 条关系）。`,
      '先筛选或聚合数据，再制作影片。',
    );
    return null;
  }

  // Pass 1: collect author ids so internal ids do not depend on array order.
  const nodeRaw: string[] = [],
    groupRaw: string[] = [];
  const declared = new Set<string>();
  rawNodes.forEach((n, i) => {
    const id = object(n) ? rawId(n.id) : rawId(n);
    if (id === null) {
      fail('ID', `nodes[${i}].id`, '', '节点缺少有效 id。', '提供非空文本或数字 id。');
      return;
    }
    if (declared.has(id))
      fail('DUPLICATE_ID', `nodes[${i}].id`, id, '节点 id 重复。', '每个节点使用唯一 id。');
    declared.add(id);
    nodeRaw.push(id);
    if (object(n)) {
      const group = rawId(n.group);
      if (group !== null) groupRaw.push(group);
    }
  });
  rawEdges.forEach((e, i) => {
    if (!object(e)) {
      fail('TYPE', `edges[${i}]`, '', '关系必须是对象。', '使用 { "source": …, "target": … }。');
      return;
    }
    for (const end of ['source', 'target'] as const) {
      const id = rawId(e[end]);
      if (id === null)
        fail(
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
  rawGroups.forEach((g, i) => {
    const id = object(g) ? rawId(g.id) : rawId(g);
    if (id === null) {
      fail('ID', `groups[${i}].id`, '', '分组缺少有效 id。', '提供非空文本或数字 id。');
      return;
    }
    if (declaredGroups.has(id))
      fail('DUPLICATE_ID', `groups[${i}].id`, id, '分组 id 重复。', '每个分组使用唯一 id。');
    declaredGroups.add(id);
  });
  const nodeIds = internalIds(nodeRaw),
    groupIds = internalIds([...declaredGroups, ...groupRaw]);
  if (!nodeIds.size) {
    fail('EMPTY', '$', '', '图谱中没有任何节点或关系。', '至少添加一个节点或一条关系。');
    return null;
  }
  if (nodeIds.size > GENERIC_LIMITS.nodes) {
    fail('TOO_LARGE', '$', '', '节点数量超过上限。', '先筛选或聚合数据，再制作影片。');
    return null;
  }
  if (nodeIds.size > GENERIC_LIMITS.previewNodes || rawEdges.length > GENERIC_LIMITS.previewEdges)
    warn(
      'LARGE_GRAPH',
      '$',
      '',
      `图谱较大（${nodeIds.size} 个节点、${rawEdges.length} 条关系），超出流畅预览的范围（约 ${GENERIC_LIMITS.previewNodes} 个节点、${GENERIC_LIMITS.previewEdges} 条关系）。`,
      '预览可能卡顿，导出的影片不受影响；如需流畅预览，请先筛选或聚合数据。',
    );

  // Kinds: declared presentation per node and edge kind.
  const kinds: { nodes: Record<string, KindDeclaration>; edges: Record<string, KindDeclaration> } =
    { nodes: {}, edges: {} };
  const edgeDirected = new Map<string, boolean>();
  if (doc.kinds !== undefined) {
    if (!object(doc.kinds))
      fail('TYPE', 'kinds', '', 'kinds 必须是对象。', '使用 { nodes, edges }。');
    else
      for (const scope of ['nodes', 'edges'] as const) {
        const table = doc.kinds[scope];
        if (table === undefined) continue;
        if (!object(table)) {
          fail('TYPE', `kinds.${scope}`, '', '类别表必须是对象。', '以类别名为键。');
          continue;
        }
        for (const [name, value] of Object.entries(table)) {
          const path = `kinds.${scope}.${name}`;
          if (!name.trim() || name.length > 80 || !object(value)) {
            fail('KIND', path, '', '类别声明无效。', '使用 { "label": …, "color": … } 对象。');
            continue;
          }
          const entry: KindDeclaration = {};
          const label = text(value.label, path + '.label', '');
          if (label) entry.label = label;
          const c = colour(value.color, path + '.color', '');
          if (c) entry.color = c;
          if (scope === 'nodes' && value.shape !== undefined) {
            if ((NODE_SHAPES as readonly unknown[]).includes(value.shape))
              entry.shape = value.shape as KindDeclaration['shape'];
            else
              fail('ENUM', path + '.shape', '', '形状无效。', `可用：${NODE_SHAPES.join('、')}。`);
          }
          if (scope === 'edges') {
            if (value.line !== undefined) {
              if ((LINE_STYLES as readonly unknown[]).includes(value.line))
                entry.line = value.line as KindDeclaration['line'];
              else
                fail('ENUM', path + '.line', '', '线型无效。', `可用：${LINE_STYLES.join('、')}。`);
            }
            if (value.head !== undefined) {
              if ((EDGE_HEADS as readonly unknown[]).includes(value.head))
                entry.head = value.head as KindDeclaration['head'];
              else
                fail('ENUM', path + '.head', '', '端点无效。', `可用：${EDGE_HEADS.join('、')}。`);
            }
            if (typeof value.directed === 'boolean') edgeDirected.set(name.trim(), value.directed);
            else if (value.directed !== undefined)
              fail(
                'TYPE',
                path + '.directed',
                '',
                'directed 必须是布尔值。',
                '使用 true 或 false。',
              );
          }
          kinds[scope][name.trim()] = entry;
        }
      }
  }
  if (doc.directed !== undefined && typeof doc.directed !== 'boolean')
    fail('TYPE', 'directed', '', 'directed 必须是布尔值。', '使用 true 或 false。');
  // In a tree, a mind map or a process a relation runs from its source on:
  // parent to child, step to next step.
  const defaultDirected =
    typeof doc.directed === 'boolean'
      ? doc.directed
      : doc.diagram === 'tree' || doc.diagram === 'mindmap' || doc.diagram === 'flowchart';

  // Groups, declared first; groups only referenced by nodes follow by id.
  const groups: VisualGroup[] = [];
  const groupSeen = new Set<string>();
  rawGroups.forEach((g, i) => {
    const raw = object(g) ? rawId(g.id) : rawId(g);
    if (raw === null || groupSeen.has(raw)) return;
    groupSeen.add(raw);
    const path = `groups[${i}]`;
    const record = object(g) ? g : {};
    groups.push({
      id: groupIds.get(raw)!,
      label: text(record.label, path + '.label', raw) ?? raw,
      kind: kindName(record.kind, 'group', path + '.kind', raw),
      color: colour(record.color, path + '.color', raw),
    });
  });
  for (const raw of [...new Set(groupRaw)].sort(compareText))
    if (!groupSeen.has(raw)) {
      groupSeen.add(raw);
      groups.push({ id: groupIds.get(raw)!, label: raw, kind: 'group' });
    }
  // Hue slots follow group order; an authored colour does not consume one.
  let slot = 0;
  for (const group of groups)
    if (!group.color) {
      if (slot < TONE_COUNT) group.tone = slot;
      slot++;
    }

  const nodes: Parsed['nodes'] = [];
  const nodeSeen = new Set<string>(),
    weights = new Map<string, number>(),
    sourceIds = new Map<string, string>();
  rawNodes.forEach((n, i) => {
    const raw = object(n) ? rawId(n.id) : rawId(n);
    if (raw === null || nodeSeen.has(raw)) return;
    nodeSeen.add(raw);
    const record = object(n) ? n : {},
      path = `nodes[${i}]`,
      id = nodeIds.get(raw)!;
    sourceIds.set(id, raw);
    const group = rawId(record.group);
    if (record.group !== undefined && record.group !== null && group === null)
      fail('GROUP_REF', path + '.group', raw, '分组引用无效。', '填写分组 id，或删除该字段。');
    let position: { x: number; y: number } | undefined;
    if (record.position !== undefined && record.position !== null) {
      if (object(record.position) && finite(record.position.x) && finite(record.position.y))
        position = { x: record.position.x, y: record.position.y };
      else
        fail('POSITION', path + '.position', raw, '坐标无效。', '使用 { "x": 数字, "y": 数字 }。');
    }
    const weight = number(record.weight, path + '.weight', raw);
    if (weight !== undefined) {
      if (weight < 0) fail('WEIGHT', path + '.weight', raw, '权重不能为负。', '使用非负数。');
      else weights.set(id, weight);
    }
    const summary = text(record.summary, path + '.summary', raw);
    // A span on the time axis. It never hides the node; it also is when the
    // node first appears unless visibleFrom says otherwise.
    const start = number(record.start, path + '.start', raw),
      end = number(record.end, path + '.end', raw);
    if (end !== undefined && start === undefined)
      fail('INTERVAL', path + '.end', raw, 'end 需要同时提供 start。', '补充 start，或删除 end。');
    if (start !== undefined && end !== undefined && start > end)
      fail('INTERVAL', path, raw, '时间跨度无效。', '确保 start 不大于 end。');
    const shown = visibility(record, path, raw);
    // Without visibleFrom the node first appears at its start, so the start
    // is one end of the interval the kernel will be given.
    if (
      start !== undefined &&
      shown !== undefined &&
      shown.from === undefined &&
      shown.to !== undefined &&
      start > shown.to
    )
      fail(
        'INTERVAL',
        path,
        raw,
        '可见区间无效。',
        '确保 start 不大于 visibleTo，或用 visibleFrom 指定首次出现的时间。',
      );
    nodes.push({
      id,
      label: text(record.label, path + '.label', raw) ?? raw,
      kind: kindName(record.kind, 'node', path + '.kind', raw),
      groupId: group === null ? null : groupIds.get(group)!,
      color: colour(record.color, path + '.color', raw),
      position,
      visibility:
        start !== undefined && shown?.from === undefined ? { ...shown, from: start } : shown,
      ...(start === undefined
        ? {}
        : { span: { from: start, ...(end === undefined ? {} : { to: end }) } }),
      ...(summary ? { summary } : {}),
    });
  });

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
      if (!nodeSeen.has(end)) {
        nodeSeen.add(end);
        implicit.push(end);
      }
    const source = nodeIds.get(s)!,
      target = nodeIds.get(t)!,
      path = `edges[${i}]`;
    const raw = edgeRaw[i];
    let id: string;
    if (raw !== null) {
      if (edgeSeen.has(raw)) {
        fail(
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
    const kind = kindName(e.kind, 'link', path + '.kind', raw ?? '');
    if (e.directed !== undefined && typeof e.directed !== 'boolean')
      fail(
        'TYPE',
        path + '.directed',
        raw ?? '',
        'directed 必须是布尔值。',
        '使用 true 或 false。',
      );
    const weight = number(e.weight, path + '.weight', raw ?? '');
    if (weight !== undefined) {
      if (weight < 0) fail('WEIGHT', path + '.weight', raw ?? '', '权重不能为负。', '使用非负数。');
      else strengths.set(id, weight);
    }
    edges.push({
      id,
      source,
      target,
      kind,
      label: text(e.label, path + '.label', raw ?? ''),
      directed:
        typeof e.directed === 'boolean' ? e.directed : (edgeDirected.get(kind) ?? defaultDirected),
      visibility: visibility(e, path, raw ?? ''),
    });
  });
  // Endpoints that were never declared are nodes too: an edge list is enough.
  for (const raw of implicit) {
    const id = nodeIds.get(raw)!;
    sourceIds.set(id, raw);
    nodes.push({ id, label: raw, kind: 'node', groupId: null });
  }

  // Visual hierarchy: authored weights, otherwise how connected a node is.
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

  const meta = doc.meta === undefined ? {} : doc.meta;
  if (!object(meta)) fail('TYPE', 'meta', '', 'meta 必须是对象。', '使用 { "title": … }。');
  const metaRecord = object(meta) ? meta : {};
  let timeline: Parsed['timeline'];
  if (doc.timeline !== undefined) {
    if (object(doc.timeline) && typeof doc.timeline.unit === 'string' && doc.timeline.unit.trim())
      timeline = {
        unit: doc.timeline.unit.trim(),
        ...(finite(doc.timeline.total) ? { total: doc.timeline.total } : {}),
      };
    else fail('TYPE', 'timeline', '', 'timeline 无效。', '使用 { "unit": "步骤" }。');
  }

  // Authored storyboard. References use author ids and are mapped here.
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
  const edgeLookup = new Map<string, string>([...explicitEdgeIds]);
  for (const edge of edges) if (!edgeLookup.has(edge.id)) edgeLookup.set(edge.id, edge.id);
  rawScenes.forEach((s, i) => {
    const path = `presentation[${i}]`;
    if (!object(s)) {
      fail('TYPE', path, '', '分镜必须是对象。', '使用 { "title": …, "durationSec": … }。');
      return;
    }
    const raw = sceneNames[i];
    if (sceneSeen.has(raw)) {
      fail('DUPLICATE_ID', path + '.id', raw, '分镜 id 重复。', '每个分镜使用唯一 id，或省略 id。');
      return;
    }
    sceneSeen.add(raw);
    const refs = (
      value: unknown,
      table: Map<string, string>,
      field: string,
    ): string[] | undefined => {
      if (value === undefined || value === null) return undefined;
      if (!Array.isArray(value)) {
        fail('TYPE', `${path}.${field}`, raw, `${field} 必须是数组。`, '改为 id 数组。');
        return undefined;
      }
      const out: string[] = [];
      value.forEach((entry, j) => {
        const id = rawId(entry),
          mapped = id === null ? undefined : table.get(id);
        if (mapped) out.push(mapped);
        else
          fail('SCENE_REF', `${path}.${field}[${j}]`, raw, '引用了不存在的对象。', '使用已有 id。');
      });
      return out;
    };
    const ref = (value: unknown, table: Map<string, string>, field: string): string | undefined => {
      if (value === undefined || value === null) return undefined;
      const id = rawId(value),
        mapped = id === null ? undefined : table.get(id);
      if (!mapped)
        fail('SCENE_REF', `${path}.${field}`, raw, '引用了不存在的对象。', '使用已有 id。');
      return mapped;
    };
    const camera = object(s.camera) ? s.camera : undefined,
      highlight = object(s.highlight) ? s.highlight : undefined;
    if (s.camera !== undefined && !camera)
      fail('TYPE', path + '.camera', raw, 'camera 必须是对象。', '使用 { "fitIds": […] }。');
    if (s.highlight !== undefined && !highlight)
      fail('TYPE', path + '.highlight', raw, 'highlight 必须是对象。', '使用 { "nodeIds": […] }。');
    const duration = s.durationSec === undefined ? 4 : s.durationSec;
    if (!finite(duration) || duration <= 0 || duration > 600)
      fail('DURATION', path + '.durationSec', raw, '时长无效。', '使用 0 到 600 之间的秒数。');
    const zoom = number(camera?.zoom, path + '.camera.zoom', raw);
    if (zoom !== undefined && zoom <= 0)
      fail(
        'CAMERA_ZOOM',
        path + '.camera.zoom',
        raw,
        '镜头缩放无效。',
        '使用大于 0 的数值，或删除 zoom。',
      );
    const transition = number(s.transitionMs, path + '.transitionMs', raw);
    if (transition !== undefined && transition < 0)
      fail('TRANSITION', path + '.transitionMs', raw, '转场时长无效。', '使用不小于 0 的毫秒数。');
    const focus = camera ? ref(camera.focusNodeId, nodeIds, 'camera.focusNodeId') : undefined,
      fit = camera ? refs(camera.fitIds, nodeIds, 'camera.fitIds') : undefined;
    // One shot looks at one thing: a node, or the frame around several.
    if (focus !== undefined && fit?.length)
      fail(
        'CAMERA_CONFLICT',
        path + '.camera',
        raw,
        '镜头目标冲突。',
        'focusNodeId 与 fitIds 只保留一个。',
      );
    scenes.push({
      id: sceneIds.get(raw)!,
      title: text(s.title, path + '.title', raw) ?? `${i + 1}`,
      narration: text(s.narration, path + '.narration', raw),
      durationSec: finite(duration) ? duration : 4,
      transitionMs: transition,
      domainAt: number(s.domainAt, path + '.domainAt', raw),
      camera: camera
        ? { focusNodeId: focus, fitIds: fit, ...(zoom === undefined ? {} : { zoom }) }
        : undefined,
      highlight: highlight
        ? {
            nodeIds: refs(highlight.nodeIds, nodeIds, 'highlight.nodeIds'),
            edgeIds: refs(highlight.edgeIds, edgeLookup, 'highlight.edgeIds'),
            groupId: ref(highlight.groupId, groupIds, 'highlight.groupId'),
          }
        : undefined,
      openDetailNodeId: ref(s.openDetailNodeId, nodeIds, 'openDetailNodeId'),
    });
  });
  if (implicit.length && rawNodes.length)
    warn(
      'IMPLICIT_NODES',
      'edges',
      '',
      `${implicit.length} 个节点只在关系中出现，已按 id 自动创建。`,
      '如需名称、类别或分组，请在 nodes 中声明它们。',
    );
  const title = text(metaRecord.title, 'meta.title', '') ?? '关系图';
  let diagram: DiagramKind = 'network';
  if (doc.diagram !== undefined) {
    if ((DIAGRAM_KINDS as readonly unknown[]).includes(doc.diagram))
      diagram = doc.diagram as DiagramKind;
    else fail('ENUM', 'diagram', '', '图的类型无效。', `可用：${DIAGRAM_KINDS.join('、')}。`);
  }
  if (doc.unfold !== undefined && typeof doc.unfold !== 'boolean')
    fail('TYPE', 'unfold', '', 'unfold 必须是布尔值。', '使用 true 或 false。');
  if (doc.timeAxis !== undefined && typeof doc.timeAxis !== 'boolean')
    fail('TYPE', 'timeAxis', '', 'timeAxis 必须是布尔值。', '使用 true 或 false。');
  return {
    title,
    description: text(metaRecord.description, 'meta.description', ''),
    sourceNote: text(metaRecord.sourceNote, 'meta.sourceNote', ''),
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
  } satisfies Parsed;
}

const joinLabels = (labels: string[], limit: number): string =>
  labels.slice(0, limit).join(' · ') + (labels.length > limit ? ' …' : '');

/**
 * A storyboard read off the graph's own structure, for documents that do not
 * author one: the whole, then each group, then the best-connected node. A
 * graph with timed facts instead grows step by step along its domain time.
 * Titles and narration reuse author text only, so no language is assumed.
 */
export function autoStoryboard(
  graph: Pick<VisualGraph, 'meta' | 'nodes' | 'edges' | 'groups' | 'timeline'>,
  summaries: ReadonlyMap<string, string> = new Map(),
): VisualScene[] {
  const { nodes, edges, groups } = graph;
  const byImportance = [...nodes].sort(
    (a, b) => (b.importance ?? 0) - (a.importance ?? 0) || compareText(a.id, b.id),
  );
  const overview = (id: string, durationSec: number, narration?: string): VisualScene => ({
    id,
    title: graph.meta.title,
    ...(narration ? { narration } : {}),
    durationSec,
    transitionMs: 900,
  });
  if ([...nodes, ...edges].some((item) => item.visibility))
    return timedStoryboard(graph, summaries, { titles: 'time', follow: false, closing: false });
  const scenes: VisualScene[] = [overview('auto-overview', 5, graph.meta.description)];
  if (groups.length >= 2 && groups.length <= 6 && nodes.length > groups.length)
    for (const group of groups) {
      const members = byImportance.filter((n) => n.groupId === group.id);
      if (!members.length) continue;
      scenes.push({
        id: `auto-group-${group.id}`,
        title: group.label,
        narration: joinLabels(
          members.map((n) => n.label),
          5,
        ),
        durationSec: 3.5,
        transitionMs: 900,
        highlight: { groupId: group.id },
        camera: members.length > 1 ? { fitIds: members.map((n) => n.id) } : undefined,
      });
    }
  const hub = byImportance[0];
  const incident = hub ? edges.filter((e) => e.source === hub.id || e.target === hub.id) : [];
  if (hub && nodes.length >= 4 && incident.length >= 2) {
    const neighbours = [
      ...new Set(incident.map((e) => (e.source === hub.id ? e.target : e.source))),
    ].filter((id) => id !== hub.id);
    const labels = new Map(nodes.map((n) => [n.id, n.label]));
    const summary = summaries.get(hub.id);
    scenes.push({
      id: 'auto-hub',
      title: hub.label,
      narration:
        summary ??
        joinLabels(
          neighbours.map((id) => labels.get(id) ?? id),
          6,
        ),
      durationSec: 4.5,
      transitionMs: 900,
      highlight: { nodeIds: [hub.id, ...neighbours], edgeIds: incident.map((e) => e.id) },
      camera: { fitIds: [hub.id, ...neighbours] },
      ...(summary ? { openDetailNodeId: hub.id } : {}),
    });
  }
  if (scenes.length > 1) scenes.push(overview('auto-closing', 3.5, graph.meta.sourceNote));
  return scenes;
}

/**
 * One shot per step of domain time, each showing what has just arrived. Used
 * for graphs with timed facts, for timelines, and for diagrams that unfold
 * level by level.
 */
function timedStoryboard(
  graph: Pick<VisualGraph, 'meta' | 'nodes' | 'edges' | 'timeline'>,
  summaries: ReadonlyMap<string, string>,
  options: { titles: 'time' | 'labels'; follow: boolean; closing: boolean },
): VisualScene[] {
  const { nodes, edges } = graph;
  // Principals first; peers in the order the author wrote them.
  const written = new Map(nodes.map((n, i) => [n.id, i]));
  const byImportance = [...nodes].sort(
    (a, b) => (b.importance ?? 0) - (a.importance ?? 0) || written.get(a.id)! - written.get(b.id)!,
  );
  const times = [
    ...new Set(
      [...nodes, ...edges]
        .flatMap((item) => [item.visibility?.from, item.visibility?.to])
        .filter((value): value is number => value !== undefined),
    ),
  ].sort((a, b) => a - b);
  // At most twelve steps, spread evenly over the timed range.
  const steps =
    times.length <= 12
      ? times
      : Array.from({ length: 12 }, (_, i) => times[Math.round((i * (times.length - 1)) / 11)]);
  const scenes = steps.map((at, index): VisualScene => {
    const since = index ? steps[index - 1] : -Infinity;
    const fresh = (item: { visibility?: { from?: number } }): boolean =>
      item.visibility?.from !== undefined &&
      item.visibility.from > since &&
      item.visibility.from <= at;
    // Untimed nodes have been there from the start.
    const arriving = byImportance.filter((n) => fresh(n) || (!index && !n.visibility)),
      labels = arriving.map((n) => n.label),
      told = arriving.map((n) => summaries.get(n.id)).find(Boolean);
    const title =
      options.titles === 'time'
        ? `${graph.timeline?.unit ?? ''} ${at}`.trim()
        : labels.length
          ? joinLabels(labels, 3)
          : graph.meta.title;
    const narration =
      options.titles === 'time'
        ? labels.length
          ? joinLabels(labels, 6)
          : undefined
        : (told ?? (labels.length > 3 ? joinLabels(labels.slice(3), 6) : undefined));
    const visible = nodes.filter((n) => (n.visibility?.from ?? -Infinity) <= at);
    // Light what is new, once there is something older to set it against.
    const highlight =
      index && arriving.length && arriving.length < visible.length
        ? {
            nodeIds: arriving.map((n) => n.id),
            edgeIds: edges.filter(fresh).map((e) => e.id),
          }
        : undefined;
    // A timeline travels: the frame holds what is arriving and what it meets.
    const company = options.follow
      ? visible.filter(
          (n) =>
            arriving.includes(n) || (n.span && (n.span.to === undefined || n.span.to >= since)),
        )
      : [];
    return {
      id: `auto-step-${index + 1}`,
      title,
      ...(narration ? { narration } : {}),
      durationSec: index === steps.length - 1 && !options.closing ? 4 : 3,
      transitionMs: 900,
      domainAt: at,
      ...(highlight ? { highlight } : {}),
      ...(company.length > 1 && company.length < visible.length
        ? { camera: { fitIds: company.map((n) => n.id) } }
        : {}),
    };
  });
  if (options.closing && scenes.length > 1)
    scenes.push({
      id: 'auto-closing',
      title: graph.meta.title,
      ...((graph.meta.description ?? graph.meta.sourceNote)
        ? { narration: graph.meta.description ?? graph.meta.sourceNote }
        : {}),
      durationSec: 4.5,
      transitionMs: 1100,
    });
  return scenes;
}

/**
 * Give a diagram the hierarchy, branch colours and unfolding its kind implies.
 * Authored weights, colours, groups, timing and storyboards always win.
 */
function shapeDiagram(
  graph: VisualGraph,
  { diagram, unfold, weighted }: Pick<Parsed, 'diagram' | 'unfold' | 'weighted'>,
  summaries: ReadonlyMap<string, string>,
): void {
  if (diagram === 'network') return;
  const { nodes, edges } = graph;
  const tree = diagram === 'tree' || diagram === 'mindmap';
  const structure = diagram === 'timeline' ? null : diagramStructure(graph, tree ? 'tree' : 'flow');
  if (!weighted)
    for (const node of nodes) {
      const level = structure?.level.get(node.id) ?? 0;
      // Trees speak from the root outwards; steps and spans are peers.
      node.importance = tree ? Math.max(2, 5 - level) : 3;
    }
  if (tree && structure && !graph.groups.length)
    for (const node of nodes) {
      const branch = structure.branch.get(node.id);
      if (!node.color && branch !== undefined && branch < TONE_COUNT) node.tone = branch;
    }
  if (graph.scenes.length) return;
  const timed = [...nodes, ...edges].some((item) => item.visibility);
  if (structure && unfold && !timed && nodes.length > 1) {
    // Reveal one level at a time, folding very deep diagrams into twelve steps.
    const deepest = Math.max(...structure.level.values()),
      step = (id: string): number => {
        const level = structure.level.get(id) ?? 0;
        return 1 + (deepest > 11 ? Math.floor((level * 11) / deepest) : level);
      };
    for (const node of nodes) node.visibility = { from: step(node.id) };
    for (const edge of edges)
      edge.visibility = { from: Math.max(step(edge.source), step(edge.target)) };
    // The steps are reveal order, not time: no frame may present them as a date.
    graph.timeline = { unit: '', ordinal: true };
    graph.scenes = timedStoryboard(graph, summaries, {
      titles: 'labels',
      follow: false,
      closing: true,
    });
  } else if (timed)
    graph.scenes = timedStoryboard(graph, summaries, {
      titles: 'time',
      follow: diagram === 'timeline',
      closing: true,
    });
}

export function validateGenericDocument(doc: unknown): {
  valid: boolean;
  errors: GenericDiagnostic[];
  warnings: GenericDiagnostic[];
} {
  const errors: GenericDiagnostic[] = [],
    warnings: GenericDiagnostic[] = [];
  parse(doc, errors, warnings);
  return { valid: errors.length === 0, errors, warnings };
}

export function adaptGenericDocument(input: unknown) {
  const errors: GenericDiagnostic[] = [],
    warnings: GenericDiagnostic[] = [];
  const parsed = parse(input, errors, warnings);
  if (!parsed || errors.length)
    throw Object.assign(new Error('Invalid generic graph document'), { issues: errors });
  const summaries = new Map<string, string>();
  const nodes: VisualNode[] = parsed.nodes.map(({ summary, ...node }) => {
    if (summary) summaries.set(node.id, summary);
    return node;
  });
  const graph: VisualGraph = {
    domain: 'graph',
    meta: {
      title: parsed.title,
      description: parsed.description,
      sourceNote: parsed.sourceNote,
    },
    timeline: parsed.timeline,
    ...(parsed.diagram === 'network' ? {} : { diagram: parsed.diagram }),
    ...(parsed.diagram === 'timeline' && !parsed.timeAxis ? { timeAxis: false as const } : {}),
    kinds: parsed.kinds,
    groups: parsed.groups,
    nodes,
    edges: parsed.edges,
    scenes: parsed.scenes,
  };
  shapeDiagram(graph, parsed, summaries);
  // A timeline keeps time unless it says otherwise: authored x that is not a
  // node's place in time is redrawn there, and the author is told how to keep it.
  if (graph.diagram === 'timeline' && graph.timeAxis !== false) {
    const nodes = timedNodes(graph),
      axis = axisOf(nodes);
    const off = axis
      ? nodes.filter((node) => {
          const x = placeInTime(node, axis);
          return node.position && x !== null && !(Math.abs(node.position.x - x) <= TIME_TOLERANCE);
        }).length
      : 0;
    if (off)
      warnings.push({
        level: 'warning',
        layer: 'graph-source',
        code: 'OFF_TIME_AXIS',
        path: 'nodes',
        id: '',
        message: `${off} 个带日期的节点横坐标不在其时间上，已按日期绘制。`,
        fix: '如需保留这些横坐标并不显示时间轴，请设置 "timeAxis": false。',
      });
  }
  if (!graph.scenes.length) graph.scenes = autoStoryboard(graph, summaries);
  const check = validateVisualGraph(graph);
  if (!check.valid)
    throw Object.assign(new Error('Generic projection invalid'), { issues: check.errors });
  return {
    graph,
    diagnostics: { valid: true, errors, warnings },
    /** Node summaries are author display text and follow node visibility. */
    detailAt: (id: string): { summary: string } | undefined => {
      const summary = summaries.get(id);
      return summary ? { summary } : undefined;
    },
    sourceIds: parsed.sourceIds,
  };
}
