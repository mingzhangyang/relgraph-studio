import { DEFAULT_LAYOUT_SETTINGS, type LayoutSettings, type ProjectConfig } from '@relgraph/core';
import { copyConfig } from './project-editor-model.js';
import type { PositionDrag, PositionMap } from './layout-editor-model.js';
/** Individual edits preserve sparse authored anchors; explicit whole-layout apply captures all. */
export function configWithLayoutPositions(
  config: ProjectConfig,
  current: PositionMap,
  settings: LayoutSettings = config.layout ?? DEFAULT_LAYOUT_SETTINGS,
  editedIds?: readonly string[],
): ProjectConfig {
  const next = copyConfig(config);
  const positions = editedIds
    ? { ...next.layout?.positions }
    : Object.fromEntries([...current].map(([id, p]) => [id, { ...p }]));
  if (editedIds)
    for (const id of editedIds) {
      const p = current.get(id);
      if (p)
        Object.defineProperty(positions, id, {
          value: { ...p },
          enumerable: true,
          configurable: true,
          writable: true,
        });
    }
  next.layout = { ...settings, locked: [...settings.locked], positions };
  return next;
}
export function dragHasChanges(drag: PositionDrag, current: PositionMap): boolean {
  const point = current.get(drag.id);
  return Boolean(point && (point.x !== drag.previous.x || point.y !== drag.previous.y));
}
export function cancelPositionDrag(
  current: Map<string, { x: number; y: number }>,
  drag: PositionDrag,
): void {
  current.set(drag.id, { ...drag.previous });
}
