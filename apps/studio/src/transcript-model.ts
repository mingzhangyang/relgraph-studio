import type { FrameText } from '@relgraph/render';

/**
 * Only the semantic fields displayed by the transcript participate in this
 * comparison. Renderer animation progress and DOM nodes are deliberately absent.
 */
export interface TranscriptSnapshot {
  readonly scene: Readonly<FrameText['scene']>;
  readonly detail: Readonly<NonNullable<FrameText['detail']>> | null;
  /** The evidence card's subject and items, as text (`evidenceLines`). */
  readonly evidence: readonly string[];
  readonly nodes: readonly string[];
  readonly relations: readonly string[];
}

function sameStrings(a: readonly string[], b: readonly string[]): boolean {
  return a.length === b.length && a.every((value, index) => value === b[index]);
}

export function sameTranscriptSemantics(
  previous: TranscriptSnapshot | null,
  current: FrameText,
): boolean {
  if (!previous) return false;
  const a = previous.scene;
  const b = current.scene;
  const detail = previous.detail;
  const nextDetail = current.detail;
  return (
    a.index === b.index &&
    a.count === b.count &&
    a.title === b.title &&
    a.narration === b.narration &&
    (detail === null
      ? nextDetail === null
      : nextDetail !== null &&
        detail.label === nextDetail.label &&
        detail.summary === nextDetail.summary) &&
    sameStrings(previous.evidence, evidenceLines(current.evidence, 'zh-CN')) &&
    sameStrings(previous.nodes, current.nodes) &&
    sameStrings(previous.relations, current.relations)
  );
}

/** Snapshot semantic arrays so an in-place renderer mutation cannot hide a change. */
export function snapshotTranscriptSemantics(current: FrameText): TranscriptSnapshot {
  return {
    scene: { ...current.scene },
    detail: current.detail ? { ...current.detail } : null,
    evidence: evidenceLines(current.evidence, 'zh-CN'),
    nodes: [...current.nodes],
    relations: [...current.relations],
  };
}

/**
 * An evidence card in words: its subject, then each item as written, a
 * quotation followed by its citation (ADR 004, D4). Empty without a card.
 */
export function evidenceLines(evidence: FrameText['evidence'], language: 'zh-CN' | 'en'): string[] {
  if (!evidence) return [];
  const en = language === 'en';
  return [
    evidence.subject,
    ...evidence.items.map((item) => {
      const cite = [item.cite, item.locator].filter(Boolean).join(' · ');
      const quote = item.quote ? (en ? `“${item.quote}”` : `「${item.quote}」`) : '';
      return quote && cite ? `${quote}${en ? ' — ' : '——'}${cite}` : quote || cite;
    }),
  ];
}

/** Preserve the existing live-region wording and derive it only from a11y. */
export function liveFrameDescription(a11y: FrameText): string {
  const evidence = evidenceLines(a11y.evidence, 'zh-CN');
  const detail =
    (a11y.detail ? a11y.detail.label + '：' + a11y.detail.summary : '') +
    (evidence.length ? '证据：' + evidence.join('；') : '');
  return (
    a11y.scene.title +
    '。' +
    a11y.scene.narration +
    ' 当前 ' +
    a11y.nodes.length +
    ' 个节点，' +
    a11y.relations.length +
    ' 条关系。' +
    detail
  );
}
