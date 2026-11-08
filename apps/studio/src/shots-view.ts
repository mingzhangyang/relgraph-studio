import { formatPlaybackTime } from './playback-model.js';

/**
 * Only already-safe, presentation-neutral shot markers enter this DOM adapter.
 * The sole displayed shot title is supplied by the current DisplayList.a11y.
 * Unselected shots retain numbered placeholders, never authored future text.
 */
export interface ShotMarker {
  readonly startSec: number;
  readonly targetFrame: number;
  readonly durationSec: number;
}

export interface ShotElements {
  shots: HTMLElement;
  strip: HTMLElement;
}

export interface ShotsView {
  clear(): void;
  build(markers: readonly ShotMarker[], onSeek: (targetFrame: number) => void): void;
  render(activeIndex: number, activeTitle: string, progress: number): void;
}

export function createShotsView(
  document: Pick<Document, 'createElement'>,
  elements: ShotElements,
): ShotsView {
  let buttons: HTMLButtonElement[] = [];
  let segments: HTMLElement[] = [];
  // Render-only memoization; these are not an independent playback clock.
  let lastIndex = -1;
  let lastTitle = '';
  let lastProgress = Number.NaN;

  function clear(): void {
    elements.shots.replaceChildren();
    elements.strip.replaceChildren();
    buttons = [];
    segments = [];
    lastIndex = -1;
    lastTitle = '';
    lastProgress = Number.NaN;
  }

  return {
    clear,
    build(markers, onSeek) {
      clear();
      for (const [index, marker] of markers.entries()) {
        const button = document.createElement('button');
        button.type = 'button';
        button.className = 'shot';
        button.setAttribute('aria-label', '跳转至分镜 ' + (index + 1));

        const top = document.createElement('small');
        const number = document.createElement('span');
        number.className = 'shot-index';
        number.textContent = String(index + 1).padStart(2, '0');
        top.append(
          number,
          ' ' + formatPlaybackTime(marker.startSec) + ' · ' + marker.durationSec + 's',
        );

        const progress = document.createElement('span');
        progress.className = 'shot-progress';
        progress.setAttribute('aria-hidden', 'true');
        progress.setAttribute('style', 'transform:scaleX(0)');

        const title = document.createElement('strong');
        title.textContent = '分镜 ' + (index + 1);
        button.append(progress, top, title);
        button.addEventListener('click', () => onSeek(marker.targetFrame));
        elements.shots.append(button);
        buttons.push(button);

        const segment = document.createElement('span');
        segment.className = 'segment';
        segment.setAttribute('style', 'flex-grow:' + marker.durationSec);
        elements.strip.append(segment);
        segments.push(segment);
      }
    },
    render(activeIndex, activeTitle, progress) {
      if (activeIndex !== lastIndex || activeTitle !== lastTitle) {
        for (const [index, button] of buttons.entries()) {
          const active = index === activeIndex;
          button.className = 'shot' + (active ? ' active' : '');
          if (active) button.setAttribute('aria-current', 'step');
          else button.removeAttribute('aria-current');
          const safeTitle = active ? activeTitle : '分镜 ' + (index + 1);
          if (button.lastElementChild && button.lastElementChild.textContent !== safeTitle)
            button.lastElementChild.textContent = safeTitle;
        }
        for (const [index, segment] of segments.entries())
          segment.className =
            'segment' + (index === activeIndex ? ' active' : index < activeIndex ? ' done' : '');
      }
      // Update only affected progress elements; never recreate focused buttons.
      if (activeIndex !== lastIndex && lastIndex >= 0)
        buttons[lastIndex]?.children[0]?.setAttribute('style', 'transform:scaleX(0)');
      if (activeIndex !== lastIndex || progress !== lastProgress)
        buttons[activeIndex]?.children[0]?.setAttribute('style', 'transform:scaleX(' + progress + ')');
      lastIndex = activeIndex;
      lastTitle = activeTitle;
      lastProgress = progress;
    },
  };
}
