import { normalizeNodeImage } from '../../apps/studio/src/node-image.ts';
import { setNodeImage } from '../../apps/studio/src/project-editor-model.ts';
import {
  configWithLayoutPositions,
  dragHasChanges,
  cancelPositionDrag,
} from '../../apps/studio/src/layout-history-model.ts';
import {
  computeLayout,
  DEFAULT_LAYOUT_SETTINGS,
} from '../../packages/core/src/director/layout-strategies.ts';
import { createLayoutStrategyView } from '../../apps/studio/src/layout-strategy-view.ts';
import { ProjectHistory } from '../../apps/studio/src/project-editor-model.ts';
import { createProjectEditor } from '../../apps/studio/src/project-editor-view.ts';
import {
  createProject,
  projectSource,
  validateProjectConfig,
} from '../../packages/core/src/project.ts';
import { readFileSync } from 'node:fs';
import { transpileModule, ModuleKind, ScriptTarget } from 'typescript';
import { FILM_FONT_FACES, filmFontQuery } from '../../packages/render/src/fonts.ts';
import {
  editableNodes,
  layoutHasChanges,
  parseCoordinateInputs,
  positionForDrag,
  restoreLayoutPositions,
  startPositionDrag,
  updateEditableNodePosition,
} from '../../apps/studio/src/layout-editor-model.ts';
import {
  renderEditorAvailability,
  renderEditorFields,
  renderEditorMessage,
  renderEditorMode,
  renderEditorNodes,
  renderEditorSelection,
  renderEditorStatus,
} from '../../apps/studio/src/layout-editor-view.ts';

import {
  advancePlayback,
  createPlaybackState,
  formatPlaybackTime,
  playbackDisplay,
  seekPlayback,
  setPlaybackRunning,
  shotMarkers,
} from '../../apps/studio/src/playback-model.ts';
import {
  disablePlaybackView,
  enablePlaybackView,
  renderPlaybackControls,
  renderPlaybackFrame,
  renderPlaybackStatus,
  resetPlaybackView,
} from '../../apps/studio/src/playback-view.ts';
import { createShotsView } from '../../apps/studio/src/shots-view.ts';
import { createDiagnosticsView } from '../../apps/studio/src/diagnostics-view.ts';
import { createTranscriptView } from '../../apps/studio/src/transcript-view.ts';
import { createWorkspaceShellView } from '../../apps/studio/src/workspace-shell-view.ts';

// VM tests exercise the actual TypeScript workspace against a minimal simulated DOM.
// The imported dependencies are supplied explicitly by each harness.
export function studioSource() {
  const source = readFileSync(new URL('../../apps/studio/src/studio.ts', import.meta.url), 'utf8');
  return transpileModule(source, {
    compilerOptions: { module: ModuleKind.ESNext, target: ScriptTarget.ES2022 },
  })
    .outputText.replace(/^import .*;\n/gm, '')
    .replace(/^export \{\};?\n/gm, '');
}

// Workspace dependency functions and views are supplied to the source VM as-is;
// only Canvas drawing, network, animation and browser storage are stubbed.
export const studioImports = {
  normalizeNodeImage,
  setNodeImage,
  configWithLayoutPositions,
  dragHasChanges,
  cancelPositionDrag,
  computeLayout,
  DEFAULT_LAYOUT_SETTINGS,
  createLayoutStrategyView,
  ProjectHistory,
  createProjectEditor,
  createProject,
  projectSource,
  validateProjectConfig,
  FILM_FONT_FACES,
  filmFontQuery,
  editableNodes,
  layoutHasChanges,
  parseCoordinateInputs,
  positionForDrag,
  restoreLayoutPositions,
  startPositionDrag,
  updateEditableNodePosition,
  renderEditorAvailability,
  renderEditorFields,
  renderEditorMessage,
  renderEditorMode,
  renderEditorNodes,
  renderEditorSelection,
  renderEditorStatus,
  advancePlayback,
  createPlaybackState,
  formatPlaybackTime,
  playbackDisplay,
  seekPlayback,
  setPlaybackRunning,
  shotMarkers,
  disablePlaybackView,
  enablePlaybackView,
  renderPlaybackControls,
  renderPlaybackFrame,
  renderPlaybackStatus,
  resetPlaybackView,
  createShotsView,
  createDiagnosticsView,
  createTranscriptView,
  createWorkspaceShellView,
};
