import { directorFrameAt } from '@relgraph/core';
import type {
  DirectorFrameState,
  ProjectedVisualGraph,
  ResolvedHighlight,
  VisualEdge,
  VisualGraph,
  VisualNode,
} from '@relgraph/core';

type Point = { x: number; y: number };
type Rectangle = Point & { w: number; h: number };
type EdgeLabel = Point & { text: unknown; alpha: number };
type DrawItem = VisualNode | VisualEdge;
export interface CanvasRendererOptions {
  fps?: number;
  detailAt?: (nodeId: string, domainAt: number | null) => { summary?: string } | null | undefined;
  theme?: unknown;
}
export interface CanvasRenderer {
  renderFrame(frame: number): DirectorFrameState;
  theme: 'dark' | 'light';
}

export const VIDEO_WIDTH = 1280,
  VIDEO_HEIGHT = 720;
const sans = '"Noto Sans CJK SC", "PingFang SC", system-ui, sans-serif';
const serif = '"Noto Serif CJK SC", "Songti SC", Georgia, serif';
const clamp = (x: number, a: number, b: number): number => Math.min(b, Math.max(a, x));
const mix = (a: number, b: number, t: number): number => a + (b - a) * t;
const color = (value: unknown, fallback: string): string =>
  typeof value === 'string' && /^#[0-9a-f]{6}$/i.test(value) ? value : fallback;
/**
 * Video palettes. A theme is an explicit renderer input, so a frame stays a
 * pure function of (graph, layout, frame, theme). Data-authored node and
 * group colours are used as-is in both palettes.
 */
export const VIDEO_THEMES = Object.freeze({
  dark: Object.freeze({
    name: 'dark',
    bg: ['#101b2a', '#152638', '#111d2d'],
    warm: 'rgba(150,112,76,.16)',
    warmEnd: 'rgba(17,29,45,0)',
    hatch: 'rgba(226,218,191,.035)',
    fallbackNode: '#8aaeb1',
    groupStroke: '40',
    groupLabel: 'b0',
    edge: { highlight: '#f0c99b', physical: '#8aaab5', special: '#d3b783', plain: '#9ebac0' },
    nodeFill: '#14212f',
    labelHalo: '#0f1a27',
    labelActive: '#f2eee4',
    labelMuted: '#b7c5c9',
    edgeLabelBox: '#14212fe8',
    edgeLabelText: '#d5c7ad',
    card: '#14212ff2',
    cardStroke: '#a78d6e',
    cardTitle: '#e6c89e',
    cardText: '#c6cfcf',
    band: 'rgba(12,20,32,.82)',
    bandRule: 'rgba(224,192,154,.24)',
    kicker: '#cfae84',
    title: '#f1e6d2',
    meta: '#97adb5',
    sceneLabel: '#d5b17f',
    sceneTitle: '#f4eee3',
    narration: '#b9c6c9',
    track: 'rgba(173,189,197,.22)',
    progress: '#d9b382',
  }),
  light: Object.freeze({
    name: 'light',
    bg: ['#f8f4ec', '#f3ede1', '#eee6d6'],
    warm: 'rgba(214,170,112,.22)',
    warmEnd: 'rgba(243,237,225,0)',
    hatch: 'rgba(120,98,66,.05)',
    fallbackNode: '#5f8a8f',
    groupStroke: '60',
    groupLabel: 'e0',
    edge: { highlight: '#b5722c', physical: '#5d8696', special: '#a57e3c', plain: '#8197a0' },
    nodeFill: '#fffdf8',
    labelHalo: '#f8f3ea',
    labelActive: '#1d2733',
    labelMuted: '#6d7c86',
    edgeLabelBox: '#fffaf0ee',
    edgeLabelText: '#7a5a33',
    card: '#fffbf4f5',
    cardStroke: '#c9a77c',
    cardTitle: '#8a5a22',
    cardText: '#3d4a54',
    band: 'rgba(251,248,241,.94)',
    bandRule: 'rgba(160,120,70,.32)',
    kicker: '#a0672a',
    title: '#1f2a36',
    meta: '#5c6973',
    sceneLabel: '#a0672a',
    sceneTitle: '#1a2430',
    narration: '#4a5862',
    track: 'rgba(60,70,80,.14)',
    progress: '#b9803f',
  }),
});
// Own-property check: names such as 'constructor' or '__proto__' must not
// resolve to Object.prototype members instead of falling back to dark.
type ThemeName = keyof typeof VIDEO_THEMES;
type VideoTheme = (typeof VIDEO_THEMES)[ThemeName];
const isThemeName = (name: string): name is ThemeName => Object.hasOwn(VIDEO_THEMES, name);
export const themeFor = (name: unknown): VideoTheme =>
  typeof name === 'string' && isThemeName(name) ? VIDEO_THEMES[name] : VIDEO_THEMES.dark;
const edgeNames: Record<string, unknown> = {
  consumption: '输入',
  production: '产物',
  catalyst: '催化',
  activator: '促进',
  inhibitor: '抑制',
  'physical-association': '物理结合',
  'activity-influence': '功能调控',
  activation: '激活',
  inhibition: '抑制',
};

function background(ctx: CanvasRenderingContext2D, P: VideoTheme): void {
  const g = ctx.createLinearGradient(0, 0, VIDEO_WIDTH, VIDEO_HEIGHT);
  g.addColorStop(0, P.bg[0]);
  g.addColorStop(0.5, P.bg[1]);
  g.addColorStop(1, P.bg[2]);
  ctx.fillStyle = g;
  ctx.fillRect(0, 0, VIDEO_WIDTH, VIDEO_HEIGHT);
  const warm = ctx.createRadialGradient(850, 400, 15, 850, 400, 700);
  warm.addColorStop(0, P.warm);
  warm.addColorStop(1, P.warmEnd);
  ctx.fillStyle = warm;
  ctx.fillRect(0, 0, VIDEO_WIDTH, VIDEO_HEIGHT);
  ctx.strokeStyle = P.hatch;
  ctx.lineWidth = 0.6;
  for (let i = 0; i < 30; i++) {
    const x = i * 53 - 80;
    ctx.beginPath();
    ctx.moveTo(x, 0);
    ctx.lineTo(x + 230, VIDEO_HEIGHT);
    ctx.stroke();
  }
}

function ellipseGlow(
  ctx: CanvasRenderingContext2D,
  x: number,
  y: number,
  rx: number,
  ry: number,
  c: string,
  alpha: number,
): void {
  ctx.save();
  ctx.translate(x, y);
  ctx.scale(Math.max(1, rx), Math.max(1, ry));
  const gradient = ctx.createRadialGradient(0, 0, 0, 0, 0, 1);
  gradient.addColorStop(
    0,
    `${c}${Math.round(alpha * 255)
      .toString(16)
      .padStart(2, '0')}`,
  );
  gradient.addColorStop(1, `${c}00`);
  ctx.fillStyle = gradient;
  ctx.beginPath();
  ctx.arc(0, 0, 1, 0, Math.PI * 2);
  ctx.fill();
  ctx.restore();
}
function fitText(ctx: CanvasRenderingContext2D, text: unknown, maxWidth: number): string {
  const s = String(text || '');
  if (ctx.measureText(s).width <= maxWidth) return s;
  let result = '';
  for (const ch of s) {
    if (ctx.measureText(result + ch + '…').width > maxWidth) break;
    result += ch;
  }
  return result + '…';
}
function wrapText(
  ctx: CanvasRenderingContext2D,
  text: unknown,
  maxWidth: number,
  maxLines = 2,
): string[] {
  const lines = [];
  let line = '';
  for (const ch of String(text || '')) {
    if (ch === '\n' || (line && ctx.measureText(line + ch).width > maxWidth)) {
      lines.push(line);
      line = ch === '\n' ? '' : ch;
      if (lines.length === maxLines) break;
    } else line += ch;
  }
  if (lines.length < maxLines && line) lines.push(line);
  if (lines.join('').length < String(text || '').replaceAll('\n', '').length && lines.length)
    lines[lines.length - 1] = fitText(ctx, lines.at(-1) + '…', maxWidth);
  return lines;
}
function intersects(a: Rectangle, b: Rectangle): boolean {
  return a.x < b.x + b.w && a.x + a.w > b.x && a.y < b.y + b.h && a.y + a.h > b.y;
}
function scaledDifference(value: number, center: number, scale: number): number {
  const difference = value - center;
  // Opposite but finite world coordinates can overflow on subtraction.
  return Number.isFinite(difference) ? difference * scale : value * scale - center * scale;
}
const isEdge = (item: DrawItem): item is VisualEdge =>
  'source' in item && item.source !== undefined;

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
function radius(node: VisualNode, scale: number): number {
  return clamp(
    (node.kind === 'reaction'
      ? 13
      : (node.importance ?? 0) >= 5
        ? 16
        : (node.importance ?? 0) >= 3
          ? 13
          : 11) * Math.sqrt(scale),
    8,
    19,
  );
}

/** The renderer only consumes a VisualGraph, a static layout and an integer frame. */
export function createCanvasRenderer(
  canvas: HTMLCanvasElement,
  graph: VisualGraph,
  positions: ReadonlyMap<string, Point>,
  { fps = 24, detailAt = () => undefined, theme = 'dark' }: CanvasRendererOptions = {},
): CanvasRenderer {
  const P = themeFor(theme);
  const ctx = canvas.getContext('2d', { alpha: false, desynchronized: false });
  canvas.width = VIDEO_WIDTH;
  canvas.height = VIDEO_HEIGHT;
  function renderFrame(frame: number): DirectorFrameState {
    const state = directorFrameAt(graph, positions, frame, fps);
    const { view, playback, cameraResolved: cam, highlight, previousHighlight, transition } = state;
    const point = (node: VisualNode): Point => {
      const p = positions.get(node.id);
      if (!p) throw new Error(`Missing layout position for node ${node.id}`);
      return {
        x: 640 + scaledDifference(p.x, cam.x, cam.scale),
        y: 330 + scaledDifference(p.y, cam.y, cam.scale),
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
    if (!ctx) throw new TypeError('Canvas 2D context is unavailable');
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.globalAlpha = 1;
    ctx.setLineDash([]);
    ctx.clearRect(0, 0, VIDEO_WIDTH, VIDEO_HEIGHT);
    background(ctx, P);
    ctx.save();
    ctx.beginPath();
    ctx.rect(26, 108, 1228, 434);
    ctx.clip();
    for (const group of view.groups) {
      const members = view.nodes.filter((n) => n.groupId === group.id).map((n) => pointFor(n.id));
      if (!members.length) continue;
      const minX = Math.min(...members.map((p) => p.x)),
        maxX = Math.max(...members.map((p) => p.x));
      const minY = Math.min(...members.map((p) => p.y)),
        maxY = Math.max(...members.map((p) => p.y));
      const x = (minX + maxX) / 2,
        y = (minY + maxY) / 2,
        rx = Math.max(95, (maxX - minX) / 2 + 75),
        ry = Math.max(72, (maxY - minY) / 2 + 65),
        c = color(group.color, P.fallbackNode);
      ellipseGlow(ctx, x, y, rx * 1.35, ry * 1.35, c, 0.11);
      ctx.save();
      ctx.strokeStyle = c + P.groupStroke;
      ctx.lineWidth = 1;
      ctx.setLineDash([4, 9]);
      ctx.beginPath();
      ctx.ellipse(x, y, rx, ry, 0, 0, Math.PI * 2);
      ctx.stroke();
      ctx.setLineDash([]);
      ctx.font = `500 13px ${sans}`;
      ctx.fillStyle = c + P.groupLabel;
      ctx.fillText(fitText(ctx, group.label, 180), x - rx * 0.6, y - ry * 0.65);
      ctx.restore();
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
      edgeObstacles: Rectangle[] = [];
    for (const edge of view.edges) {
      const a = points.get(edge.source),
        b = points.get(edge.target),
        source = view.nodes.find((n) => n.id === edge.source),
        target = view.nodes.find((n) => n.id === edge.target);
      if (!a || !b || !source || !target) continue;
      const dx = b.x - a.x,
        dy = b.y - a.y,
        len = Math.hypot(dx, dy);
      if (len < 1) continue;
      const ux = dx / len,
        uy = dy / len,
        ra = radius(source, cam.scale) + 4,
        rb = radius(target, cam.scale) + 5;
      const start = { x: a.x + ux * ra, y: a.y + uy * ra },
        end = { x: b.x - ux * rb, y: b.y - uy * rb };
      const key = [edge.source, edge.target].sort().join('\0');
      const siblings = pairs.get(key);
      if (!siblings) throw new Error('Missing edge pair');
      const order = siblings.indexOf(edge.id) - (siblings.length - 1) / 2;
      const sign = edge.source < edge.target ? 1 : -1,
        offset = order * 22 * sign;
      const control = {
        x: (start.x + end.x) / 2 - uy * offset,
        y: (start.y + end.y) / 2 + ux * offset,
      };
      for (let t = 0.1; t < 1; t += 0.1) {
        const u = 1 - t,
          x = u * u * start.x + 2 * u * t * control.x + t * t * end.x,
          y = u * u * start.y + 2 * u * t * control.y + t * t * end.y;
        edgeObstacles.push({ x: x - 4, y: y - 4, w: 8, h: 8 });
      }
      const active = attention(edge),
        special = [
          'catalyst',
          'activator',
          'inhibitor',
          'activity-influence',
          'activation',
          'inhibition',
        ].includes(edge.kind);
      ctx.save();
      ctx.globalAlpha = active * (highlight.edgeIds.includes(edge.id) ? 0.95 : 0.68);
      ctx.lineWidth = highlight.edgeIds.includes(edge.id) ? 2.6 : 1.6;
      ctx.strokeStyle = highlight.edgeIds.includes(edge.id)
        ? P.edge.highlight
        : edge.kind === 'physical-association'
          ? P.edge.physical
          : special
            ? P.edge.special
            : P.edge.plain;
      if (special) ctx.setLineDash(edge.kind === 'catalyst' ? [2, 5] : [7, 5]);
      ctx.beginPath();
      ctx.moveTo(start.x, start.y);
      ctx.quadraticCurveTo(control.x, control.y, end.x, end.y);
      ctx.stroke();
      ctx.setLineDash([]);
      if (edge.directed) {
        const angle = Math.atan2(end.y - control.y, end.x - control.x),
          size = 8;
        ctx.fillStyle = ctx.strokeStyle;
        if (edge.kind === 'catalyst') {
          // A hollow catalyst marker is distinct from a reaction flow arrow.
          ctx.fillStyle = P.nodeFill;
          ctx.beginPath();
          ctx.arc(end.x, end.y, 4, 0, Math.PI * 2);
          ctx.fill();
          ctx.stroke();
        } else if (edge.kind === 'inhibitor' || edge.kind === 'inhibition') {
          ctx.beginPath();
          ctx.moveTo(end.x - 5 * Math.sin(angle), end.y + 5 * Math.cos(angle));
          ctx.lineTo(end.x + 5 * Math.sin(angle), end.y - 5 * Math.cos(angle));
          ctx.stroke();
        } else {
          ctx.beginPath();
          ctx.moveTo(end.x, end.y);
          ctx.lineTo(end.x - size * Math.cos(angle - 0.45), end.y - size * Math.sin(angle - 0.45));
          ctx.lineTo(end.x - size * Math.cos(angle + 0.45), end.y - size * Math.sin(angle + 0.45));
          ctx.closePath();
          ctx.fill();
        }
      }
      ctx.restore();
      const label = edgeNames[edge.kind] || (highlight.edgeIds.includes(edge.id) ? edge.label : '');
      if (label)
        edgeLabels.push({
          text:
            edge.label && edgeNames[edge.kind] && !/^1$/.test(edge.label)
              ? `${label} · ${edge.label}`
              : label,
          x: 0.25 * start.x + 0.5 * control.x + 0.25 * end.x,
          y: 0.25 * start.y + 0.5 * control.y + 0.25 * end.y,
          alpha: active,
        });
    }
    const occupied: Rectangle[] = [];
    for (const node of view.nodes) {
      const p = pointFor(node.id),
        r = radius(node, cam.scale),
        c = color(
          node.color || (node.groupId == null ? undefined : groups.get(node.groupId)?.color),
          P.fallbackNode,
        ),
        alpha = attention(node);
      occupied.push({ x: p.x - r - 4, y: p.y - r - 4, w: r * 2 + 8, h: r * 2 + 8 });
      ctx.save();
      ctx.globalAlpha = alpha;
      if (alpha > 0.8) ellipseGlow(ctx, p.x, p.y, 45, 45, c, 0.18);
      ctx.fillStyle = P.nodeFill;
      ctx.strokeStyle = c;
      ctx.lineWidth = 1.8;
      ctx.beginPath();
      if (node.kind === 'reaction') {
        ctx.moveTo(p.x, p.y - r - 3);
        ctx.lineTo(p.x + r + 3, p.y);
        ctx.lineTo(p.x, p.y + r + 3);
        ctx.lineTo(p.x - r - 3, p.y);
        ctx.closePath();
      } else if (
        ['protein', 'protein-state', 'complex', 'small-molecule', 'gene'].includes(node.kind)
      ) {
        ctx.roundRect(p.x - r - 4, p.y - r * 0.75, r * 2 + 8, r * 1.5, r * 0.65);
      } else ctx.arc(p.x, p.y, r + 3, 0, Math.PI * 2);
      ctx.fill();
      ctx.stroke();
      ctx.fillStyle = c;
      ctx.beginPath();
      ctx.arc(p.x, p.y, node.kind === 'reaction' ? 3.5 : Math.max(3, r * 0.48), 0, Math.PI * 2);
      ctx.fill();
      ctx.restore();
    }
    // Deterministic screen-space label placement: prioritize selected and major nodes.
    const nodeLabelObstacles = [...occupied, ...edgeObstacles];
    const sorted = [...view.nodes].sort(
      (a, b) =>
        attention(b) - attention(a) ||
        (b.importance || 0) - (a.importance || 0) ||
        a.id.localeCompare(b.id, 'en'),
    );
    for (const node of sorted) {
      const p = pointFor(node.id),
        r = radius(node, cam.scale),
        active = attention(node);
      ctx.font = `${active > 0.8 ? 600 : 450} ${(node.importance ?? 0) >= 5 ? 18 : 15}px ${sans}`;
      const label = fitText(ctx, node.label, 200),
        width = ctx.measureText(label).width,
        height = 21;
      const candidates = [
        { x: p.x + r + 9, y: p.y - 10 },
        { x: p.x - r - 9 - width, y: p.y - 10 },
        { x: p.x - width / 2, y: p.y - r - 25 },
        { x: p.x - width / 2, y: p.y + r + 6 },
        { x: p.x + r + 5, y: p.y - r - 24 },
        { x: p.x - r - 5 - width, y: p.y - r - 24 },
        { x: p.x + r + 5, y: p.y + r + 6 },
        { x: p.x - r - 5 - width, y: p.y + r + 6 },
      ].map((c) => ({ ...c, w: width, h: height }));
      const available = (c: Rectangle, obstacles: Rectangle[]): boolean =>
        c.x >= 30 &&
        c.x + c.w <= 1250 &&
        c.y >= 112 &&
        c.y + c.h <= 540 &&
        !obstacles.some((o) => intersects(c, o));
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
      ctx.save();
      ctx.globalAlpha = active;
      ctx.textBaseline = 'top';
      ctx.lineJoin = 'round';
      ctx.lineWidth = 4;
      ctx.strokeStyle = P.labelHalo;
      ctx.strokeText(label, box.x, box.y);
      ctx.fillStyle = active > 0.8 ? P.labelActive : P.labelMuted;
      ctx.fillText(label, box.x, box.y);
      ctx.restore();
    }
    ctx.font = `11px ${sans}`;
    for (const label of edgeLabels) {
      const text = fitText(ctx, label.text, 150),
        w = ctx.measureText(text).width + 10,
        box = { x: label.x - w / 2, y: label.y - 18, w, h: 17 };
      if (
        box.x < 30 ||
        box.x + w > 1250 ||
        box.y < 112 ||
        box.y + 17 > 540 ||
        occupied.some((o) => intersects(box, o))
      )
        continue;
      occupied.push(box);
      ctx.save();
      ctx.globalAlpha = label.alpha;
      ctx.fillStyle = P.edgeLabelBox;
      ctx.fillRect(box.x, box.y, w, 17);
      ctx.fillStyle = P.edgeLabelText;
      ctx.textBaseline = 'middle';
      ctx.fillText(text, box.x + 5, box.y + 9);
      ctx.restore();
    }
    ctx.restore();
    if (state.overlay) {
      const overlayId = state.overlay.nodeId;
      const node = view.nodes.find((n) => n.id === overlayId),
        detail = detailAt(overlayId, playback.domainAt);
      if (node && detail?.summary) {
        ctx.save();
        ctx.fillStyle = P.card;
        ctx.strokeStyle = P.cardStroke;
        ctx.lineWidth = 1;
        ctx.beginPath();
        ctx.roundRect(850, 135, 350, 190, 12);
        ctx.fill();
        ctx.stroke();
        ctx.textBaseline = 'alphabetic';
        ctx.fillStyle = P.cardTitle;
        ctx.font = `600 20px ${serif}`;
        ctx.fillText(fitText(ctx, node.label, 300), 875, 172);
        ctx.fillStyle = P.cardText;
        ctx.font = `15px ${sans}`;
        wrapText(ctx, detail.summary, 300, 5).forEach((line, i) =>
          ctx.fillText(line, 875, 203 + i * 22),
        );
        ctx.restore();
      }
    }
    // Fixed frame-safe title and subtitle bands keep graph labels out of overlays.
    ctx.fillStyle = P.band;
    ctx.fillRect(0, 0, VIDEO_WIDTH, 104);
    ctx.fillRect(0, 548, VIDEO_WIDTH, 172);
    ctx.strokeStyle = P.bandRule;
    ctx.lineWidth = 1;
    ctx.beginPath();
    ctx.moveTo(62, 102);
    ctx.lineTo(1218, 102);
    ctx.moveTo(62, 550);
    ctx.lineTo(1218, 550);
    ctx.stroke();
    ctx.textAlign = 'left';
    ctx.textBaseline = 'alphabetic';
    ctx.fillStyle = P.kicker;
    ctx.font = `600 13px ${sans}`;
    ctx.fillText('RELGRAPH  /  DIRECTOR STUDIO', 64, 39);
    ctx.fillStyle = P.title;
    ctx.font = `600 27px ${serif}`;
    ctx.fillText(fitText(ctx, view.meta.title, 850), 64, 78);
    ctx.textAlign = 'right';
    ctx.fillStyle = P.meta;
    ctx.font = '13px ui-monospace, monospace';
    ctx.fillText(`FRAME ${String(frame).padStart(5, '0')}  ·  ${fps} FPS`, 1218, 40);
    ctx.fillText(
      playback.domainAt === null ? '' : `${view.timeline?.unit || 'TIME'} ${playback.domainAt}`,
      1218,
      73,
    );
    ctx.textAlign = 'left';
    ctx.fillStyle = P.sceneLabel;
    ctx.font = `500 13px ${sans}`;
    ctx.fillText(
      `SCENE ${String(playback.index + 1).padStart(2, '0')}  /  ${String(graph.scenes.length).padStart(2, '0')}`,
      64,
      585,
    );
    ctx.fillStyle = P.sceneTitle;
    ctx.font = `600 27px ${serif}`;
    ctx.fillText(fitText(ctx, playback.scene?.title || '', 1120), 64, 625);
    ctx.font = `16px ${sans}`;
    ctx.fillStyle = P.narration;
    wrapText(ctx, playback.scene?.narration || '', 1120, 2).forEach((line, i) =>
      ctx.fillText(line, 64, 657 + i * 21),
    );
    ctx.fillStyle = P.track;
    ctx.fillRect(64, 704, 1152, 2);
    ctx.fillStyle = P.progress;
    ctx.fillRect(64, 704, 1152 * clamp(frame / fps / (playback.totalSec || 1), 0, 1), 2);
    return state;
  }
  return { renderFrame, theme: P.name };
}
