/**
 * A DOM-free transition policy for Studio's mutually exclusive working modes.
 *
 * The coordinator derives the current mode from its existing authoritative
 * playback clock, position-editor flag and temporary preview snapshot.
 * This model does NOT own a second mutable mode or a second playback clock.
 *
 * The plan's `next` is the intended destination: entering playback, editing
 * or preview still requires the coordinator's normal guards to succeed.
 */
export type StudioMode = 'idle' | 'playing' | 'positionEdit' | 'layoutPreview';

export type StudioModeIntent =
  | 'navigate'
  | 'theme'
  | 'play'
  | 'pause'
  | 'commitEdit'
  | 'beginPreview'
  | 'acceptPreview'
  | 'cancelPreview'
  | 'enterPositionEdit'
  | 'exitPositionEdit';

export interface StudioModePlan {
  readonly from: StudioMode;
  readonly next: StudioMode;
  readonly pausePlayback: boolean;
  readonly discardPreview: boolean;
  readonly acceptPreview: boolean;
  readonly exitPositionEdit: boolean;
}

/** The existing clock/snapshot/editor ownership determines the real mode. */
export function currentStudioMode(status: {
  readonly playing: boolean;
  readonly editing: boolean;
  readonly previewing: boolean;
}): StudioMode {
  if (status.previewing) return 'layoutPreview';
  if (status.editing) return 'positionEdit';
  return status.playing ? 'playing' : 'idle';
}

/** Decide all teardown effects exactly once before touching mutable browser state. */
export function planStudioModeTransition(
  from: StudioMode,
  intent: StudioModeIntent,
): StudioModePlan {
  let next: StudioMode;
  switch (intent) {
    case 'navigate':
      next = 'idle';
      break;
    case 'commitEdit':
      // Applying copy/style pauses playback but keeps manual position mode.
      next = from === 'positionEdit' ? 'positionEdit' : 'idle';
      break;
    case 'theme':
      // Theme changes intentionally preserve an already-playing film.
      next = from === 'playing' ? 'playing' : 'idle';
      break;
    case 'play':
      next = 'playing';
      break;
    case 'pause':
      next = from === 'playing' ? 'idle' : from;
      break;
    case 'beginPreview':
      next = 'layoutPreview';
      break;
    case 'acceptPreview':
    case 'cancelPreview':
      next = from === 'layoutPreview' ? 'idle' : from;
      break;
    case 'enterPositionEdit':
      next = 'positionEdit';
      break;
    case 'exitPositionEdit':
      next = from === 'positionEdit' ? 'idle' : from;
      break;
  }

  return {
    from,
    next,
    pausePlayback:
      intent === 'navigate' ||
      intent === 'pause' ||
      intent === 'commitEdit' ||
      intent === 'beginPreview' ||
      intent === 'enterPositionEdit' ||
      (from === 'playing' && next !== 'playing'),
    discardPreview:
      from === 'layoutPreview' &&
      intent !== 'acceptPreview' &&
      (intent === 'beginPreview' || next !== 'layoutPreview'),
    acceptPreview: from === 'layoutPreview' && intent === 'acceptPreview',
    exitPositionEdit: from === 'positionEdit' && next !== 'positionEdit',
  };
}
