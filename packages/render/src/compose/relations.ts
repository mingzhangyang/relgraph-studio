import { edgeAppearance, edgeStyleFor, localize } from '@relgraph/core';
import type { ProjectedVisualGraph } from '@relgraph/core';
import type { DisplayItem, FontRef, Paint } from '../display-list.js';
import { nodeGlyphRayDistance } from '../node-geometry.js';
import type { RectIndex } from '../spatial.js';
import { edgePaint, toneOf } from '../theme.js';
import { color, type FrameContext, type Selection } from './context.js';
import {
  clamp,
  pathPoint,
  pathPrefix,
  pathTangent,
  TAU,
  type Point,
  type Segment,
} from './geometry.js';
import type { DrawnNode } from './nodes.js';
import { captionWithLabel } from './text.js';

/** A relation's tag, placed after the node labels (`composeRelationLabels`). */
export type EdgeLabel = Point & {
  text: string;
  alpha: number;
  font: FontRef;
  color: string;
  stroke: string;
  /** Unit direction the tag is pushed in, by half its own size. */
  push?: Point;
  /** Unit normal of the relation at the tag, towards the side it bows to. */
  aside?: Point;
};

/** Share of an arrowhead's length, from the tip, where the stroke meets it. */
const ARROW_NOTCH = 0.72;

/** A swept-back arrowhead whose notch is where the stroke ends. */
function arrowhead(tip: Point, dir: Point, length: number, fill: Paint): DisplayItem {
  const half = length * 0.4,
    back = { x: tip.x - dir.x * length, y: tip.y - dir.y * length };
  return {
    type: 'path',
    d: [
      ['M', tip.x, tip.y],
      ['L', back.x - dir.y * half, back.y + dir.x * half],
      ['L', tip.x - dir.x * length * ARROW_NOTCH, tip.y - dir.y * length * ARROW_NOTCH],
      ['L', back.x + dir.y * half, back.y - dir.x * half],
      ['Z'],
    ],
    fill,
  };
}

/** How the relations of a view sit around their nodes, on screen. */
export interface RelationLayout {
  /** Relations between the same two nodes, by an unordered pair key, in id order. */
  pairs: Map<string, string[]>;
  /** Sum of the unit directions towards each node's neighbours. */
  pull: Map<string, Point>;
  /** Angles of the relations that leave each node, unsorted. */
  spokeAngles: Map<string, number[]>;
  degree: Map<string, number>;
  /** A node's loops, in id order, so that each has its own radius. */
  loopsOf: Map<string, string[]>;
}

export function relationLayout(
  view: Pick<ProjectedVisualGraph, 'nodes' | 'edges'>,
  points: ReadonlyMap<string, Point>,
): RelationLayout {
  // Parallel and reciprocal links get stable, symmetric curve offsets.
  const pairs = new Map<string, string[]>();
  for (const edge of view.edges) {
    const key = [edge.source, edge.target].sort().join('\0');
    const siblings = pairs.get(key) ?? [];
    siblings.push(edge.id);
    pairs.set(key, siblings);
  }
  for (const siblings of pairs.values()) siblings.sort();
  // Where a node's neighbours lie, so loops and labels can face away from them.
  const pull = new Map<string, Point>(view.nodes.map((n) => [n.id, { x: 0, y: 0 }]));
  const spokeAngles = new Map<string, number[]>();
  for (const edge of view.edges) {
    const a = points.get(edge.source),
      b = points.get(edge.target);
    if (!a || !b || edge.source === edge.target) continue;
    const d = Math.hypot(b.x - a.x, b.y - a.y);
    if (!(d > 0)) continue;
    for (const [id, angle] of [
      [edge.source, Math.atan2(b.y - a.y, b.x - a.x)],
      [edge.target, Math.atan2(a.y - b.y, a.x - b.x)],
    ] as const) {
      const angles = spokeAngles.get(id);
      if (angles) angles.push(angle);
      else spokeAngles.set(id, [angle]);
    }
    const pa = pull.get(edge.source),
      pb = pull.get(edge.target);
    if (pa) {
      pa.x += (b.x - a.x) / d;
      pa.y += (b.y - a.y) / d;
    }
    if (pb) {
      pb.x -= (b.x - a.x) / d;
      pb.y -= (b.y - a.y) / d;
    }
  }
  const degree = new Map<string, number>();
  for (const edge of view.edges)
    for (const id of edge.source === edge.target ? [edge.source] : [edge.source, edge.target])
      degree.set(id, (degree.get(id) ?? 0) + 1);
  const loopsOf = new Map<string, string[]>();
  for (const edge of view.edges)
    if (edge.source === edge.target) {
      const loops = loopsOf.get(edge.source);
      if (loops) loops.push(edge.id);
      else loopsOf.set(edge.source, [edge.id]);
    }
  for (const loops of loopsOf.values()) loops.sort();
  return { pairs, pull, spokeAngles, degree, loopsOf };
}

/**
 * The relations: strokes, heads and the glow of a highlighted one. Returns
 * the tags to place later and the obstacles the drawn strokes make for node
 * labels.
 */
export function composeRelations(
  ctx: FrameContext,
  drawnById: ReadonlyMap<string, DrawnNode>,
  layout: RelationLayout,
): { items: DisplayItem[]; selection: Selection; labels: EdgeLabel[]; obstacles: RectIndex } {
  const { view, config, style, theme: P, u, sans, cam, spec, locale } = ctx;
  const { pairs, spokeAngles, degree, loopsOf } = layout;
  const items: DisplayItem[] = [];
  const selection: Selection = [];
  const edgeLabels: EdgeLabel[] = [],
    edgeObstacles = ctx.rectIndex();
  for (const edge of view.edges) {
    const custom = edgeAppearance(config, edge);
    const visibility = ctx.edgeProgress(edge.id);
    const from = drawnById.get(edge.source),
      to = drawnById.get(edge.target);
    if (!from || !to) continue;
    const a = from.p,
      b = to.p;
    const edgeStyle = edgeStyleFor(style, edge.kind),
      highlighted = ctx.highlightedEdges.has(edge.id),
      active = ctx.attention(edge),
      kindColour = color(edgeStyle.color, toneOf(P, edgeStyle.tone) ?? ''),
      stroke =
        custom.color ??
        (kindColour ||
          // A branch takes the colour of the node it leads to.
          (style.edgeHue === 'target'
            ? to.c
            : highlighted
              ? P.edge.highlight
              : edgePaint(P, edgeStyle.stroke))),
      // Strength is drawn as weight; a highlighted relation gains one more step.
      width = u(
        custom.width ??
          (edge.strength === undefined ? 1.5 : 1 + 0.28 * clamp(edge.strength, 1, 5)) +
            (highlighted ? 1 : 0),
      );
    const head = view.domain === 'biology' ? edgeStyle.head : (custom.head ?? edgeStyle.head);
    const arrow = Boolean(edge.directed) && head === 'arrow',
      arrowLength = u(8) + width * 1.3;
    const dash =
      custom.dash === undefined
        ? edgeStyle.dash
        : custom.dash === 'dashed'
          ? [7, 5]
          : custom.dash === 'dotted'
            ? [2, 4]
            : [];
    const parts: DisplayItem[] = [];
    let labelAt: Point, labelPush: Point | undefined, labelAside: Point | undefined;
    if (edge.source === edge.target) {
      // A relation of a node with itself: a loop leaving on the side its
      // neighbours leave free.
      // It leaves through the widest gap between the node's other relations.
      const spokes = (spokeAngles.get(edge.source) ?? []).slice().sort((m, n) => m - n);
      let outAngle = -0.99;
      if (spokes.length) {
        let widest = -1;
        spokes.forEach((angle, i) => {
          const next = i + 1 < spokes.length ? spokes[i + 1] : spokes[0] + TAU,
            gap = next - angle;
          if (gap > widest) {
            widest = gap;
            outAngle = angle + gap / 2;
          }
        });
      }
      const out = { x: Math.cos(outAngle), y: Math.sin(outAngle) };
      const loops = loopsOf.get(edge.source) ?? [];
      const loopRadius = Math.max(u(11), from.r * 0.8) * (1 + 0.45 * loops.indexOf(edge.id));
      const rim = nodeGlyphRayDistance(from.node, out, cam.scale, spec, style, config) + u(2.5),
        distance = rim + loopRadius * 0.55,
        centre = { x: a.x + out.x * distance, y: a.y + out.y * distance };
      // Hide the part of the loop that would pass under the glyph.
      const hidden = Math.acos(
        clamp(
          (distance * distance + loopRadius * loopRadius - rim * rim) / (2 * distance * loopRadius),
          -1,
          1,
        ),
      );
      // Angles are not lengths: keep them identical at every output size.
      const steady = (angle: number): number => Math.round(angle * 1e9) / 1e9;
      const back = Math.atan2(-out.y, -out.x),
        first = steady(back + hidden),
        sweep = TAU - 2 * hidden - (arrow ? (arrowLength * ARROW_NOTCH) / loopRadius : 0);
      if (!(sweep > 0.3)) continue;
      const last = steady(first + sweep * visibility),
        on = (angle: number): Point => ({
          x: centre.x + Math.cos(angle) * loopRadius,
          y: centre.y + Math.sin(angle) * loopRadius,
        });
      const begin = on(first);
      parts.push({
        type: 'path',
        d: [
          ['M', begin.x, begin.y],
          ['A', centre.x, centre.y, loopRadius, first, last],
        ],
        stroke,
        width,
        ...(dash?.length ? { dash: dash.map(u) } : {}),
      });
      if (arrow && visibility > 0) {
        const tipBase = on(last),
          dir = { x: -Math.sin(last), y: Math.cos(last) };
        parts.push(
          arrowhead(
            {
              x: tipBase.x + dir.x * arrowLength * ARROW_NOTCH,
              y: tipBase.y + dir.y * arrowLength * ARROW_NOTCH,
            },
            dir,
            arrowLength,
            stroke,
          ),
        );
      }
      if (visibility > 0.5) {
        const samples = Array.from({ length: 17 }, (_, i) =>
          on(first + (sweep * visibility * i) / 16),
        );
        selection.push({ kind: 'edge', id: edge.id, points: samples });
        // Node labels keep clear of the whole loop, not just of a line.
        for (const q of [...samples, centre])
          edgeObstacles.add({ x: q.x - u(4), y: q.y - u(4), w: u(8), h: u(8) });
      }
      labelAt = {
        x: centre.x + out.x * (loopRadius + u(4)),
        y: centre.y + out.y * (loopRadius + u(4)),
      };
      labelPush = out;
    } else {
      const dx = b.x - a.x,
        dy = b.y - a.y,
        len = Math.hypot(dx, dy);
      if (len < u(1)) continue;
      const key = [edge.source, edge.target].sort().join('\0');
      const siblings = pairs.get(key);
      if (!siblings) throw new Error('Missing edge pair');
      const order = siblings.indexOf(edge.id) - (siblings.length - 1) / 2;
      const sign = edge.source < edge.target ? 1 : -1;
      // Tree, mind-map and process links leave and arrive sideways when the
      // two nodes are clearly side by side. A pair joined both ways, such as
      // a step and the retry that returns to it, opens into two arcs instead.
      const elbow =
        style.routing === 'elbow' && siblings.length === 1 && Math.abs(dx) > Math.abs(dy) * 0.35;
      const ux = elbow ? Math.sign(dx) : dx / len,
        uy = elbow ? 0 : dy / len;
      const sourceRim = nodeGlyphRayDistance(
          from.node,
          { x: ux, y: uy },
          cam.scale,
          spec,
          style,
          config,
        ),
        targetRim = nodeGlyphRayDistance(
          to.node,
          { x: -ux, y: -uy },
          cam.scale,
          spec,
          style,
          config,
        );
      // The stroke stops short of both glyphs; a role mark gets its full
      // footprint beyond the stroked outline, an arrowhead touches down
      // just outside it.
      const ra = sourceRim + width / 2 + u(2.5);
      const reach = !edge.directed
        ? width / 2 + u(2.5)
        : head === 'hollow-circle'
          ? u(4) + width / 2 + u(1.5)
          : head === 'bar'
            ? u(5) + width / 2 + u(1.5)
            : head === 'arrow'
              ? u(3) + arrowLength * ARROW_NOTCH
              : width / 2 + u(2.5);
      const rb = targetRim + reach;
      // Glyphs that touch or overlap leave no room for a readable stroke.
      if ((elbow ? Math.abs(dx) : len) <= ra + rb + u(1)) continue;
      const start = { x: a.x + ux * ra, y: a.y + uy * ra },
        end = { x: b.x - ux * rb, y: b.y - uy * rb };
      let segments: Segment[];
      if (elbow) {
        // Out level, across, in level: two quadratic arcs that meet upright.
        const turn = (start.x + end.x) / 2 + u(custom.curve ?? 0),
          middle = { x: turn, y: (start.y + end.y) / 2 };
        segments = [
          [start, { x: turn, y: start.y }, middle],
          [middle, { x: turn, y: end.y }, end],
        ];
      } else {
        // A lone relation bows slightly. All relations of a hub turn the same
        // way around it, so its spokes read as one gesture instead of a pile
        // of rulers.
        const hubFirst =
          (degree.get(edge.source) ?? 0) - (degree.get(edge.target) ?? 0) ||
          (edge.source < edge.target ? 1 : -1);
        const bow =
          siblings.length === 1 && custom.curve === undefined
            ? (hubFirst > 0 ? 1 : -1) *
              Math.min(u(12), (len - ra - rb) * 0.06) *
              (style.curvature ?? 0)
            : 0;
        const offset = order * u(30) * sign + u(custom.curve ?? 0) + bow;
        segments = [
          [
            start,
            {
              x: (start.x + end.x) / 2 - uy * offset,
              y: (start.y + end.y) / 2 + ux * offset,
            },
            end,
          ],
        ];
      }
      if (visibility > 0.5) {
        const samples = Array.from({ length: 33 }, (_, i) =>
          pathPoint(segments, (i / 32) * visibility),
        );
        selection.push({ kind: 'edge', id: edge.id, points: samples });
        // A label appearing before halfway would disturb existing label layout.
        // Beyond halfway, only the drawn prefix participates in avoidance.
        for (let t = 0.1; t < visibility; t += 0.1) {
          const q = pathPoint(segments, t);
          edgeObstacles.add({ x: q.x - u(4), y: q.y - u(4), w: u(8), h: u(8) });
        }
      }
      parts.push({
        type: 'path',
        d: pathPrefix(segments, visibility),
        stroke,
        width,
        ...(dash?.length ? { dash: dash.map(u) } : {}),
      });
      if (edge.directed && visibility > 0) {
        const t = clamp(visibility, 0, 1),
          tipBase = pathPoint(segments, t),
          // Tangent of the drawn prefix at its end; the chord when degenerate.
          dir = pathTangent(segments, t) ?? { x: dx / len, y: dy / len };
        if (head === 'arrow')
          // The head rides the tip of the line while the relation is drawn.
          parts.push(
            arrowhead(
              {
                x: tipBase.x + dir.x * arrowLength * ARROW_NOTCH,
                y: tipBase.y + dir.y * arrowLength * ARROW_NOTCH,
              },
              dir,
              arrowLength,
              stroke,
            ),
          );
        else if (visibility >= 1 && head === 'hollow-circle')
          parts.push({
            type: 'path',
            d: [['A', end.x, end.y, u(4), 0, TAU]],
            fill: P.nodeFill,
            stroke,
            width,
          });
        else if (visibility >= 1 && head === 'bar') {
          const bar = u(5);
          parts.push({
            type: 'path',
            d: [
              ['M', end.x - bar * dir.y, end.y + bar * dir.x],
              ['L', end.x + bar * dir.y, end.y - bar * dir.x],
            ],
            stroke,
            width,
          });
        }
      }
      labelAt = pathPoint(segments, 0.5);
      // Where a tag may step aside when it does not fit on the line: across
      // the relation, first to the side it already bows to.
      const along = pathTangent(segments, 0.5) ?? { x: dx / len, y: dy / len },
        bowed =
          (labelAt.x - (start.x + end.x) / 2) * -along.y +
          (labelAt.y - (start.y + end.y) / 2) * along.x;
      labelAside =
        bowed < 0 || (bowed === 0 && along.x < 0)
          ? { x: along.y, y: -along.x }
          : { x: -along.y, y: along.x };
    }
    if (visibility > 0) {
      // A highlighted relation glows softly in its own colour.
      if (highlighted && parts[0].type === 'path')
        items.push({
          type: 'group',
          alpha: active * 0.16,
          items: [{ type: 'path', d: parts[0].d, stroke, width: width * 3.4 }],
        });
      items.push({
        type: 'group',
        alpha: active * (highlighted ? 0.98 : 0.66),
        items: parts,
      });
    }
    const caption = edgeStyle.caption ? localize(edgeStyle.caption, locale) : '';
    const label = caption
      ? captionWithLabel(caption, ctx.edgeLabel(edge))
      : (custom.showLabel ?? (highlighted || style.edgeLabels === 'always'))
        ? ctx.edgeLabel(edge) || ''
        : '';
    if (label && custom.showLabel !== false && visibility > 0.5)
      edgeLabels.push({
        text: label,
        font: sans(custom.fontSize ?? 12, custom.fontWeight ?? 500),
        color: custom.textColor ?? P.edgeLabelText,
        stroke,
        x: labelAt.x,
        y: labelAt.y,
        ...(labelPush ? { push: labelPush } : {}),
        ...(labelAside ? { aside: labelAside } : {}),
        alpha: active * Math.min(1, (visibility - 0.5) * 2),
      });
  }
  return { items, selection, labels: edgeLabels, obstacles: edgeObstacles };
}
