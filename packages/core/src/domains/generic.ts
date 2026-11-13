/**
 * Adapter for `relgraph.graph/1`, the domain-free source format: anything
 * that can be written as "things and the relations between them".
 *
 * Only `format` and one node or edge are required. Everything else has a
 * deterministic default: undeclared edge endpoints become nodes, kinds get a
 * derived visual encoding, weights or degree set the visual hierarchy, missing
 * coordinates are laid out, and a document without a `presentation` receives
 * a storyboard that walks through its own structure.
 *
 * The parser and validator are `generic-source.ts`; the derived storyboard is
 * `director/storyboard.ts`.
 */
import { validateVisualGraph } from '../graph/core.js';
import { placeInTime, TIME_TOLERANCE, timeAxis as axisOf, timedNodes } from '../graph/time-axis.js';
import { autoStoryboard, shapeDiagram } from '../director/storyboard.js';
import {
  parseGenericSource,
  type GenericDiagnostic,
  type ParsedGenericSource,
} from './generic-source.js';
import type { VisualGraph, VisualNode } from '../../types/visual-graph.js';

export {
  GENERIC_FORMAT,
  GENERIC_LIMITS,
  internalIds,
  type GenericDiagnostic,
} from './generic-source.js';

export function validateGenericDocument(doc: unknown): {
  valid: boolean;
  errors: GenericDiagnostic[];
  warnings: GenericDiagnostic[];
} {
  const errors: GenericDiagnostic[] = [],
    warnings: GenericDiagnostic[] = [];
  parseGenericSource(doc, errors, warnings);
  return { valid: errors.length === 0, errors, warnings };
}

export type GenericAdaptation = ReturnType<typeof adaptParsed>;

/**
 * Validate and adapt a source with one parse: invalid sources return their
 * diagnostics, valid ones the adapted graph as well. `loadDocument` uses it;
 * `adaptGenericDocument` throws instead of returning the invalid case.
 */
export function inspectGenericDocument(
  doc: unknown,
):
  | { valid: false; errors: GenericDiagnostic[]; warnings: GenericDiagnostic[] }
  | { valid: true; adapted: GenericAdaptation } {
  const errors: GenericDiagnostic[] = [],
    warnings: GenericDiagnostic[] = [];
  const parsed = parseGenericSource(doc, errors, warnings);
  if (!parsed || errors.length) return { valid: false, errors, warnings };
  return { valid: true, adapted: adaptParsed(parsed, warnings) };
}

export function adaptGenericDocument(input: unknown): GenericAdaptation {
  const inspected = inspectGenericDocument(input);
  if (!inspected.valid)
    throw Object.assign(new Error('Invalid generic graph document'), { issues: inspected.errors });
  return inspected.adapted;
}

function adaptParsed(parsed: ParsedGenericSource, warnings: GenericDiagnostic[]) {
  const errors: GenericDiagnostic[] = [];
  const summaries = new Map<string, string>();
  const nodes: VisualNode[] = parsed.nodes.map(({ summary, ...node }) => {
    if (summary) summaries.set(node.id, summary);
    return node;
  });
  const graph: VisualGraph = {
    domain: 'graph',
    meta: {
      title: parsed.title,
      description: parsed.description,
      sourceNote: parsed.sourceNote,
    },
    timeline: parsed.timeline,
    ...(parsed.diagram === 'network' ? {} : { diagram: parsed.diagram }),
    ...(parsed.diagram === 'timeline' && !parsed.timeAxis ? { timeAxis: false as const } : {}),
    kinds: parsed.kinds,
    groups: parsed.groups,
    nodes,
    edges: parsed.edges,
    scenes: parsed.scenes,
  };
  shapeDiagram(graph, parsed, summaries);
  // A timeline keeps time unless it says otherwise: authored x that is not a
  // node's place in time is redrawn there, and the author is told how to keep it.
  if (graph.diagram === 'timeline' && graph.timeAxis !== false) {
    const nodes = timedNodes(graph),
      axis = axisOf(nodes);
    const off = axis
      ? nodes.filter((node) => {
          const x = placeInTime(node, axis);
          return node.position && x !== null && !(Math.abs(node.position.x - x) <= TIME_TOLERANCE);
        }).length
      : 0;
    if (off)
      warnings.push({
        level: 'warning',
        layer: 'graph-source',
        code: 'OFF_TIME_AXIS',
        path: 'nodes',
        id: '',
        message: `${off} 个带日期的节点横坐标不在其时间上，已按日期绘制。`,
        fix: '带日期节点的横坐标由日期决定：删除其 x，只保留 y（重新导出带坐标的数据会这样写）；如需保留这些横坐标并不显示时间轴，请设置 "timeAxis": false。',
      });
  }
  if (!graph.scenes.length) graph.scenes = autoStoryboard(graph, summaries);
  const check = validateVisualGraph(graph);
  if (!check.valid)
    throw Object.assign(new Error('Generic projection invalid'), { issues: check.errors });
  return {
    graph,
    diagnostics: { valid: true, errors, warnings },
    /** Node summaries are author display text and follow node visibility. */
    detailAt: (id: string): { summary: string } | undefined => {
      const summary = summaries.get(id);
      return summary ? { summary } : undefined;
    },
    sourceIds: parsed.sourceIds,
  };
}
