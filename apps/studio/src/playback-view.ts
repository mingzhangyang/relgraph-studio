import { uiText } from './i18n.js';
import type { PlaybackDisplay, PlaybackState } from './playback-model.js';

/**
 * DOM-only playback presentation. Timing, frame selection and seek rules belong
 * to playback-model.ts; RAF scheduling and loading belong to the workspace.
 */
export type WorkspaceStatus = 'playing' | 'ready' | 'loading' | 'error';

export interface PlaybackControls {
  play: HTMLButtonElement;
  restart: HTMLButtonElement;
  scrubber: HTMLInputElement;
  status: HTMLElement;
  frameNumber: HTMLElement;
  time: HTMLElement;
}

export function renderPlaybackStatus(
  controls: PlaybackControls,
  text: string,
  state: WorkspaceStatus,
): void {
  controls.status.textContent = uiText(text);
  controls.status.setAttribute('data-state', state);
}

export function renderPlaybackControls(
  controls: PlaybackControls,
  playback: Pick<PlaybackState, 'playing'>,
  available: boolean,
  loading: boolean,
): void {
  controls.play.textContent = playback.playing ? '❚❚' : '▶';
  controls.play.setAttribute('aria-label', uiText(playback.playing ? '暂停' : '播放'));
  controls.play.className = 'icon-button play' + (playback.playing ? ' is-playing' : '');
  if (playback.playing) renderPlaybackStatus(controls, '播放中', 'playing');
  else if (available && !loading) renderPlaybackStatus(controls, '就绪', 'ready');
}

/** The model has already formatted all frame and clock values. */
export function renderPlaybackFrame(controls: PlaybackControls, display: PlaybackDisplay): void {
  controls.scrubber.value = display.frameValue;
  controls.scrubber.setAttribute('style', '--fill:' + display.fillPercent + '%');
  controls.scrubber.setAttribute('aria-valuetext', display.ariaValueText.replace('，分镜 ', uiText('，分镜 ')));
  controls.frameNumber.textContent = display.frameLabel;
  controls.time.textContent = display.timeLabel;
}

export function disablePlaybackView(controls: PlaybackControls): void {
  controls.play.disabled = true;
  controls.restart.disabled = true;
  controls.scrubber.disabled = true;
}

export function enablePlaybackView(controls: PlaybackControls, totalFrames: number): void {
  controls.scrubber.max = String(totalFrames - 1);
  controls.scrubber.disabled = false;
  controls.play.disabled = false;
  controls.restart.disabled = false;
}

export function resetPlaybackView(controls: PlaybackControls): void {
  disablePlaybackView(controls);
  controls.scrubber.max = '0';
  controls.scrubber.value = '0';
  controls.scrubber.setAttribute('style', '--fill:0%');
  controls.time.textContent = '00:00.00 / 00:00.00';
  controls.frameNumber.textContent = 'FRAME 0';
}
