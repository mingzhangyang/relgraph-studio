import type { DisplayItem, OmittedLabel } from '../display-list.js';
import type { Rect } from '../frame-spec.js';
import { importanceStep, SPAN_LABEL } from '../importance.js';
import { PointIndex, type RectIndex } from '../spatial.js';
import type { FrameContext } from './context.js';
import type { Point } from './geometry.js';
import type { DrawnNode } from './nodes.js';
import type { EdgeLabel } from './relations.js';
import { fitText, wrapText } from './text.js';

/** Whether a point lies on the stage, where its label would be expected. */
const onStage = (ctx: FrameContext, p: Point): boolean => {
  const { stage } = ctx.spec;
  return p.x >= stage.x && p.x <= stage.x + stage.w && p.y >= stage.y && p.y <= stage.y + stage.h;
};

/** Node ids in reading order; one collator instead of one per comparison. */
const byId = new Intl.Collator('en').compare;

/** Sides of a label, in the order `composeNodeLabels` lists them. */
const SIDE = { right: 0, left: 1, top: 2, bottom: 3 } as const;

/** A node's place in a tree, which decides where its label goes. */
export type TreeRole = 'leaf' | 'root' | 'inner';

/** How a tree is drawn: each node's role and the direction it grows in. */
export interface TreeReading {
  roles: Map<string, TreeRole>;
  /** True when the tree grows sideways, false when it grows up or down. */
  sideways: boolean;
  /** +1 when it grows right or down, -1 when left or up. */
  forward: 1 | -1;
}

/**
 * How far the relations of a drawing must agree on one direction (the length
 * of the mean of their unit vectors, 0–1) for it to grow that way. The
 * vertebrates example measures 0.90 as a tree, 0.75 layered and 0.94 as a
 * flow; 0.19 radial, 0.35 by force, 0.41 on a circle and 0.53 on a grid.
 */
export const TREE_GROWTH = 0.6;

/**
 * Each node's role in the whole tree, not only in the part shown, so a
 * branch keeps its label's side while the tree unfolds, and the direction
 * the tree grows on the drawing: the one most of its relations lead in.
 * Roles are read from the drawing along that direction (a node with a
 * neighbour further on leads, one with a neighbour before it follows), so a
 * stray relation authored child to parent does not turn its ends around. A
 * node without relations has no role. Null when the relations do not agree
 * on a direction (`TREE_GROWTH`): a tree drawn around its root, or written
 * every which way, has no "ahead", and keeps the free-side search.
 */
export function treeReading(
  graph: Pick<FrameContext['graph'], 'nodes' | 'edges'>,
  positions: ReadonlyMap<string, Point>,
): TreeReading | null {
  const drawn: [string, string, number, number][] = [];
  let gx = 0,
    gy = 0;
  for (const edge of graph.edges) {
    const a = positions.get(edge.source),
      b = positions.get(edge.target);
    if (!a || !b) continue;
    const dx = b.x - a.x,
      dy = b.y - a.y,
      d = Math.hypot(dx, dy);
    if (!(d > 0)) continue;
    drawn.push([edge.source, edge.target, dx, dy]);
    gx += dx / d;
    gy += dy / d;
  }
  if (!drawn.length || Math.hypot(gx, gy) < TREE_GROWTH * drawn.length) return null;
  const sideways = Math.abs(gx) >= Math.abs(gy),
    forward = (sideways ? gx : gy) < 0 ? -1 : 1;
  const leads = new Set<string>(),
    follows = new Set<string>();
  for (const [source, target, dx, dy] of drawn) {
    const along = (sideways ? dx : dy) * forward;
    // Level with one another: neither is ahead.
    if (along === 0) continue;
    leads.add(along > 0 ? source : target);
    follows.add(along > 0 ? target : source);
  }
  const roles = new Map<string, TreeRole>();
  for (const node of graph.nodes) {
    const parent = leads.has(node.id),
      child = follows.has(node.id);
    if (parent || child) roles.set(node.id, !parent ? 'leaf' : !child ? 'root' : 'inner');
  }
  return { roles, sideways, forward };
}

/**
 * Where a label goes in a tree, best first. A leaf is labelled ahead of its
 * node, where nothing follows; the root behind it, where nothing leads in;
 * an inner node across the growth (below a tree that grows sideways, right
 * of one that grows up or down), ending where the node ends, so it sits
 * between neither its parent nor its children and stays clear of the
 * relations that leave towards them. Then the other side across, the same
 * two centred on the node, and the sides along the growth last.
 */
function treePlaces(
  { sideways, forward }: TreeReading,
  role: TreeRole,
  sides: readonly Point[],
  { p, r, width, height }: { p: Point; r: number; width: number; height: number },
): Point[] {
  const [ahead, behind] = sideways
    ? forward > 0
      ? [SIDE.right, SIDE.left]
      : [SIDE.left, SIDE.right]
    : forward > 0
      ? [SIDE.bottom, SIDE.top]
      : [SIDE.top, SIDE.bottom];
  const [across, opposite] = sideways ? [SIDE.bottom, SIDE.top] : [SIDE.right, SIDE.left];
  const back = (side: Point): Point =>
    sideways
      ? { ...side, x: forward > 0 ? p.x + r - width : p.x - r }
      : { ...side, y: forward > 0 ? p.y + r - height : p.y - r };
  if (role === 'leaf') return [ahead, across, opposite, behind].map((i) => sides[i]);
  if (role === 'root') return [behind, across, opposite, ahead].map((i) => sides[i]);
  return [
    back(sides[across]),
    back(sides[opposite]),
    sides[across],
    sides[opposite],
    sides[behind],
    sides[ahead],
  ];
}

export interface NodeLabelInputs {
  drawn: readonly DrawnNode[];
  /** Nodes whose label is drawn inside their shape (`composeNodes`). */
  held: ReadonlySet<string>;
  /** Each node's own label obstacle (`nodeObstacles`). */
  obstacles: ReadonlyMap<string, Rect>;
  /** Where each node's neighbours lie (`relationLayout`). */
  pull: ReadonlyMap<string, Point>;
  /** The strokes drawn so far, counted as crossings (`composeRelations`). */
  relations: RectIndex;
}

/**
 * Deterministic screen-space label placement: prioritize selected and major
 * nodes. Each placed label takes its place in `occupied`. A label of a node on
 * the stage that finds no place is appended to `omitted`, when given.
 */
export function composeNodeLabels(
  ctx: FrameContext,
  { drawn, held, obstacles, pull, relations: edgeObstacles }: NodeLabelInputs,
  occupied: RectIndex,
  omitted?: OmittedLabel[],
): DisplayItem[] {
  const { theme: P, u, sans, measure, inBounds } = ctx;
  const items: DisplayItem[] = [];
  const sorted = drawn
    .filter((entry) => entry.visibility > 0.5 && !held.has(entry.node.id))
    .sort(
      (a, b) =>
        b.alpha - a.alpha ||
        (b.node.importance || 0) - (a.node.importance || 0) ||
        byId(a.node.id, b.node.id),
    );
  // Where the other labelled nodes are, for the test that a label reads as theirs.
  const labelled = new PointIndex(u(96));
  for (const entry of sorted) labelled.add(entry.node.id, entry.p.x, entry.p.y);
  const tree = ctx.style.labelSides === 'tree' ? treeReading(ctx.graph, ctx.positions) : undefined;
  for (const { node, custom, p, r, geometry, alpha: active } of sorted) {
    const obstacle = obstacles.get(node.id);
    if (!obstacle) continue;
    // Type follows the same hierarchy as the glyphs: principals speak loudest.
    // A span that cannot hold its words is labelled as one that can.
    const step = importanceStep(node.importance),
      span = geometry.shape === 'span';
    const font = sans(
      custom.fontSize ?? (span ? SPAN_LABEL.size : step.label),
      custom.fontWeight ?? (span ? SPAN_LABEL.weight : step.weight),
    );
    const lines = wrapText(measure, ctx.nodeLabel(node), font, u(170), 2);
    const width = Math.max(0, ...lines.map((line) => measure(line, font))),
      height = lines.length * font.size * 1.3;
    const rightX = Math.max(p.x + r + u(9), obstacle.x + obstacle.w + u(5));
    const leftX = Math.min(p.x - r - u(9) - width, obstacle.x - width - u(5));
    const topY = Math.min(p.y - r - Math.max(u(25), height + u(4)), obstacle.y - height - u(4));
    const bottomY = Math.max(p.y + r + u(6), obstacle.y + obstacle.h + u(2));
    const nearRightX = Math.max(p.x + r + u(5), obstacle.x + obstacle.w + u(1));
    const nearLeftX = Math.min(p.x - r - u(5) - width, obstacle.x - width - u(1));
    const upperY = Math.min(p.y - r - Math.max(u(24), height + u(4)), obstacle.y - height - u(1));
    const sides = [
      { x: rightX, y: p.y - height / 2 },
      { x: leftX, y: p.y - height / 2 },
      { x: p.x - width / 2, y: topY },
      { x: p.x - width / 2, y: bottomY },
    ];
    const corners = [
      { x: nearRightX, y: upperY },
      { x: nearLeftX, y: upperY },
      { x: nearRightX, y: bottomY },
      { x: nearLeftX, y: bottomY },
    ];
    const authored =
      custom.textPosition === undefined || custom.textPosition === 'auto'
        ? undefined
        : SIDE[custom.textPosition];
    const role = authored === undefined ? tree?.roles.get(node.id) : undefined;
    // An authored side comes first, then a tree's places for the node's role
    // (`treePlaces`). Otherwise face away from the node's relations: the side
    // its neighbours leave free. Reading order breaks ties, so a lone node
    // labels to the right.
    const towards = pull.get(node.id) ?? { x: 0, y: 0 },
      reach = Math.hypot(towards.x, towards.y),
      out = reach > 0.35 ? { x: -towards.x / reach, y: -towards.y / reach } : { x: 0, y: 0 };
    const score = [out.x + 0.3, -out.x + 0.12, -out.y, out.y + 0.06];
    const ordered =
      tree && role
        ? treePlaces(tree, role, sides, { p, r, width, height })
        : authored !== undefined
          ? [sides[authored], ...sides.filter((_, i) => i !== authored)]
          : sides
              .map((side, i) => ({ side, score: score[i], i }))
              .sort((m, n) => n.score - m.score || m.i - n.i)
              .map((entry) => entry.side);
    const candidates = [...ordered, ...corners].map((c) => ({ ...c, w: width, h: height }));
    // Hard rules: stay on the stage and never cover a glyph or other text.
    // Among the places that remain, prefer the natural side, then the one
    // that crosses fewest relations and cannot be read as a neighbour's name.
    let box: Rect | undefined,
      best = Infinity;
    for (let rank = 0; rank < candidates.length; rank++) {
      // A place costs at least its rank, so nothing further down can win.
      if (rank >= best) break;
      const c = candidates[rank];
      if (!inBounds(c) || occupied.someIntersecting(c)) continue;
      // Count crossings only while they can still change the outcome: they
      // are capped at six, and a place already as costly as the best is out.
      let crossings = 0;
      edgeObstacles.someIntersecting(c, () => ++crossings >= 6 || rank + crossings * 0.9 >= best);
      if (rank + Math.min(6, crossings) * 0.9 >= best) continue;
      const cx = c.x + c.w / 2,
        cy = c.y + c.h / 2,
        own = Math.hypot(cx - p.x, cy - p.y);
      // In a tree the side follows the node's role, which is how a reader
      // pairs label and node; elsewhere a label must not sit nearer another.
      const ambiguous = !role && labelled.anyCloser(cx, cy, own * 0.9, node.id);
      const placeCost = rank + Math.min(6, crossings) * 0.9 + (ambiguous ? 4 : 0);
      if (placeCost < best) {
        best = placeCost;
        box = c;
      }
    }
    if (!box) {
      if (omitted && onStage(ctx, p))
        omitted.push({ kind: 'node-label', id: node.id, text: ctx.nodeLabel(node) });
      continue;
    }
    const placed: Rect = box;
    occupied.add(placed);
    lines.forEach((line, index) =>
      items.push({
        type: 'text',
        text: line,
        x: placed.x,
        y: placed.y + index * font.size * 1.3,
        font,
        fill: custom.textColor ?? (active > 0.8 ? P.labelActive : P.labelMuted),
        baseline: 'top',
        halo: { paint: P.labelHalo, width: u(3.5) },
        alpha: active * Math.min(1, (ctx.nodeProgress(node.id) - 0.5) * 2),
      }),
    );
  }
  return items;
}

/**
 * Relation tags, placed after the node labels: on their relation, or a step
 * aside when the line is taken. Each placed tag takes its place in `occupied`.
 * A tag whose home point is on the stage and finds no place is appended to
 * `omitted`, when given.
 */
export function composeRelationLabels(
  ctx: FrameContext,
  labels: readonly EdgeLabel[],
  occupied: RectIndex,
  omitted?: OmittedLabel[],
): DisplayItem[] {
  const { theme: P, u, measure, inBounds } = ctx;
  const items: DisplayItem[] = [];
  for (const label of labels) {
    const edgeFont = label.font;
    const text = fitText(measure, label.text, edgeFont, u(150)),
      w = measure(text, edgeFont) + u(14),
      h = Math.max(u(18), edgeFont.size * 1.5),
      // The tag sits on its relation, interrupting the line like a route
      // marker. Between two close shapes it steps aside instead of vanishing.
      home = {
        x: label.x - w / 2 + (label.push ? (label.push.x * w) / 2 : 0),
        y: label.y - h / 2 + (label.push ? (label.push.y * h) / 2 : 0),
        w,
        h,
      },
      aside = label.aside,
      reach = h / 2 + u(15);
    const box = (aside ? [0, 1, -1, 2, -2] : [0])
      .map((k) => ({
        ...home,
        x: home.x + (aside?.x ?? 0) * k * reach,
        y: home.y + (aside?.y ?? 0) * k * reach,
      }))
      .find((candidate) => inBounds(candidate) && !occupied.someIntersecting(candidate));
    if (!box) {
      if (omitted && onStage(ctx, label))
        omitted.push({ kind: 'edge-label', id: label.id, text: label.text });
      continue;
    }
    occupied.add(box);
    items.push(
      {
        type: 'path',
        d: [['RR', box.x, box.y, w, box.h, h / 2]],
        fill: P.edgeLabelBox,
        stroke: label.stroke,
        width: u(0.8),
        alpha: label.alpha,
      },
      {
        type: 'text',
        text,
        x: box.x + w / 2,
        y: box.y + h / 2 + u(0.5),
        font: edgeFont,
        fill: label.color,
        align: 'center',
        baseline: 'middle',
        alpha: label.alpha,
      },
    );
  }
  return items;
}
