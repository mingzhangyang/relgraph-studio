import { uiStatus } from './i18n.js';
import type { DocumentCommand } from './document-command-model.js';

export interface DocumentToolbarControls {
  undo: HTMLButtonElement;
  redo: HTMLButtonElement;
  save: HTMLButtonElement;
  exportSource: HTMLButtonElement;
  message: HTMLElement;
}
export interface DocumentToolbarActions {
  undo(): void;
  redo(): void;
  save(): void;
  exportSource(): void;
}
export interface DocumentToolbarState {
  loaded: boolean;
  canUndo: boolean;
  canRedo: boolean;
}

/**
 * One DOM-only home for document actions. A disabled button and a keyboard
 * shortcut go through the same availability checks and controller callback.
 */
export function createDocumentToolbarView(
  controls: DocumentToolbarControls,
  actions: DocumentToolbarActions,
) {
  let lastMessage: { value: string; failed: boolean } | null = null;
  const buttons = {
    undo: controls.undo,
    redo: controls.redo,
    save: controls.save,
    exportSource: controls.exportSource,
  } as const;

  const run = (command: DocumentCommand | 'exportSource'): boolean => {
    if (buttons[command].disabled) return false;
    actions[command]();
    return true;
  };

  for (const command of ['undo', 'redo', 'save', 'exportSource'] as const)
    buttons[command].addEventListener('click', () => {
      run(command);
    });

  return {
    render(state: DocumentToolbarState): void {
      controls.undo.disabled = !state.loaded || !state.canUndo;
      controls.redo.disabled = !state.loaded || !state.canRedo;
      controls.save.disabled = !state.loaded;
      controls.exportSource.disabled = !state.loaded;
    },
    run,
    enabled(command: DocumentCommand): boolean {
      return !buttons[command].disabled;
    },
    message(value: string, failed = false): void {
      lastMessage = { value, failed };
      const localized = uiStatus(value);
      if (controls.message.textContent !== localized) controls.message.textContent = localized;
      controls.message.setAttribute('data-error', String(failed));
    },
    refreshLanguage(): void {
      if (lastMessage) {
        const localized = uiStatus(lastMessage.value);
        if (controls.message.textContent !== localized) controls.message.textContent = localized;
        controls.message.setAttribute('data-error', String(lastMessage.failed));
      }
    },
  };
}
