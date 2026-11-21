/**
 * The direction time is drawn in (ADR 004, D7 step 2). A drawing whose x is
 * time is stored once, with time along x; a Studio project may ask for it to
 * be drawn with time running down instead (`config.view.timeAxis:
 * "vertical"`). That is a render-time transpose: every stored point (x, y) is
 * drawn at (y, x), so the earliest time is at the top and the lanes run left
 * to right. Stored coordinates never change, so a data owner's checked
 * layout stays valid in both directions.
 *
 * The direction is only ever read from the project: never inferred from the
 * frame spec, and the CLI has no switch for it, so a render is reproducible
 * from the file and the `--frame-spec` choice alone. A plain source file has
 * no project and is drawn horizontally.
 *
 * Everything that turns stored positions into a picture goes through
 * `drawnPositions`: the camera (`directorFrameAt`), the composer
 * (`frameContext`), the studio's hit tests and drags, and the chronology
 * check. What reads the stored drawing as data (writing positions back, the
 * time anchor, the layout strategies) keeps the stored positions.
 */
import type { VisualGraph, VisualNode } from '../../types/visual-graph.js';
import { TIME_AXIS_DIRECTIONS, type ProjectConfig } from '../project.js';
import { hasTimes } from '../graph/time-axis.js';

/** The directions a project may draw time in; `horizontal` when absent. */
export const TIME_DIRECTIONS = TIME_AXIS_DIRECTIONS;
export type TimeDirection = (typeof TIME_DIRECTIONS)[number];

type Point = { x: number; y: number };

/** The direction a drawing shows time in: the project's, else horizontal. */
export function timeDirection(
  graph: { project?: Pick<ProjectConfig, 'view'> } | null | undefined,
): TimeDirection {
  return graph?.project?.view?.timeAxis === 'vertical' ? 'vertical' : 'horizontal';
}

/** Whether a drawing is transposed: time drawn top to bottom. */
export const drawsTimeVertically = (
  graph: { project?: Pick<ProjectConfig, 'view'> } | null | undefined,
): boolean => timeDirection(graph) === 'vertical';

/** A point with x and y swapped; the transpose is its own inverse. */
export const transposePoint = <P extends Point>(point: P): Point => ({ x: point.y, y: point.x });

/**
 * The positions a drawing is drawn at: the stored ones themselves when time
 * runs horizontally (the same map, so nothing changes for such a drawing),
 * else a transposed copy. A copy, not a view: built per frame, it always
 * follows positions an authoring drag has just moved.
 */
export function drawnPositions<M extends ReadonlyMap<string, Point>>(
  graph: { project?: Pick<ProjectConfig, 'view'> } | null | undefined,
  positions: M,
): M | Map<string, Point> {
  if (!drawsTimeVertically(graph)) return positions;
  const drawn = new Map<string, Point>();
  for (const [id, p] of positions) drawn.set(id, transposePoint(p));
  return drawn;
}

/**
 * The stored point a drawn point stands for: the inverse of `drawnPositions`
 * for one point, as the studio needs it to write a drag back.
 */
export const storedPoint = (
  graph: { project?: Pick<ProjectConfig, 'view'> } | null | undefined,
  point: Point,
): Point => (drawsTimeVertically(graph) ? transposePoint(point) : { x: point.x, y: point.y });

/**
 * Whether a graph may be drawn with time running down: it is a drawing on a
 * time axis, which needs nodes that carry a time (a span or a first
 * appearance). The project validator refuses `vertical` for any other graph.
 */
export const canDrawTimeVertically = (graph: Pick<VisualGraph, 'nodes'>): boolean =>
  hasTimes(graph.nodes as readonly VisualNode[]);
