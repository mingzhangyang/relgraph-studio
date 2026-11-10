import type { DirectorFrameState } from '@relgraph/core';
import type { DisplayList } from '@relgraph/render';
import type { Scope, Selection } from './project-editor-model.js';

export interface InspectorFocus {
  kind: 'node' | 'edge';
  selection: Selection;
  scope: Scope;
}

type HitTarget = NonNullable<DisplayList['selection']>[number];
type VisibleObject =
  DirectorFrameState['view']['nodes'][number] | DirectorFrameState['view']['edges'][number];

export interface OverlayProjection {
  width: number;
  height: number;
  clip: { x: number; y: number; w: number; h: number };
  targets: { hit: HitTarget; selected: boolean }[];
  affectedCount: number;
  message: string;
}

const finite = (value: number): boolean => Number.isFinite(value);
const drawable = (hit: HitTarget): boolean => {
  if (hit.box)
    return (
      [hit.box.x, hit.box.y, hit.box.w, hit.box.h].every(finite) && hit.box.w > 0 && hit.box.h > 0
    );
  return (
    hit.points !== undefined &&
    hit.points.length > 1 &&
    hit.points.every((point) => finite(point.x) && finite(point.y))
  );
};

function intersectsClip(
  hit: HitTarget,
  clip: { x: number; y: number; w: number; h: number },
): boolean {
  if (![clip.x, clip.y, clip.w, clip.h].every(finite) || clip.w <= 0 || clip.h <= 0) return false;
  const right = clip.x + clip.w;
  const bottom = clip.y + clip.h;
  if (!finite(right) || !finite(bottom)) return false;
  if (hit.box)
    return (
      hit.box.x <= right &&
      hit.box.x + hit.box.w >= clip.x &&
      hit.box.y <= bottom &&
      hit.box.y + hit.box.h >= clip.y
    );

  // A polyline's bounding box may overlap a clip corner even when every
  // segment is outside. Check each segment with Liang-Barsky clipping instead.
  const points = hit.points ?? [];
  for (let i = 1; i < points.length; i++) {
    const a = points[i - 1];
    const b = points[i];
    const dx = b.x - a.x;
    const dy = b.y - a.y;
    if (!finite(dx) || !finite(dy)) continue;
    let start = 0;
    let end = 1;
    const bounds: [number, number][] = [
      [-dx, a.x - clip.x],
      [dx, right - a.x],
      [-dy, a.y - clip.y],
      [dy, bottom - a.y],
    ];
    let overlaps = true;
    for (const [direction, distance] of bounds) {
      if (direction === 0) {
        if (distance < 0) {
          overlaps = false;
          break;
        }
        continue;
      }
      const t = distance / direction;
      if (direction < 0) start = Math.max(start, t);
      else end = Math.min(end, t);
      if (start > end) {
        overlaps = false;
        break;
      }
    }
    if (overlaps) return true;
  }
  return false;
}

/**
 * Selection feedback is strictly a WORKSPACE projection of already-safe frame
 * objects and already-composed hit geometry. Never consult the raw source graph.
 * The return value is never passed to FrameSpec, DisplayList or the exporter.
 */
export function projectSelectionOverlay(
  frame: Pick<DirectorFrameState, 'view'> | null,
  list: Pick<DisplayList, 'width' | 'height' | 'selection' | 'selectionClip'> | null,
  focus: InspectorFocus,
): OverlayProjection {
  const width = list?.width ?? 1280;
  const height = list?.height ?? 720;
  const clip = list?.selectionClip ?? { x: 0, y: 0, w: width, h: height };
  const noun = focus.kind === 'node' ? '节点' : '连线';
  const visible: readonly VisibleObject[] = frame
    ? frame.view[focus.kind === 'node' ? 'nodes' : 'edges']
    : [];
  const selected =
    focus.selection?.kind === focus.kind
      ? visible.find((item) => item.id === focus.selection?.id)
      : undefined;

  let affected: readonly VisibleObject[] = selected && focus.scope === 'object' ? [selected] : [];
  if (focus.scope === 'global') affected = visible;
  if (focus.scope === 'category' && selected)
    affected = visible.filter((item) => item.kind === selected.kind);
  const eligibleIds = new Set(affected.map((item) => item.id));
  const targets = (list?.selection ?? [])
    .filter(
      (hit) =>
        hit.kind === focus.kind &&
        eligibleIds.has(hit.id) &&
        drawable(hit) &&
        intersectsClip(hit, clip),
    )
    .map((hit) => ({ hit, selected: selected?.id === hit.id }));

  const message = !frame
    ? '请选择数据后，可在画面上查看选中对象和影响范围。'
    : focus.scope === 'global'
      ? `全局${noun}样式 · 当前投影 ${affected.length} 个，已描边 ${targets.length} 个`
      : !selected
        ? `请选择一个${noun}，查看其${focus.scope === 'category' ? '类别' : '位置'}。`
        : focus.scope === 'category'
          ? `当前类别 · 当前投影 ${affected.length} 个${noun}，已描边 ${targets.length} 个`
          : `已选中${noun} · ${targets.length ? '画面已描边' : '尚未绘制到当前画面'}`;

  return { width, height, clip, targets, affectedCount: affected.length, message };
}
