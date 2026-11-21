import type { DirectorFrameState, ProjectedVisualGraph, ResolvedHighlight } from '@relgraph/core';
import type { DisplayItem, DisplayList, OmittedLabel } from './display-list.js';
import { composeBackground } from './compose/background.js';
import {
  attentionUnder,
  frameContext,
  type ComposeOptions,
  type DrawItem,
} from './compose/context.js';
import { composeEvidenceCard } from './compose/evidence.js';
import { composeDetailCard, composeFurniture, frameText } from './compose/furniture.js';
import { composeGroups } from './compose/groups.js';
import { composeNodeLabels, composeRelationLabels } from './compose/labels.js';
import { composeLegend } from './compose/legend.js';
import { composeNodes, drawnNodes, nodeObstacles } from './compose/nodes.js';
import { composeRelations, relationLayout } from './compose/relations.js';
import { composeTimeAxis, withoutCoveredLabels } from './compose/time-axis.js';

export { drawingStyle, type ComposeOptions, type DetailLookup } from './compose/context.js';
export { quadraticPrefix } from './compose/geometry.js';
export { hullOutline } from './compose/groups.js';

/** Attention (0–1) of a node or edge under a shot highlight. */
export function shotAttention(
  item: DrawItem,
  highlight: ResolvedHighlight,
  view: ProjectedVisualGraph,
): number {
  return attentionUnder(highlight, view)(item);
}

/**
 * Compose one frame into a display list. Pure: the result depends only on the
 * frame state and options (including the text measurer), never on earlier frames.
 *
 * The frame is built by passes over one shared context (`frameContext`), in
 * this order: background, the nodes' shared geometry, time axis, group
 * hulls, relations, glyphs, legend, evidence card (laid out here so labels
 * keep out of it; drawn above the stage), node labels, relation tags, detail
 * card and frame furniture. Label space is the one state they share: each pass
 * that places text or a plate takes its room in `occupied`, so a later pass
 * can only use what the earlier ones left free.
 */
export function composeFrame(state: DirectorFrameState, options: ComposeOptions): DisplayList {
  const ctx = frameContext(state, options);
  const { stage, width, height } = ctx.spec;
  const items: DisplayItem[] = composeBackground(ctx);
  const drawn = drawnNodes(ctx);
  const occupied = ctx.rectIndex();
  const obstacles = nodeObstacles(ctx, drawn, occupied);
  const axis = composeTimeAxis(ctx, occupied);
  // A legend strip (portrait, 3:4, square) is laid out before group names
  // and labels, which are placed at the top of what they name and would
  // otherwise land under it; the landscape legend keeps its place in the order.
  const stripLegend = ctx.spec.safe.legend ? composeLegend(ctx, occupied) : null;
  const hulls = composeGroups(ctx, drawn, occupied);
  const layout = relationLayout(ctx.view, ctx.points, ctx.style, ctx.graph);
  const relations = composeRelations(
    ctx,
    new Map(drawn.map((entry) => [entry.node.id, entry])),
    layout,
  );
  const glyphs = composeNodes(ctx, drawn);
  const legend = stripLegend ?? composeLegend(ctx, occupied);
  // The evidence card is laid out before any name or relation label: its box
  // is taken for the whole shot, so no label of its object (or any other)
  // is placed under it, and it is verified against the drawn glyphs and
  // relations (ADR 004, D4). It is still drawn above the stage.
  const evidence = composeEvidenceCard(ctx, relations.selection);
  if (evidence.obstacle) occupied.add(evidence.obstacle);
  const omitted: OmittedLabel[] = [];
  const nodeLabels = composeNodeLabels(
    ctx,
    {
      drawn,
      held: glyphs.held,
      obstacles,
      pull: layout.pull,
      relations: relations.obstacles,
    },
    occupied,
    omitted,
  );
  const tags = composeRelationLabels(ctx, relations.labels, occupied, omitted);
  items.push({
    type: 'group',
    clip: { ...stage },
    items: [
      ...withoutCoveredLabels(ctx, axis, evidence.obstacle),
      ...hulls,
      ...relations.items,
      ...glyphs.items,
      ...nodeLabels,
      ...tags,
      ...legend,
    ],
  });
  const card = composeDetailCard(ctx);
  items.push(...card.items, ...evidence.items, ...composeFurniture(ctx));
  return {
    width,
    height,
    items,
    a11y: frameText(ctx, card.detail, evidence.evidence),
    selection: [...relations.selection, ...glyphs.selection],
    selectionClip: { ...stage },
    omitted,
    evidenceOverflow: evidence.overflow,
    evidenceCovers: evidence.covers,
  };
}
