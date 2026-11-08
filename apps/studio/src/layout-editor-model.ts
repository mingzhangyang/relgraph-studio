import { roundPositionCoordinate, type DirectorFrameState, type VisualNode } from '@relgraph/core';
import { worldWithScreenOffset, type FrameSpec } from '@relgraph/render';
import { hitVisibleNode, isNodeEditableNow, type Point } from './position-tool.js';

/**
 * DOM-independent, spoiler-safe position editing policy.
 *
 * This module never reads window, document, HTML elements or browser events.
 * The workspace adapter owns pointer capture, controls and rendering; the
 * model owns eligibility, coordinate arithmetic and mutation rules.
 */
export type EditableFrame = Pick<DirectorFrameState, 'view' | 'reveal'>;
export type Camera = DirectorFrameState['cameraResolved'];
export type PositionMap = ReadonlyMap<string, Point>;
export interface PositionDrag {
  pointerId: number;
  id: string;
  previous: Point;
  start: Point;
}

/** Reuse the same visibility threshold for keyboard controls and canvas drag. */
export function editableNodes(frame: EditableFrame, positions: PositionMap): VisualNode[] {
  return frame.view.nodes.filter(
    (node) =>
      isNodeEditableNow(node.id, frame.reveal) && positions.has(node.id),
  );
}

export function layoutHasChanges(current: PositionMap, original: PositionMap): boolean {
  if (current.size !== original.size) return true;
  for (const [id, point] of current) {
    const first = original.get(id);
    if (!first || first.x !== point.x || first.y !== point.y) return true;
  }
  return false;
}

/** Restore the previous authored/fallback layout without replacing its Map. */
export function restoreLayoutPositions(
  current: Map<string, Point>,
  original: PositionMap,
): void {
  current.clear();
  for (const [id, point] of original) current.set(id, { ...point });
}

/**
 * Every edit path (keyboard and pointer) passes through the same eligibility
 * guard, so neither path can edit a future/redacted node.
 */
export function updateEditableNodePosition(
  current: Map<string, Point>,
  frame: EditableFrame,
  nodeId: string,
  next: Point,
): boolean {
  if (!Number.isFinite(next.x) || !Number.isFinite(next.y)) return false;
  if (!editableNodes(frame, current).some((node) => node.id === nodeId)) return false;
  const previous = current.get(nodeId);
  if (!previous || (previous.x === next.x && previous.y === next.y)) return false;
  current.set(nodeId, { x: next.x, y: next.y });
  return true;
}

/** Empty strings, NaN, Infinity and non-numeric text never become coordinates. */
export function parseCoordinateInputs(xText: string, yText: string): Point | null {
  if (!xText.trim() || !yText.trim()) return null;
  const x = Number(xText), y = Number(yText);
  return Number.isFinite(x) && Number.isFinite(y) ? { x, y } : null;
}

export function startPositionDrag(
  frame: DirectorFrameState,
  positions: PositionMap,
  spec: FrameSpec,
  point: Point,
  radius: number,
  pointerId: number,
): PositionDrag | null {
  if (!(radius > 0) || !Number.isFinite(radius)) return null;
  const id = hitVisibleNode(
    frame.view.nodes,
    positions,
    frame.reveal,
    frame.cameraResolved,
    spec,
    point,
    radius,
  );
  const previous = id ? positions.get(id) : undefined;
  if (!id || !previous || !editableNodes(frame, positions).some((node) => node.id === id))
    return null;
  return {
    id,
    pointerId,
    previous: { ...previous },
    start: { ...point },
  };
}

/** Relative pixel displacement preserves the original grab offset exactly. */
export function positionForDrag(
  drag: PositionDrag,
  currentPoint: Point,
  camera: Camera,
  spec: FrameSpec,
): Point | null {
  const scale = camera.scale * spec.typeScale;
  if (!(scale > 0) || !Number.isFinite(scale)) return null;
  const dx = currentPoint.x - drag.start.x;
  const dy = currentPoint.y - drag.start.y;
  if (!Number.isFinite(dx) || !Number.isFinite(dy)) return null;
  if (dx === 0 && dy === 0) return { ...drag.previous };
  const x = worldWithScreenOffset(drag.previous.x, dx, scale);
  const y = worldWithScreenOffset(drag.previous.y, dy, scale);
  if (x === null || y === null) return null;
  // Preserve the exact authored precision on the untouched axis. Imported
  // coordinates and keyboard X/Y edits can contain more than two decimals.
  return {
    x: dx === 0 ? drag.previous.x : roundPositionCoordinate(x),
    y: dy === 0 ? drag.previous.y : roundPositionCoordinate(y),
  };
}
