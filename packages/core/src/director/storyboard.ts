/**
 * Storyboards derived from a graph's own structure, for documents that do not
 * author one, and the hierarchy, branch colours and unfolding a diagram kind
 * implies. Works on any `VisualGraph`; the generic adapter calls it after
 * parsing. Titles and narration reuse author text only, so no language is
 * assumed.
 */
import { diagramStructure } from '../graph/analysis.js';
import { TONE_COUNT } from '../style.js';
import type { VisualGraph, VisualScene } from '../../types/visual-graph.js';

/** What a source says about how its diagram is presented. */
export interface DiagramShaping {
  /** False when the author asked for the whole diagram at once. */
  unfold: boolean;
  /** Whether any node carries an authored weight; weights win over levels. */
  weighted: boolean;
}

const compareText = (a: string, b: string): number => (a < b ? -1 : a > b ? 1 : 0);

const joinLabels = (labels: string[], limit: number): string =>
  labels.slice(0, limit).join(' · ') + (labels.length > limit ? ' …' : '');

/**
 * A storyboard read off the graph's own structure, for documents that do not
 * author one: the whole, then each group, then the best-connected node. A
 * graph with timed facts instead grows step by step along its domain time.
 * Titles and narration reuse author text only, so no language is assumed.
 */
export function autoStoryboard(
  graph: Pick<VisualGraph, 'meta' | 'nodes' | 'edges' | 'groups' | 'timeline'>,
  summaries: ReadonlyMap<string, string> = new Map(),
): VisualScene[] {
  const { nodes, edges, groups } = graph;
  const byImportance = [...nodes].sort(
    (a, b) => (b.importance ?? 0) - (a.importance ?? 0) || compareText(a.id, b.id),
  );
  const overview = (id: string, durationSec: number, narration?: string): VisualScene => ({
    id,
    title: graph.meta.title,
    ...(narration ? { narration } : {}),
    durationSec,
    transitionMs: 900,
  });
  if ([...nodes, ...edges].some((item) => item.visibility))
    return timedStoryboard(graph, summaries, { titles: 'time', follow: false, closing: false });
  const scenes: VisualScene[] = [overview('auto-overview', 5, graph.meta.description)];
  if (groups.length >= 2 && groups.length <= 6 && nodes.length > groups.length)
    for (const group of groups) {
      const members = byImportance.filter((n) => n.groupId === group.id);
      if (!members.length) continue;
      scenes.push({
        id: `auto-group-${group.id}`,
        title: group.label,
        narration: joinLabels(
          members.map((n) => n.label),
          5,
        ),
        durationSec: 3.5,
        transitionMs: 900,
        highlight: { groupId: group.id },
        camera: members.length > 1 ? { fitIds: members.map((n) => n.id) } : undefined,
      });
    }
  const hub = byImportance[0];
  const incident = hub ? edges.filter((e) => e.source === hub.id || e.target === hub.id) : [];
  if (hub && nodes.length >= 4 && incident.length >= 2) {
    const neighbours = [
      ...new Set(incident.map((e) => (e.source === hub.id ? e.target : e.source))),
    ].filter((id) => id !== hub.id);
    const labels = new Map(nodes.map((n) => [n.id, n.label]));
    const summary = summaries.get(hub.id);
    scenes.push({
      id: 'auto-hub',
      title: hub.label,
      narration:
        summary ??
        joinLabels(
          neighbours.map((id) => labels.get(id) ?? id),
          6,
        ),
      durationSec: 4.5,
      transitionMs: 900,
      highlight: { nodeIds: [hub.id, ...neighbours], edgeIds: incident.map((e) => e.id) },
      camera: { fitIds: [hub.id, ...neighbours] },
      ...(summary ? { openDetailNodeId: hub.id } : {}),
    });
  }
  if (scenes.length > 1) scenes.push(overview('auto-closing', 3.5, graph.meta.sourceNote));
  return scenes;
}

/**
 * One shot per step of domain time, each showing what has just arrived. Used
 * for graphs with timed facts, for timelines, and for diagrams that unfold
 * level by level.
 */
function timedStoryboard(
  graph: Pick<VisualGraph, 'meta' | 'nodes' | 'edges' | 'timeline'>,
  summaries: ReadonlyMap<string, string>,
  options: { titles: 'time' | 'labels'; follow: boolean; closing: boolean },
): VisualScene[] {
  const { nodes, edges } = graph;
  // Principals first; peers in the order the author wrote them.
  const written = new Map(nodes.map((n, i) => [n.id, i]));
  const byImportance = [...nodes].sort(
    (a, b) => (b.importance ?? 0) - (a.importance ?? 0) || written.get(a.id)! - written.get(b.id)!,
  );
  const times = [
    ...new Set(
      [...nodes, ...edges]
        .flatMap((item) => [item.visibility?.from, item.visibility?.to])
        .filter((value): value is number => value !== undefined),
    ),
  ].sort((a, b) => a - b);
  // At most twelve steps, spread evenly over the timed range.
  const steps =
    times.length <= 12
      ? times
      : Array.from({ length: 12 }, (_, i) => times[Math.round((i * (times.length - 1)) / 11)]);
  const scenes = steps.map((at, index): VisualScene => {
    const since = index ? steps[index - 1] : -Infinity;
    const fresh = (item: { visibility?: { from?: number } }): boolean =>
      item.visibility?.from !== undefined &&
      item.visibility.from > since &&
      item.visibility.from <= at;
    // Untimed nodes have been there from the start.
    const arriving = byImportance.filter((n) => fresh(n) || (!index && !n.visibility)),
      labels = arriving.map((n) => n.label),
      told = arriving.map((n) => summaries.get(n.id)).find(Boolean);
    const title =
      options.titles === 'time'
        ? `${graph.timeline?.unit ?? ''} ${at}`.trim()
        : labels.length
          ? joinLabels(labels, 3)
          : graph.meta.title;
    const narration =
      options.titles === 'time'
        ? labels.length
          ? joinLabels(labels, 6)
          : undefined
        : (told ?? (labels.length > 3 ? joinLabels(labels.slice(3), 6) : undefined));
    const visible = nodes.filter((n) => (n.visibility?.from ?? -Infinity) <= at);
    // Light what is new, once there is something older to set it against.
    const highlight =
      index && arriving.length && arriving.length < visible.length
        ? {
            nodeIds: arriving.map((n) => n.id),
            edgeIds: edges.filter(fresh).map((e) => e.id),
          }
        : undefined;
    // A timeline travels: the frame holds what is arriving and what it meets.
    const company = options.follow
      ? visible.filter(
          (n) =>
            arriving.includes(n) || (n.span && (n.span.to === undefined || n.span.to >= since)),
        )
      : [];
    return {
      id: `auto-step-${index + 1}`,
      title,
      ...(narration ? { narration } : {}),
      durationSec: index === steps.length - 1 && !options.closing ? 4 : 3,
      transitionMs: 900,
      domainAt: at,
      ...(highlight ? { highlight } : {}),
      ...(company.length > 1 && company.length < visible.length
        ? { camera: { fitIds: company.map((n) => n.id) } }
        : {}),
    };
  });
  if (options.closing && scenes.length > 1)
    scenes.push({
      id: 'auto-closing',
      title: graph.meta.title,
      ...((graph.meta.description ?? graph.meta.sourceNote)
        ? { narration: graph.meta.description ?? graph.meta.sourceNote }
        : {}),
      durationSec: 4.5,
      transitionMs: 1100,
    });
  return scenes;
}

/**
 * Give a diagram the hierarchy, branch colours and unfolding its kind implies.
 * Authored weights, colours, groups, timing and storyboards always win.
 */
export function shapeDiagram(
  graph: VisualGraph,
  { unfold, weighted }: DiagramShaping,
  summaries: ReadonlyMap<string, string> = new Map(),
): void {
  const diagram = graph.diagram ?? 'network';
  if (diagram === 'network') return;
  const { nodes, edges } = graph;
  const tree = diagram === 'tree' || diagram === 'mindmap';
  const structure = diagram === 'timeline' ? null : diagramStructure(graph, tree ? 'tree' : 'flow');
  if (!weighted)
    for (const node of nodes) {
      const level = structure?.level.get(node.id) ?? 0;
      // Trees speak from the root outwards; steps and spans are peers.
      node.importance = tree ? Math.max(2, 5 - level) : 3;
    }
  if (tree && structure && !graph.groups.length)
    for (const node of nodes) {
      const branch = structure.branch.get(node.id);
      if (!node.color && branch !== undefined && branch < TONE_COUNT) node.tone = branch;
    }
  if (graph.scenes.length) return;
  const timed = [...nodes, ...edges].some((item) => item.visibility);
  if (structure && unfold && !timed && nodes.length > 1) {
    // Reveal one level at a time, folding very deep diagrams into twelve steps.
    const deepest = Math.max(...structure.level.values()),
      step = (id: string): number => {
        const level = structure.level.get(id) ?? 0;
        return 1 + (deepest > 11 ? Math.floor((level * 11) / deepest) : level);
      };
    for (const node of nodes) node.visibility = { from: step(node.id) };
    for (const edge of edges)
      edge.visibility = { from: Math.max(step(edge.source), step(edge.target)) };
    // The steps are reveal order, not time: no frame may present them as a date.
    graph.timeline = { unit: '', ordinal: true };
    graph.scenes = timedStoryboard(graph, summaries, {
      titles: 'labels',
      follow: false,
      closing: true,
    });
  } else if (timed)
    graph.scenes = timedStoryboard(graph, summaries, {
      titles: 'time',
      follow: diagram === 'timeline',
      closing: true,
    });
}
