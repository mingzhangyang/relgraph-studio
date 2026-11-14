import {
  DEFAULT_LOCALE,
  displayEdgeText,
  displayNodeText,
  NEUTRAL_STYLE,
  styleForDrawing,
} from '@relgraph/core';
import type {
  DirectorFrameState,
  DomainStyle,
  Locale,
  ProjectConfig,
  ProjectedVisualGraph,
  ResolvedHighlight,
  VisualEdge,
  VisualGraph,
  VisualNode,
} from '@relgraph/core';
import type { DisplayList, FontRef, TextMeasurer } from '../display-list.js';
import {
  projectCameraPoint,
  DEFAULT_FRAME_SPEC,
  type FrameSpec,
  type Rect,
} from '../frame-spec.js';
import { nodeRadius } from '../node-geometry.js';
import { RENDER_MESSAGES, type RenderMessages } from '../locale.js';
import { RectIndex } from '../spatial.js';
import { VIDEO_THEMES, type VideoTheme } from '../theme.js';
import { mix, type Point } from './geometry.js';

export type DetailLookup = (
  nodeId: string,
  domainAt: number | null,
) => { summary?: string } | null | undefined;

export interface ComposeOptions {
  /**
   * The full graph. The frame state is already projected; what is read here
   * does not depend on the frame: the scene count, the project, and every
   * node's place in time, to tell whether the drawing keeps a time axis.
   */
  graph: Pick<VisualGraph, 'scenes' | 'project' | 'nodes'>;
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

export type DrawItem = VisualNode | VisualEdge;
export type Selection = NonNullable<DisplayList['selection']>;

export const isEdge = (item: DrawItem): item is VisualEdge =>
  'source' in item && item.source !== undefined;
/** An authored #RRGGBB, or the fallback. */
export const color = (value: unknown, fallback: string): string =>
  typeof value === 'string' && /^#[0-9a-f]{6}$/i.test(value) ? value : fallback;
export const alphaHex = (alpha: number): string =>
  Math.round(alpha * 255)
    .toString(16)
    .padStart(2, '0');

/**
 * The style a drawing is composed with: the graph's style sheet read through
 * `styleForDrawing`, so a time axis is drawn only for a drawing anchored to
 * time (`timeAnchor`). The composer, and every tool that has to agree with
 * what it drew (hit tests, overlays), take the style from here.
 */
export function drawingStyle(
  options: Pick<ComposeOptions, 'graph' | 'positions' | 'style'>,
): DomainStyle {
  return styleForDrawing(options.style ?? NEUTRAL_STYLE, options.graph, options.positions);
}

/**
 * Attention (0–1) of the nodes and edges of a view under a shot highlight.
 * The lookups are built once, so asking for every item costs one pass over
 * the view instead of one per item.
 */
export function attentionUnder(
  highlight: ResolvedHighlight,
  view: ProjectedVisualGraph,
): (item: DrawItem) => number {
  const ids = new Set(highlight.nodeIds),
    edges = new Set(highlight.edgeIds),
    group = highlight.groupId;
  const active = ids.size || edges.size || group;
  if (!active) return () => 1;
  // Members of the highlighted group that are in view, and nodes that a
  // highlighted relation in view touches.
  const members = new Set(
    group ? view.nodes.filter((n) => n.groupId === group).map((n) => n.id) : [],
  );
  const touched = new Set<string>();
  for (const edge of view.edges) if (edges.has(edge.id)) touched.add(edge.source).add(edge.target);
  return (item) => {
    if (isEdge(item))
      return edges.has(item.id) || (group && members.has(item.source) && members.has(item.target))
        ? 1
        : 0.2;
    // Only a highlighted group may match: ungrouped nodes (groupId null or
    // undefined) must not equal an absent group and stay dimmed.
    return ids.has(item.id) || (group && item.groupId === group) || touched.has(item.id) ? 1 : 0.24;
  };
}

/** Bounds that labels and plates stay inside: the stage with a small margin. */
export interface LabelBounds {
  left: number;
  right: number;
  top: number;
  bottom: number;
}

/**
 * Everything the passes of one frame share and none of them changes: the
 * frame state, the resolved options, the scaled units and fonts, the
 * projected node points and the attention of every item. Built once per
 * frame by `frameContext`; each pass reads it and returns its own items.
 */
export interface FrameContext {
  readonly state: DirectorFrameState;
  readonly graph: ComposeOptions['graph'];
  readonly frame: number;
  readonly fps: number;
  readonly measure: TextMeasurer;
  readonly spec: FrameSpec;
  readonly theme: VideoTheme;
  /** The style of this drawing (`drawingStyle`). */
  readonly style: DomainStyle;
  readonly config: ProjectConfig | undefined;
  readonly locale: Locale;
  readonly messages: RenderMessages;
  readonly detailAt: DetailLookup;
  /** Lengths in the 720p design, scaled to this frame. */
  readonly u: (n: number) => number;
  readonly sans: (size: number, weight?: number) => FontRef;
  readonly serif: (size: number, weight?: number) => FontRef;
  readonly mono: (size: number, weight?: number) => FontRef;
  readonly bounds: LabelBounds;
  readonly inBounds: (box: Rect) => boolean;
  /** A fresh collision index over the label bounds. */
  readonly rectIndex: () => RectIndex;
  readonly view: DirectorFrameState['view'];
  readonly playback: DirectorFrameState['playback'];
  readonly cam: DirectorFrameState['cameraResolved'];
  readonly highlight: ResolvedHighlight;
  readonly previousHighlight: ResolvedHighlight;
  readonly transition: number;
  readonly captionAlpha: number;
  readonly nodeProgress: (id: string) => number;
  readonly edgeProgress: (id: string) => number;
  /** Screen points of the nodes in view. */
  readonly points: ReadonlyMap<string, Point>;
  readonly pointFor: (id: string) => Point;
  readonly groups: ReadonlyMap<string, ProjectedVisualGraph['groups'][number]>;
  /** Attention (0–1) under the highlight, mixed across the shot transition. */
  readonly attention: (item: DrawItem) => number;
  readonly namedBefore: ReadonlySet<string>;
  readonly namedNow: ReadonlySet<string>;
  readonly highlightedEdges: ReadonlySet<string>;
  readonly radius: (node: VisualNode) => number;
  readonly nodeLabel: (node: VisualNode) => string;
  readonly edgeLabel: (edge: VisualEdge) => string | undefined;
}

/** The shared context of one frame. Throws when a node in view has no position. */
export function frameContext(state: DirectorFrameState, options: ComposeOptions): FrameContext {
  const {
    graph,
    positions,
    frame,
    fps,
    measure,
    frameSpec: spec = DEFAULT_FRAME_SPEC,
    theme = VIDEO_THEMES.dark,
    locale = DEFAULT_LOCALE,
    detailAt = () => undefined,
  } = options;
  const style = drawingStyle(options);
  const config = graph.project;
  const { stage, typeScale: ts } = spec;
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
  // Collision tests go through grids over the label bounds: every candidate
  // is tested in bounds first, so only nearby rectangles can meet it. A cell
  // about the height of a label line keeps the rectangles per cell few when a
  // whole graph is on stage, where a coarser cell holds more of them the
  // larger the graph (tests/compose-cost.test.mjs).
  const boundsRect = {
    x: bounds.left,
    y: bounds.top,
    w: bounds.right - bounds.left,
    h: bounds.bottom - bounds.top,
  };
  const rectIndex = (): RectIndex => new RectIndex(boundsRect, u(16));

  const { view, playback, cameraResolved: cam, highlight, previousHighlight, transition } = state;
  const point = (node: VisualNode): Point => {
    const p = positions.get(node.id);
    if (!p) throw new Error(`Missing layout position for node ${node.id}`);
    return projectCameraPoint(p, cam, spec);
  };
  const points = new Map(view.nodes.map((n) => [n.id, point(n)]));
  const attentionBefore = attentionUnder(previousHighlight, view),
    attentionNow = attentionUnder(highlight, view);
  return {
    state,
    graph,
    frame,
    fps,
    measure,
    spec,
    theme,
    style,
    config,
    locale,
    messages: RENDER_MESSAGES[locale],
    detailAt,
    u,
    sans,
    serif,
    mono,
    bounds,
    inBounds,
    rectIndex,
    view,
    playback,
    cam,
    highlight,
    previousHighlight,
    transition,
    captionAlpha: state.captionOpacity ?? 1,
    nodeProgress: (id) => state.reveal?.nodes[id] ?? 1,
    edgeProgress: (id) => state.reveal?.edges[id] ?? 1,
    points,
    pointFor: (id) => {
      const result = points.get(id);
      if (!result) throw new Error(`Missing projected position for node ${id}`);
      return result;
    },
    groups: new Map(view.groups.map((g) => [g.id, g])),
    attention: (item) => mix(attentionBefore(item), attentionNow(item), transition),
    namedBefore: new Set(previousHighlight.nodeIds),
    namedNow: new Set(highlight.nodeIds),
    highlightedEdges: new Set(highlight.edgeIds),
    radius: (node) => nodeRadius(node, cam.scale, spec, style, config),
    nodeLabel: (node) => displayNodeText(config, node.id)?.label ?? node.label,
    edgeLabel: (edge) => displayEdgeText(config, edge.id)?.label ?? edge.label,
  };
}
