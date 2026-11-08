import type { FrameText } from '@relgraph/render';
import {
  liveFrameDescription,
  sameTranscriptSemantics,
  snapshotTranscriptSemantics,
  type TranscriptSnapshot,
} from './transcript-model.js';

/**
 * The DOM consumes only DisplayList.a11y: never the source graph, director
 * timeline, or reveal rules. The live region is written only for a new semantic
 * message or a shot transition, not on each animation frame.
 */
export interface TranscriptElements {
  transcript: HTMLElement;
  description: HTMLElement;
  currentShot: HTMLElement;
  nodeCount: HTMLElement;
  edgeCount: HTMLElement;
}

export interface TranscriptView {
  reset(): void;
  render(a11y: FrameText): void;
}

export function createTranscriptView(
  document: Pick<Document, 'createElement'>,
  elements: TranscriptElements,
): TranscriptView {
  let previous: TranscriptSnapshot | null = null;
  let lastLiveText: string | null = null;
  let lastLiveScene: number | null = null;

  function setText(element: HTMLElement, text: string): void {
    if (element.textContent !== text) element.textContent = text;
  }

  function addList(title: string, values: readonly string[]): void {
    const heading = document.createElement('strong');
    heading.textContent = title;
    const list = document.createElement('ul');
    for (const value of values) {
      const item = document.createElement('li');
      item.textContent = value;
      list.append(item);
    }
    elements.transcript.append(heading, list);
  }

  return {
    reset() {
      previous = null;
      lastLiveText = null;
      lastLiveScene = null;
      elements.transcript.replaceChildren();
      setText(elements.description, '没有已加载的有效数据。');
      setText(elements.currentShot, '—');
      setText(elements.nodeCount, '0');
      setText(elements.edgeCount, '0');
    },
    render(a11y) {
      const scene = a11y.scene;
      setText(elements.currentShot, scene.title + (scene.narration ? '\n' + scene.narration : ''));
      setText(elements.nodeCount, String(a11y.nodes.length));
      setText(elements.edgeCount, String(a11y.relations.length));

      if (!sameTranscriptSemantics(previous, a11y)) {
        elements.transcript.replaceChildren();
        const intro = document.createElement('p');
        intro.textContent = scene.title + '。' + scene.narration;
        elements.transcript.append(intro);
        if (a11y.detail) {
          const heading = document.createElement('strong');
          heading.textContent = '当前人物简介';
          const summary = document.createElement('p');
          summary.textContent = a11y.detail.label + '：' + a11y.detail.summary;
          elements.transcript.append(heading, summary);
        }
        addList('当前可见节点', a11y.nodes);
        addList('当前可见关系', a11y.relations);
        previous = snapshotTranscriptSemantics(a11y);
      }

      const liveText = liveFrameDescription(a11y);
      if (liveText !== lastLiveText || scene.index !== lastLiveScene) {
        // Setting textContent on role=status triggers a screen-reader
        // announcement, so never write again for an unchanged frame.
        elements.description.textContent = liveText;
        lastLiveText = liveText;
        lastLiveScene = scene.index;
      }
    },
  };
}
