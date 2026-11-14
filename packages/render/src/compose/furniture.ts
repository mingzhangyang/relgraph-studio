import { displayNodeText, edgeStyleFor, localize } from '@relgraph/core';
import type { DisplayItem, FontRef, FrameText, Paint } from '../display-list.js';
import type { FrameContext } from './context.js';
import { clamp } from './geometry.js';
import { captionWithLabel, fitText, wrapText } from './text.js';

/** The domain time shown in the title band, or '' for a frame without one. */
export function domainTimeText(ctx: FrameContext): string {
  const { playback, messages, view } = ctx;
  return playback.domainAt === null
    ? ''
    : messages.domainTime(view.timeline?.unit, playback.domainAt);
}

/**
 * The detail card in the upper right of the graph safe area, for the node a
 * shot opens, and its accessible text.
 */
export function composeDetailCard(ctx: FrameContext): {
  items: DisplayItem[];
  detail: FrameText['detail'];
} {
  const { state, view, config, playback, spec, theme: P, u, sans, serif, measure } = ctx;
  const graphArea = spec.safe.graph;
  const items: DisplayItem[] = [];
  if (!state.overlay) return { items, detail: null };
  const overlayId = state.overlay.nodeId;
  const node = view.nodes.find((n) => n.id === overlayId),
    summary =
      displayNodeText(config, overlayId)?.description ??
      ctx.detailAt(overlayId, playback.domainAt)?.summary;
  if (!node || !summary) return { items, detail: null };
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
      text: fitText(measure, ctx.nodeLabel(node), titleFont, textWidth),
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
  const cardProgress = ctx.nodeProgress(node.id);
  if (cardProgress >= 1) items.push(...cardItems);
  else if (cardProgress > 0.5)
    items.push({ type: 'group', alpha: (cardProgress - 0.5) * 2, items: cardItems });
  return { items, detail: { label: ctx.nodeLabel(node), summary } };
}

/**
 * Frame furniture: the title and caption bands, which keep graph labels out
 * of overlays, the film title, frame and domain time, the shot's title and
 * narration, and the progress track.
 */
export function composeFurniture(ctx: FrameContext): DisplayItem[] {
  const { spec, theme: P, u, sans, serif, mono, measure, messages, view, playback, graph } = ctx;
  const { frame, fps, captionAlpha } = ctx;
  const { width: W } = spec;
  const { title: titleBand, caption: captionBand } = spec.safe;
  const items: DisplayItem[] = [
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
  ];
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
  const domainTime = domainTimeText(ctx);
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
  return items;
}

/** The frame's accessible text: what it shows, in words. */
export function frameText(ctx: FrameContext, detail: FrameText['detail']): FrameText {
  const { view, playback, graph, style, locale, messages } = ctx;
  const labels = new Map(view.nodes.map((node) => [node.id, ctx.nodeLabel(node)]));
  return {
    title: view.meta.title,
    scene: {
      index: playback.index + 1,
      count: graph.scenes.length,
      title: playback.scene?.title || '',
      narration: playback.scene?.narration || '',
    },
    domainTime: domainTimeText(ctx),
    detail,
    nodes: view.nodes.map(ctx.nodeLabel),
    relations: view.edges.map((edge) => {
      const caption = edgeStyleFor(style, edge.kind).caption;
      return messages.relation(
        labels.get(edge.source) ?? edge.source,
        labels.get(edge.target) ?? edge.target,
        Boolean(edge.directed),
        caption
          ? captionWithLabel(localize(caption, locale), ctx.edgeLabel(edge))
          : ctx.edgeLabel(edge) || edge.kind,
      );
    }),
  };
}
