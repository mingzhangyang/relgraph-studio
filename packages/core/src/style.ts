/**
 * Visual encoding owned by each domain (ADR 003, D4). Renderers read resolved
 * styles; they hold no edge kinds, node kinds or captions of their own.
 */
import { biologyStyle } from './domains/biology.style.js';
import { literatureStyle } from './domains/literature.style.js';
import type { VisualGraph } from '../types/visual-graph.js';

export const LOCALES = ['zh-CN', 'en'] as const;
export type Locale = (typeof LOCALES)[number];
export const DEFAULT_LOCALE: Locale = 'zh-CN';
export type LocalizedText = Readonly<Record<Locale, string>>;

/** Semantic stroke; the video theme resolves it to a colour. */
export type EdgeStroke = 'plain' | 'physical' | 'regulatory';
/** Marker at the target end, drawn only for directed edges. */
export type EdgeHead = 'arrow' | 'bar' | 'hollow-circle' | 'none';
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
export const NODE_SHAPES = ['circle', 'pill', 'diamond', 'square', 'hexagon'] as const;
export type NodeShape = (typeof NODE_SHAPES)[number];
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
  line?: 'solid' | 'dashed' | 'dotted';
  head?: EdgeHead;
}
export interface GraphKinds {
  nodes?: Readonly<Record<string, KindDeclaration>>;
  edges?: Readonly<Record<string, KindDeclaration>>;
}

const LINE_DASH: Readonly<Record<'solid' | 'dashed' | 'dotted', readonly number[] | undefined>> =
  Object.freeze({ solid: undefined, dashed: Object.freeze([7, 5]), dotted: Object.freeze([2, 4]) });
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
const compareText = (a: string, b: string): number => (a < b ? -1 : a > b ? 1 : 0);
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
 *  - node hue belongs to groups when the graph has any, otherwise to node kinds;
 *  - node shape always follows the node kind;
 *  - edge hue follows the edge kind, taking palette slots after the node hues
 *    so one hue never means two things, with a dash rhythm as second channel.
 * Declarations in `graph.kinds` override the automatic choice for their kind.
 */
export function deriveGraphStyle(
  graph: Pick<VisualGraph, 'nodes' | 'edges' | 'groups' | 'kinds' | 'domain'>,
): DomainStyle {
  const declaredNodes = graph.kinds?.nodes ?? {},
    declaredEdges = graph.kinds?.edges ?? {};
  const nodeKinds = rankedKinds(graph.nodes, Object.keys(declaredNodes)),
    edgeKinds = rankedKinds(graph.edges, Object.keys(declaredEdges));
  const grouped = graph.groups.length > 0;
  // Hue slots already spoken for by groups (assigned by the adapter in order).
  let nextTone = grouped ? Math.min(TONE_COUNT, graph.groups.length) : 0;
  const tone = (): number | undefined => (nextTone < TONE_COUNT ? nextTone++ : undefined);
  const nodes: Record<string, NodeStyle> = {},
    edges: Record<string, EdgeStyle> = {},
    legend: LegendEntry[] = [];
  const plain = (text: string): LocalizedText => Object.freeze({ 'zh-CN': text, en: text });
  nodeKinds.forEach((kind, index) => {
    const declared = Object.hasOwn(declaredNodes, kind) ? declaredNodes[kind] : undefined;
    const assigned = grouped || nodeKinds.length < 2 ? undefined : tone();
    nodes[kind] = Object.freeze({
      shape: declared?.shape ?? NODE_SHAPES[index % NODE_SHAPES.length],
      ...(declared?.color ? { color: declared.color } : {}),
      ...(assigned === undefined || declared?.color ? {} : { tone: assigned }),
    });
    if (nodeKinds.length > 1 || declared?.label)
      legend.push(Object.freeze({ kind, label: plain(declared?.label ?? kind), of: 'node' }));
  });
  edgeKinds.forEach((kind, index) => {
    const declared = Object.hasOwn(declaredEdges, kind) ? declaredEdges[kind] : undefined;
    const assigned = edgeKinds.length < 2 ? undefined : tone();
    const dash = declared?.line ? LINE_DASH[declared.line] : AUTO_DASH[index % AUTO_DASH.length];
    edges[kind] = Object.freeze({
      stroke: 'plain',
      head: declared?.head ?? 'arrow',
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
    curvature: 1,
  });
}

const derived = new WeakMap<object, DomainStyle>();
/**
 * The style sheet of a loaded graph: a registered domain sheet when its
 * domain has one, otherwise an encoding derived from the graph itself.
 */
export function styleForGraph(
  graph: Pick<VisualGraph, 'nodes' | 'edges' | 'groups' | 'kinds' | 'domain'>,
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
