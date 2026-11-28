/**
 * The list form of a graph: the same projected nodes and relations read top
 * to bottom as rows instead of drawn as a network (`config.view.mode:
 * "list"`). It is chosen per Studio project, like the direction of time, and
 * never inferred from the frame spec, so a render stays a function of the
 * file and the `--frame-spec` choice. The source and its stored coordinates
 * are unchanged; switching back draws the network as before.
 *
 * Core decides only the order of the rows and gives each row one unit of
 * height (`LIST_ROW`) along y. The camera frames rows with the same shot and
 * beat fields as a drawing (`fitIds`, `focusNodeId`), so a film scrolls its
 * list by the storyboard it already has; the renderer, which measures the
 * text, maps that position onto rows as tall as their words.
 */
import type { ProjectedVisualGraph, VisualCamera, VisualNode } from '../../types/visual-graph.js';
import { VIEW_MODES, type ProjectConfig } from '../project.js';

export type ViewMode = (typeof VIEW_MODES)[number];

/** Height of one row along the list's y in the camera's coordinates. */
export const LIST_ROW = 100;

/** The form a project shows its graph in: the project's, else `graph`. */
export function viewMode(
  graph: { project?: Pick<ProjectConfig, 'view'> } | null | undefined,
): ViewMode {
  return graph?.project?.view?.mode === 'list' ? 'list' : 'graph';
}

/** Whether a project shows its graph as a list. */
export const drawsList = (
  graph: { project?: Pick<ProjectConfig, 'view'> } | null | undefined,
): boolean => viewMode(graph) === 'list';

/** Where a node stands in time for the list: its span's start, else its first appearance. */
export function listTime(node: Pick<VisualNode, 'span' | 'visibility'>): number | undefined {
  const time = node.span?.from ?? node.visibility?.from;
  return Number.isFinite(time) ? time : undefined;
}

/**
 * The rows of a list in reading order: nodes without a time first, then by
 * time; equal times keep the order in which the nodes were written.
 */
export function listOrder<N extends Pick<VisualNode, 'id' | 'span' | 'visibility'>>(
  nodes: readonly N[],
): N[] {
  return nodes
    .map((node, index) => ({ node, index, time: listTime(node) ?? -Infinity }))
    .sort((a, b) => a.time - b.time || a.index - b.index)
    .map(({ node }) => node);
}

/**
 * The camera's positions for a list: each row of the view one `LIST_ROW`
 * below the previous, all at x = 0. They depend on the view, so a row that
 * has not appeared yet takes no room.
 */
export function listPositions(
  view: Pick<ProjectedVisualGraph, 'nodes'>,
): Map<string, { x: number; y: number }> {
  return new Map(listOrder(view.nodes).map((node, row) => [node.id, { x: 0, y: row * LIST_ROW }]));
}

/**
 * How many rows past the first framed row the camera may aim. A framing of
 * rows far apart in time (a chapter whose results come years after its
 * people) is taller than a screen; aiming at its middle would show none of
 * them, so the aim stays near where the framed rows begin.
 */
export const LIST_AIM_ROWS = 3;

/**
 * The camera's target for a list, in the same terms as a drawing's (`x`, `y`,
 * `scale`, of which a list reads `y`): the middle of the framed rows
 * (`focusNodeId`, else `fitIds`, else every row), at most `LIST_AIM_ROWS`
 * rows below the first of them.
 */
export function listCamera(
  view: Pick<ProjectedVisualGraph, 'nodes'>,
  camera: VisualCamera,
  positions: ReadonlyMap<string, { x: number; y: number }>,
): { x: number; y: number; scale: number } {
  const requested = camera.focusNodeId ? [camera.focusNodeId] : (camera.fitIds ?? []);
  const framed = requested.map((id) => positions.get(id)).filter((p) => p !== undefined);
  const ys = (framed.length ? framed : [...positions.values()]).map((p) => p.y);
  if (!ys.length) return { x: 0, y: 0, scale: 1 };
  const top = Math.min(...ys),
    bottom = Math.max(...ys);
  return { x: 0, y: Math.min((top + bottom) / 2, top + LIST_AIM_ROWS * LIST_ROW), scale: 1 };
}
