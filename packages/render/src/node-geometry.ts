import { nodeStyleFor, type DomainStyle, type VisualNode } from '@relgraph/core';
import type { FrameSpec, Rect } from './frame-spec.js';

export type NodePoint = { x: number; y: number };

/** Shared with the composer so editor visibility checks use the drawn node size. */
export function nodeRadius(
  node: Pick<VisualNode, 'kind' | 'importance'>,
  cameraScale: number,
  spec: Pick<FrameSpec, 'typeScale'>,
  style: DomainStyle,
): number {
  const importance = node.importance ?? 0;
  const base =
    nodeStyleFor(style, node.kind).baseRadius ??
    (importance >= 5 ? 16 : importance >= 3 ? 13 : 11);
  return Math.min(19, Math.max(8, base * Math.sqrt(cameraScale))) * spec.typeScale;
}

/**
 * Bounds of the actual node outline, including its stroke and reveal scaling.
 * Labels have their own stage-constrained placement; a clipped glyph must not
 * become draggable simply because the pointer lies near its off-stage centre.
 */
export function nodeGlyphBounds(
  node: Pick<VisualNode, 'kind' | 'importance'>,
  point: NodePoint,
  cameraScale: number,
  spec: FrameSpec,
  style: DomainStyle,
  revealProgress = 1,
): Rect {
  const r = nodeRadius(node, cameraScale, spec, style);
  const shape = nodeStyleFor(style, node.kind).shape;
  const u = spec.typeScale;
  const halfStroke = 0.9 * u;
  const halfWidth = (r + (shape === 'pill' ? 4 : 3) * u + halfStroke);
  const halfHeight = ((shape === 'pill' ? r * 0.75 : r + 3 * u) + halfStroke);
  const revealScale = revealProgress < 1 ? 0.82 + 0.18 * revealProgress : 1;
  const width = halfWidth * revealScale;
  const height = halfHeight * revealScale;
  return { x: point.x - width, y: point.y - height, w: 2 * width, h: 2 * height };
}

export const rectsIntersect = (a: Rect, b: Rect): boolean =>
  a.x < b.x + b.w && a.x + a.w > b.x && a.y < b.y + b.h && a.y + a.h > b.y;
