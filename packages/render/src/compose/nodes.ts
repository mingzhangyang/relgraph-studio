import { nodeAppearance, nodeStyleFor } from '@relgraph/core';
import type { VisualNode } from '@relgraph/core';
import type { DisplayItem } from '../display-list.js';
import type { Rect } from '../frame-spec.js';
import { composeNodeImage } from '../image-layout.js';
import {
  glyphGeometry,
  insideLabel,
  nodeGlyphBounds,
  nodeLabelObstacleBounds,
  nodeOutline,
  DEFAULT_BORDER_WIDTH,
  type GlyphGeometry,
} from '../node-geometry.js';
import { importanceStep } from '../importance.js';
import type { RectIndex } from '../spatial.js';
import { mixHex, toneOf } from '../theme.js';
import { alphaHex, color, type FrameContext, type Selection } from './context.js';
import { mix, TAU, type Point } from './geometry.js';

/** Everything about a node that edges, hulls and labels need to agree on. */
export interface DrawnNode {
  node: VisualNode;
  custom: ReturnType<typeof nodeAppearance>;
  /** Screen point. */
  p: Point;
  r: number;
  geometry: GlyphGeometry;
  /** Colour: the node's own, then its group's, then its kind's. */
  c: string;
  alpha: number;
  visibility: number;
  /** Explicitly named in the shot, as opposed to merely not dimmed. */
  focus: number;
}

export function drawnNodes(ctx: FrameContext): DrawnNode[] {
  const { view, config, style, groups, theme: P, cam, spec, transition } = ctx;
  return view.nodes.map((node) => {
    const custom = nodeAppearance(config, node),
      kindStyle = nodeStyleFor(style, node.kind),
      group = node.groupId == null ? undefined : groups.get(node.groupId);
    return {
      node,
      custom,
      p: ctx.pointFor(node.id),
      r: ctx.radius(node),
      geometry: glyphGeometry(node, cam.scale, spec, style, 1, config),
      c:
        custom.border ??
        color(
          node.color ||
            toneOf(P, node.tone) ||
            (group ? (group.color ?? toneOf(P, group.tone)) : undefined),
          color(kindStyle.color, toneOf(P, kindStyle.tone) ?? P.fallbackNode),
        ),
      alpha: ctx.attention(node),
      visibility: ctx.nodeProgress(node.id),
      focus: mix(
        ctx.namedBefore.has(node.id) ? 1 : 0,
        ctx.namedNow.has(node.id) ? 1 : 0,
        transition,
      ),
    };
  });
}

/**
 * The space each node revealed past halfway keeps free of labels. Every
 * obstacle takes its place in `occupied`; the map gives each node's own, from
 * which its label is placed.
 */
export function nodeObstacles(
  ctx: FrameContext,
  drawn: readonly DrawnNode[],
  occupied: RectIndex,
): Map<string, Rect> {
  const nodeLabelBounds = new Map<string, Rect>();
  for (const { node, p, visibility } of drawn)
    if (visibility > 0.5) {
      const obstacle = nodeLabelObstacleBounds(
        node,
        p,
        ctx.cam.scale,
        ctx.spec,
        ctx.style,
        ctx.config,
      );
      nodeLabelBounds.set(node.id, obstacle);
      occupied.add(obstacle);
    }
  return nodeLabelBounds;
}

/** A soft radial glow filling an ellipse, as a unit circle under a transform. */
function ellipseGlow(
  x: number,
  y: number,
  rx: number,
  ry: number,
  c: string,
  alpha: number,
): DisplayItem {
  return {
    type: 'group',
    transform: [Math.max(1, rx), 0, 0, Math.max(1, ry), x, y],
    items: [
      {
        type: 'path',
        d: [['A', 0, 0, 1, 0, TAU]],
        fill: {
          type: 'radial',
          x0: 0,
          y0: 0,
          r0: 0,
          x1: 0,
          y1: 0,
          r1: 1,
          stops: [
            { offset: 0, color: `${c}${alphaHex(alpha)}` },
            { offset: 1, color: `${c}00` },
          ],
        },
      },
    ],
  };
}

/**
 * The glyphs: aura, body, image and the words a shape holds. `held` names the
 * nodes whose label is drawn inside their shape, which need none beside it.
 */
export function composeNodes(
  ctx: FrameContext,
  drawn: readonly DrawnNode[],
): { items: DisplayItem[]; selection: Selection; held: Set<string> } {
  const { theme: P, u, cam, spec, style, config } = ctx;
  const ts = spec.typeScale;
  const items: DisplayItem[] = [];
  const selection: Selection = [];
  const held = new Set<string>();
  for (const { node, custom, p, r, geometry, c, alpha, visibility, focus } of drawn) {
    if (visibility > 0.5)
      selection.push({
        kind: 'node',
        id: node.id,
        box: nodeGlyphBounds(node, p, cam.scale, spec, style, visibility, config),
      });
    if (visibility <= 0) continue;
    const outline = nodeOutline(p, geometry);
    const asset =
      custom.image && config?.assets && Object.hasOwn(config.assets, custom.image)
        ? config.assets[custom.image]
        : undefined;
    const imageBox = {
      x: p.x - geometry.halfWidth,
      y: p.y - geometry.halfHeight,
      w: geometry.halfWidth * 2,
      h: geometry.halfHeight * 2,
    };
    const borderWidth = u(custom.borderWidth ?? DEFAULT_BORDER_WIDTH);
    // The body carries a tint of the node's colour over the paper, so colour
    // reads as area and not only as a thin ring.
    const body = custom.fill ?? mixHex(c, P.nodeFill, P.nodeTint);
    const extent = Math.max(geometry.halfWidth, geometry.halfHeight),
      waist = Math.min(geometry.halfWidth, geometry.halfHeight);
    const glyph: DisplayItem[] = [],
      aura: DisplayItem[] = [];
    const principal = importanceStep(node.importance).principal;
    // Shapes that are as wide as their words or their years keep their own
    // outline for the focus ring; compact glyphs are ringed by a circle.
    const wide = geometry.inside !== undefined || geometry.shape === 'span';
    // Light gathers behind the nodes a shot names, and behind the principals.
    const glow = Math.max(focus, principal && alpha > 0.8 ? 0.55 : 0);
    if (glow > 0)
      aura.push(
        ellipseGlow(
          p.x,
          p.y,
          geometry.halfWidth * 1.3 + waist,
          geometry.halfHeight * 1.3 + waist,
          c,
          0.2 * glow,
        ),
      );
    if (focus > 0) {
      const gap = borderWidth / 2 + u(4.5);
      aura.push({
        type: 'path',
        d: wide
          ? nodeOutline(p, {
              ...geometry,
              halfWidth: geometry.halfWidth + gap * (geometry.shape === 'decision' ? 1.6 : 1),
              halfHeight: geometry.halfHeight + gap,
              cornerRadius: geometry.cornerRadius + gap,
            })
          : [['A', p.x, p.y, extent + gap, 0, TAU]],
        stroke: c,
        width: u(1.2),
        alpha: 0.55 * focus,
      });
    }
    // The topic of a mind map, or the first step, is set in solid colour.
    const solid = geometry.inside !== undefined && principal && !custom.fill;
    if (asset && custom.image)
      glyph.push(
        { type: 'path', d: outline, fill: custom.fill ?? P.nodeFill },
        composeNodeImage(custom.image, asset, imageBox, outline, custom.imageFit ?? 'cover'),
        { type: 'path', d: outline, stroke: c, width: borderWidth },
      );
    else {
      glyph.push({
        type: 'path',
        d: outline,
        fill: solid ? c : body,
        stroke: c,
        width: borderWidth,
      });
      if (!wide)
        glyph.push({
          type: 'path',
          d: [
            ['A', p.x, p.y, geometry.shape === 'diamond' ? u(3) : Math.max(u(3), r * 0.34), 0, TAU],
          ],
          fill: c,
        });
    }
    // Words inside the shape: the label of a step or topic, or of a span
    // long enough to hold it.
    const within =
      geometry.inside ??
      (geometry.shape === 'span'
        ? insideLabel(ctx.nodeLabel(node), 0, ts, {
            fontSize: custom.fontSize ?? 13,
            fontWeight: custom.fontWeight,
          })
        : undefined);
    if (
      within &&
      !(asset && custom.image) &&
      (geometry.inside ||
        (within.lines.length === 1 && within.width + u(14) <= geometry.halfWidth * 2))
    ) {
      held.add(node.id);
      if (visibility > 0.5) {
        const lineHeight = within.size * 1.3;
        within.lines.forEach((line, index) =>
          glyph.push({
            type: 'text',
            text: line,
            x: p.x,
            y: p.y - within.height / 2 + (index + 0.5) * lineHeight + u(0.5),
            font: { family: 'sans', size: within.size, weight: within.weight },
            fill:
              custom.textColor ?? (solid ? P.nodeFill : alpha > 0.8 ? P.labelActive : P.labelMuted),
            align: 'center',
            baseline: 'middle',
            ...(visibility < 1 ? { alpha: (visibility - 0.5) * 2 } : {}),
          }),
        );
      }
    }
    const scale = 0.82 + 0.18 * visibility;
    const frame = {
      type: 'group' as const,
      alpha: alpha * visibility,
      ...(visibility < 1
        ? {
            transform: [scale, 0, 0, scale, p.x * (1 - scale), p.y * (1 - scale)] as [
              number,
              number,
              number,
              number,
              number,
              number,
            ],
          }
        : {}),
    };
    // The aura is its own layer so the glyph stays one fill and one outline.
    if (aura.length) items.push({ ...frame, items: aura });
    items.push({ ...frame, items: glyph });
  }
  return { items, selection, held };
}
