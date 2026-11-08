import { cameraCenterFor, type FrameSpec } from '@relgraph/render';
import type { DirectorFrameState, VisualNode } from '@relgraph/core';

export type Point = { x: number; y: number };
export type Camera = DirectorFrameState['cameraResolved'];
export type ClientRect = { left: number; top: number; width: number; height: number };

export function canvasPoint(
  client: Point,
  rect: ClientRect,
  size: { width: number; height: number },
): Point | null {
  if (
    !Number.isFinite(client.x) ||
    !Number.isFinite(client.y) ||
    !(rect.width > 0 && rect.height > 0 && size.width > 0 && size.height > 0)
  )
    return null;
  return {
    x: ((client.x - rect.left) * size.width) / rect.width,
    y: ((client.y - rect.top) * size.height) / rect.height,
  };
}

export function screenPosition(point: Point, camera: Camera, spec: FrameSpec): Point {
  const center = cameraCenterFor(spec);
  return {
    x: center.x + (point.x - camera.x) * camera.scale * spec.typeScale,
    y: center.y + (point.y - camera.y) * camera.scale * spec.typeScale,
  };
}

export function graphPosition(point: Point, camera: Camera, spec: FrameSpec): Point {
  const center = cameraCenterFor(spec);
  const factor = camera.scale * spec.typeScale;
  if (!(factor > 0) || !Number.isFinite(factor))
    throw new RangeError('Invalid camera scale for position editing');
  return {
    x: camera.x + (point.x - center.x) / factor,
    y: camera.y + (point.y - center.y) / factor,
  };
}

/**
 * Hit-test visible, sufficiently revealed nodes, not raw source data.
 * A layout edit cannot accidentally select a still-hidden story character.
 */
export function hitVisibleNode(
  nodes: readonly VisualNode[],
  positions: ReadonlyMap<string, Point>,
  reveal: DirectorFrameState['reveal'],
  camera: Camera,
  spec: FrameSpec,
  point: Point,
  radius: number,
): string | null {
  let closest: string | null = null;
  let best = radius * radius;
  for (const node of nodes) {
    const progress = Object.hasOwn(reveal.nodes, node.id) ? reveal.nodes[node.id] : 0;
    if (progress <= 0.5) continue;
    const position = positions.get(node.id);
    if (!position) continue;
    const screen = screenPosition(position, camera, spec);
    const distance = (screen.x - point.x) ** 2 + (screen.y - point.y) ** 2;
    if (distance <= best) {
      best = distance;
      closest = node.id;
    }
  }
  return closest;
}
