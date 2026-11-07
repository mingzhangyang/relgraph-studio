/**
 * Visual encoding owned by each domain (ADR 003, D4). Renderers read resolved
 * styles; they hold no edge kinds, node kinds or captions of their own.
 */
import { biologyStyle } from './domains/biology.style.js';
import { literatureStyle } from './domains/literature.style.js';

export const LOCALES = ['zh-CN', 'en'] as const;
export type Locale = (typeof LOCALES)[number];
export const DEFAULT_LOCALE: Locale = 'zh-CN';
export type LocalizedText = Readonly<Record<Locale, string>>;

/** Semantic stroke; the video theme resolves it to a colour. */
export type EdgeStroke = 'plain' | 'physical' | 'regulatory';
/** Marker at the target end, drawn only for directed edges. */
export type EdgeHead = 'arrow' | 'bar' | 'hollow-circle' | 'none';
export interface EdgeStyle {
  stroke: EdgeStroke;
  dash?: readonly number[];
  head: EdgeHead;
  /** Shown on every edge of this kind; otherwise the edge label appears when highlighted. */
  caption?: LocalizedText;
}
export type NodeShape = 'circle' | 'pill' | 'diamond';
export interface NodeStyle {
  shape: NodeShape;
  /** Fixed radius at camera scale 1; otherwise the radius follows node importance. */
  baseRadius?: number;
}
export interface DomainStyle {
  domain: string;
  edges: Readonly<Record<string, EdgeStyle>>;
  defaultEdge: EdgeStyle;
  nodes: Readonly<Record<string, NodeStyle>>;
  defaultNode: NodeStyle;
  legend: readonly { kind: string; label: LocalizedText }[];
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
