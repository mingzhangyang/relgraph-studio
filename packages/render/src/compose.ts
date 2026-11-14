import type { DirectorFrameState, ProjectedVisualGraph, ResolvedHighlight } from '@relgraph/core';
import type { DisplayItem, DisplayList } from './display-list.js';
import { composeBackground } from './compose/background.js';
import {
  attentionUnder,
  frameContext,
  type ComposeOptions,
  type DrawItem,
} from './compose/context.js';
import { composeDetailCard, composeFurniture, frameText } from './compose/furniture.js';
import { composeGroups } from './compose/groups.js';
import { composeNodeLabels, composeRelationLabels } from './compose/labels.js';
import { composeLegend } from './compose/legend.js';
import { composeNodes, drawnNodes, nodeObstacles } from './compose/nodes.js';
import { composeRelations, relationLayout } from './compose/relations.js';
import { composeTimeAxis } from './compose/time-axis.js';

export type { ComposeOptions, DetailLookup } from './compose/context.js';
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
 * hulls, relations, glyphs, legend, node labels, relation tags, detail card
 * and frame furniture. Label space is the one state they share: each pass
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
  const hulls = composeGroups(ctx, drawn, occupied);
  const layout = relationLayout(ctx.view, ctx.points);
  const relations = composeRelations(
    ctx,
    new Map(drawn.map((entry) => [entry.node.id, entry])),
    layout,
  );
  const glyphs = composeNodes(ctx, drawn);
  const legend = composeLegend(ctx, occupied);
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
  );
  const tags = composeRelationLabels(ctx, relations.labels, occupied);
  items.push({
    type: 'group',
    clip: { ...stage },
    items: [
      ...axis,
      ...hulls,
      ...relations.items,
      ...glyphs.items,
      ...nodeLabels,
      ...tags,
      ...legend,
    ],
  });
  const card = composeDetailCard(ctx);
  items.push(...card.items, ...composeFurniture(ctx));
  return {
    width,
    height,
    items,
    a11y: frameText(ctx, card.detail),
    selection: [...relations.selection, ...glyphs.selection],
    selectionClip: { ...stage },
  };
}
