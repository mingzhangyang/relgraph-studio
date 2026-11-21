import type { EvidenceCovers, EvidenceOverflow, OmittedLabel } from '@relgraph/render';
import { studioLanguage } from './i18n.js';

/**
 * Workspace-only notice of the labels the current frame could not place
 * (`DisplayList.omitted`, ADR 004 D1). It reads only the composed frame, is
 * hidden when every label fits, and is not a live region: playback must not
 * announce it on each frame. Moving a node redraws the frame, so the notice
 * follows position edits. `relgraph check-labels` reports the same omissions
 * for a whole film, counting only the frames in which a shot holds.
 *
 * It also says when the shot's evidence card does not fit and is therefore
 * not drawn (`DisplayList.evidenceOverflow`, ADR 004 D4); `relgraph render`
 * refuses such a film.
 */
export interface OmittedLabelsView {
  reset(): void;
  render(
    omitted: readonly OmittedLabel[],
    overflow?: EvidenceOverflow | null,
    covers?: EvidenceCovers | null,
  ): void;
}

/** The notice for an evidence card that does not fit, or ''. */
export function evidenceOverflowText(
  overflow: EvidenceOverflow | null | undefined,
  language: 'zh-CN' | 'en',
): string {
  if (!overflow) return '';
  return language === 'en'
    ? `The evidence card does not fit from evidence index ${overflow.item} on and is not drawn; export will refuse it. Show fewer items or a shorter quotation.`
    : `证据卡片从证据序号 ${overflow.item} 起放不下，未画出，导出时会报错；请少选几条或改用较短的引文。`;
}

/** The notice for an evidence card withheld because it would cover its own node, or ''. */
export function evidenceCoversText(
  covers: EvidenceCovers | null | undefined,
  language: 'zh-CN' | 'en',
): string {
  if (!covers) return '';
  return language === 'en'
    ? 'The evidence card would cover the node it cites and is not drawn; export will refuse it. Shorten that node’s label or use a narrower shape.'
    : '证据卡片会盖住它引证的节点，未画出，导出时会报错；请缩短该节点的标签或改用较窄的形状。';
}

/** The notice text, or '' when nothing was left out. */
export function omittedLabelsText(
  omitted: readonly OmittedLabel[],
  language: 'zh-CN' | 'en',
): string {
  if (!omitted.length) return '';
  const en = language === 'en';
  const names = omitted
    .map((label) =>
      label.kind === 'edge-label'
        ? en
          ? `relation “${label.text}”`
          : `关系「${label.text}」`
        : label.text,
    )
    .join(en ? ', ' : '、');
  return en
    ? `${omitted.length === 1 ? '1 label does' : `${omitted.length} labels do`} not fit in this frame and ${omitted.length === 1 ? 'is' : 'are'} not drawn: ${names}`
    : `本帧有 ${omitted.length} 个标签放不下，未画出：${names}`;
}

export function createOmittedLabelsView(element: HTMLElement): OmittedLabelsView {
  const show = (text: string): void => {
    if (element.textContent !== text) element.textContent = text;
    const hidden = text === '';
    if (element.hidden !== hidden) element.hidden = hidden;
  };
  return {
    reset: () => show(''),
    render: (omitted, overflow, covers) => {
      const language = studioLanguage();
      show(
        [
          evidenceOverflowText(overflow, language),
          evidenceCoversText(covers, language),
          omittedLabelsText(omitted, language),
        ]
          .filter(Boolean)
          .join(' '),
      );
    },
  };
}
