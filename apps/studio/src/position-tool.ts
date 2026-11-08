import {
  cameraCenterFor,
  projectCameraPoint,
  worldWithScreenOffset,
  nodeGlyphBounds,
  rectsIntersect,
  type FrameSpec,
} from '@relgraph/render';
import { NEUTRAL_STYLE, type DirectorFrameState, type DomainStyle, type VisualNode } from '@relgraph/core';

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
  return projectCameraPoint(point, camera, spec);
}

export function graphPosition(point: Point, camera: Camera, spec: FrameSpec): Point {
  const center = cameraCenterFor(spec);
  const factor = camera.scale * spec.typeScale;
  if (!(factor > 0) || !Number.isFinite(factor))
    throw new RangeError('Invalid camera scale for position editing');
  const x = worldWithScreenOffset(camera.x, point.x - center.x, factor);
  const y = worldWithScreenOffset(camera.y, point.y - center.y, factor);
  if (x === null || y === null)
    throw new RangeError('Screen point has no finite world coordinate');
  return { x, y };
}

/** A single reveal threshold used by hit-testing and editing policy. */
export function isNodeEditableNow(id: string, reveal: DirectorFrameState['reveal']): boolean {
  return Object.hasOwn(reveal.nodes, id) && reveal.nodes[id] > 0.5;
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
  style: DomainStyle = NEUTRAL_STYLE,
): string | null {
  // The composer clips all graph drawing to this stage. Without the same
  // constraint, a node outside it can be dragged through the caption band.
  const stage = spec.stage;
  if (
    !Number.isFinite(point.x) ||
    !Number.isFinite(point.y) ||
    point.x < stage.x ||
    point.y < stage.y ||
    point.x > stage.x + stage.w ||
    point.y > stage.y + stage.h
  )
    return null;
  let closest: string | null = null;
  let best = radius * radius;
  for (const node of nodes) {
    if (!isNodeEditableNow(node.id, reveal)) continue;
    const position = positions.get(node.id);
    if (!position) continue;
    const screen = screenPosition(position, camera, spec);
    const bounds = nodeGlyphBounds(node, screen, camera.scale, spec, style, reveal.nodes[node.id]);
    if (!rectsIntersect(bounds, stage)) continue;
    const distance = (screen.x - point.x) ** 2 + (screen.y - point.y) ** 2;
    if (distance <= best) {
      best = distance;
      closest = node.id;
    }
  }
  return closest;
}
