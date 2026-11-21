import type { EvidenceCard, VisualEvidence } from '@relgraph/core';
import type { DisplayItem, EvidenceOverflow, FontRef, FrameText } from '../display-list.js';
import { evidenceCardRegion } from '../frame-spec.js';
import type { FrameContext } from './context.js';
import { wrapAllText } from './text.js';

/** The card's lines, laid out from its top, in output pixels. */
interface CardLine {
  text: string;
  font: FontRef;
  role: 'quote' | 'cite';
  /** Baseline, from the top of the content. */
  y: number;
}

/**
 * What a card says about its object: a node's label, or a relation's ends as
 * the transcript names them. Derived from labels only, never free text.
 */
function cardSubject(ctx: FrameContext, card: EvidenceCard): string {
  const { view } = ctx;
  if (card.object === 'node') {
    const node = view.nodes.find((n) => n.id === card.id);
    return node ? ctx.nodeLabel(node) : '';
  }
  const edge = view.edges.find((e) => e.id === card.id);
  if (!edge) return '';
  const label = (id: string): string => {
    const node = view.nodes.find((n) => n.id === id);
    return node ? ctx.nodeLabel(node) : id;
  };
  return `${label(edge.source)} ${edge.directed ? '→' : '—'} ${label(edge.target)}`;
}

/** A citation as the card prints it: the work, then where in it. */
const citation = (item: VisualEvidence): string =>
  [item.cite, item.locator].filter(Boolean).join(' · ');

/**
 * Lay out every item in full, or say which item would not fit. Text is never
 * cut: an item that does not fit is an error for the data owner to resolve
 * by choosing fewer items or a shorter quotation (ADR 004, D4).
 */
function layoutCard(
  ctx: FrameContext,
  card: EvidenceCard,
  width: number,
  height: number,
):
  | { lines: CardLine[]; height: number; overflow: null }
  | { lines: null; overflow: EvidenceOverflow } {
  const { u, serif, sans, measure, locale } = ctx;
  const quoteFont = serif(16),
    citeFont = sans(13),
    lonelyCite = sans(14);
  const lines: CardLine[] = [];
  let y = 0;
  for (const [n, item] of card.items.entries()) {
    if (n) y += u(14);
    if (item.quote)
      for (const text of wrapAllText(measure, item.quote, quoteFont, width - u(12))) {
        y += u(25);
        lines.push({ text, font: quoteFont, role: 'quote', y: y - u(7) });
      }
    const cite = citation(item);
    if (cite) {
      const font = item.quote ? citeFont : lonelyCite;
      const lead = item.quote ? (locale === 'en' ? '— ' : '——') : '';
      for (const [i, text] of wrapAllText(
        measure,
        cite,
        font,
        width - measure(lead, font),
      ).entries()) {
        y += item.quote ? u(20) : u(22);
        lines.push({ text: (i ? '' : lead) + text, font, role: 'cite', y: y - u(5) });
      }
      if (item.quote) y += u(2);
    }
    if (y > height)
      return {
        lines: null,
        overflow: {
          object: card.object,
          id: card.id,
          item: item.index,
          needed: y / ctx.spec.typeScale,
          available: height / ctx.spec.typeScale,
        },
      };
  }
  return { lines, height: y, overflow: null };
}

/**
 * The shot's evidence card (ADR 004, D4), in the card region of the frame
 * spec, and its accessible text. The card shows each quotation exactly as
 * written followed by its citation, or a citation alone. It fades in once
 * the camera has stopped and its object is half revealed, so it never
 * covers its object, and out with the caption. A card that does not fit is not drawn: the frame
 * reports it in `evidenceOverflow` instead of cutting the text.
 */
export function composeEvidenceCard(ctx: FrameContext): {
  items: DisplayItem[];
  evidence: FrameText['evidence'];
  overflow: EvidenceOverflow | null;
} {
  const card = ctx.state.evidence;
  if (!card) return { items: [], evidence: null, overflow: null };
  const { spec, theme: P, u, sans, serif, measure } = ctx;
  const region = evidenceCardRegion(spec);
  const pad = u(22);
  const subject = cardSubject(ctx, card);
  const evidence: FrameText['evidence'] = {
    subject,
    items: card.items.map((item) => ({
      ...(item.quote ? { quote: item.quote } : {}),
      ...(item.cite ? { cite: item.cite } : {}),
      ...(item.locator ? { locator: item.locator } : {}),
      ...(item.url ? { url: item.url } : {}),
    })),
  };
  const textX = region.x + pad,
    textWidth = region.w - 2 * pad;
  // The subject wraps like the items and is never shortened: a long name
  // takes lines from the items, and a card it leaves no room in overflows.
  const subjectFont = serif(19, 600);
  const subjectLines = wrapAllText(measure, subject, subjectFont, textWidth);
  const subjectExtra = u(26) * Math.max(0, subjectLines.length - 1);
  const contentTop = region.y + u(84) + subjectExtra;
  const laid = layoutCard(ctx, card, textWidth, region.y + region.h - u(20) - contentTop);
  if (!laid.lines) return { items: [], evidence, overflow: laid.overflow };
  // The card is as tall as its items, up to the whole region.
  const box = { ...region, h: Math.min(region.h, contentTop - region.y + laid.height + pad) };
  const cardItems: DisplayItem[] = [
    {
      type: 'path',
      d: [['RR', box.x, box.y, box.w, box.h, u(12)]],
      fill: P.card,
      stroke: P.cardStroke,
      width: u(1),
    },
    {
      type: 'text',
      text: 'EVIDENCE',
      x: textX,
      y: region.y + u(32),
      font: sans(11, 600),
      fill: P.kicker,
    },
    ...subjectLines.map((text, i): DisplayItem => ({
      type: 'text',
      text,
      x: textX,
      y: region.y + u(60) + u(26) * i,
      font: subjectFont,
      fill: P.cardTitle,
    })),
    {
      type: 'path',
      d: [
        ['M', textX, region.y + u(72) + subjectExtra],
        ['L', textX + textWidth, region.y + u(72) + subjectExtra],
      ],
      stroke: P.cardStroke,
      width: u(1),
      alpha: 0.5,
    },
  ];
  // A rule beside each quotation's lines marks the source text.
  let run: { top: number; bottom: number } | null = null;
  const closeRun = (): void => {
    if (run)
      cardItems.push({
        type: 'path',
        d: [['R', textX, run.top, u(2), run.bottom - run.top]],
        fill: P.cardStroke,
      });
    run = null;
  };
  for (const line of laid.lines) {
    const baseline = contentTop + line.y;
    if (line.role === 'quote') {
      const top = baseline - u(17),
        bottom = baseline + u(7);
      run = run ? { top: run.top, bottom } : { top, bottom };
    } else closeRun();
    cardItems.push({
      type: 'text',
      text: line.text,
      x: line.role === 'quote' ? textX + u(12) : textX,
      y: baseline,
      font: line.font,
      fill: line.role === 'quote' ? P.cardText : P.meta,
    });
  }
  closeRun();
  // Core decides when the card may show: after the camera move that clears
  // its object and once the object is half revealed (`evidenceShownSec`).
  const alpha = ctx.state.evidenceOpacity ?? 1;
  if (alpha <= 0) return { items: [], evidence, overflow: null };
  return {
    items: alpha >= 1 ? cardItems : [{ type: 'group', alpha, items: cardItems }],
    evidence,
    overflow: null,
  };
}
