import { validImageAsset, MAX_IMAGE_BYTES, type ImageAsset } from './image-assets.js';
import type { VisualGraph, VisualNode, VisualEdge } from '../types/visual-graph.js';
import type { NodeShape, EdgeHead } from './style.js';

export interface NodeAppearance {
  image?: string | null;
  imageFit?: 'cover' | 'contain';
  shape?: NodeShape;
  size?: number;
  fill?: string;
  border?: string;
  borderWidth?: number;
  fontSize?: number;
  fontWeight?: number;
  textColor?: string;
  textPosition?: 'auto' | 'top' | 'bottom' | 'left' | 'right';
}
export interface EdgeAppearance {
  color?: string;
  width?: number;
  dash?: 'solid' | 'dashed' | 'dotted';
  head?: EdgeHead;
  curve?: number;
  showLabel?: boolean;
  fontSize?: number;
  fontWeight?: number;
  textColor?: string;
}
export interface AppearanceLayers<T> {
  defaults?: T;
  categories?: Record<string, T>;
  objects?: Record<string, T>;
}
export interface ProjectConfig {
  assets?: Record<string, ImageAsset>;
  preset?: 'editorial' | 'quiet' | 'presentation';
  nodes?: AppearanceLayers<NodeAppearance>;
  edges?: AppearanceLayers<EdgeAppearance>;
  /** Display copy only: never modifies evidence or its verification status. */
  text?: {
    nodes?: Record<string, { label?: string; description?: string }>;
    edges?: Record<string, { label?: string }>;
  };
  layout?: {
    type: 'manual' | 'force' | 'circle' | 'layered';
    mode: 'preserve' | 'missing' | 'rearrange';
    seed: number;
    spacing: number;
    iterations: number;
    locked: string[];
    positions: Record<string, { x: number; y: number }>;
  };
}
export interface StudioProject {
  format: 'relgraph.studio/1';
  source: unknown;
  config: ProjectConfig;
}
export const isRecord = (v: unknown): v is Record<string, unknown> =>
  v !== null && typeof v === 'object' && !Array.isArray(v);
const enumValue = (v: unknown, values: readonly unknown[]): boolean => values.includes(v);
const numberIn = (v: unknown, min: number, max: number): boolean =>
  typeof v === 'number' && Number.isFinite(v) && v >= min && v <= max;

/** One authoritative rule set for imported projects AND Studio field controls. */
export type AppearanceFieldRule =
  | { type: 'number'; min: number; max: number }
  | { type: 'enum'; values: readonly (string | number)[] }
  | { type: 'color' }
  | { type: 'boolean' }
  | { type: 'image' };
export type AppearanceKind = 'nodes' | 'edges';
export const APPEARANCE_FIELD_RULES: Record<AppearanceKind, Record<string, AppearanceFieldRule>> = {
  nodes: {
    image: { type: 'image' },
    imageFit: { type: 'enum', values: ['cover', 'contain'] },
    shape: { type: 'enum', values: ['circle', 'pill', 'diamond'] },
    size: { type: 'number', min: 8, max: 48 },
    fill: { type: 'color' },
    border: { type: 'color' },
    borderWidth: { type: 'number', min: 0, max: 8 },
    fontSize: { type: 'number', min: 9, max: 32 },
    fontWeight: { type: 'enum', values: [400, 600] },
    textColor: { type: 'color' },
    textPosition: { type: 'enum', values: ['auto', 'top', 'bottom', 'left', 'right'] },
  },
  edges: {
    color: { type: 'color' },
    width: { type: 'number', min: 0.5, max: 8 },
    dash: { type: 'enum', values: ['solid', 'dashed', 'dotted'] },
    head: { type: 'enum', values: ['arrow', 'bar', 'hollow-circle', 'none'] },
    curve: { type: 'number', min: -160, max: 160 },
    showLabel: { type: 'boolean' },
    fontSize: { type: 'number', min: 9, max: 32 },
    fontWeight: { type: 'enum', values: [400, 600] },
    textColor: { type: 'color' },
  },
};

/** Evaluate a field using the same constraints as full-project validation. */
export function validAppearanceField(kind: AppearanceKind, key: string, value: unknown): boolean {
  const rule = APPEARANCE_FIELD_RULES[kind][key];
  if (!rule) return false;
  switch (rule.type) {
    case 'number':
      return numberIn(value, rule.min, rule.max);
    case 'enum':
      return enumValue(value, rule.values);
    case 'color':
      return typeof value === 'string' && /^#[a-f0-9]{6}$/i.test(value);
    case 'boolean':
      return typeof value === 'boolean';
    case 'image':
      return value === null || (typeof value === 'string' && /^[a-zA-Z0-9_-]{1,100}$/.test(value));
  }
}
const nodeKeys = Object.keys(APPEARANCE_FIELD_RULES.nodes);
const edgeKeys = Object.keys(APPEARANCE_FIELD_RULES.edges);
/** Strict, bounded validation; errors describe fields, never imported display values. */
export function validateProjectConfig(value: unknown, graph?: VisualGraph): string[] {
  const errors: string[] = [];
  const fail = (path: string): void => {
    errors.push(path);
  };
  const keys = (v: unknown, allowed: string[], path: string): v is Record<string, unknown> => {
    if (!isRecord(v)) {
      fail(path);
      return false;
    }
    if (Object.keys(v).some((k) => !allowed.includes(k))) fail(path + ': unknown field');
    return true;
  };
  if (!keys(value, ['preset', 'nodes', 'edges', 'text', 'layout', 'assets'], 'config'))
    return errors;
  if (
    value.preset !== undefined &&
    !enumValue(value.preset, ['editorial', 'quiet', 'presentation'])
  )
    fail('config.preset');
  if (value.assets !== undefined) {
    if (!isRecord(value.assets)) fail('config.assets');
    else {
      let bytes = 0;
      if (Object.keys(value.assets).length > 32) fail('config.assets: at most 32 images');
      for (const [id, asset] of Object.entries(value.assets)) {
        if (!/^[a-zA-Z0-9_-]{1,100}$/.test(id) || !validImageAsset(asset))
          fail('config.assets: invalid raster');
        else bytes += asset.width * asset.height * 4;
      }
      if (bytes > MAX_IMAGE_BYTES) fail('config.assets: pixel budget exceeded');
    }
  }
  for (const kind of ['nodes', 'edges'] as const) {
    const layer = value[kind];
    if (layer === undefined) continue;
    if (!keys(layer, ['defaults', 'categories', 'objects'], `config.${kind}`)) continue;
    const check = (v: unknown): void => {
      const allowed = kind === 'nodes' ? nodeKeys : edgeKeys;
      if (!keys(v, allowed, `config.${kind}.style`)) return;
      if (
        kind === 'nodes' &&
        typeof v.image === 'string' &&
        (!isRecord(value.assets) || !Object.hasOwn(value.assets, v.image))
      )
        fail('config.nodes.image: missing asset');
      for (const [k, x] of Object.entries(v))
        if (!allowed.includes(k) || !validAppearanceField(kind, k, x)) fail(`config.${kind}.${k}`);
    };
    if (layer.defaults !== undefined) check(layer.defaults);
    for (const scope of ['categories', 'objects']) {
      if (layer[scope] === undefined) continue;
      if (!isRecord(layer[scope])) {
        fail(`config.${kind}.${scope}`);
        continue;
      }
      for (const [id, v] of Object.entries(layer[scope])) {
        check(v);
        if (graph && scope === 'objects' && !graph[kind].some((n) => n.id === id))
          fail(`config.${kind}.objects: unknown object`);
        // Biological endpoint markers encode roles; keep those markers authoritative.
        if (graph?.domain === 'biology' && kind === 'edges' && isRecord(v) && v.head !== undefined)
          fail('config.edges.head: biology role marker is protected');
      }
    }
    if (
      graph?.domain === 'biology' &&
      kind === 'edges' &&
      isRecord(layer.defaults) &&
      layer.defaults.head !== undefined
    )
      fail('config.edges.head: biology role marker is protected');
  }
  if (value.text !== undefined && keys(value.text, ['nodes', 'edges'], 'config.text')) {
    for (const kind of ['nodes', 'edges'] as const) {
      const entries = value.text[kind];
      if (entries === undefined) continue;
      if (!isRecord(entries)) {
        fail('config.text.' + kind);
        continue;
      }
      for (const [id, v] of Object.entries(entries)) {
        if (!keys(v, kind === 'nodes' ? ['label', 'description'] : ['label'], 'config.text.copy'))
          continue;
        for (const x of Object.values(v))
          if (typeof x !== 'string' || x.length > 2000) fail('config.text.copy');
        if (graph && !graph[kind].some((n) => n.id === id)) fail('config.text: unknown object');
      }
    }
  }
  const l = value.layout;
  if (
    l !== undefined &&
    keys(
      l,
      ['type', 'mode', 'seed', 'spacing', 'iterations', 'locked', 'positions'],
      'config.layout',
    )
  ) {
    if (!enumValue(l.type, ['manual', 'force', 'circle', 'layered'])) fail('config.layout.type');
    if (!enumValue(l.mode, ['preserve', 'missing', 'rearrange'])) fail('config.layout.mode');
    if (!numberIn(l.seed, 0, 0xffffffff) || !Number.isInteger(l.seed)) fail('config.layout.seed');
    if (!numberIn(l.spacing, 64, 400)) fail('config.layout.spacing');
    if (!numberIn(l.iterations, 0, 2000) || !Number.isInteger(l.iterations))
      fail('config.layout.iterations');
    if (
      !Array.isArray(l.locked) ||
      l.locked.some(
        (id) => typeof id !== 'string' || (graph && !graph.nodes.some((n) => n.id === id)),
      )
    )
      fail('config.layout.locked');
    if (!isRecord(l.positions)) fail('config.layout.positions');
    else
      for (const [id, p] of Object.entries(l.positions)) {
        if (
          !keys(p, ['x', 'y'], 'config.layout.position') ||
          !numberIn(p.x, -1e7, 1e7) ||
          !numberIn(p.y, -1e7, 1e7)
        )
          fail('config.layout.position');
        if (graph && !graph.nodes.some((n) => n.id === id))
          fail('config.layout.positions: unknown object');
      }
  }
  return errors;
}
const own = <T>(map: Record<string, T> | undefined, key: string): T | undefined =>
  map && Object.hasOwn(map, key) ? map[key] : undefined;
export function resolveAppearance<T extends NodeAppearance | EdgeAppearance>(
  layers: AppearanceLayers<T> | undefined,
  kind: string,
  id: string,
): T {
  return {
    ...layers?.defaults,
    ...own(layers?.categories, kind),
    ...own(layers?.objects, id),
  } as T;
}
export function appearanceOrigin<T>(
  layers: AppearanceLayers<T> | undefined,
  kind: string,
  id: string,
  key: keyof T,
): string {
  return own(layers?.objects, id)?.[key] !== undefined
    ? '对象'
    : own(layers?.categories, kind)?.[key] !== undefined
      ? '类别'
      : layers?.defaults?.[key] !== undefined
        ? '全局'
        : '默认';
}
export const nodeAppearance = (
  config: ProjectConfig | undefined,
  node: VisualNode,
): NodeAppearance => ({
  ...(config?.preset === 'quiet'
    ? { borderWidth: 1.2, fontSize: 14 }
    : config?.preset === 'presentation'
      ? { borderWidth: 2.4, fontSize: 18 }
      : {}),
  ...resolveAppearance(config?.nodes, node.kind, node.id),
});
export const edgeAppearance = (
  config: ProjectConfig | undefined,
  edge: VisualEdge,
): EdgeAppearance => ({
  ...(config?.preset === 'quiet'
    ? { width: 1 }
    : config?.preset === 'presentation'
      ? { width: 2 }
      : {}),
  ...resolveAppearance(config?.edges, edge.kind, edge.id),
});
export const displayNodeText = (config: ProjectConfig | undefined, id: string) =>
  own(config?.text?.nodes, id);
export const displayEdgeText = (config: ProjectConfig | undefined, id: string) =>
  own(config?.text?.edges, id);
export function projectSource(value: unknown): unknown {
  return isRecord(value) && value.format === 'relgraph.studio/1' ? value.source : value;
}
export function createProject(source: unknown, config: ProjectConfig): StudioProject {
  return { format: 'relgraph.studio/1', source: projectSource(source), config };
}
