import {
  edgeAppearance,
  edgeStyleFor,
  feedbackRelations,
  LINE_DASH,
  localize,
} from '@relgraph/core';
import type { DomainStyle, ProjectedVisualGraph, VisualGraph } from '@relgraph/core';
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
  /** Relations that run against the flow, routed over the steps (`returns`). */
  returns: Set<string>;
}

/** The feedback of each graph's relations, once per list of relations. */
const feedbackOf = new WeakMap<readonly unknown[], Set<string>>();

/**
 * The relations routed as returns: the feedback of the process
 * (`feedbackRelations`: those that lead back to a step already under way,
 * by structure and the author's order, never by how many there are or which
 * way they point), in a drawing that advances sideways, and drawn more
 * sideways than upright. None without `returns: 'over'`.
 */
function returnsOf(
  view: Pick<ProjectedVisualGraph, 'edges'>,
  points: ReadonlyMap<string, Point>,
  style: Pick<DomainStyle, 'returns'>,
  graph: Pick<VisualGraph, 'nodes' | 'edges'>,
): Set<string> {
  const returns = new Set<string>();
  if (style.returns !== 'over') return returns;
  let feedback = feedbackOf.get(graph.edges);
  if (!feedback) {
    feedback = feedbackRelations(graph);
    feedbackOf.set(graph.edges, feedback);
  }
  if (!feedback.size) return returns;
  let sideways = 0,
    upright = 0;
  for (const edge of view.edges) {
    const a = points.get(edge.source),
      b = points.get(edge.target);
    if (!a || !b || edge.source === edge.target) continue;
    sideways += Math.abs(b.x - a.x);
    upright += Math.abs(b.y - a.y);
  }
  if (!(sideways >= upright)) return returns;
  for (const edge of view.edges) {
    if (!feedback.has(edge.id)) continue;
    const a = points.get(edge.source),
      b = points.get(edge.target);
    if (a && b && Math.abs(b.x - a.x) > Math.abs(b.y - a.y) * 0.35) returns.add(edge.id);
  }
  return returns;
}

export function relationLayout(
  view: Pick<ProjectedVisualGraph, 'nodes' | 'edges'>,
  points: ReadonlyMap<string, Point>,
  style: Pick<DomainStyle, 'returns'>,
  graph: Pick<VisualGraph, 'nodes' | 'edges'>,
): RelationLayout {
  const returns = returnsOf(view, points, style, graph);
  // Parallel and reciprocal links get stable, symmetric curve offsets. A
  // return takes its own route, so the relation it pairs with stays straight.
  const pairs = new Map<string, string[]>();
  for (const edge of view.edges) {
    if (returns.has(edge.id)) continue;
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
  return { pairs, pull, spokeAngles, degree, loopsOf, returns };
}

/** Where a return crosses: above (-1) or below (1) the steps, and at what height. */
export interface ReturnRoute {
  side: -1 | 1;
  peak: number;
}

/**
 * The route of every return, so that none passes through a step it does not
 * join and no two share a line. A return leaves and arrives upright, so it
 * crosses on the side where fewer steps stand in the column of its ends
 * (above when equal), beyond every step between its ends. Shorter returns
 * are routed first and keep the inside; one that would run along another
 * moves a lane further out. An authored `curve` only takes a return further
 * out, and counts before the lanes are resolved.
 */
export function returnRoutes(
  ctx: Pick<FrameContext, 'view' | 'u' | 'config'>,
  drawnById: ReadonlyMap<string, DrawnNode>,
  returns: ReadonlySet<string>,
): Map<string, ReturnRoute> {
  const routes = new Map<string, ReturnRoute>();
  if (!returns.size) return routes;
  const { u } = ctx;
  const steps = [...drawnById.values()].filter((entry) => entry.visibility > 0);
  const spans = ctx.view.edges
    .filter((edge) => returns.has(edge.id))
    .flatMap((edge) => {
      const from = drawnById.get(edge.source),
        to = drawnById.get(edge.target);
      return from && to ? [{ edge, from, to, reach: Math.abs(to.p.x - from.p.x) }] : [];
    })
    .sort((m, n) => m.reach - n.reach || (m.edge.id < n.edge.id ? -1 : 1));
  const placed: { lo: number; hi: number; side: number; peak: number }[] = [];
  const lane = u(22);
  for (const { edge, from, to } of spans) {
    const lo = Math.min(from.p.x, to.p.x),
      hi = Math.max(from.p.x, to.p.x);
    // Steps standing in the way of an upright leg from `end` towards `side`.
    const blocked = (side: number): number =>
      [from, to].reduce(
        (count, end) =>
          count +
          steps.filter(
            (other) =>
              other !== from &&
              other !== to &&
              Math.abs(other.p.x - end.p.x) <= other.geometry.halfWidth + u(6) &&
              (other.p.y - end.p.y) * side > 0,
          ).length,
        0,
      );
    const side = blocked(1) < blocked(-1) ? 1 : -1;
    let edgeOfSteps = side * Math.max(from.p.y * side, to.p.y * side);
    for (const other of steps)
      if (other.p.x + other.geometry.halfWidth >= lo && other.p.x - other.geometry.halfWidth <= hi)
        edgeOfSteps =
          side *
          Math.max(edgeOfSteps * side, (other.p.y + side * other.geometry.halfHeight) * side);
    // A lane out, and room for the turn and the arrowhead that comes back in.
    // An authored curve only takes the return further out: it is applied
    // before the lanes are resolved, and never brings it inside the clearance.
    const curve = Math.max(0, edgeAppearance(ctx.config, edge).curve ?? 0);
    let peak = edgeOfSteps + side * (lane + u(6) + u(curve));
    for (let moved = true; moved;) {
      moved = false;
      for (const other of placed)
        if (
          other.side === side &&
          other.lo < hi &&
          other.hi > lo &&
          Math.abs(other.peak - peak) < lane - 1e-6
        ) {
          peak = other.peak + side * lane;
          moved = true;
        }
    }
    placed.push({ lo, hi, side, peak });
    routes.set(edge.id, { side, peak });
  }
  return routes;
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
  const { pairs, spokeAngles, degree, loopsOf, returns } = layout;
  const strong = style.edgeContrast === 'strong';
  const routes = returnRoutes(ctx, drawnById, returns);
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
              : edgePaint(P, edgeStyle.stroke, style.edgeContrast))),
      // Strength is drawn as weight; a highlighted relation gains one more step.
      width = u(
        custom.width ??
          (edge.strength === undefined ? 1.5 : 1 + 0.28 * clamp(edge.strength, 1, 5)) +
            (highlighted ? 1 : 0),
      );
    const head = view.domain === 'biology' ? edgeStyle.head : (custom.head ?? edgeStyle.head);
    const arrow = Boolean(edge.directed) && head === 'arrow',
      arrowLength = u(8) + width * 1.3;
    const dash = custom.dash === undefined ? edgeStyle.dash : LINE_DASH[custom.dash];
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
      const back = routes.get(edge.id);
      const key = [edge.source, edge.target].sort().join('\0');
      const siblings = back ? [edge.id] : pairs.get(key);
      if (!siblings) throw new Error('Missing edge pair');
      const order = siblings.indexOf(edge.id) - (siblings.length - 1) / 2;
      const sign = edge.source < edge.target ? 1 : -1;
      // Tree, mind-map and process links leave and arrive sideways when the
      // two nodes are clearly side by side. A pair joined both ways, such as
      // a step and the retry that returns to it, opens into two arcs instead.
      const elbow =
        !back &&
        style.routing === 'elbow' &&
        siblings.length === 1 &&
        Math.abs(dx) > Math.abs(dy) * 0.35;
      // A return leaves its step upright and enters its target from the same side.
      const ux = back ? 0 : elbow ? Math.sign(dx) : dx / len,
        uy = back ? back.side : elbow ? 0 : dy / len;
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
          back ? { x: 0, y: back.side } : { x: -ux, y: -uy },
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
      if (!back && (elbow ? Math.abs(dx) : len) <= ra + rb + u(1)) continue;
      const start = { x: a.x + ux * ra, y: a.y + uy * ra },
        end = back ? { x: b.x, y: b.y + back.side * rb } : { x: b.x - ux * rb, y: b.y - uy * rb };
      let segments: Segment[];
      if (back) {
        // Out upright, across beyond every step between the two, and back
        // in upright (`returnRoutes`).
        const peak = back.peak,
          way = Math.sign(dx),
          turn = Math.min(Math.abs(dx) / 3, u(18));
        const leave = { x: start.x + way * turn, y: peak },
          arrive = { x: end.x - way * turn, y: peak };
        segments = [
          [start, { x: start.x, y: peak }, leave],
          [leave, { x: (leave.x + arrive.x) / 2, y: peak }, arrive],
          [arrive, { x: end.x, y: peak }, end],
        ];
      } else if (elbow) {
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
      // On a return, the middle of its crossing.
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
        alpha: active * (highlighted ? 0.98 : strong ? 0.92 : 0.66),
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
