import type { FrameText } from '@relgraph/render';

/**
 * Only the semantic fields displayed by the transcript participate in this
 * comparison. Renderer animation progress and DOM nodes are deliberately absent.
 */
export interface TranscriptSnapshot {
  readonly scene: Readonly<FrameText['scene']>;
  readonly detail: Readonly<NonNullable<FrameText['detail']>> | null;
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
    sameStrings(previous.nodes, current.nodes) &&
    sameStrings(previous.relations, current.relations)
  );
}

/** Snapshot semantic arrays so an in-place renderer mutation cannot hide a change. */
export function snapshotTranscriptSemantics(current: FrameText): TranscriptSnapshot {
  return {
    scene: { ...current.scene },
    detail: current.detail ? { ...current.detail } : null,
    nodes: [...current.nodes],
    relations: [...current.relations],
  };
}

/** Preserve the existing live-region wording and derive it only from a11y. */
export function liveFrameDescription(a11y: FrameText): string {
  const detail = a11y.detail ? a11y.detail.label + '：' + a11y.detail.summary : '';
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
