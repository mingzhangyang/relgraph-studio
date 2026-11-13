/**
 * Visual encoding owned by each domain (ADR 003, D4). Renderers read resolved
 * styles; they hold no edge kinds, node kinds or captions of their own.
 */
import { biologyStyle } from './domains/biology.style.js';
import { literatureStyle } from './domains/literature.style.js';
import type { VisualGraph } from '../types/visual-graph.js';
import { keepsTime, timeAxis } from './director/layout-engines.js';
import { timeAnchor } from './director/time-anchor.js';

export const LOCALES = ['zh-CN', 'en'] as const;
export type Locale = (typeof LOCALES)[number];
export const DEFAULT_LOCALE: Locale = 'zh-CN';
export type LocalizedText = Readonly<Record<Locale, string>>;

/** Semantic stroke; the video theme resolves it to a colour. */
export type EdgeStroke = 'plain' | 'physical' | 'regulatory';
/** Marker at the target end, drawn only for directed edges. */
/** How a relation ends at its target. */
export const EDGE_HEADS = ['arrow', 'bar', 'hollow-circle', 'none'] as const;
export type EdgeHead = (typeof EDGE_HEADS)[number];
/** The line rhythms an author may ask for by name. */
export const LINE_STYLES = ['solid', 'dashed', 'dotted'] as const;
export type LineStyle = (typeof LINE_STYLES)[number];
/**
 * Number of categorical tones every video theme provides. A tone is an index
 * into the theme's validated palette, so the same kind keeps one identity in
 * the light and the dark film. Kinds beyond the palette are never given a
 * generated hue: they fold into the neutral stroke and rely on dash or shape.
 */
export const TONE_COUNT = 8;
export interface EdgeStyle {
  stroke: EdgeStroke;
  /** Categorical palette slot, resolved by the video theme. */
  tone?: number;
  /** Author-declared #RRGGBB; takes precedence over the tone. */
  color?: string;
  dash?: readonly number[];
  head: EdgeHead;
  /** Shown on every edge of this kind; otherwise the edge label appears when highlighted. */
  caption?: LocalizedText;
}
/** Glyphs with the label beside them; a derived encoding assigns these in order. */
export const GLYPH_SHAPES = ['circle', 'pill', 'diamond', 'square', 'hexagon'] as const;
/**
 * Shapes that hold their label and take their size from it: a step, a start
 * or end, and a decision. They are what flowcharts and mind maps are made of.
 */
export const LABEL_SHAPES = ['box', 'capsule', 'decision'] as const;
/** `span` is a bar as long as the node's time span; without one it is a circle. */
export const NODE_SHAPES = [...GLYPH_SHAPES, ...LABEL_SHAPES, 'span'] as const;
export type NodeShape = (typeof NODE_SHAPES)[number];
/**
 * The shapes a project may give a node by hand: every shape but `span`,
 * whose length is a fact about the node's time and not a choice of style.
 */
export const APPEARANCE_SHAPES = [...GLYPH_SHAPES, ...LABEL_SHAPES] as const;
export const isLabelShape = (shape: NodeShape): boolean =>
  (LABEL_SHAPES as readonly string[]).includes(shape);

/**
 * What kind of picture a graph is. Every kind is still nodes and relations;
 * the kind only chooses the conventions readers expect: how it is laid out,
 * how relations are routed, where labels go and how the film unfolds.
 */
export const DIAGRAM_KINDS = ['network', 'tree', 'mindmap', 'flowchart', 'timeline'] as const;
export type DiagramKind = (typeof DIAGRAM_KINDS)[number];
export interface NodeStyle {
  shape: NodeShape;
  /** Fixed radius at camera scale 1; otherwise the radius follows node importance. */
  baseRadius?: number;
  /** Categorical palette slot for nodes that have neither their own nor a group colour. */
  tone?: number;
  /** Author-declared #RRGGBB; takes precedence over the tone. */
  color?: string;
}
export interface LegendEntry {
  kind: string;
  label: LocalizedText;
  /** Which collection the kind belongs to; absent entries describe edges. */
  of?: 'node' | 'edge';
}
export interface DomainStyle {
  domain: string;
  edges: Readonly<Record<string, EdgeStyle>>;
  defaultEdge: EdgeStyle;
  nodes: Readonly<Record<string, NodeStyle>>;
  defaultNode: NodeStyle;
  legend: readonly LegendEntry[];
  /** 0–1: how much a lone relation bows. Diagrams with fixed conventions keep 0. */
  curvature?: number;
  /** `elbow` leaves and enters sideways, as tree, mind-map and flow links do. */
  routing?: 'arc' | 'elbow';
  /** `always` shows every authored relation label, not only highlighted ones. */
  edgeLabels?: 'highlight' | 'always';
  /** `target` draws a relation in the colour of the node it leads to. */
  edgeHue?: 'kind' | 'target';
  /**
   * The domain time axis of a timeline: its range and world units per unit of
   * time. Span glyphs take their length from it and the axis is drawn from it.
   */
  timeAxis?: { from: number; to: number; scale: number };
}

export const isLocale = (value: unknown): value is Locale =>
  typeof value === 'string' && (LOCALES as readonly string[]).includes(value);
export const localeFor = (value: unknown): Locale => (isLocale(value) ? value : DEFAULT_LOCALE);
export const localize = (text: LocalizedText, locale: Locale): string => text[locale];

/** A neutral encoding for domains without a style sheet. */
export const NEUTRAL_STYLE: DomainStyle = Object.freeze({
  domain: 'neutral',
  edges: Object.freeze({}),
  defaultEdge: Object.freeze({ stroke: 'plain', head: 'arrow' }),
  nodes: Object.freeze({}),
  defaultNode: Object.freeze({ shape: 'circle' }),
  legend: Object.freeze([]),
});

const STYLES: Readonly<Record<string, DomainStyle>> = Object.freeze({
  literature: literatureStyle,
  biology: biologyStyle,
});

export function domainStyle(domain: unknown): DomainStyle {
  return typeof domain === 'string' && Object.hasOwn(STYLES, domain)
    ? STYLES[domain]
    : NEUTRAL_STYLE;
}

// Own-property lookups: kinds such as 'constructor' must use the defaults.
export const edgeStyleFor = (style: DomainStyle, kind: string): EdgeStyle =>
  Object.hasOwn(style.edges, kind) ? style.edges[kind] : style.defaultEdge;
export const nodeStyleFor = (style: DomainStyle, kind: string): NodeStyle =>
  Object.hasOwn(style.nodes, kind) ? style.nodes[kind] : style.defaultNode;

/** Declared presentation of one kind in a generic graph document. */
export interface KindDeclaration {
  label?: string;
  color?: string;
  shape?: NodeShape;
  line?: LineStyle;
  head?: EdgeHead;
}
export interface GraphKinds {
  nodes?: Readonly<Record<string, KindDeclaration>>;
  edges?: Readonly<Record<string, KindDeclaration>>;
}

const LINE_DASH: Readonly<Record<LineStyle, readonly number[] | undefined>> = Object.freeze({
  solid: undefined,
  dashed: Object.freeze([7, 5]),
  dotted: Object.freeze([2, 4]),
});
// Redundant with hue: the first kinds stay solid, later ones also change rhythm.
const AUTO_DASH: readonly (readonly number[] | undefined)[] = Object.freeze([
  undefined,
  undefined,
  undefined,
  Object.freeze([7, 5]),
  Object.freeze([2, 4]),
  Object.freeze([11, 4, 2, 4]),
  Object.freeze([4, 4]),
  Object.freeze([14, 6]),
]);
// Without a hue, rhythm is all a kind has: the first stays solid and every
// later one takes the next rhythm, so no two neutral kinds look alike.
const NEUTRAL_DASH: readonly (readonly number[] | undefined)[] = Object.freeze([
  undefined,
  ...AUTO_DASH.filter((dash) => dash !== undefined),
]);
const compareText = (a: string, b: string): number => (a < b ? -1 : a > b ? 1 : 0);
const TERMINAL = /^(start|end|begin|finish|stop|terminal|terminator|开始|结束|起点|终点|起止)$/i,
  DECISION = /^(decision|condition|branch|choice|gateway|if|判断|条件|分支|决策)$/i;
/** The shape readers expect for a kind in this sort of diagram. */
function conventionalShape(diagram: DiagramKind, kind: string, index: number): NodeShape {
  if (diagram === 'flowchart')
    return TERMINAL.test(kind) ? 'capsule' : DECISION.test(kind) ? 'decision' : 'box';
  if (diagram === 'mindmap') return 'box';
  if (diagram === 'timeline') return 'span';
  return GLYPH_SHAPES[index % GLYPH_SHAPES.length];
}
/** Kinds by descending frequency, then by name, so array order never matters. */
function rankedKinds(items: readonly { kind: string }[], declared: readonly string[]): string[] {
  const count = new Map<string, number>();
  for (const item of items) count.set(item.kind, (count.get(item.kind) ?? 0) + 1);
  const order = new Map(declared.map((kind, index) => [kind, index]));
  return [...new Set([...declared, ...count.keys()])].sort(
    (a, b) =>
      (order.get(a) ?? Infinity) - (order.get(b) ?? Infinity) ||
      (count.get(b) ?? 0) - (count.get(a) ?? 0) ||
      compareText(a, b),
  );
}

/**
 * Derive a complete visual encoding for a graph of arbitrary kinds.
 *
 * Channels are allocated once for the whole document (never per frame, so a
 * reveal cannot repaint what is already on screen):
 *  - node hue belongs to the nodes that carry a tone of their own (the
 *    branches of a tree or mind map), then to groups when the graph has any,
 *    otherwise to node kinds;
 *  - node shape always follows the node kind;
 *  - edge hue follows the edge kind and takes only palette slots that no
 *    node, group or node kind uses, so one hue never means two things, with
 *    a dash rhythm as second channel.
 * Declarations in `graph.kinds` override the automatic choice for their kind.
 */
export function deriveGraphStyle(
  graph: Pick<VisualGraph, 'nodes' | 'edges' | 'groups' | 'kinds' | 'domain' | 'diagram'>,
): DomainStyle {
  const diagram = graph.diagram ?? 'network',
    axis = diagram === 'timeline' ? timeAxis(graph.nodes) : null;
  const declaredNodes = graph.kinds?.nodes ?? {},
    declaredEdges = graph.kinds?.edges ?? {};
  const nodeKinds = rankedKinds(graph.nodes, Object.keys(declaredNodes)),
    edgeKinds = rankedKinds(graph.edges, Object.keys(declaredEdges));
  const grouped = graph.groups.length > 0;
  // Hue slots already spoken for, read from what will actually be drawn: the
  // tone of each group (one with an authored colour holds no slot) and of
  // each node that carries its own.
  const taken = new Set<number>();
  for (const group of graph.groups) if (group.tone !== undefined) taken.add(group.tone);
  let branched = false;
  for (const node of graph.nodes)
    if (node.tone !== undefined) {
      taken.add(node.tone);
      branched = true;
    }
  let nextTone = 0;
  const tone = (): number | undefined => {
    while (taken.has(nextTone)) nextTone++;
    return nextTone < TONE_COUNT ? nextTone++ : undefined;
  };
  const nodes: Record<string, NodeStyle> = {},
    edges: Record<string, EdgeStyle> = {},
    legend: LegendEntry[] = [];
  const plain = (text: string): LocalizedText => Object.freeze({ 'zh-CN': text, en: text });
  nodeKinds.forEach((kind, index) => {
    const declared = Object.hasOwn(declaredNodes, kind) ? declaredNodes[kind] : undefined;
    // Where nodes or groups already speak in hue, a kind is told by shape alone.
    const assigned = grouped || branched || nodeKinds.length < 2 ? undefined : tone();
    nodes[kind] = Object.freeze({
      shape: declared?.shape ?? conventionalShape(diagram, kind, index),
      ...(declared?.color ? { color: declared.color } : {}),
      ...(assigned === undefined || declared?.color ? {} : { tone: assigned }),
    });
    if (nodeKinds.length > 1 || declared?.label)
      legend.push(Object.freeze({ kind, label: plain(declared?.label ?? kind), of: 'node' }));
  });
  let neutral = 0;
  edgeKinds.forEach((kind, index) => {
    const declared = Object.hasOwn(declaredEdges, kind) ? declaredEdges[kind] : undefined;
    const assigned = edgeKinds.length < 2 ? undefined : tone();
    const hued = assigned !== undefined || declared?.color !== undefined;
    const dash = declared?.line
      ? LINE_DASH[declared.line]
      : hued
        ? AUTO_DASH[index % AUTO_DASH.length]
        : NEUTRAL_DASH[neutral++ % NEUTRAL_DASH.length];
    edges[kind] = Object.freeze({
      stroke: 'plain',
      // Branches of a tree or mind map need no arrowhead: the root says the way.
      head: declared?.head ?? (diagram === 'tree' || diagram === 'mindmap' ? 'none' : 'arrow'),
      ...(declared?.color ? { color: declared.color } : {}),
      ...(assigned === undefined || declared?.color ? {} : { tone: assigned }),
      ...(dash ? { dash } : {}),
    });
    if (edgeKinds.length > 1 || declared?.label)
      legend.push(Object.freeze({ kind, label: plain(declared?.label ?? kind), of: 'edge' }));
  });
  return Object.freeze({
    domain: graph.domain,
    edges: Object.freeze(edges),
    defaultEdge: NEUTRAL_STYLE.defaultEdge,
    nodes: Object.freeze(nodes),
    defaultNode: NEUTRAL_STYLE.defaultNode,
    legend: Object.freeze(legend),
    ...(diagram === 'network'
      ? { curvature: 1 }
      : {
          curvature: 0,
          routing: 'elbow' as const,
          // Branch colour follows the node, unless relation kinds need the hue.
          ...(edgeKinds.length < 2 && diagram !== 'flowchart'
            ? { edgeHue: 'target' as const }
            : {}),
          ...(diagram === 'flowchart' ? { edgeLabels: 'always' as const } : {}),
          ...(axis ? { timeAxis: { from: axis.from, to: axis.to, scale: axis.scale } } : {}),
        }),
  });
}

const untimed = new WeakMap<DomainStyle, DomainStyle>();
function withoutAxis(style: DomainStyle): DomainStyle {
  let plain = untimed.get(style);
  if (!plain) {
    const rest: DomainStyle = { ...style };
    delete rest.timeAxis;
    plain = Object.freeze(rest);
    untimed.set(style, plain);
  }
  return plain;
}

/**
 * The style a drawing of `graph` at `positions` is read with. Whether it has
 * a time axis is the declared state `timeAnchor` defines, the one the editor
 * and the layout panel use too. Positions can only take the axis away, as a
 * guard for callers that pass coordinates no anchoring has pinned: rules and
 * bars must never point at the wrong years. Without an axis spans are drawn
 * as points and no rule or cursor is drawn. Glyph outlines, hit tests and the
 * composer must all read a drawing through this.
 */
export function styleForDrawing(
  style: DomainStyle,
  graph: Parameters<typeof timeAnchor>[0],
  positions: Parameters<typeof keepsTime>[1],
): DomainStyle {
  if (!style.timeAxis) return style;
  if (!timeAnchor(graph)) return withoutAxis(style);
  return styleForPositions(style, graph.nodes, positions);
}

/**
 * The coordinate guard of `styleForDrawing` alone: the style without its axis
 * unless every dated node sits at its place in time. It does not know whether
 * the drawing is declared a timeline; read drawings through `styleForDrawing`.
 */
export function styleForPositions(
  style: DomainStyle,
  nodes: Parameters<typeof keepsTime>[0],
  positions: Parameters<typeof keepsTime>[1],
): DomainStyle {
  if (!style.timeAxis || keepsTime(nodes, positions, style.timeAxis)) return style;
  return withoutAxis(style);
}

const derived = new WeakMap<object, DomainStyle>();
/**
 * The style sheet of a loaded graph: a registered domain sheet when its
 * domain has one, otherwise an encoding derived from the graph itself.
 */
export function styleForGraph(
  graph: Pick<VisualGraph, 'nodes' | 'edges' | 'groups' | 'kinds' | 'domain' | 'diagram'>,
): DomainStyle {
  if (typeof graph.domain === 'string' && Object.hasOwn(STYLES, graph.domain))
    return STYLES[graph.domain];
  let style = derived.get(graph);
  if (!style) {
    style = deriveGraphStyle(graph);
    derived.set(graph, style);
  }
  return style;
}
