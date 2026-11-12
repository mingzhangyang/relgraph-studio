import {
  displayNodeText,
  nodeStyleFor,
  nodeAppearance,
  type ProjectConfig,
  type DomainStyle,
  type NodeShape,
  type VisualNode,
} from '@relgraph/core';
import type { FrameSpec, Rect } from './frame-spec.js';

type GeometryNode = Pick<VisualNode, 'kind' | 'importance'> &
  Partial<Pick<VisualNode, 'id' | 'label' | 'span'>>;

/**
 * Width of text without a canvas: full-width characters are one em, Latin
 * letters and digits about half. Shapes that hold their label are sized with
 * this, so hit tests, edge attachments and layout agree on every backend.
 */
export function estimateTextWidth(text: string, size: number): number {
  let ems = 0;
  for (const ch of text) {
    const code = ch.codePointAt(0) ?? 0;
    ems +=
      code >= 0x2e80
        ? 1
        : ch === ' '
          ? 0.3
          : /[A-Z0-9MWmw@%&]/.test(ch)
            ? 0.64
            : /[ilj.,:;'|!]/.test(ch)
              ? 0.3
              : 0.54;
  }
  return ems * size;
}

export interface InsideLabel {
  lines: string[];
  /** Font size in pixels of this frame. */
  size: number;
  weight: number;
  width: number;
  height: number;
}
/** A label set inside its shape: one or two centred lines of bounded width. */
export function insideLabel(
  text: string,
  importance: number,
  unit: number,
  authored?: { fontSize?: number; fontWeight?: number },
): InsideLabel {
  const size = (authored?.fontSize ?? (importance >= 5 ? 17 : importance >= 4 ? 16 : 15)) * unit,
    weight = authored?.fontWeight ?? (importance >= 4 ? 600 : 500),
    limit = size * 9.5;
  const lines: string[] = [];
  let line = '';
  for (const ch of text.trim() || ' ') {
    if (line && estimateTextWidth(line + ch, size) > limit) {
      lines.push(line);
      line = ch === ' ' ? '' : ch;
    } else line += ch;
  }
  if (line) lines.push(line);
  if (lines.length > 2) {
    // Two lines at most; the second ends in an ellipsis.
    let last = lines[1];
    while (last.length > 1 && estimateTextWidth(last + '…', size) > limit) last = last.slice(0, -1);
    lines.splice(1, lines.length - 1, last + '…');
  }
  return {
    lines,
    size,
    weight,
    width: Math.max(...lines.map((entry) => estimateTextWidth(entry, size))),
    height: lines.length * size * 1.3,
  };
}

/** The outline family a shape is drawn, hit-tested and attached with. */
const familyOf = (shape: NodeShape): 'circle' | 'diamond' | 'hexagon' | 'round' =>
  shape === 'circle'
    ? 'circle'
    : shape === 'diamond' || shape === 'decision'
      ? 'diamond'
      : shape === 'hexagon'
        ? 'hexagon'
        : 'round';
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
  // A real scale: principals are visibly larger than supporting nodes, so
  // hierarchy reads from across the room. Unrated nodes use the base size.
  const base =
    nodeStyleFor(style, node.kind).baseRadius ??
    (importance >= 5 ? 20 : importance >= 4 ? 16.5 : importance >= 3 ? 13.5 : 11);
  return Math.min(26, Math.max(8, base * Math.sqrt(cameraScale))) * spec.typeScale;
}

/** Ring width, in 720p reference pixels, of a node without an authored border. */
export const DEFAULT_BORDER_WIDTH = 2;

export interface GlyphGeometry {
  radius: number;
  shape: NodeShape;
  halfWidth: number;
  halfHeight: number;
  cornerRadius: number;
  halfStroke: number;
  /** The label, when this shape holds it. */
  inside?: InsideLabel;
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
  const wanted = custom.shape ?? nodeStyleFor(style, node.kind).shape;
  const unit = spec.typeScale;
  const revealScale = revealProgress < 1 ? 0.82 + 0.18 * revealProgress : 1;
  const halfStroke = ((custom.borderWidth ?? DEFAULT_BORDER_WIDTH) / 2) * unit * revealScale;
  const importance = node.importance ?? 0;
  if (wanted === 'box' || wanted === 'capsule' || wanted === 'decision') {
    // The shape is as large as the words it holds.
    const inside = insideLabel(
      (node.id === undefined ? undefined : displayNodeText(config, node.id)?.label) ??
        node.label ??
        '',
      importance,
      unit,
      custom,
    );
    const w = inside.width / 2,
      h = inside.height / 2;
    const [halfWidth, halfHeight, cornerRadius] =
      wanted === 'decision'
        ? // A diamond that clears the corners of the text block.
          [w + h * 2.2 + 8 * unit, h + w * 0.56 + 6 * unit, 0]
        : wanted === 'capsule'
          ? [w + 17 * unit, h + 7 * unit, h + 7 * unit]
          : [w + 13 * unit, h + 7 * unit, 7 * unit];
    return {
      shape: wanted,
      radius: radius * revealScale,
      halfWidth: halfWidth * revealScale,
      halfHeight: halfHeight * revealScale,
      cornerRadius: cornerRadius * revealScale,
      halfStroke,
      inside,
    };
  }
  const axis = style.timeAxis;
  if (wanted === 'span' && axis && node.span) {
    // A bar as long as the node lasts; what has no end runs to the axis end.
    const length =
      (Math.max(node.span.from, node.span.to ?? axis.to) - node.span.from) *
      axis.scale *
      cameraScale *
      unit;
    const halfHeight = (importance >= 4 ? 12 : 10) * unit;
    return {
      shape: 'span',
      radius: radius * revealScale,
      halfWidth: Math.max(halfHeight, length / 2) * revealScale,
      halfHeight: halfHeight * revealScale,
      cornerRadius: 4 * unit * revealScale,
      halfStroke,
    };
  }
  // A span without a place in time is drawn as a point.
  const shape = wanted === 'span' ? 'circle' : wanted;
  // Half extents chosen so every shape carries about the optical weight of
  // the circle: a square or hexagon of the same radius would look larger.
  const round = radius + 3 * unit;
  const [halfWidth, halfHeight, cornerRadius] =
    shape === 'pill'
      ? [radius + 4 * unit, radius * 0.75, radius * 0.65]
      : shape === 'square'
        ? [round * 0.9, round * 0.9, round * 0.26]
        : shape === 'hexagon'
          ? [round * 1.08, round * 1.08 * (Math.sqrt(3) / 2), 0]
          : [round, round, 0];
  return {
    shape,
    radius: radius * revealScale,
    halfWidth: halfWidth * revealScale,
    halfHeight: halfHeight * revealScale,
    cornerRadius: cornerRadius * revealScale,
    halfStroke,
  };
}

/** A flat-topped hexagon's slanted edge: unit normal and distance from the centre. */
function hexagonEdge(g: GlyphGeometry): { nx: number; ny: number; distance: number } {
  const length = Math.hypot(g.halfHeight, g.halfWidth / 2);
  return {
    nx: g.halfHeight / length,
    ny: g.halfWidth / 2 / length,
    distance: (g.halfHeight * g.halfWidth) / length,
  };
}

function boundsFor(point: NodePoint, g: GlyphGeometry): Rect {
  const family = familyOf(g.shape);
  // Canvas defaults to miter joins, which reach past the half stroke at a
  // tip: by 1 / sin of half the tip angle. A square diamond gives sqrt(2); a
  // hexagon's side vertices, at 120°, give 1 / sin 60°.
  const slant = Math.hypot(g.halfWidth, g.halfHeight);
  const width =
    g.halfWidth +
    (family === 'diamond'
      ? (g.halfStroke * slant) / g.halfHeight
      : family === 'hexagon'
        ? g.halfStroke / (Math.sqrt(3) / 2)
        : g.halfStroke);
  const height =
    g.halfHeight + (family === 'diamond' ? (g.halfStroke * slant) / g.halfWidth : g.halfStroke);
  return { x: point.x - width, y: point.y - height, w: 2 * width, h: 2 * height };
}

/**
 * Exact screen-space distance to the *stroked* glyph boundary along a ray.
 * Circle, diamond (miter-joined corners), and rounded-pill share the same
 * dimensions used by nodeOutline(), selection, and stage clipping.
 */
export function nodeGlyphRayDistance(
  node: GeometryNode,
  direction: NodePoint,
  cameraScale: number,
  spec: FrameSpec,
  style: DomainStyle,
  config?: ProjectConfig,
): number {
  const length = Math.hypot(direction.x, direction.y);
  if (!Number.isFinite(length) || length === 0)
    throw new RangeError('Node glyph ray must be finite and nonzero');
  const ux = Math.abs(direction.x / length);
  const uy = Math.abs(direction.y / length);
  const g = glyphGeometry(node, cameraScale, spec, style, 1, config);
  const family = familyOf(g.shape);
  if (family === 'circle') return g.halfWidth + g.halfStroke;
  if (family === 'diamond') {
    // Offset the diamond's sloped edges by half the stroke; miter joins
    // extend to the intersections of those offset edges at both tips.
    const slope = Math.hypot(1 / g.halfWidth, 1 / g.halfHeight);
    return (1 + g.halfStroke * slope) / (ux / g.halfWidth + uy / g.halfHeight);
  }
  if (family === 'hexagon') {
    // Nearest of the offset top edge and the offset slanted edge.
    const edge = hexagonEdge(g);
    const top = uy ? (g.halfHeight + g.halfStroke) / uy : Infinity;
    const along = ux * edge.nx + uy * edge.ny;
    const slant = along > 0 ? (edge.distance + g.halfStroke) / along : Infinity;
    return Math.min(top, slant);
  }
  // A pill or square is a rounded rectangle: straight runs end at the corner centre,
  // with its border increasing the corner radius and overall half-extents.
  const cornerX = g.halfWidth - g.cornerRadius;
  const cornerY = g.halfHeight - g.cornerRadius;
  const outerRadius = g.cornerRadius + g.halfStroke;
  const horizontal = ux ? (g.halfWidth + g.halfStroke) / ux : Infinity;
  if (horizontal * uy <= cornerY) return horizontal;
  const vertical = uy ? (g.halfHeight + g.halfStroke) / uy : Infinity;
  if (vertical * ux <= cornerX) return vertical;
  const dot = ux * cornerX + uy * cornerY;
  return (
    dot +
    Math.sqrt(
      Math.max(0, dot * dot - cornerX * cornerX - cornerY * cornerY + outerRadius * outerRadius),
    )
  );
}

/**
 * Full-size label obstacle, retaining the historical radius+4 minimum
 * whitespace, but never smaller than the authored shape and stroke.
 * Reused for both node avoidance and a node's own label candidates.
 */
export function nodeLabelObstacleBounds(
  node: GeometryNode,
  point: NodePoint,
  cameraScale: number,
  spec: FrameSpec,
  style: DomainStyle,
  config?: ProjectConfig,
): Rect {
  const glyph = nodeGlyphBounds(node, point, cameraScale, spec, style, 1, config);
  const minimum = nodeRadius(node, cameraScale, spec, style, config) + 4 * spec.typeScale;
  const halfWidth = Math.max(minimum, glyph.w / 2);
  const halfHeight = Math.max(minimum, glyph.h / 2);
  return {
    x: point.x - halfWidth,
    y: point.y - halfHeight,
    w: halfWidth * 2,
    h: halfHeight * 2,
  };
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
  const family = familyOf(g.shape);
  if (family === 'circle') return Math.hypot(dx, dy) < g.halfWidth + g.halfStroke;
  if (family === 'diamond') {
    const slope = Math.hypot(1 / g.halfWidth, 1 / g.halfHeight);
    return dx / g.halfWidth + dy / g.halfHeight < 1 + g.halfStroke * slope;
  }
  if (family === 'hexagon') {
    const edge = hexagonEdge(g);
    return (
      dy < g.halfHeight + g.halfStroke && dx * edge.nx + dy * edge.ny < edge.distance + g.halfStroke
    );
  }
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
  const { x, y } = point,
    family = familyOf(g.shape);
  if (family === 'diamond')
    return [
      ['M', x, y - g.halfHeight],
      ['L', x + g.halfWidth, y],
      ['L', x, y + g.halfHeight],
      ['L', x - g.halfWidth, y],
      ['Z'],
    ];
  if (family === 'hexagon')
    return [
      ['M', x + g.halfWidth, y],
      ['L', x + g.halfWidth / 2, y + g.halfHeight],
      ['L', x - g.halfWidth / 2, y + g.halfHeight],
      ['L', x - g.halfWidth, y],
      ['L', x - g.halfWidth / 2, y - g.halfHeight],
      ['L', x + g.halfWidth / 2, y - g.halfHeight],
      ['Z'],
    ];
  if (family === 'round')
    return [
      ['RR', x - g.halfWidth, y - g.halfHeight, g.halfWidth * 2, g.halfHeight * 2, g.cornerRadius],
    ];
  return [['A', x, y, g.halfWidth, 0, Math.PI * 2]];
}
