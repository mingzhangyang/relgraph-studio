import { compileTimeline, frameCount, layoutGraph, type Locale } from '@relgraph/core';
import { frameSpecFor, type FrameSpecName } from '@relgraph/render';
import { createHeadlessRenderer } from '@relgraph/render/skia';
import { formatDiagnostics, loadFile } from './document.js';
import {
  authoredId,
  evidenceOverflows,
  hiddenEvidenceCards,
  type ShotEvidenceOverflow,
  type ShotHiddenEvidence,
} from './evidence.js';
import {
  OmissionTally,
  sampleSettledFrames,
  settledFrameRanges,
  type ShotOmissions,
} from './labels.js';

export interface CheckLabelsRequest {
  file: string;
  frameSpec: FrameSpecName;
  locale: Locale;
  /** Warnings from loading the document; defaults to silence. */
  log?: (message: string) => void;
}

export interface CheckLabelsSummary {
  /** Frames composed, in film order. */
  frames: number[];
  shots: number;
  /** Shots, counted from 0, that never settle: their transitions outlast them. */
  unsettled: number[];
  omittedLabels: ShotOmissions[];
  /** Evidence cards that do not fit and would make `relgraph render` fail (ADR 004, D4). */
  evidenceOverflows: ShotEvidenceOverflow[];
  /** Evidence cards their shot ends before showing; `relgraph render` refuses these too. */
  hiddenEvidence: ShotHiddenEvidence[];
}

/** A user-facing failure; `main` prints the message without a stack. */
export class CheckError extends Error {}

/**
 * Compose, without drawing, the first, middle and last settled frame of every
 * shot and report the labels they leave out (ADR 004, D1), and the evidence
 * cards that do not fit, which `relgraph render` refuses (D4). Labels depend on
 * the frame spec and, through relation captions, the locale; not on the theme.
 */
export async function checkLabels(request: CheckLabelsRequest): Promise<CheckLabelsSummary> {
  const { result } = await loadFile(request.file);
  if (!result.valid) throw new CheckError(`${formatDiagnostics(result)}文档校验失败，未检查。`);
  if (result.warnings.length)
    request.log?.(formatDiagnostics({ errors: [], warnings: result.warnings }));
  const graph = result.graph;
  const { fps } = frameSpecFor(request.frameSpec);
  const filmFrames = frameCount(graph, fps);
  const timeline = compileTimeline(graph, fps);
  const renderer = createHeadlessRenderer(graph, layoutGraph(graph), {
    detailAt: result.detailAt,
    frameSpec: request.frameSpec,
    locale: request.locale,
  });
  const tally = new OmissionTally(timeline, filmFrames);
  const frames = sampleSettledFrames(timeline, filmFrames);
  for (const frame of frames) tally.add(frame, renderer.displayListAt(frame).omitted);
  const unsettled = settledFrameRanges(timeline, filmFrames).flatMap((range, shot) =>
    range.first > range.last ? [shot] : [],
  );
  return {
    frames,
    shots: timeline.shots.length,
    unsettled,
    omittedLabels: tally.report(),
    evidenceOverflows: evidenceOverflows(timeline, filmFrames, renderer.displayListAt, (kind, id) =>
      authoredId(result, kind, id),
    ),
    hiddenEvidence: hiddenEvidenceCards(timeline, filmFrames, (kind, id) =>
      authoredId(result, kind, id),
    ),
  };
}
