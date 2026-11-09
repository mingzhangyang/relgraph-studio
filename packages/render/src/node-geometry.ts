import {
  nodeStyleFor,
  nodeAppearance,
  type ProjectConfig,
  type DomainStyle,
  type NodeShape,
  type VisualNode,
} from '@relgraph/core';
import type { FrameSpec, Rect } from './frame-spec.js';

type GeometryNode = Pick<VisualNode, 'kind' | 'importance'> & Partial<Pick<VisualNode, 'id'>>;
export type NodePoint = { x: number; y: number };

/** Shared with the composer so editor visibility checks use the drawn node size. */
export function nodeRadius(
  node: GeometryNode,
  cameraScale: number,
  spec: Pick<FrameSpec, 'typeScale'>,
  style: DomainStyle,
  config?: ProjectConfig,
): number {
  const custom = nodeAppearance(config, { ...node, id: node.id ?? '', label: '' });
  if (custom.size !== undefined) return custom.size * spec.typeScale;
  const importance = node.importance ?? 0;
  const base =
    nodeStyleFor(style, node.kind).baseRadius ?? (importance >= 5 ? 16 : importance >= 3 ? 13 : 11);
  return Math.min(19, Math.max(8, base * Math.sqrt(cameraScale))) * spec.typeScale;
}

export interface GlyphGeometry {
  radius: number;
  shape: NodeShape;
  halfWidth: number;
  halfHeight: number;
  cornerRadius: number;
  halfStroke: number;
}

/** Exactly the outline dimensions used by composeFrame, including reveal scaling. */
export function glyphGeometry(
  node: GeometryNode,
  cameraScale: number,
  spec: FrameSpec,
  style: DomainStyle,
  revealProgress = 1,
  config?: ProjectConfig,
): GlyphGeometry {
  const custom = nodeAppearance(config, { ...node, id: node.id ?? '', label: '' });
  const radius = nodeRadius(node, cameraScale, spec, style, config);
  const shape = custom.shape ?? nodeStyleFor(style, node.kind).shape;
  const unit = spec.typeScale;
  const revealScale = revealProgress < 1 ? 0.82 + 0.18 * revealProgress : 1;
  return {
    shape,
    radius: radius * revealScale,
    halfWidth: (radius + (shape === 'pill' ? 4 : 3) * unit) * revealScale,
    halfHeight: (shape === 'pill' ? radius * 0.75 : radius + 3 * unit) * revealScale,
    cornerRadius: (shape === 'pill' ? radius * 0.65 : 0) * revealScale,
    halfStroke: ((custom.borderWidth ?? 2) / 2) * unit * revealScale,
  };
}

function boundsFor(point: NodePoint, g: GlyphGeometry): Rect {
  // Canvas defaults to miter joins: at a diamond's 90° tip the stroke
  // extends by sqrt(2) times its half-width, not just the half-width.
  const strokeExtent = g.shape === 'diamond' ? Math.SQRT2 * g.halfStroke : g.halfStroke;
  const width = g.halfWidth + strokeExtent;
  const height = g.halfHeight + strokeExtent;
  return { x: point.x - width, y: point.y - height, w: 2 * width, h: 2 * height };
}

/** Conservative screen-space box of the rendered node glyph. */
export function nodeGlyphBounds(
  node: GeometryNode,
  point: NodePoint,
  cameraScale: number,
  spec: FrameSpec,
  style: DomainStyle,
  revealProgress = 1,
  config?: ProjectConfig,
): Rect {
  return boundsFor(point, glyphGeometry(node, cameraScale, spec, style, revealProgress, config));
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
  node: GeometryNode,
  point: NodePoint,
  cameraScale: number,
  spec: FrameSpec,
  style: DomainStyle,
  revealProgress = 1,
  config?: ProjectConfig,
): boolean {
  const g = glyphGeometry(node, cameraScale, spec, style, revealProgress, config);
  if (!rectsIntersect(boundsFor(point, g), spec.stage)) return false;

  const stage = spec.stage;
  const dx = Math.max(stage.x - point.x, 0, point.x - (stage.x + stage.w));
  const dy = Math.max(stage.y - point.y, 0, point.y - (stage.y + stage.h));
  if (!Number.isFinite(dx) || !Number.isFinite(dy)) return false;

  return containsOffset(dx, dy, g);
}
function containsOffset(dx: number, dy: number, g: GlyphGeometry): boolean {
  if (g.shape === 'circle') return Math.hypot(dx, dy) < g.halfWidth + g.halfStroke;
  if (g.shape === 'diamond') return dx + dy < g.halfWidth + Math.SQRT2 * g.halfStroke;
  const qx = dx - (g.halfWidth - g.cornerRadius),
    qy = dy - (g.halfHeight - g.cornerRadius);
  const distance =
    Math.hypot(Math.max(qx, 0), Math.max(qy, 0)) + Math.min(Math.max(qx, qy), 0) - g.cornerRadius;
  return distance < g.halfStroke;
}
export function nodeGlyphContainsPoint(
  node: GeometryNode,
  center: NodePoint,
  point: NodePoint,
  cameraScale: number,
  spec: FrameSpec,
  style: DomainStyle,
  revealProgress = 1,
  config?: ProjectConfig,
): boolean {
  return containsOffset(
    Math.abs(point.x - center.x),
    Math.abs(point.y - center.y),
    glyphGeometry(node, cameraScale, spec, style, revealProgress, config),
  );
}
export function nodeOutline(
  point: NodePoint,
  g: GlyphGeometry,
): import('./display-list.js').PathCommand[] {
  const { x, y } = point;
  if (g.shape === 'diamond')
    return [
      ['M', x, y - g.halfHeight],
      ['L', x + g.halfWidth, y],
      ['L', x, y + g.halfHeight],
      ['L', x - g.halfWidth, y],
      ['Z'],
    ];
  if (g.shape === 'pill')
    return [
      ['RR', x - g.halfWidth, y - g.halfHeight, g.halfWidth * 2, g.halfHeight * 2, g.cornerRadius],
    ];
  return [['A', x, y, g.halfWidth, 0, Math.PI * 2]];
}
