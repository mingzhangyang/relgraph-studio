import type { OmittedLabel } from '@relgraph/render';
import { studioLanguage } from './i18n.js';

/**
 * Workspace-only notice of the labels the current frame could not place
 * (`DisplayList.omitted`, ADR 004 D1). It reads only the composed frame, is
 * hidden when every label fits, and is not a live region: playback must not
 * announce it on each frame. Moving a node redraws the frame, so the notice
 * follows position edits. `relgraph check-labels` reports the same omissions
 * for a whole film, counting only the frames in which a shot holds.
 */
export interface OmittedLabelsView {
  reset(): void;
  render(omitted: readonly OmittedLabel[]): void;
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
    render: (omitted) => show(omittedLabelsText(omitted, studioLanguage())),
  };
}
