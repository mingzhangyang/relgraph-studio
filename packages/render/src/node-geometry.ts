import { nodeStyleFor, type DomainStyle, type NodeShape, type VisualNode } from '@relgraph/core';
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

interface GlyphGeometry {
  shape: NodeShape;
  halfWidth: number;
  halfHeight: number;
  cornerRadius: number;
  halfStroke: number;
}

/** Exactly the outline dimensions used by composeFrame, including reveal scaling. */
function glyphGeometry(
  node: Pick<VisualNode, 'kind' | 'importance'>,
  cameraScale: number,
  spec: FrameSpec,
  style: DomainStyle,
  revealProgress: number,
): GlyphGeometry {
  const radius = nodeRadius(node, cameraScale, spec, style);
  const shape = nodeStyleFor(style, node.kind).shape;
  const unit = spec.typeScale;
  const revealScale = revealProgress < 1 ? 0.82 + 0.18 * revealProgress : 1;
  return {
    shape,
    halfWidth: (radius + (shape === 'pill' ? 4 : 3) * unit) * revealScale,
    halfHeight: (shape === 'pill' ? radius * 0.75 : radius + 3 * unit) * revealScale,
    cornerRadius: (shape === 'pill' ? radius * 0.65 : 0) * revealScale,
    halfStroke: 0.9 * unit * revealScale,
  };
}

function boundsFor(point: NodePoint, g: GlyphGeometry): Rect {
  const width = g.halfWidth + g.halfStroke;
  const height = g.halfHeight + g.halfStroke;
  return { x: point.x - width, y: point.y - height, w: 2 * width, h: 2 * height };
}

/** Conservative screen-space box of the rendered node glyph. */
export function nodeGlyphBounds(
  node: Pick<VisualNode, 'kind' | 'importance'>,
  point: NodePoint,
  cameraScale: number,
  spec: FrameSpec,
  style: DomainStyle,
  revealProgress = 1,
): Rect {
  return boundsFor(point, glyphGeometry(node, cameraScale, spec, style, revealProgress));
}

export const rectsIntersect = (a: Rect, b: Rect): boolean =>
  a.x < b.x + b.w && a.x + a.w > b.x && a.y < b.y + b.h && a.y + a.h > b.y;

/**
 * Check the actual circle, diamond or round-rect outline against stage clipping.
 * Bounding-box overlap alone is insufficient at corners: a circle's box can
 * overlap the stage even when every part of the circle is outside it.
 *
 * The stage's point closest to the glyph centre is sufficient because all
 * three drawn outlines are convex and symmetric about their centre.
 */
export function nodeGlyphIntersectsStage(
  node: Pick<VisualNode, 'kind' | 'importance'>,
  point: NodePoint,
  cameraScale: number,
  spec: FrameSpec,
  style: DomainStyle,
  revealProgress = 1,
): boolean {
  const g = glyphGeometry(node, cameraScale, spec, style, revealProgress);
  if (!rectsIntersect(boundsFor(point, g), spec.stage)) return false;

  const stage = spec.stage;
  const dx = Math.max(stage.x - point.x, 0, point.x - (stage.x + stage.w));
  const dy = Math.max(stage.y - point.y, 0, point.y - (stage.y + stage.h));
  if (!Number.isFinite(dx) || !Number.isFinite(dy)) return false;

  if (g.shape === 'circle') {
    return Math.hypot(dx, dy) < g.halfWidth + g.halfStroke;
  }

  if (g.shape === 'diamond') {
    // Euclidean distance to the filled diamond |x| + |y| <= halfWidth.
    // Unlike an inflated diamond AABB, this also handles the pointed tips.
    const radius = g.halfWidth;
    let distance: number;
    if (dx + dy <= radius) distance = 0;
    else if (dx - dy >= radius) distance = Math.hypot(dx - radius, dy);
    else if (dy - dx >= radius) distance = Math.hypot(dx, dy - radius);
    else distance = (dx + dy - radius) / Math.SQRT2;
    return distance < g.halfStroke;
  }

  // Rounded rectangle: signed distance to the path's actual rounded corners.
  const qx = dx - (g.halfWidth - g.cornerRadius);
  const qy = dy - (g.halfHeight - g.cornerRadius);
  const distance =
    Math.hypot(Math.max(qx, 0), Math.max(qy, 0)) +
    Math.min(Math.max(qx, qy), 0) -
    g.cornerRadius;
  return distance < g.halfStroke;
}
