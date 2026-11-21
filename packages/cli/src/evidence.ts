import { shotStartFrames, type AuthoredIds, type FilmTimeline } from '@relgraph/core';
import type { DisplayList, EvidenceOverflow } from '@relgraph/render';

/**
 * Evidence cards that do not fit (ADR 004, D4). A card's layout depends on
 * its text, the frame spec and the locale, never on the frame, so one frame
 * per shot decides it: the shot's first. A shot no frame shows has no card.
 */
export interface ShotEvidenceOverflow extends Omit<EvidenceOverflow, 'id'> {
  /** Shot index, counted from 0. */
  shot: number;
  shots: number;
  /** The shot's id as the source writes it; derived storyboards may have none. */
  id?: string;
  title: string;
  /** The node's or relation's id as the source writes it. */
  target: string;
}

/** An object's id as the source writes it (`LoadResult.authoredIds`). */
export const authoredId = (
  result: { authoredIds?: AuthoredIds },
  kind: keyof AuthoredIds,
  id: string,
): string => result.authoredIds?.[kind].get(id) ?? id;

/** Compose the first frame of every shot with a card and collect the cards that do not fit. */
export function evidenceOverflows(
  timeline: FilmTimeline,
  filmFrames: number,
  displayListAt: (frame: number) => Pick<DisplayList, 'evidenceOverflow'>,
  /** The source's own id of an object (`LoadResult.authoredIds`). */
  authored: (kind: 'nodes' | 'edges' | 'scenes', id: string) => string = (_, id) => id,
): ShotEvidenceOverflow[] {
  const starts = shotStartFrames(timeline);
  return timeline.shots.flatMap((shot, index) => {
    const last = index === timeline.shots.length - 1 ? filmFrames - 1 : starts[index + 1] - 1;
    if (!shot.evidence || last < starts[index]) return [];
    const overflow = displayListAt(starts[index]).evidenceOverflow;
    if (!overflow) return [];
    const { id, ...rest } = overflow;
    return [
      {
        ...rest,
        shot: index,
        shots: timeline.shots.length,
        ...(shot.scene.id === undefined ? {} : { id: authored('scenes', shot.scene.id) }),
        title: shot.scene.title,
        target: authored(overflow.object === 'node' ? 'nodes' : 'edges', id),
      },
    ];
  });
}

/** The report as the CLI prints it; empty when every card fits. */
export function formatEvidenceOverflows(report: readonly ShotEvidenceOverflow[]): string {
  if (!report.length) return '';
  const lines = report.map(
    (entry) =>
      `  镜头 ${entry.shot + 1}/${entry.shots}「${entry.title}」：${entry.object === 'node' ? '节点' : '关系'} ${entry.target} 的证据从序号 ${entry.item} 起放不下（需要约 ${Math.ceil(entry.needed)} 像素高，卡片只有 ${Math.floor(entry.available)} 像素，按 720p 计）`,
  );
  return (
    `错误：${report.length} 张证据卡片放不下。卡片不截断原文，放不下就不画：\n` +
    lines.join('\n') +
    '\n建议：用分镜的 evidence.items 只选部分条目，或改用较短的引文；这是数据作者的编辑决定。\n'
  );
}
