import {
  DEFAULT_LOCALE,
  edgeStyleFor,
  localize,
  nodeStyleFor,
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
import { cameraCenterFor, DEFAULT_FRAME_SPEC, type FrameSpec, type Rect } from './frame-spec.js';
import { RENDER_MESSAGES } from './locale.js';
import { edgePaint, VIDEO_THEMES, type VideoTheme } from './theme.js';

type Point = { x: number; y: number };
type DrawItem = VisualNode | VisualEdge;
type EdgeLabel = Point & { text: string; alpha: number };

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
  graph: Pick<VisualGraph, 'scenes'>;
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
const clamp = (x: number, a: number, b: number): number => Math.min(b, Math.max(a, x));
const mix = (a: number, b: number, t: number): number => a + (b - a) * t;
const color = (value: unknown, fallback: string): string =>
  typeof value === 'string' && /^#[0-9a-f]{6}$/i.test(value) ? value : fallback;
const intersects = (a: Rect, b: Rect): boolean =>
  a.x < b.x + b.w && a.x + a.w > b.x && a.y < b.y + b.h && a.y + a.h > b.y;
function scaledDifference(value: number, center: number, scale: number): number {
  const difference = value - center;
  // Opposite but finite world coordinates can overflow on subtraction.
  return Number.isFinite(difference) ? difference * scale : value * scale - center * scale;
}
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
  const messages = RENDER_MESSAGES[locale];
  const { width: W, height: H, stage, typeScale: ts } = spec;
  const { title: titleBand, graph: graphArea, caption: captionBand } = spec.safe;
  // Lengths in the 720p design, scaled to this frame.
  const u = (n: number): number => n * ts;
  // Decorative background positions are proportions of the reference design.
  const refX = (n: number): number => (n * W) / 1280,
    refY = (n: number): number => (n * H) / 720;
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
  const center = cameraCenterFor(spec);
  const screenScale = cam.scale * ts;
  const point = (node: VisualNode): Point => {
    const p = positions.get(node.id);
    if (!p) throw new Error(`Missing layout position for node ${node.id}`);
    return {
      x: center.x + scaledDifference(p.x, cam.x, screenScale),
      y: center.y + scaledDifference(p.y, cam.y, screenScale),
    };
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
  const radius = (node: VisualNode): number => {
    const importance = node.importance ?? 0;
    const base =
      nodeStyleFor(style, node.kind).baseRadius ??
      (importance >= 5 ? 16 : importance >= 3 ? 13 : 11);
    return clamp(base * Math.sqrt(cam.scale), 8, 19) * ts;
  };

  const items: DisplayItem[] = [];
  const graphItems: DisplayItem[] = [];

  // Background: diagonal gradient, warm light and a fine hatch.
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
        x0: refX(850),
        y0: refY(400),
        r0: refX(15),
        x1: refX(850),
        y1: refY(400),
        r1: refX(700),
        stops: [
          { offset: 0, color: P.warm },
          { offset: 1, color: P.warmEnd },
        ],
      },
    },
  );
  const hatch: PathCommand[] = [];
  for (let i = 0; i < 30; i++) {
    const x = refX(i * 53 - 80);
    hatch.push(['M', x, 0], ['L', x + refX(230), H]);
  }
  items.push({ type: 'path', d: hatch, stroke: P.hatch, width: u(0.6) });

  for (const group of view.groups) {
    const groupNodes = view.nodes.filter((n) => n.groupId === group.id);
    const members = groupNodes.map((n) => pointFor(n.id));
    if (!members.length) continue;
    const groupProgress = Math.max(...groupNodes.map((n) => nodeProgress(n.id)));
    const minX = Math.min(...members.map((p) => p.x)),
      maxX = Math.max(...members.map((p) => p.x));
    const minY = Math.min(...members.map((p) => p.y)),
      maxY = Math.max(...members.map((p) => p.y));
    const x = (minX + maxX) / 2,
      y = (minY + maxY) / 2,
      rx = Math.max(u(95), (maxX - minX) / 2 + u(75)),
      ry = Math.max(u(72), (maxY - minY) / 2 + u(65)),
      c = color(group.color, P.fallbackNode);
    const decoration: DisplayItem[] = [
      ellipseGlow(x, y, rx * 1.35, ry * 1.35, c, 0.11),
      {
        type: 'path',
        d: [['E', x, y, rx, ry, 0, 0, TAU]],
        stroke: c + P.groupStroke,
        width: u(1),
        dash: [u(4), u(9)],
      },
    ];
    const font = sans(13, 500),
      label = fitText(measure, group.label, font, u(180));
    if (label && groupProgress > 0.5)
      decoration.push({
        type: 'text',
        text: label,
        x: x - rx * 0.6,
        y: y - ry * 0.65,
        font,
        fill: c + P.groupLabel,
        ...(groupProgress < 1 ? { alpha: (groupProgress - 0.5) * 2 } : {}),
      });
    // The fully visible display list keeps its former flat item structure.
    if (groupProgress === 1) graphItems.push(...decoration);
    else if (groupProgress > 0)
      graphItems.push({ type: 'group', alpha: groupProgress, items: decoration });
  }

  // Parallel and reciprocal links get stable, symmetric curve offsets.
  const pairs = new Map<string, string[]>();
  for (const edge of view.edges) {
    const key = [edge.source, edge.target].sort().join('\0');
    const siblings = pairs.get(key) ?? [];
    siblings.push(edge.id);
    pairs.set(key, siblings);
  }
  const edgeLabels: EdgeLabel[] = [],
    edgeObstacles: Rect[] = [];
  for (const edge of view.edges) {
    const visibility = edgeProgress(edge.id);
    const a = points.get(edge.source),
      b = points.get(edge.target),
      source = view.nodes.find((n) => n.id === edge.source),
      target = view.nodes.find((n) => n.id === edge.target);
    if (!a || !b || !source || !target) continue;
    const dx = b.x - a.x,
      dy = b.y - a.y,
      len = Math.hypot(dx, dy);
    if (len < u(1)) continue;
    const ux = dx / len,
      uy = dy / len,
      ra = radius(source) + u(4),
      rb = radius(target) + u(5);
    const start = { x: a.x + ux * ra, y: a.y + uy * ra },
      end = { x: b.x - ux * rb, y: b.y - uy * rb };
    const key = [edge.source, edge.target].sort().join('\0');
    const siblings = pairs.get(key);
    if (!siblings) throw new Error('Missing edge pair');
    const order = siblings.indexOf(edge.id) - (siblings.length - 1) / 2;
    const sign = edge.source < edge.target ? 1 : -1,
      offset = order * u(22) * sign;
    const control = {
      x: (start.x + end.x) / 2 - uy * offset,
      y: (start.y + end.y) / 2 + ux * offset,
    };
    // A label appearing before halfway would disturb existing label layout.
    // Beyond halfway, only the drawn prefix participates in avoidance.
    if (visibility > 0.5) {
      for (let t = 0.1; t < visibility; t += 0.1) {
        const v = 1 - t,
          x = v * v * start.x + 2 * v * t * control.x + t * t * end.x,
          y = v * v * start.y + 2 * v * t * control.y + t * t * end.y;
        edgeObstacles.push({ x: x - u(4), y: y - u(4), w: u(8), h: u(8) });
      }
    }
    const edgeStyle = edgeStyleFor(style, edge.kind),
      highlighted = highlight.edgeIds.includes(edge.id),
      active = attention(edge),
      stroke = highlighted ? P.edge.highlight : edgePaint(P, edgeStyle.stroke),
      width = highlighted ? u(2.6) : u(1.6);
    const parts: DisplayItem[] = [
      {
        type: 'path',
        d: quadraticPrefix(start, control, end, visibility),
        stroke,
        width,
        ...(edgeStyle.dash ? { dash: edgeStyle.dash.map(u) } : {}),
      },
    ];
    if (edge.directed && visibility >= 1) {
      const angle = Math.atan2(end.y - control.y, end.x - control.x),
        size = u(8),
        bar = u(5);
      if (edgeStyle.head === 'hollow-circle')
        parts.push({
          type: 'path',
          d: [['A', end.x, end.y, u(4), 0, TAU]],
          fill: P.nodeFill,
          stroke,
          width,
        });
      else if (edgeStyle.head === 'bar')
        parts.push({
          type: 'path',
          d: [
            ['M', end.x - bar * Math.sin(angle), end.y + bar * Math.cos(angle)],
            ['L', end.x + bar * Math.sin(angle), end.y - bar * Math.cos(angle)],
          ],
          stroke,
          width,
        });
      else if (edgeStyle.head === 'arrow')
        parts.push({
          type: 'path',
          d: [
            ['M', end.x, end.y],
            ['L', end.x - size * Math.cos(angle - 0.45), end.y - size * Math.sin(angle - 0.45)],
            ['L', end.x - size * Math.cos(angle + 0.45), end.y - size * Math.sin(angle + 0.45)],
            ['Z'],
          ],
          fill: stroke,
        });
    }
    if (visibility > 0)
      graphItems.push({
        type: 'group',
        alpha: active * (highlighted ? 0.95 : 0.68),
        items: parts,
      });
    const caption = edgeStyle.caption ? localize(edgeStyle.caption, locale) : '';
    const label = caption
      ? captionWithLabel(caption, edge.label)
      : highlighted
        ? edge.label || ''
        : '';
    if (label && visibility > 0.5)
      edgeLabels.push({
        text: label,
        x: 0.25 * start.x + 0.5 * control.x + 0.25 * end.x,
        y: 0.25 * start.y + 0.5 * control.y + 0.25 * end.y,
        alpha: active * Math.min(1, (visibility - 0.5) * 2),
      });
  }

  const occupied: Rect[] = [];
  for (const node of view.nodes) {
    const visibility = nodeProgress(node.id);
    const p = pointFor(node.id),
      r = radius(node),
      shape = nodeStyleFor(style, node.kind).shape,
      c = color(
        node.color || (node.groupId == null ? undefined : groups.get(node.groupId)?.color),
        P.fallbackNode,
      ),
      alpha = attention(node);
    if (visibility > 0.5)
      occupied.push({ x: p.x - r - u(4), y: p.y - r - u(4), w: r * 2 + u(8), h: r * 2 + u(8) });
    const outline: PathCommand[] =
      shape === 'diamond'
        ? [
            ['M', p.x, p.y - r - u(3)],
            ['L', p.x + r + u(3), p.y],
            ['L', p.x, p.y + r + u(3)],
            ['L', p.x - r - u(3), p.y],
            ['Z'],
          ]
        : shape === 'pill'
          ? [['RR', p.x - r - u(4), p.y - r * 0.75, r * 2 + u(8), r * 1.5, r * 0.65]]
          : [['A', p.x, p.y, r + u(3), 0, TAU]];
    if (visibility > 0) {
      const scale = 0.82 + 0.18 * visibility;
      graphItems.push({
        type: 'group',
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
        items: [
          ...(alpha > 0.8 ? [ellipseGlow(p.x, p.y, u(45), u(45), c, 0.18)] : []),
          { type: 'path', d: outline, fill: P.nodeFill, stroke: c, width: u(1.8) },
          {
            type: 'path',
            d: [['A', p.x, p.y, shape === 'diamond' ? u(3.5) : Math.max(u(3), r * 0.48), 0, TAU]],
            fill: c,
          },
        ],
      });
    }
  }

  // Deterministic screen-space label placement: prioritize selected and major nodes.
  const nodeLabelObstacles = [...occupied, ...edgeObstacles];
  const sorted = view.nodes
    .filter((node) => nodeProgress(node.id) > 0.5)
    .sort(
      (a, b) =>
        attention(b) - attention(a) ||
        (b.importance || 0) - (a.importance || 0) ||
        a.id.localeCompare(b.id, 'en'),
    );
  for (const node of sorted) {
    const p = pointFor(node.id),
      r = radius(node),
      active = attention(node);
    const font = sans((node.importance ?? 0) >= 5 ? 18 : 15, active > 0.8 ? 600 : 450);
    const label = fitText(measure, node.label, font, u(200)),
      width = measure(label, font),
      height = u(21);
    const candidates = [
      { x: p.x + r + u(9), y: p.y - u(10) },
      { x: p.x - r - u(9) - width, y: p.y - u(10) },
      { x: p.x - width / 2, y: p.y - r - u(25) },
      { x: p.x - width / 2, y: p.y + r + u(6) },
      { x: p.x + r + u(5), y: p.y - r - u(24) },
      { x: p.x - r - u(5) - width, y: p.y - r - u(24) },
      { x: p.x + r + u(5), y: p.y + r + u(6) },
      { x: p.x - r - u(5) - width, y: p.y + r + u(6) },
    ].map((c) => ({ ...c, w: width, h: height }));
    const available = (c: Rect, obstacles: Rect[]): boolean =>
      inBounds(c) && !obstacles.some((o) => intersects(c, o));
    // A major or highlighted node should not become anonymous merely because
    // several lines leave it. Text/other nodes still take precedence.
    const box =
      candidates.find((c) => available(c, nodeLabelObstacles)) ||
      ((node.importance ?? 0) >= 4 || highlight.nodeIds.includes(node.id)
        ? candidates.find((c) => available(c, occupied))
        : undefined);
    if (!box) continue;
    occupied.push(box);
    nodeLabelObstacles.push(box);
    graphItems.push({
      type: 'text',
      text: label,
      x: box.x,
      y: box.y,
      font,
      fill: active > 0.8 ? P.labelActive : P.labelMuted,
      baseline: 'top',
      halo: { paint: P.labelHalo, width: u(4) },
      alpha: active * Math.min(1, (nodeProgress(node.id) - 0.5) * 2),
    });
  }
  const edgeFont = sans(11);
  for (const label of edgeLabels) {
    const text = fitText(measure, label.text, edgeFont, u(150)),
      w = measure(text, edgeFont) + u(10),
      box = { x: label.x - w / 2, y: label.y - u(18), w, h: u(17) };
    if (!inBounds(box) || occupied.some((o) => intersects(box, o))) continue;
    occupied.push(box);
    graphItems.push(
      {
        type: 'path',
        d: [['R', box.x, box.y, w, box.h]],
        fill: P.edgeLabelBox,
        alpha: label.alpha,
      },
      {
        type: 'text',
        text,
        x: box.x + u(5),
        y: box.y + u(9),
        font: edgeFont,
        fill: P.edgeLabelText,
        baseline: 'middle',
        alpha: label.alpha,
      },
    );
  }
  items.push({ type: 'group', clip: { ...stage }, items: graphItems });

  // Detail card in the upper right of the graph safe area.
  let detail: FrameText['detail'] = null;
  if (state.overlay) {
    const overlayId = state.overlay.nodeId;
    const node = view.nodes.find((n) => n.id === overlayId),
      summary = detailAt(overlayId, playback.domainAt)?.summary;
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
          text: fitText(measure, node.label, titleFont, textWidth),
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
      detail = { label: node.label, summary };
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

  const labels = new Map(view.nodes.map((node) => [node.id, node.label]));
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
    nodes: view.nodes.map((node) => node.label),
    relations: view.edges.map((edge) => {
      const caption = edgeStyleFor(style, edge.kind).caption;
      return messages.relation(
        labels.get(edge.source) ?? edge.source,
        labels.get(edge.target) ?? edge.target,
        Boolean(edge.directed),
        caption ? captionWithLabel(localize(caption, locale), edge.label) : edge.label || edge.kind,
      );
    }),
  };
  return { width: W, height: H, items, a11y };
}
