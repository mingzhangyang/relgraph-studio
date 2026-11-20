import {
  frameAtOrAfter,
  shotSettledSec,
  shotStartFrames,
  timelinePlaybackAt,
  type FilmTimeline,
} from '@relgraph/core';
import type { OmittedLabel } from '@relgraph/render';

/**
 * Omitted-label reports (ADR 004, D1). A frame counts only once its shot has
 * settled: after the camera and highlight transition and the reveals under
 * way at the shot's start. Labels that give way while the camera moves are
 * not reported; labels missing while the picture holds are.
 */

/** One label missing from the settled frames of one shot. */
export interface OmittedLabelReport extends OmittedLabel {
  /** Settled frames, among those checked, that lack the label. */
  frames: number;
  first: number;
  last: number;
}

/** The labels one shot leaves out while it holds. */
export interface ShotOmissions {
  /** Shot index, counted from 0. */
  shot: number;
  shots: number;
  /** The shot's authored id; derived storyboards may have none. */
  id?: string;
  title: string;
  /** Settled frames of the shot that were checked. */
  checked: number;
  labels: OmittedLabelReport[];
}

/** The settled frames of each shot, as an inclusive range of frame indices (empty when first > last). */
export function settledFrameRanges(
  timeline: FilmTimeline,
  filmFrames: number,
): { first: number; last: number }[] {
  const { fps } = timeline;
  const settled = shotSettledSec(timeline);
  const starts = shotStartFrames(timeline);
  return timeline.shots.map((_, index) => ({
    first: Math.max(starts[index], frameAtOrAfter(settled[index], fps)),
    last: index === timeline.shots.length - 1 ? filmFrames - 1 : starts[index + 1] - 1,
  }));
}

/** Collects the omissions of rendered frames, in any order. */
export class OmissionTally {
  private readonly ranges: { first: number; last: number }[];
  private readonly checked: number[];
  private readonly labels: Map<string, OmittedLabelReport>[];

  constructor(
    private readonly timeline: FilmTimeline,
    filmFrames: number,
  ) {
    this.ranges = settledFrameRanges(timeline, filmFrames);
    this.checked = timeline.shots.map(() => 0);
    this.labels = timeline.shots.map(() => new Map());
  }

  /** The shot a frame is a settled frame of, or null. */
  settledShot(frame: number): number | null {
    const { index } = timelinePlaybackAt(this.timeline, frame / this.timeline.fps);
    const range = this.ranges[index];
    return range && frame >= range.first && frame <= range.last ? index : null;
  }

  add(frame: number, omitted: readonly OmittedLabel[]): void {
    const shot = this.settledShot(frame);
    if (shot === null) return;
    this.checked[shot] += 1;
    for (const label of omitted) {
      const key = `${label.kind}\u0000${label.id}`;
      const known = this.labels[shot].get(key);
      if (known) {
        known.frames += 1;
        known.first = Math.min(known.first, frame);
        known.last = Math.max(known.last, frame);
      } else this.labels[shot].set(key, { ...label, frames: 1, first: frame, last: frame });
    }
  }

  /** Shots that left a label out, in film order; labels by first frame, then text. */
  report(): ShotOmissions[] {
    const { shots } = this.timeline;
    return shots.flatMap((compiled, shot) => {
      const labels = [...this.labels[shot].values()].sort(
        (a, b) => a.first - b.first || (a.text < b.text ? -1 : a.text > b.text ? 1 : 0),
      );
      return labels.length
        ? [
            {
              shot,
              shots: shots.length,
              ...(compiled.scene.id === undefined ? {} : { id: compiled.scene.id }),
              title: compiled.scene.title,
              checked: this.checked[shot],
              labels,
            },
          ]
        : [];
    });
  }
}

/**
 * Frames to compose when checking without rendering: the first, middle and
 * last settled frame of each shot. Nothing on the stage moves while a shot
 * holds, so these stand for the rest.
 */
export function sampleSettledFrames(timeline: FilmTimeline, filmFrames: number): number[] {
  return settledFrameRanges(timeline, filmFrames).flatMap(({ first, last }) =>
    first > last ? [] : [...new Set([first, Math.floor((first + last) / 2), last])],
  );
}

const labelText = (label: OmittedLabelReport): string =>
  label.kind === 'edge-label' ? `关系「${label.text}」` : label.text;

/** The report as the CLI prints it; empty when nothing was left out. */
export function formatOmissions(report: readonly ShotOmissions[]): string {
  if (!report.length) return '';
  const lines = report.map((shot) => {
    const labels = shot.labels
      .map((label) =>
        label.frames < shot.checked
          ? `${labelText(label)}（${label.frames}/${shot.checked} 帧）`
          : labelText(label),
      )
      .join('、');
    return `  镜头 ${shot.shot + 1}/${shot.shots}「${shot.title}」：${labels}`;
  });
  return (
    `警告：${report.length} 个镜头在画面稳定后（镜头切换和揭示动画结束之后）放不下以下标签，它们不会出现在画面上：\n` +
    lines.join('\n') +
    '\n建议：移动相关节点、调整这些镜头的取景或缩短标签；--fail-on-omitted-labels 把它们视为错误。\n'
  );
}
