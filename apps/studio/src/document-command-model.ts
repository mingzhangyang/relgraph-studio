export type DocumentCommand = 'undo' | 'redo' | 'save';

export interface DocumentShortcut {
  key?: string;
  code?: string;
  ctrlKey?: boolean;
  metaKey?: boolean;
  altKey?: boolean;
  shiftKey?: boolean;
  isComposing?: boolean;
  defaultPrevented?: boolean;
  repeat?: boolean;
}

/**
 * Pure shortcut policy. Browser/editor adapters decide whether the event
 * originated in editable content. Never hijack the browser's text-field undo.
 */
export function documentCommandFromShortcut(
  event: DocumentShortcut,
  editingField: boolean,
): DocumentCommand | null {
  if (
    event.defaultPrevented ||
    event.isComposing ||
    event.repeat ||
    event.altKey ||
    !(event.ctrlKey || event.metaKey)
  )
    return null;
  const key = (event.key ?? event.code?.replace(/^Key/, '') ?? '').toLowerCase();
  if (key === 's' && !event.shiftKey) return 'save';
  if (editingField) return null;
  if (key === 'z') return event.shiftKey ? 'redo' : 'undo';
  if (key === 'y' && !event.shiftKey) return 'redo';
  return null;
}
