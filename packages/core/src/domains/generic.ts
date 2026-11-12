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
import { NODE_SHAPES, TONE_COUNT, type GraphKinds, type KindDeclaration } from '../style.js';
import type {
  VisualEdge,
  VisualGraph,
  VisualGroup,
  VisualNode,
  VisualScene,
} from '../../types/visual-graph.js';

export const GENERIC_FORMAT = 'relgraph.graph/1';
export const GENERIC_LIMITS = Object.freeze({ nodes: 5000, edges: 20000, text: 2000, id: 200 });

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
              if (['solid', 'dashed', 'dotted'].includes(value.line as string))
                entry.line = value.line as KindDeclaration['line'];
              else fail('ENUM', path + '.line', '', '线型无效。', '可用：solid、dashed、dotted。');
            }
            if (value.head !== undefined) {
              if (['arrow', 'bar', 'hollow-circle', 'none'].includes(value.head as string))
                entry.head = value.head as KindDeclaration['head'];
              else
                fail(
                  'ENUM',
                  path + '.head',
                  '',
                  '端点无效。',
                  '可用：arrow、bar、hollow-circle、none。',
                );
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
  const defaultDirected = doc.directed === true;

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
    nodes.push({
      id,
      label: text(record.label, path + '.label', raw) ?? raw,
      kind: kindName(record.kind, 'node', path + '.kind', raw),
      groupId: group === null ? null : groupIds.get(group)!,
      color: colour(record.color, path + '.color', raw),
      position,
      visibility: visibility(record, path, raw),
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
  const sceneIds = internalIds(
    rawScenes.map((s, i) => (object(s) ? (rawId(s.id) ?? `scene-${i + 1}`) : `scene-${i + 1}`)),
  );
  const edgeLookup = new Map<string, string>([...explicitEdgeIds]);
  for (const edge of edges) if (!edgeLookup.has(edge.id)) edgeLookup.set(edge.id, edge.id);
  rawScenes.forEach((s, i) => {
    const path = `presentation[${i}]`;
    if (!object(s)) {
      fail('TYPE', path, '', '分镜必须是对象。', '使用 { "title": …, "durationSec": … }。');
      return;
    }
    const raw = rawId(s.id) ?? `scene-${i + 1}`;
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
    scenes.push({
      id: sceneIds.get(raw)!,
      title: text(s.title, path + '.title', raw) ?? `${i + 1}`,
      narration: text(s.narration, path + '.narration', raw),
      durationSec: finite(duration) ? duration : 4,
      transitionMs: number(s.transitionMs, path + '.transitionMs', raw),
      domainAt: number(s.domainAt, path + '.domainAt', raw),
      camera: camera
        ? {
            focusNodeId: ref(camera.focusNodeId, nodeIds, 'camera.focusNodeId'),
            fitIds: refs(camera.fitIds, nodeIds, 'camera.fitIds'),
            ...(zoom === undefined ? {} : { zoom }),
          }
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
  return {
    title,
    description: text(metaRecord.description, 'meta.description', ''),
    sourceNote: text(metaRecord.sourceNote, 'meta.sourceNote', ''),
    timeline,
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
  const times = [
    ...new Set(
      [...nodes, ...edges]
        .flatMap((item) => [item.visibility?.from, item.visibility?.to])
        .filter((value): value is number => value !== undefined),
    ),
  ].sort((a, b) => a - b);
  if (times.length) {
    // At most twelve steps, spread evenly over the timed range.
    const steps =
      times.length <= 12
        ? times
        : Array.from({ length: 12 }, (_, i) => times[Math.round((i * (times.length - 1)) / 11)]);
    return steps.map((at, index) => {
      const arriving = byImportance.filter((n) => n.visibility?.from === at).map((n) => n.label);
      return {
        id: `auto-step-${index + 1}`,
        title: `${graph.timeline?.unit ?? ''} ${at}`.trim(),
        ...(arriving.length ? { narration: joinLabels(arriving, 6) } : {}),
        durationSec: index === steps.length - 1 ? 4 : 3,
        transitionMs: 900,
        domainAt: at,
      };
    });
  }
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
    kinds: parsed.kinds,
    groups: parsed.groups,
    nodes,
    edges: parsed.edges,
    scenes: parsed.scenes,
  };
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
