import { composeNodeImage } from './image-layout.js';
import {
  DEFAULT_LOCALE,
  nodeAppearance,
  edgeAppearance,
  displayNodeText,
  displayEdgeText,
  edgeStyleFor,
  nodeStyleFor,
  localize,
  NEUTRAL_STYLE,
} from '@relgraph/core';
import type {
  DirectorFrameState,
  DomainStyle,
  Locale,
  ProjectedVisualGraph,
  ResolvedHighlight,
  VisualEdge,
  VisualGraph,
  VisualNode,
} from '@relgraph/core';
import type {
  DisplayItem,
  DisplayList,
  FontRef,
  FrameText,
  Paint,
  PathCommand,
  TextMeasurer,
} from './display-list.js';
import { projectCameraPoint, DEFAULT_FRAME_SPEC, type FrameSpec, type Rect } from './frame-spec.js';
import {
  nodeRadius,
  rectsIntersect,
  glyphGeometry,
  nodeOutline,
  nodeGlyphBounds,
  nodeGlyphRayDistance,
  nodeLabelObstacleBounds,
  DEFAULT_BORDER_WIDTH,
  type GlyphGeometry,
} from './node-geometry.js';
import { RENDER_MESSAGES } from './locale.js';
import { edgePaint, mixHex, toneOf, VIDEO_THEMES, type VideoTheme } from './theme.js';

type Point = { x: number; y: number };
type DrawItem = VisualNode | VisualEdge;
type EdgeLabel = Point & {
  text: string;
  alpha: number;
  font: FontRef;
  color: string;
  stroke: string;
  /** Unit direction the tag is pushed in, by half its own size. */
  push?: Point;
};

/** Exact de Casteljau prefix [0,t] of a quadratic Bézier. No raster approximation. */
export function quadraticPrefix(
  start: Point,
  control: Point,
  end: Point,
  progress: number,
): PathCommand[] {
  const t = clamp(progress, 0, 1);
  if (t === 1)
    return [
      ['M', start.x, start.y],
      ['Q', control.x, control.y, end.x, end.y],
    ];
  const first = { x: mix(start.x, control.x, t), y: mix(start.y, control.y, t) };
  const second = { x: mix(control.x, end.x, t), y: mix(control.y, end.y, t) };
  const point = { x: mix(first.x, second.x, t), y: mix(first.y, second.y, t) };
  return [
    ['M', start.x, start.y],
    ['Q', first.x, first.y, point.x, point.y],
  ];
}
export type DetailLookup = (
  nodeId: string,
  domainAt: number | null,
) => { summary?: string } | null | undefined;

export interface ComposeOptions {
  /** The full graph; only its scene count is read (the frame state is already projected). */
  graph: Pick<VisualGraph, 'scenes' | 'project'>;
  positions: ReadonlyMap<string, Point>;
  frame: number;
  fps: number;
  measure: TextMeasurer;
  frameSpec?: FrameSpec;
  theme?: VideoTheme;
  style?: DomainStyle;
  locale?: Locale;
  detailAt?: DetailLookup;
}

const TAU = Math.PI * 2;
/** Share of an arrowhead's length, from the tip, where the stroke meets it. */
const ARROW_NOTCH = 0.72;
const ease = (t: number): number => {
  const x = Math.min(1, Math.max(0, t));
  return x * x * (3 - 2 * x);
};
const clamp = (x: number, a: number, b: number): number => Math.min(b, Math.max(a, x));
const mix = (a: number, b: number, t: number): number => a + (b - a) * t;
const color = (value: unknown, fallback: string): string =>
  typeof value === 'string' && /^#[0-9a-f]{6}$/i.test(value) ? value : fallback;
const isEdge = (item: DrawItem): item is VisualEdge =>
  'source' in item && item.source !== undefined;
const alphaHex = (alpha: number): string =>
  Math.round(alpha * 255)
    .toString(16)
    .padStart(2, '0');

/**
 * A domain caption followed by the edge's own label when that adds
 * information; a stoichiometry of 1 adds none.
 */
const captionWithLabel = (caption: string, label: string | undefined): string =>
  label && !/^1$/.test(label) ? `${caption} · ${label}` : caption;

/** Attention (0–1) of a node or edge under a shot highlight. */
export function shotAttention(
  item: DrawItem,
  highlight: ResolvedHighlight,
  view: ProjectedVisualGraph,
): number {
  const ids = highlight.nodeIds,
    edges = highlight.edgeIds,
    group = highlight.groupId;
  const active = ids.length || edges.length || group;
  if (!active) return 1;
  if (isEdge(item))
    return edges.includes(item.id) ||
      (group &&
        view.nodes.some((n) => n.id === item.source && n.groupId === group) &&
        view.nodes.some((n) => n.id === item.target && n.groupId === group))
      ? 1
      : 0.2;
  // Only a highlighted group may match: ungrouped nodes (groupId null or
  // undefined) must not equal an absent group and stay dimmed.
  return ids.includes(item.id) ||
    (group && item.groupId === group) ||
    view.edges.some(
      (edge) => edges.includes(edge.id) && (edge.source === item.id || edge.target === item.id),
    )
    ? 1
    : 0.24;
}

function fitText(measure: TextMeasurer, text: unknown, font: FontRef, maxWidth: number): string {
  const s = String(text || '');
  if (measure(s, font) <= maxWidth) return s;
  let result = '';
  for (const ch of s) {
    if (measure(result + ch + '…', font) > maxWidth) break;
    result += ch;
  }
  return result + '…';
}
function wrapText(
  measure: TextMeasurer,
  text: unknown,
  font: FontRef,
  maxWidth: number,
  maxLines: number,
): string[] {
  const lines = [];
  let line = '';
  for (const ch of String(text || '')) {
    if (ch === '\n' || (line && measure(line + ch, font) > maxWidth)) {
      lines.push(line);
      line = ch === '\n' ? '' : ch;
      if (lines.length === maxLines) break;
    } else line += ch;
  }
  if (lines.length < maxLines && line) lines.push(line);
  if (lines.join('').length < String(text || '').replaceAll('\n', '').length && lines.length)
    lines[lines.length - 1] = fitText(measure, lines.at(-1) + '…', font, maxWidth);
  return lines;
}

/**
 * Smooth outline around a set of circles: the convex hull of points sampled
 * on every circle, rounded with quadratic segments through its edge midpoints.
 * One circle gives a disc, two a capsule, more a soft blob that follows them.
 */
export function hullOutline(circles: readonly { x: number; y: number; r: number }[]): {
  d: PathCommand[];
  points: Point[];
} {
  const samples: Point[] = [];
  for (const c of circles)
    for (let i = 0; i < 16; i++) {
      const angle = (i / 16) * TAU;
      samples.push({ x: c.x + Math.cos(angle) * c.r, y: c.y + Math.sin(angle) * c.r });
    }
  samples.sort((a, b) => a.x - b.x || a.y - b.y);
  const cross = (o: Point, a: Point, b: Point): number =>
    (a.x - o.x) * (b.y - o.y) - (a.y - o.y) * (b.x - o.x);
  const half = (source: Point[]): Point[] => {
    const chain: Point[] = [];
    for (const q of source) {
      while (chain.length >= 2 && cross(chain[chain.length - 2], chain[chain.length - 1], q) <= 0)
        chain.pop();
      chain.push(q);
    }
    chain.pop();
    return chain;
  };
  const points = [...half(samples), ...half([...samples].reverse())];
  if (points.length < 3) return { d: [], points: samples };
  const mid = (a: Point, b: Point): Point => ({ x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 });
  const first = mid(points[points.length - 1], points[0]);
  const d: PathCommand[] = [['M', first.x, first.y]];
  points.forEach((q, i) => {
    const next = mid(q, points[(i + 1) % points.length]);
    d.push(['Q', q.x, q.y, next.x, next.y]);
  });
  d.push(['Z']);
  return { d, points };
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
 * Compose one frame into a display list. Pure: the result depends only on the
 * frame state and options (including the text measurer), never on earlier frames.
 */
export function composeFrame(state: DirectorFrameState, options: ComposeOptions): DisplayList {
  const {
    graph,
    positions,
    frame,
    fps,
    measure,
    frameSpec: spec = DEFAULT_FRAME_SPEC,
    theme: P = VIDEO_THEMES.dark,
    style = NEUTRAL_STYLE,
    locale = DEFAULT_LOCALE,
    detailAt = () => undefined,
  } = options;
  const config = graph.project;
  const messages = RENDER_MESSAGES[locale];
  const { width: W, height: H, stage, typeScale: ts } = spec;
  const { title: titleBand, graph: graphArea, caption: captionBand } = spec.safe;
  // Lengths in the 720p design, scaled to this frame.
  const u = (n: number): number => n * ts;
  const sans = (size: number, weight = 400): FontRef => ({ family: 'sans', size: u(size), weight });
  const serif = (size: number, weight = 400): FontRef => ({
    family: 'serif',
    size: u(size),
    weight,
  });
  const mono = (size: number, weight = 400): FontRef => ({ family: 'mono', size: u(size), weight });
  // Labels stay inside the stage with a small margin.
  const bounds = {
    left: stage.x + u(4),
    right: stage.x + stage.w - u(4),
    top: stage.y + u(4),
    bottom: stage.y + stage.h - u(2),
  };
  const inBounds = (box: Rect): boolean =>
    box.x >= bounds.left &&
    box.x + box.w <= bounds.right &&
    box.y >= bounds.top &&
    box.y + box.h <= bounds.bottom;

  const { view, playback, cameraResolved: cam, highlight, previousHighlight, transition } = state;
  const nodeProgress = (id: string): number => state.reveal?.nodes[id] ?? 1;
  const edgeProgress = (id: string): number => state.reveal?.edges[id] ?? 1;
  const captionAlpha = state.captionOpacity ?? 1;
  const point = (node: VisualNode): Point => {
    const p = positions.get(node.id);
    if (!p) throw new Error(`Missing layout position for node ${node.id}`);
    return projectCameraPoint(p, cam, spec);
  };
  const points = new Map(view.nodes.map((n) => [n.id, point(n)]));
  const pointFor = (id: string): Point => {
    const result = points.get(id);
    if (!result) throw new Error(`Missing projected position for node ${id}`);
    return result;
  };
  const groups = new Map(view.groups.map((g) => [g.id, g]));
  const attention = (item: DrawItem): number =>
    mix(
      shotAttention(item, previousHighlight, view),
      shotAttention(item, highlight, view),
      transition,
    );
  const radius = (node: VisualNode): number => nodeRadius(node, cam.scale, spec, style, config);
  const nodeLabel = (node: VisualNode): string =>
    displayNodeText(config, node.id)?.label ?? node.label;
  const edgeLabel = (edge: VisualEdge): string | undefined =>
    displayEdgeText(config, edge.id)?.label ?? edge.label;
  const selection: NonNullable<DisplayList['selection']> = [];

  const items: DisplayItem[] = [];
  const graphItems: DisplayItem[] = [];
  const legendItems: DisplayItem[] = [];

  // Background: a quiet gradient, a soft light behind the stage and a fine
  // dot lattice that gives the graph a ground to sit on.
  const stageCx = stage.x + stage.w / 2,
    stageCy = stage.y + stage.h / 2;
  items.push(
    {
      type: 'path',
      d: [['R', 0, 0, W, H]],
      fill: {
        type: 'linear',
        x0: 0,
        y0: 0,
        x1: W,
        y1: H,
        stops: [
          { offset: 0, color: P.bg[0] },
          { offset: 0.5, color: P.bg[1] },
          { offset: 1, color: P.bg[2] },
        ],
      },
    },
    {
      type: 'path',
      d: [['R', 0, 0, W, H]],
      fill: {
        type: 'radial',
        x0: stageCx,
        y0: stageCy,
        r0: u(20),
        x1: stageCx,
        y1: stageCy,
        r1: stage.w * 0.52,
        stops: [
          { offset: 0, color: P.warm },
          { offset: 1, color: P.warmEnd },
        ],
      },
    },
  );
  const lattice: PathCommand[] = [];
  const pitch = u(28),
    dot = u(0.8);
  for (let row = 0; stage.y + pitch * (row + 0.5) < stage.y + stage.h; row++)
    for (let column = 0; stage.x + pitch * (column + 0.5) < stage.x + stage.w; column++) {
      const x = stage.x + pitch * (column + 0.5),
        y = stage.y + pitch * (row + 0.5);
      lattice.push(['M', x + dot, y], ['A', x, y, dot, 0, TAU]);
    }
  items.push({ type: 'path', d: lattice, fill: P.grid });

  // Everything about a node that edges, hulls and labels need to agree on.
  const hasFocus = (h: ResolvedHighlight): boolean =>
    Boolean(h.nodeIds.length || h.edgeIds.length || h.groupId);
  const drawn = view.nodes.map((node) => {
    const custom = nodeAppearance(config, node),
      kindStyle = nodeStyleFor(style, node.kind),
      group = node.groupId == null ? undefined : groups.get(node.groupId);
    return {
      node,
      custom,
      p: pointFor(node.id),
      r: radius(node),
      geometry: glyphGeometry(node, cam.scale, spec, style, 1, config),
      // Colour: the node's own, then its group's, then its kind's.
      c:
        custom.border ??
        color(
          node.color || (group ? (group.color ?? toneOf(P, group.tone)) : undefined),
          color(kindStyle.color, toneOf(P, kindStyle.tone) ?? P.fallbackNode),
        ),
      alpha: attention(node),
      visibility: nodeProgress(node.id),
      // Explicitly named in the shot, as opposed to merely not dimmed.
      focus: mix(
        previousHighlight.nodeIds.includes(node.id) ? 1 : 0,
        highlight.nodeIds.includes(node.id) ? 1 : 0,
        transition,
      ),
    };
  });
  const drawnById = new Map(drawn.map((entry) => [entry.node.id, entry]));
  const occupied: Rect[] = [];
  const nodeLabelBounds = new Map<string, Rect>();
  for (const { node, p, visibility } of drawn)
    if (visibility > 0.5) {
      const obstacle = nodeLabelObstacleBounds(node, p, cam.scale, spec, style, config);
      nodeLabelBounds.set(node.id, obstacle);
      occupied.push(obstacle);
    }

  // Groups: a soft hull that follows its members instead of a fixed ellipse.
  const focusActive = mix(
    hasFocus(previousHighlight) ? 1 : 0,
    hasFocus(highlight) ? 1 : 0,
    transition,
  );
  for (const group of view.groups) {
    const members = drawn.filter((entry) => entry.node.groupId === group.id);
    if (!members.length) continue;
    const groupProgress = Math.max(...members.map((entry) => entry.visibility));
    if (groupProgress <= 0) continue;
    // A member that is still arriving pulls the hull out as it appears.
    const settled = members.filter((entry) => entry.visibility >= 1),
      anchor = settled.length
        ? {
            x: settled.reduce((sum, entry) => sum + entry.p.x / settled.length, 0),
            y: settled.reduce((sum, entry) => sum + entry.p.y / settled.length, 0),
          }
        : null;
    const circles = members.map((entry) => {
      const grow = anchor ? ease(entry.visibility) : 1;
      return {
        x: anchor ? mix(anchor.x, entry.p.x, grow) : entry.p.x,
        y: anchor ? mix(anchor.y, entry.p.y, grow) : entry.p.y,
        r:
          (Math.max(entry.geometry.halfWidth, entry.geometry.halfHeight) + u(26)) *
          (0.6 + 0.4 * grow),
      };
    });
    const hull = hullOutline(circles),
      c = color(group.color, toneOf(P, group.tone) ?? P.fallbackNode);
    const presence = Math.max(...members.map((entry) => entry.alpha)),
      lit = mix(
        previousHighlight.groupId === group.id ? 1 : 0,
        highlight.groupId === group.id ? 1 : 0,
        transition,
      );
    const decoration: DisplayItem[] = [
      { type: 'path', d: hull.d, fill: c + P.hullFill },
      {
        type: 'path',
        d: hull.d,
        stroke: c + P.groupStroke,
        width: u(mix(1, 1.6, lit)),
      },
    ];
    const font = sans(13, 500),
      label = fitText(measure, group.label, font, u(180));
    if (label && groupProgress > 0.5) {
      const w = measure(label, font) + u(14),
        h = font.size * 1.5;
      // The name sits on the outline like a tab, where no member can be.
      const top = hull.points.reduce((best, q) => (q.y < best.y ? q : best)),
        bottom = hull.points.reduce((best, q) => (q.y > best.y ? q : best)),
        left = hull.points.reduce((best, q) => (q.x < best.x ? q : best)),
        right = hull.points.reduce((best, q) => (q.x > best.x ? q : best));
      const spots = [top, bottom, left, right].map((q) => ({
        x: q.x - w / 2,
        y: q.y - h / 2,
        w,
        h,
      }));
      const free = (box: Rect): boolean =>
        inBounds(box) && !occupied.some((o) => rectsIntersect(box, o));
      const fallback = {
        ...spots[0],
        x: clamp(spots[0].x, bounds.left, Math.max(bounds.left, bounds.right - w)),
        y: clamp(spots[0].y, bounds.top, Math.max(bounds.top, bounds.bottom - h)),
      };
      const box = spots.find(free) ?? fallback;
      occupied.push(box);
      decoration.push({
        type: 'text',
        text: label,
        x: box.x + w / 2,
        y: box.y + h / 2,
        font,
        fill: c + P.groupLabel,
        align: 'center',
        baseline: 'middle',
        halo: { paint: P.labelHalo, width: u(6) },
        ...(groupProgress < 1 ? { alpha: (groupProgress - 0.5) * 2 } : {}),
      });
    }
    // Hulls recede with their members when another part of the graph is in focus.
    const hullAlpha = groupProgress * mix(1, Math.max(lit, 0.35 + 0.65 * presence), focusActive);
    graphItems.push(
      hullAlpha >= 1
        ? { type: 'group', items: decoration }
        : { type: 'group', alpha: hullAlpha, items: decoration },
    );
  }

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
    spokeAngles.set(edge.source, [
      ...(spokeAngles.get(edge.source) ?? []),
      Math.atan2(b.y - a.y, b.x - a.x),
    ]);
    spokeAngles.set(edge.target, [
      ...(spokeAngles.get(edge.target) ?? []),
      Math.atan2(a.y - b.y, a.x - b.x),
    ]);
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
  const edgeLabels: EdgeLabel[] = [],
    edgeObstacles: Rect[] = [];
  const quad = (a: Point, c: Point, b: Point, t: number): Point => {
    const v = 1 - t;
    return {
      x: v * v * a.x + 2 * v * t * c.x + t * t * b.x,
      y: v * v * a.y + 2 * v * t * c.y + t * t * b.y,
    };
  };
  /** A swept-back arrowhead whose notch is where the stroke ends. */
  const arrowhead = (tip: Point, dir: Point, length: number, fill: Paint): DisplayItem => {
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
  };
  for (const edge of view.edges) {
    const custom = edgeAppearance(config, edge);
    const visibility = edgeProgress(edge.id);
    const from = drawnById.get(edge.source),
      to = drawnById.get(edge.target);
    if (!from || !to) continue;
    const a = from.p,
      b = to.p;
    const edgeStyle = edgeStyleFor(style, edge.kind),
      highlighted = highlight.edgeIds.includes(edge.id),
      active = attention(edge),
      kindColour = color(edgeStyle.color, toneOf(P, edgeStyle.tone) ?? ''),
      stroke =
        custom.color ??
        (kindColour || (highlighted ? P.edge.highlight : edgePaint(P, edgeStyle.stroke))),
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
    let labelAt: Point, labelPush: Point | undefined;
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
      const loops = view.edges
        .filter((e) => e.source === edge.source && e.target === edge.source)
        .map((e) => e.id)
        .sort();
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
          edgeObstacles.push({ x: q.x - u(4), y: q.y - u(4), w: u(8), h: u(8) });
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
      const ux = dx / len,
        uy = dy / len;
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
      if (len <= ra + rb + u(1)) continue;
      const start = { x: a.x + ux * ra, y: a.y + uy * ra },
        end = { x: b.x - ux * rb, y: b.y - uy * rb };
      const key = [edge.source, edge.target].sort().join('\0');
      const siblings = pairs.get(key);
      if (!siblings) throw new Error('Missing edge pair');
      const order = siblings.indexOf(edge.id) - (siblings.length - 1) / 2;
      const sign = edge.source < edge.target ? 1 : -1;
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
      const control = {
        x: (start.x + end.x) / 2 - uy * offset,
        y: (start.y + end.y) / 2 + ux * offset,
      };
      if (visibility > 0.5) {
        const samples = Array.from({ length: 33 }, (_, i) =>
          quad(start, control, end, (i / 32) * visibility),
        );
        selection.push({ kind: 'edge', id: edge.id, points: samples });
        // A label appearing before halfway would disturb existing label layout.
        // Beyond halfway, only the drawn prefix participates in avoidance.
        for (let t = 0.1; t < visibility; t += 0.1) {
          const q = quad(start, control, end, t);
          edgeObstacles.push({ x: q.x - u(4), y: q.y - u(4), w: u(8), h: u(8) });
        }
      }
      parts.push({
        type: 'path',
        d: quadraticPrefix(start, control, end, visibility),
        stroke,
        width,
        ...(dash?.length ? { dash: dash.map(u) } : {}),
      });
      if (edge.directed && visibility > 0) {
        const t = clamp(visibility, 0, 1),
          tipBase = quad(start, control, end, t);
        // Tangent of the drawn prefix at its end; the chord when degenerate.
        const tx = mix(control.x - start.x, end.x - control.x, t),
          ty = mix(control.y - start.y, end.y - control.y, t),
          tl = Math.hypot(tx, ty);
        const dir = tl > 0 ? { x: tx / tl, y: ty / tl } : { x: ux, y: uy };
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
      labelAt = quad(start, control, end, 0.5);
    }
    if (visibility > 0) {
      // A highlighted relation glows softly in its own colour.
      if (highlighted && parts[0].type === 'path')
        graphItems.push({
          type: 'group',
          alpha: active * 0.16,
          items: [{ type: 'path', d: parts[0].d, stroke, width: width * 3.4 }],
        });
      graphItems.push({
        type: 'group',
        alpha: active * (highlighted ? 0.98 : 0.66),
        items: parts,
      });
    }
    const caption = edgeStyle.caption ? localize(edgeStyle.caption, locale) : '';
    const label = caption
      ? captionWithLabel(caption, edgeLabel(edge))
      : (custom.showLabel ?? highlighted)
        ? edgeLabel(edge) || ''
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
        alpha: active * Math.min(1, (visibility - 0.5) * 2),
      });
  }

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
    const extent = Math.max(geometry.halfWidth, geometry.halfHeight);
    const glyph: DisplayItem[] = [],
      aura: DisplayItem[] = [];
    // Light gathers behind the nodes a shot names, and behind the principals.
    const glow = Math.max(focus, (node.importance ?? 0) >= 5 && alpha > 0.8 ? 0.55 : 0);
    if (glow > 0) aura.push(ellipseGlow(p.x, p.y, extent * 2.3, extent * 2.3, c, 0.2 * glow));
    if (focus > 0)
      aura.push({
        type: 'path',
        d: [['A', p.x, p.y, extent + borderWidth / 2 + u(4.5), 0, TAU]],
        stroke: c,
        width: u(1.2),
        alpha: 0.55 * focus,
      });
    if (asset && custom.image)
      glyph.push(
        { type: 'path', d: outline, fill: custom.fill ?? P.nodeFill },
        composeNodeImage(custom.image, asset, imageBox, outline, custom.imageFit ?? 'cover'),
        { type: 'path', d: outline, stroke: c, width: borderWidth },
      );
    else
      glyph.push(
        { type: 'path', d: outline, fill: body, stroke: c, width: borderWidth },
        {
          type: 'path',
          d: [
            ['A', p.x, p.y, geometry.shape === 'diamond' ? u(3) : Math.max(u(3), r * 0.34), 0, TAU],
          ],
          fill: c,
        },
      );
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
    if (aura.length) graphItems.push({ ...frame, items: aura });
    graphItems.push({ ...frame, items: glyph });
  }

  // The legend names what colour, rhythm and shape mean, for the kinds that
  // are on screen now. Kinds captioned on their own edges need no entry.
  const legendEntries = style.legend.flatMap((entry) => {
    const isNode = entry.of === 'node';
    if (!isNode && edgeStyleFor(style, entry.kind).caption) return [];
    const progress = isNode
      ? Math.max(
          0,
          ...view.nodes.filter((n) => n.kind === entry.kind).map((n) => nodeProgress(n.id)),
        )
      : Math.max(
          0,
          ...view.edges.filter((e) => e.kind === entry.kind).map((e) => edgeProgress(e.id)),
        );
    return progress > 0.5 ? [{ ...entry, isNode, alpha: Math.min(1, (progress - 0.5) * 2) }] : [];
  });
  if (legendEntries.length > 1) {
    const font = sans(12, 400),
      swatch = u(20),
      gap = u(6),
      between = u(16),
      padX = u(10),
      h = u(24);
    const x0 = titleBand.x + u(2),
      y0 = stage.y + stage.h - h - u(8),
      limit = stage.x + stage.w - u(12);
    const row: DisplayItem[] = [];
    let x = x0 + padX;
    for (const entry of legendEntries) {
      const text = fitText(measure, localize(entry.label, locale), font, u(120)),
        w = (entry.isNode ? u(12) : swatch) + gap + measure(text, font);
      if (x + w + padX > limit) break;
      const cy = y0 + h / 2;
      if (entry.isNode) {
        const kindStyle = nodeStyleFor(style, entry.kind),
          c = color(kindStyle.color, toneOf(P, kindStyle.tone) ?? P.legendText),
          half = u(5.2);
        const g: GlyphGeometry =
          kindStyle.shape === 'pill'
            ? {
                shape: 'pill',
                radius: half,
                halfWidth: half * 1.25,
                halfHeight: half * 0.78,
                cornerRadius: half * 0.62,
                halfStroke: 0,
              }
            : kindStyle.shape === 'square'
              ? {
                  shape: 'square',
                  radius: half,
                  halfWidth: half * 0.9,
                  halfHeight: half * 0.9,
                  cornerRadius: half * 0.26,
                  halfStroke: 0,
                }
              : kindStyle.shape === 'hexagon'
                ? {
                    shape: 'hexagon',
                    radius: half,
                    halfWidth: half * 1.08,
                    halfHeight: half * 1.08 * (Math.sqrt(3) / 2),
                    cornerRadius: 0,
                    halfStroke: 0,
                  }
                : {
                    shape: kindStyle.shape,
                    radius: half,
                    halfWidth: half,
                    halfHeight: half,
                    cornerRadius: 0,
                    halfStroke: 0,
                  };
        row.push({
          type: 'path',
          d: nodeOutline({ x: x + u(6), y: cy }, g),
          fill: mixHex(color(c, P.fallbackNode), P.nodeFill, P.nodeTint),
          stroke: c,
          width: u(1.5),
          alpha: entry.alpha,
        });
      } else {
        const edgeStyle = edgeStyleFor(style, entry.kind),
          c = color(edgeStyle.color, toneOf(P, edgeStyle.tone) ?? edgePaint(P, edgeStyle.stroke));
        row.push({
          type: 'path',
          d: [
            ['M', x, cy],
            ['L', x + swatch, cy],
          ],
          stroke: c,
          width: u(2),
          ...(edgeStyle.dash?.length ? { dash: edgeStyle.dash.map(u) } : {}),
          alpha: entry.alpha,
        });
      }
      row.push({
        type: 'text',
        text,
        x: x + (entry.isNode ? u(12) : swatch) + gap,
        y: cy + u(0.5),
        font,
        fill: P.legendText,
        baseline: 'middle',
        alpha: entry.alpha,
      });
      x += w + between;
    }
    if (row.length) {
      const plate = { x: x0, y: y0, w: x - between + padX - x0, h };
      occupied.push(plate);
      legendItems.push(
        {
          type: 'path',
          d: [['RR', plate.x, plate.y, plate.w, plate.h, h / 2]],
          fill: P.legendPlate,
        },
        ...row,
      );
    }
  }

  // Deterministic screen-space label placement: prioritize selected and major nodes.
  const sorted = drawn
    .filter((entry) => entry.visibility > 0.5)
    .sort(
      (a, b) =>
        b.alpha - a.alpha ||
        (b.node.importance || 0) - (a.node.importance || 0) ||
        a.node.id.localeCompare(b.node.id, 'en'),
    );
  for (const { node, custom, p, r, alpha: active } of sorted) {
    const obstacle = nodeLabelBounds.get(node.id);
    if (!obstacle) continue;
    const importance = node.importance ?? 0;
    // Type follows the same hierarchy as the glyphs: principals speak loudest.
    const font = sans(
      custom.fontSize ??
        (importance >= 5 ? 19 : importance >= 4 ? 17 : importance >= 1 && importance < 3 ? 14 : 16),
      custom.fontWeight ?? (importance >= 4 ? 600 : 500),
    );
    const lines = wrapText(measure, nodeLabel(node), font, u(170), 2);
    const width = Math.max(0, ...lines.map((line) => measure(line, font))),
      height = lines.length * font.size * 1.3;
    const rightX = Math.max(p.x + r + u(9), obstacle.x + obstacle.w + u(5));
    const leftX = Math.min(p.x - r - u(9) - width, obstacle.x - width - u(5));
    const topY = Math.min(p.y - r - Math.max(u(25), height + u(4)), obstacle.y - height - u(4));
    const bottomY = Math.max(p.y + r + u(6), obstacle.y + obstacle.h + u(2));
    const nearRightX = Math.max(p.x + r + u(5), obstacle.x + obstacle.w + u(1));
    const nearLeftX = Math.min(p.x - r - u(5) - width, obstacle.x - width - u(1));
    const upperY = Math.min(p.y - r - Math.max(u(24), height + u(4)), obstacle.y - height - u(1));
    const sides = [
      { x: rightX, y: p.y - height / 2 },
      { x: leftX, y: p.y - height / 2 },
      { x: p.x - width / 2, y: topY },
      { x: p.x - width / 2, y: bottomY },
    ];
    const corners = [
      { x: nearRightX, y: upperY },
      { x: nearLeftX, y: upperY },
      { x: nearRightX, y: bottomY },
      { x: nearLeftX, y: bottomY },
    ];
    const preferred =
      custom.textPosition === undefined || custom.textPosition === 'auto'
        ? undefined
        : { right: 0, left: 1, top: 2, bottom: 3 }[custom.textPosition];
    // An authored side comes first. Otherwise face away from the node's
    // relations: the side its neighbours leave free. Reading order breaks
    // ties, so a lone node labels to the right.
    const towards = pull.get(node.id) ?? { x: 0, y: 0 },
      reach = Math.hypot(towards.x, towards.y),
      out = reach > 0.35 ? { x: -towards.x / reach, y: -towards.y / reach } : { x: 0, y: 0 };
    const score = [out.x + 0.3, -out.x + 0.12, -out.y, out.y + 0.06];
    const ordered =
      preferred !== undefined
        ? [sides[preferred], ...sides.filter((_, i) => i !== preferred)]
        : sides
            .map((side, i) => ({ side, score: score[i], i }))
            .sort((m, n) => n.score - m.score || m.i - n.i)
            .map((entry) => entry.side);
    const candidates = [...ordered, ...corners].map((c) => ({ ...c, w: width, h: height }));
    // Hard rules: stay on the stage and never cover a glyph or other text.
    // Among the places that remain, prefer the natural side, then the one
    // that crosses fewest relations and cannot be read as a neighbour's name.
    let box: Rect | undefined,
      best = Infinity;
    candidates.forEach((c, rank) => {
      if (!inBounds(c) || occupied.some((o) => rectsIntersect(c, o))) return;
      const crossings = edgeObstacles.reduce((n, o) => n + (rectsIntersect(c, o) ? 1 : 0), 0);
      const cx = c.x + c.w / 2,
        cy = c.y + c.h / 2,
        own = Math.hypot(cx - p.x, cy - p.y);
      const ambiguous = sorted.some(
        (other) =>
          other.node.id !== node.id && Math.hypot(cx - other.p.x, cy - other.p.y) < own * 0.9,
      );
      const cost = rank + Math.min(6, crossings) * 0.9 + (ambiguous ? 4 : 0);
      if (cost < best) {
        best = cost;
        box = c;
      }
    });
    if (!box) continue;
    const placed: Rect = box;
    occupied.push(placed);
    lines.forEach((line, index) =>
      graphItems.push({
        type: 'text',
        text: line,
        x: placed.x,
        y: placed.y + index * font.size * 1.3,
        font,
        fill: custom.textColor ?? (active > 0.8 ? P.labelActive : P.labelMuted),
        baseline: 'top',
        halo: { paint: P.labelHalo, width: u(3.5) },
        alpha: active * Math.min(1, (nodeProgress(node.id) - 0.5) * 2),
      }),
    );
  }
  for (const label of edgeLabels) {
    const edgeFont = label.font;
    const text = fitText(measure, label.text, edgeFont, u(150)),
      w = measure(text, edgeFont) + u(14),
      h = Math.max(u(18), edgeFont.size * 1.5),
      // The tag sits on its relation, interrupting the line like a route marker.
      box = {
        x: label.x - w / 2 + (label.push ? (label.push.x * w) / 2 : 0),
        y: label.y - h / 2 + (label.push ? (label.push.y * h) / 2 : 0),
        w,
        h,
      };
    if (!inBounds(box) || occupied.some((o) => rectsIntersect(box, o))) continue;
    occupied.push(box);
    graphItems.push(
      {
        type: 'path',
        d: [['RR', box.x, box.y, w, box.h, h / 2]],
        fill: P.edgeLabelBox,
        stroke: label.stroke,
        width: u(0.8),
        alpha: label.alpha,
      },
      {
        type: 'text',
        text,
        x: box.x + w / 2,
        y: box.y + h / 2 + u(0.5),
        font: edgeFont,
        fill: label.color,
        align: 'center',
        baseline: 'middle',
        alpha: label.alpha,
      },
    );
  }
  items.push({ type: 'group', clip: { ...stage }, items: [...graphItems, ...legendItems] });

  // Detail card in the upper right of the graph safe area.
  let detail: FrameText['detail'] = null;
  if (state.overlay) {
    const overlayId = state.overlay.nodeId;
    const node = view.nodes.find((n) => n.id === overlayId),
      summary =
        displayNodeText(config, overlayId)?.description ??
        detailAt(overlayId, playback.domainAt)?.summary;
    if (node && summary) {
      const card = {
        x: graphArea.x + graphArea.w + u(10) - u(350),
        y: graphArea.y,
        w: u(350),
        h: u(190),
      };
      const textX = card.x + u(25),
        textWidth = card.w - u(50),
        titleFont = serif(20, 600),
        bodyFont = sans(15);
      const cardItems: DisplayItem[] = [
        {
          type: 'path',
          d: [['RR', card.x, card.y, card.w, card.h, u(12)]],
          fill: P.card,
          stroke: P.cardStroke,
          width: u(1),
        },
        {
          type: 'text',
          text: fitText(measure, nodeLabel(node), titleFont, textWidth),
          x: textX,
          y: card.y + u(37),
          font: titleFont,
          fill: P.cardTitle,
        },
        ...wrapText(measure, summary, bodyFont, textWidth, 5).map((line, i): DisplayItem => ({
          type: 'text',
          text: line,
          x: textX,
          y: card.y + u(68) + i * u(22),
          font: bodyFont,
          fill: P.cardText,
        })),
      ];
      // The card follows its node's label: drawn only past halfway through the
      // node's reveal and faded in over the second half. Its text is
      // accessible from the start of the reveal, like the node itself.
      const cardProgress = nodeProgress(node.id);
      if (cardProgress >= 1) items.push(...cardItems);
      else if (cardProgress > 0.5)
        items.push({ type: 'group', alpha: (cardProgress - 0.5) * 2, items: cardItems });
      detail = { label: nodeLabel(node), summary };
    }
  }

  // Title and caption bands keep graph labels out of overlays.
  items.push(
    { type: 'path', d: [['R', 0, titleBand.y, W, titleBand.h]], fill: P.band },
    { type: 'path', d: [['R', 0, captionBand.y, W, captionBand.h]], fill: P.band },
    {
      type: 'path',
      d: [
        ['M', titleBand.x, titleBand.y + titleBand.h - u(2)],
        ['L', titleBand.x + titleBand.w, titleBand.y + titleBand.h - u(2)],
        ['M', captionBand.x, captionBand.y + u(2)],
        ['L', captionBand.x + captionBand.w, captionBand.y + u(2)],
      ],
      stroke: P.bandRule,
      width: u(1),
    },
  );
  const text = (
    value: string,
    x: number,
    y: number,
    font: FontRef,
    fill: Paint,
    align?: 'right',
    alpha?: number,
  ): void => {
    if (value && (alpha === undefined || alpha > 0))
      items.push({
        type: 'text',
        text: value,
        x,
        y,
        font,
        fill,
        ...(align ? { align } : {}),
        ...(alpha === undefined || alpha === 1 ? {} : { alpha }),
      });
  };
  const titleX = titleBand.x + u(2),
    titleRight = titleBand.x + titleBand.w;
  const titleFont = serif(27, 600),
    metaFont = mono(13);
  const domainTime =
    playback.domainAt === null ? '' : messages.domainTime(view.timeline?.unit, playback.domainAt);
  // The film title shares its row with the right-aligned domain time and
  // never exceeds the title safe area; u(850) is the design's maximum length.
  const titleRoom = titleRight - titleX - (domainTime ? measure(domainTime, metaFont) + u(24) : 0);
  const filmTitle = fitText(measure, view.meta.title, titleFont, Math.min(u(850), titleRoom));
  text(messages.kicker, titleX, titleBand.y + u(39), sans(13, 600), P.kicker);
  text(filmTitle, titleX, titleBand.y + u(78), titleFont, P.title);
  text(messages.frameMeta(frame, fps), titleRight, titleBand.y + u(40), metaFont, P.meta, 'right');
  text(domainTime, titleRight, titleBand.y + u(73), metaFont, P.meta, 'right');

  const captionX = captionBand.x + u(2),
    captionWidth = captionBand.w - u(36),
    trackWidth = captionBand.w - u(4);
  const sceneTitle = playback.scene?.title || '',
    narration = playback.scene?.narration || '';
  text(
    messages.sceneCounter(playback.index + 1, graph.scenes.length),
    captionX,
    captionBand.y + u(37),
    sans(13, 500),
    P.sceneLabel,
  );
  text(
    fitText(measure, sceneTitle, titleFont, captionWidth),
    captionX,
    captionBand.y + u(77),
    titleFont,
    P.sceneTitle,
    undefined,
    captionAlpha,
  );
  const narrationFont = sans(16);
  wrapText(measure, narration, narrationFont, captionWidth, 2).forEach((line, i) =>
    text(
      line,
      captionX,
      captionBand.y + u(109) + i * u(21),
      narrationFont,
      P.narration,
      undefined,
      captionAlpha,
    ),
  );
  const trackY = captionBand.y + u(156);
  items.push({ type: 'path', d: [['R', captionX, trackY, trackWidth, u(2)]], fill: P.track });
  const progress = trackWidth * clamp(frame / fps / (playback.totalSec || 1), 0, 1);
  if (progress > 0)
    items.push({ type: 'path', d: [['R', captionX, trackY, progress, u(2)]], fill: P.progress });

  const labels = new Map(view.nodes.map((node) => [node.id, nodeLabel(node)]));
  const a11y: FrameText = {
    title: view.meta.title,
    scene: {
      index: playback.index + 1,
      count: graph.scenes.length,
      title: sceneTitle,
      narration,
    },
    domainTime,
    detail,
    nodes: view.nodes.map(nodeLabel),
    relations: view.edges.map((edge) => {
      const caption = edgeStyleFor(style, edge.kind).caption;
      return messages.relation(
        labels.get(edge.source) ?? edge.source,
        labels.get(edge.target) ?? edge.target,
        Boolean(edge.directed),
        caption
          ? captionWithLabel(localize(caption, locale), edgeLabel(edge))
          : edgeLabel(edge) || edge.kind,
      );
    }),
  };
  return { width: W, height: H, items, a11y, selection, selectionClip: { ...stage } };
}
