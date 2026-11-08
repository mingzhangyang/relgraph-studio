/** Pure playback clock for the director workspace.
 *
 * The renderer owns frame evaluation, and the workspace owns scheduling and DOM.
 * This model only decides which frame to show and whether playback continues.
 * Video-frame time is intentionally independent of authored domain time.
 */
export interface PlaybackState {
  readonly fps: number;
  readonly totalFrames: number;
  readonly frame: number;
  /** Fractional frame position; retained across repaints during playback. */
  readonly position: number;
  readonly playing: boolean;
  readonly lastTickMs: number | null;
}

export function createPlaybackState(totalFrames = 1, fps = 24): PlaybackState {
  if (!Number.isSafeInteger(totalFrames) || totalFrames < 1)
    throw new RangeError('totalFrames must be a positive safe integer');
  if (!Number.isFinite(fps) || fps <= 0) throw new RangeError('fps must be positive');
  return { fps, totalFrames, frame: 0, position: 0, playing: false, lastTickMs: null };
}

/** A play/pause transition always starts a fresh clock from the drawn frame. */
export function setPlaybackRunning(
  state: PlaybackState,
  requested: boolean,
  available: boolean,
): PlaybackState {
  return {
    ...state,
    playing: Boolean(requested && available),
    position: state.frame,
    lastTickMs: null,
  };
}

/** Preserve the fractional position only for a repaint, never for user seeking. */
export function seekPlayback(
  state: PlaybackState,
  requestedFrame: number,
  preservePosition = false,
): PlaybackState {
  if (!Number.isFinite(requestedFrame)) return state;
  const frame = Math.max(0, Math.min(state.totalFrames - 1, Math.floor(requestedFrame)));
  return {
    ...state,
    frame,
    position: preservePosition ? state.position : frame,
  };
}

/**
 * Time progression is independent of requestAnimationFrame and wall clocks.
 * The first tick establishes the baseline (zero elapsed time), as in the
 * original workspace. Repeated/regressing timestamps cannot rewind frames.
 */
export function advancePlayback(state: PlaybackState, nowMs: number): PlaybackState {
  if (!state.playing || !Number.isFinite(nowMs)) return state;
  // A regressing (or duplicate) RAF timestamp must not reset the baseline.
  // Otherwise a later forward tick will replay time already consumed.
  if (state.lastTickMs !== null && nowMs <= state.lastTickMs) return state;
  const elapsedMs = state.lastTickMs === null ? 0 : nowMs - state.lastTickMs;
  const advancedFrames = (elapsedMs * state.fps) / 1000;
  const position = Math.min(state.totalFrames - 1, state.position + advancedFrames);
  const playing = position < state.totalFrames - 1;
  return {
    ...state,
    position,
    frame: Math.floor(position),
    playing,
    lastTickMs: playing ? nowMs : null,
  };
}

/** UI-only shot markers; the compiled director timeline remains authoritative. */
export function shotMarkers(
  scenes: readonly { durationSec: number }[],
  totalFrames: number,
  fps: number,
): ReadonlyArray<{ startSec: number; targetFrame: number; durationSec: number }> {
  let startSec = 0;
  return scenes.map((scene) => {
    // Small epsilon maintains the pre-refactor fractional boundary behavior.
    const marker = {
      startSec,
      targetFrame: Math.max(0, Math.min(totalFrames - 1, Math.ceil(startSec * fps - 1e-9))),
      durationSec: scene.durationSec,
    };
    startSec += scene.durationSec;
    return marker;
  });
}

/** Pure display fields derived from the existing playback clock and scene. */
export interface PlaybackDisplay {
  readonly frameValue: string;
  readonly fillPercent: number;
  readonly ariaValueText: string;
  readonly frameLabel: string;
  readonly timeLabel: string;
}

export function playbackDisplay(
  state: Pick<PlaybackState, 'frame' | 'fps' | 'totalFrames'>,
  sceneIndex: number,
  totalSec: number,
): PlaybackDisplay {
  const positionSec = state.frame / state.fps;
  return {
    frameValue: String(state.frame),
    fillPercent: state.totalFrames > 1 ? (state.frame / (state.totalFrames - 1)) * 100 : 0,
    ariaValueText: formatPlaybackTime(positionSec) + '，分镜 ' + (sceneIndex + 1),
    frameLabel: 'FRAME ' + state.frame,
    timeLabel: formatPlaybackTime(positionSec) + ' / ' + formatPlaybackTime(totalSec),
  };
}

export function formatPlaybackTime(seconds: number): string {
  const t = Math.max(0, seconds);
  const minutes = Math.floor(t / 60);
  const s = (t % 60).toFixed(2).padStart(5, '0');
  return `${String(minutes).padStart(2, '0')}:${s}`;
}
