import {
  chronologyInversions,
  compileTimeline,
  frameCount,
  layoutGraph,
  nodeTimes,
  timelinePlaybackAt,
  type ChronologyInversion,
  type Locale,
  type VisualGraph,
} from '@relgraph/core';
import {
  frameLayoutIssues,
  frameSpecFor,
  glyphGeometry,
  type FrameSpecName,
} from '@relgraph/render';
import { createHeadlessRenderer } from '@relgraph/render/skia';
import { formatDiagnostics, loadFile } from './document.js';
import { sampleSettledFrames, settledFrameRanges } from './labels.js';

/**
 * `relgraph check-layout` (ADR 004, D2a). Two checks read what the viewer
 * sees, in the settled frames of every shot (the first, middle and last, as
 * `check-labels` samples them): relations drawn close to or across a node
 * they do not join, and glyphs drawn too close together. One reads the stored
 * layout: with a chronology tolerance, nodes drawn against time along x.
 */
export interface CheckLayoutRequest {
  file: string;
  frameSpec: FrameSpecName;
  locale: Locale;
  /** Least gap between a relation and a node it does not join, 720p pixels. */
  clearance?: number;
  /** Least gap between two glyphs, 720p pixels. */
  crowding?: number;
  /** Check order along x for nodes whose times differ by at least this much. */
  chronologyTolerance?: number;
  log?: (message: string) => void;
}

export const LAYOUT_CHECK_DEFAULTS = Object.freeze({ clearance: 4, crowding: 2 });

/** One problem in the settled frames of one shot. */
export type FrameIssue =
  | { kind: 'near-pass'; edge: string; node: string; text: string; distance: number }
  | { kind: 'crowded'; nodes: [string, string]; text: string; distance: number };
export type FrameIssueReport = FrameIssue & { frames: number; first: number; last: number };

export interface ShotLayoutIssues {
  shot: number;
  shots: number;
  id?: string;
  title: string;
  checked: number;
  issues: FrameIssueReport[];
}

export interface CheckLayoutSummary {
  frames: number[];
  shots: number;
  unsettled: number[];
  clearance: number;
  crowding: number;
  shotIssues: ShotLayoutIssues[];
  /** Present when a chronology tolerance was given. */
  chronology?: {
    tolerance: number;
    timedNodes: number;
    inversions: (ChronologyInversion & { text: string })[];
  };
}

/** A user-facing failure; `main` prints the message without a stack. */
export class CheckLayoutError extends Error {}

const labelsOf = (graph: VisualGraph) => {
  const nodes = new Map(graph.nodes.map((node) => [node.id, node.label]));
  const node = (id: string): string => nodes.get(id) ?? id;
  const edges = new Map(graph.edges.map((edge) => [edge.id, edge]));
  const edge = (id: string): string => {
    const found = edges.get(id);
    return found ? `${node(found.source)}—${node(found.target)}` : id;
  };
  return { node, edge };
};

export async function checkLayout(request: CheckLayoutRequest): Promise<CheckLayoutSummary> {
  const clearance = request.clearance ?? LAYOUT_CHECK_DEFAULTS.clearance;
  const crowding = request.crowding ?? LAYOUT_CHECK_DEFAULTS.crowding;
  for (const [name, value] of [
    ['clearance', clearance],
    ['crowding', crowding],
    ['chronologyTolerance', request.chronologyTolerance ?? 0],
  ] as const)
    if (!(Number.isFinite(value) && value >= 0))
      throw new CheckLayoutError(`${name} 需要不小于 0 的数，收到 ${String(value)}`);
  const { result } = await loadFile(request.file);
  if (!result.valid)
    throw new CheckLayoutError(`${formatDiagnostics(result)}文档校验失败，未检查。`);
  if (result.warnings.length)
    request.log?.(formatDiagnostics({ errors: [], warnings: result.warnings }));
  const graph = result.graph;
  const spec = frameSpecFor(request.frameSpec);
  const filmFrames = frameCount(graph, spec.fps);
  const timeline = compileTimeline(graph, spec.fps);
  const positions = layoutGraph(graph);
  const renderer = createHeadlessRenderer(graph, positions, {
    detailAt: result.detailAt,
    frameSpec: request.frameSpec,
    locale: request.locale,
  });
  const label = labelsOf(graph);
  // The renderer's own rule for which nodes are drawn as bars on a time axis.
  const style = renderer.style;
  const bars = new Set(
    graph.nodes
      .filter((node) => glyphGeometry(node, 1, spec, style, 1, graph.project).shape === 'span')
      .map((node) => node.id),
  );
  const ends = new Map(graph.edges.map((edge) => [edge.id, edge]));
  const frames = sampleSettledFrames(timeline, filmFrames);
  const perShot = timeline.shots.map(() => ({
    checked: 0,
    issues: new Map<string, FrameIssueReport>(),
  }));
  for (const frame of frames) {
    const shot = timelinePlaybackAt(timeline, frame / spec.fps).index;
    const { nearPasses, crowded } = frameLayoutIssues(renderer.displayListAt(frame), ends, {
      clearance,
      crowding,
      typeScale: spec.typeScale,
      bars,
    });
    const found: [string, FrameIssue][] = [
      ...nearPasses.map((pass): [string, FrameIssue] => [
        `near\u0000${pass.edge}\u0000${pass.node}`,
        {
          kind: 'near-pass',
          ...pass,
          text: `${label.edge(pass.edge)} 贴近 ${label.node(pass.node)}`,
        },
      ]),
      ...crowded.map((pair): [string, FrameIssue] => [
        `crowd\u0000${pair.nodes.join('\u0000')}`,
        {
          kind: 'crowded',
          ...pair,
          text: `${label.node(pair.nodes[0])} 与 ${label.node(pair.nodes[1])} 过挤`,
        },
      ]),
    ];
    const tally = perShot[shot];
    tally.checked += 1;
    for (const [key, issue] of found) {
      const known = tally.issues.get(key);
      if (known) {
        known.frames += 1;
        known.first = Math.min(known.first, frame);
        known.last = Math.max(known.last, frame);
        known.distance = Math.min(known.distance, issue.distance);
      } else tally.issues.set(key, { ...issue, frames: 1, first: frame, last: frame });
    }
  }
  const shotIssues = perShot.flatMap(({ checked, issues }, shot): ShotLayoutIssues[] => {
    if (!issues.size) return [];
    const scene = timeline.shots[shot].scene;
    return [
      {
        shot,
        shots: timeline.shots.length,
        ...(scene.id === undefined ? {} : { id: scene.id }),
        title: scene.title,
        checked,
        issues: [...issues.values()].sort(
          (a, b) => a.first - b.first || (a.text < b.text ? -1 : a.text > b.text ? 1 : 0),
        ),
      },
    ];
  });
  const summary: CheckLayoutSummary = {
    frames,
    shots: timeline.shots.length,
    unsettled: settledFrameRanges(timeline, filmFrames).flatMap((range, shot) =>
      range.first > range.last ? [shot] : [],
    ),
    clearance,
    crowding,
    shotIssues,
  };
  if (request.chronologyTolerance !== undefined)
    summary.chronology = {
      tolerance: request.chronologyTolerance,
      timedNodes: nodeTimes(graph).size,
      inversions: chronologyInversions(graph, positions, request.chronologyTolerance).map(
        (inversion) => ({
          ...inversion,
          text: `${label.node(inversion.earlier)} 早于 ${label.node(inversion.later)} 约 ${Math.round(inversion.gap * 10) / 10}，却画在其右侧或同列`,
        }),
      ),
    };
  return summary;
}

/** Whether a summary found anything. */
export const layoutIssueCount = (summary: CheckLayoutSummary): number =>
  summary.shotIssues.reduce((n, shot) => n + shot.issues.length, 0) +
  (summary.chronology?.inversions.length ?? 0);

/** The summary as the CLI prints it. */
export function formatLayoutIssues(summary: CheckLayoutSummary): string {
  const lines = [
    `检查了 ${summary.shots} 个镜头的 ${summary.frames.length} 个稳定帧（连线净空 ${summary.clearance}、节点间距 ${summary.crowding}，单位为 720p 像素）` +
      (summary.unsettled.length
        ? `；镜头 ${summary.unsettled.map((shot) => shot + 1).join('、')} 在转场或揭示结束前就已结束，未检查`
        : ''),
  ];
  for (const shot of summary.shotIssues) {
    lines.push(`  镜头 ${shot.shot + 1}/${shot.shots}「${shot.title}」：`);
    for (const issue of shot.issues)
      lines.push(
        `    ${issue.text}（相距 ${issue.distance}${issue.frames < shot.checked ? `；${issue.frames}/${shot.checked} 帧` : ''}）`,
      );
  }
  if (summary.chronology) {
    const { tolerance, timedNodes, inversions } = summary.chronology;
    lines.push(
      `时间顺序：${timedNodes} 个有时间的节点，时间相差至少 ${tolerance} 的两点在横向上` +
        (inversions.length ? `有 ${inversions.length} 对先后颠倒：` : '没有先后颠倒。'),
    );
    for (const inversion of inversions) lines.push(`    ${inversion.text}`);
  }
  if (!layoutIssueCount(summary)) lines.push('没有发现布局问题。');
  return lines.join('\n') + '\n';
}
