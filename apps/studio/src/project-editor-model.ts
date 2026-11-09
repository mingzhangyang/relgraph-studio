import {
  nodeAppearance,
  type ProjectConfig,
  type VisualNode,
  type VisualEdge,
  type AppearanceLayers,
  type NodeAppearance,
  type EdgeAppearance,
} from '@relgraph/core';
export type Selection = { kind: 'node' | 'edge'; id: string } | null;
export type Scope = 'global' | 'category' | 'object';
// Config is JSON data. Copying here isolates history, imports and source evidence.
export const copyConfig = (value: ProjectConfig): ProjectConfig => {
  const { assets, ...rest } = value;
  const copy = JSON.parse(JSON.stringify(rest)) as ProjectConfig;
  if (assets)
    copy.assets = Object.fromEntries(
      Object.entries(assets).map(([id, asset]) => [id, { ...asset }]),
    );
  return copy;
};

export class ProjectHistory {
  value: ProjectConfig = {};
  private undoStack: ProjectConfig[] = [];
  private redoStack: ProjectConfig[] = [];
  reset(value: ProjectConfig = {}): void {
    this.value = copyConfig(value);
    this.undoStack = [];
    this.redoStack = [];
  }
  commit(next: ProjectConfig): boolean {
    if (JSON.stringify(next) === JSON.stringify(this.value)) return false;
    this.undoStack.push(copyConfig(this.value));
    if (this.undoStack.length > 100) this.undoStack.shift();
    this.value = copyConfig(next);
    this.redoStack = [];
    return true;
  }
  undo(): void {
    const value = this.undoStack.pop();
    if (value) {
      this.redoStack.push(this.value);
      this.value = value;
    }
  }
  redo(): void {
    const value = this.redoStack.pop();
    if (value) {
      this.undoStack.push(this.value);
      this.value = value;
    }
  }
  get canUndo(): boolean {
    return this.undoStack.length > 0;
  }
  get canRedo(): boolean {
    return this.redoStack.length > 0;
  }
}
export function editAppearance(
  config: ProjectConfig,
  kind: 'node' | 'edge',
  item: VisualNode | VisualEdge | undefined,
  scope: Scope,
  field: string,
  value: unknown,
): ProjectConfig {
  const next = copyConfig(config),
    collection = kind === 'node' ? 'nodes' : 'edges';
  if (!item && scope !== 'global') return next;
  const layers = (next[collection] ??= {}) as AppearanceLayers<NodeAppearance & EdgeAppearance>;
  const key = scope === 'category' ? item!.kind : item?.id;
  const map =
    scope === 'global'
      ? undefined
      : (layers[scope === 'category' ? 'categories' : 'objects'] ??= {});
  if (map && key && !Object.hasOwn(map, key))
    Object.defineProperty(map, key, {
      value: {},
      writable: true,
      enumerable: true,
      configurable: true,
    });
  const target = (scope === 'global' ? (layers.defaults ??= {}) : (map![key!] ??= {})) as Record<
    string,
    unknown
  >;
  if (value === undefined) delete target[field];
  else target[field] = value;
  return next;
}
export function clearAppearance(
  config: ProjectConfig,
  kind: 'node' | 'edge',
  item: VisualNode | VisualEdge | undefined,
  scope: Scope,
): ProjectConfig {
  const next = copyConfig(config),
    layers = next[kind === 'node' ? 'nodes' : 'edges'];
  if (!layers) return next;
  if (scope === 'global') delete layers.defaults;
  else if (item)
    delete layers[scope === 'category' ? 'categories' : 'objects']?.[
      scope === 'category' ? item.kind : item.id
    ];
  return next;
}

/** Drop unreferenced pixels in the next snapshot; earlier undo snapshots own theirs. */
export function pruneImageAssets(config: ProjectConfig): ProjectConfig {
  const used = new Set<string>();
  const layers = config.nodes;
  for (const style of [
    layers?.defaults,
    ...Object.values(layers?.categories ?? {}),
    ...Object.values(layers?.objects ?? {}),
  ])
    if (typeof style?.image === 'string') used.add(style.image);
  if (config.assets)
    config.assets = Object.fromEntries(
      Object.entries(config.assets).filter(([id]) => used.has(id)),
    );
  return config;
}
/** Restore only this node's inherited image, regardless of the active style scope. */
export function inheritNodeImage(config: ProjectConfig, node: VisualNode): ProjectConfig {
  return pruneImageAssets(editAppearance(config, 'node', node, 'object', 'image', undefined));
}
export function setNodeImage(
  config: ProjectConfig,
  node: VisualNode,
  id: string | null,
  asset?: import('@relgraph/core').ImageAsset,
): ProjectConfig {
  let next = editAppearance(config, 'node', node, 'object', 'image', id);
  if (id && asset) {
    next.assets = { ...next.assets, [id]: { ...asset } };
    if (nodeAppearance(config, node).size === undefined)
      next = editAppearance(next, 'node', node, 'object', 'size', 32);
  }
  return pruneImageAssets(next);
}
