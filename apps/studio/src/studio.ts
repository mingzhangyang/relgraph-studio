import {
  captureStaticStudioUi,
  initializeStudioLanguage,
  refreshStudioUi,
  setStudioLanguage,
  studioLanguage,
  uiText,
  type StudioLanguage,
} from './i18n.js';
import { normalizeNodeImage } from './node-image.js';
import { setNodeImage } from './project-editor-model.js';
import {
  configWithLayoutPositions,
  dragHasChanges,
  cancelPositionDrag,
} from './layout-history-model.js';
import {
  DEFAULT_LAYOUT_SETTINGS,
  displayNodeText,
  planLayout,
  type LayoutSettings,
  type LayoutType,
} from '@relgraph/core';
import {
  blockedLayoutMessage,
  blockedResetMessage,
  createLayoutStrategyView,
  unchangedLayoutMessage,
} from './layout-strategy-view.js';
import {
  currentStudioMode,
  planStudioModeTransition,
  type StudioModeIntent,
} from './studio-mode-model.js';
import {
  createProject,
  projectSource,
  validateProjectConfig,
  type ProjectConfig,
} from '@relgraph/core';
import { ProjectHistory } from './project-editor-model.js';
import { ProjectSavepoint } from './unsaved-changes-model.js';
import { createProjectEditor } from './project-editor-view.js';
import { createDocumentToolbarView } from './document-toolbar-view.js';
import { documentCommandFromShortcut } from './document-command-model.js';
import { parseDocument, applyGraphPositions, type LoadResult } from '@relgraph/core';
import {
  anchoredPoint,
  anchorToTime,
  declaresTimeAxis,
  layoutGraph,
  offTime,
  placeInTime,
  styleForGraph,
  timeAnchor,
} from '@relgraph/core';
import { frameCount } from '@relgraph/core';
import type { Bio } from '@relgraph/core';
import type { DirectorFrameState, VisualGraph } from '@relgraph/core';
import {
  createCanvasRenderer,
  FILM_FONT_FACES,
  filmFontQuery,
  type CanvasRenderer,
} from '@relgraph/render';
import { canvasPoint } from './position-tool.js';
import {
  editableNodes,
  layoutHasChanges,
  parseCoordinateInputs,
  positionForDrag,
  restoreLayoutPositions,
  startPositionDrag,
  updateEditableNodePosition,
  type PositionDrag,
} from './layout-editor-model.js';
import {
  renderEditorAvailability,
  renderEditorFields,
  renderEditorMessage,
  renderEditorMode,
  renderEditorNodes,
  renderEditorSelection,
  renderEditorStatus,
  refreshEditorFieldText,
} from './layout-editor-view.js';
import {
  advancePlayback,
  createPlaybackState,
  playbackDisplay,
  seekPlayback,
  setPlaybackRunning,
  shotMarkers,
} from './playback-model.js';
import {
  disablePlaybackView,
  enablePlaybackView,
  renderPlaybackControls,
  renderPlaybackFrame,
  renderPlaybackStatus,
  resetPlaybackView,
  type WorkspaceStatus,
} from './playback-view.js';
import { createShotsView } from './shots-view.js';
import { createDiagnosticsView } from './diagnostics-view.js';
import { createTranscriptView } from './transcript-view.js';
import { createWorkspaceShellView } from './workspace-shell-view.js';
import { projectSelectionOverlay } from './selection-overlay-model.js';
import { createSelectionOverlayView } from './selection-overlay-view.js';
import type { DisplayList } from '@relgraph/render';

declare global {
  interface Window {
    renderAt(frame: number): boolean;
    studioFrame(): DirectorFrameState | null;
  }
}

type Theme = 'dark' | 'light';
type DetailAt = (id: string, at: number | null) => Bio | undefined;

// Fail immediately with the missing ID rather than producing a partial workspace.
function requiredElement<T extends HTMLElement>(id: string, elementType: { new (): T }): T {
  const element = document.getElementById(id);
  if (!(element instanceof elementType))
    throw new Error(`Missing or invalid workspace element: #${id}`);
  return element;
}

const FPS = 24;
let languageStorage: Storage | undefined;
try {
  languageStorage = globalThis.localStorage;
} catch {
  // Browser storage can be unavailable under privacy restrictions.
}
initializeStudioLanguage(languageStorage);
captureStaticStudioUi(document);
refreshStudioUi(document);
const $ = (id: string): HTMLElement => requiredElement(id, HTMLElement);
const canvas = requiredElement('stage', HTMLCanvasElement),
  play = requiredElement('play', HTMLButtonElement),
  restart = requiredElement('restart', HTMLButtonElement),
  scrubber = requiredElement('scrubber', HTMLInputElement),
  fileInput = requiredElement('fileInput', HTMLInputElement),
  exampleLiterature = requiredElement('exampleLiterature', HTMLButtonElement),
  exampleBiology = requiredElement('exampleBiology', HTMLButtonElement),
  // Generic-graph examples: any relations, and the diagram kinds drawn from them.
  gallery = Object.fromEntries(
    (
      [
        ['exampleGraph', 'bookshop-systems-synthetic', '线上书店 · 通用关系合成示例'],
        ['exampleTree', 'vertebrates-tree-provisional', '进化树 · 逐层展开的简化示例'],
        ['exampleTimeline', 'dynasties-timeline-provisional', '朝代更替 · 时间轴简化示例'],
        ['exampleMindmap', 'reading-club-mindmap-synthetic', '读书会 · 思维导图合成示例'],
        ['exampleFlowchart', 'order-flowchart-synthetic', '订单流程 · 流程图合成示例'],
      ] as const
    ).map(([id, file, name]) => [
      id,
      { button: requiredElement(id, HTMLButtonElement), file, name },
    ]),
  ),
  themeToggle = requiredElement('themeToggle', HTMLButtonElement),
  languageSelect = requiredElement('languageSelect', HTMLSelectElement),
  layoutToggle = requiredElement('layoutToggle', HTMLButtonElement),
  layoutReset = requiredElement('layoutReset', HTMLButtonElement),
  layoutExport = requiredElement('layoutExport', HTMLButtonElement),
  layoutEditor = $('layoutEditor'),
  layoutNode = requiredElement('layoutNode', HTMLSelectElement),
  layoutX = requiredElement('layoutX', HTMLInputElement),
  layoutY = requiredElement('layoutY', HTMLInputElement),
  layoutApply = requiredElement('layoutApply', HTMLButtonElement),
  dropzone = requiredElement('dropzone', HTMLLabelElement),
  saveState = $('saveState'),
  shots = $('shots'),
  strip = $('sceneStrip');
languageSelect.value = studioLanguage();
const selectionSvg = document.getElementById('stageSelection');
if (!selectionSvg) throw new Error('Missing workspace element: #stageSelection');
const selectionOverlayView = createSelectionOverlayView(
  document,
  selectionSvg as unknown as SVGSVGElement,
  $('selectionFeedback'),
);
const playbackControls = {
  play,
  restart,
  scrubber,
  status: $('status'),
  frameNumber: $('frameNumber'),
  time: $('time'),
};
const shotsView = createShotsView(document, { shots, strip });
const diagnosticsView = createDiagnosticsView(document, {
  errors: $('errors'),
  warnings: $('warnings'),
  count: $('diagCount'),
});
const transcriptView = createTranscriptView(document, {
  transcript: $('transcript'),
  description: $('sceneDescription'),
  currentShot: $('currentShot'),
  nodeCount: $('nodeCount'),
  edgeCount: $('edgeCount'),
});
const shellView = createWorkspaceShellView(document, {
  canvas,
  domainTime: $('domainTime'),
  sceneCount: $('sceneCount'),
  sourceName: $('sourceName'),
  sourceNote: $('sourceNote'),
  exampleLiterature,
  exampleBiology,
  gallery: Object.fromEntries(Object.entries(gallery).map(([id, entry]) => [id, entry.button])),
  themeToggle,
  dropzone,
});
let layoutPreview: {
  settings: LayoutSettings;
  before: Map<string, { x: number; y: number }>;
  serial: number;
} | null = null;
function discardLayoutPreview(): void {
  if (!layoutPreview) return;
  if (currentLayout) {
    restoreLayoutPositions(currentLayout, layoutPreview.before);
    projectSavepoint.positionsChanged();
  }
  layoutPreview = null;
  rebuildRenderer();
  refreshUnsavedState();
}
/**
 * The single coordinator for working-mode changes. Live state is derived from
 * existing owners, never duplicated in another mutable mode variable.
 */
function transitionStudio(intent: StudioModeIntent): void {
  const plan = planStudioModeTransition(
    currentStudioMode({
      playing: playback.playing,
      editing: layoutEditing,
      previewing: layoutPreview !== null,
    }),
    intent,
  );
  if (plan.discardPreview) discardLayoutPreview();
  if (plan.exitPositionEdit) leavePositionEdit();
  if (plan.pausePlayback) setPlaying(false);
  if (plan.acceptPreview) {
    // Keep the previewed coordinates; only application writes them to history.
    layoutPreview = null;
    refreshUnsavedState();
  }
  if (intent === 'enterPositionEdit' && renderer && currentFrameState && currentLayout) {
    // Preview rollback may change the camera, so freeze it afterwards.
    editCamera = { ...currentFrameState.cameraResolved };
    layoutEditing = true;
    rebuildRenderer();
    updateLayoutEditor();
    updateLayoutControls();
    refreshSelectionFeedback();
  }
  if (intent === 'play') {
    if (!playback.playing && playback.frame >= playback.totalFrames - 1) setFrame(0);
    setPlaying(true);
  }
}
function configWithPositions(
  settings: LayoutSettings = projectHistory.value.layout ?? DEFAULT_LAYOUT_SETTINGS,
  editedIds?: readonly string[],
) {
  return configWithLayoutPositions(
    projectHistory.value,
    currentLayout ?? new Map(),
    settings,
    editedIds,
  );
}
function applyProjectHistory({
  preserveLayoutDraft = false,
}: { preserveLayoutDraft?: boolean } = {}): void {
  if (!graph || !currentLayout || !originalLayout) return;
  // History replay, config changes and asynchronous image edits must invalidate
  // an in-flight pointer transaction before they replace its underlying layout.
  // Otherwise the late pointerup could commit stale coordinates over undo/redo.
  cancelActiveLayoutDrag();
  graph.project = projectHistory.value;
  restoreLayoutPositions(currentLayout, originalLayout);
  for (const [id, p] of Object.entries(graph.project.layout?.positions ?? {}))
    currentLayout.set(id, { ...p });
  // While the drawing is a timeline, every bar stays at its years.
  anchorToTime(graph, currentLayout);
  reconcileCommittedCoordinateDrafts();
  projectSavepoint.positionsChanged();
  // Lock-only commits update persisted coordinates/locks, not the user's pending
  // strategy inputs. Undo/redo, apply and other config transitions still reset.
  if (!preserveLayoutDraft) strategyView.reset(graph.project.layout);
  rebuildRenderer();
  updateLayoutFields();
  updateLayoutControls();
}
/** A node as the workspace names it: its display label, else its own. */
function nodeName(id: string): string {
  const node = graph?.nodes.find((n) => n.id === id);
  return displayNodeText(graph?.project, id)?.label ?? node?.label ?? id;
}
const strategyView = createLayoutStrategyView(document, $('layoutStrategyEditor'), {
  draftChanged() {
    refreshUnsavedState();
  },
  preview(settings) {
    if (!graph || !currentLayout || loading) return;
    transitionStudio('beginPreview');
    try {
      const before = new Map([...currentLayout].map(([id, p]) => [id, { ...p }]));
      const plan = planLayout(graph, settings, currentLayout);
      // A lock is never moved, and the time axis would have to move these.
      if (plan.blocked.length) {
        strategyView.error(blockedLayoutMessage(plan.blocked.map(nodeName)));
        return;
      }
      // A preview that changes nothing would look pending and enable Apply.
      // Putting the drawing on the time axis, or taking it off, is a change
      // even when no coordinate moves.
      if (!plan.moved && !plan.anchorChanged) {
        strategyView.unchanged(unchangedLayoutMessage(settings));
        refreshUnsavedState();
        return;
      }
      layoutPreview = { settings, before, serial: requestSerial };
      restoreLayoutPositions(currentLayout, plan.positions);
      projectSavepoint.positionsChanged();
      rebuildRenderer();
      refreshUnsavedState();
      strategyView.outcome(plan);
    } catch (error) {
      strategyView.error(error instanceof Error ? error.message : String(error));
    }
  },
  apply() {
    if (!graph || !layoutPreview || loading || layoutPreview.serial !== requestSerial) return;
    const next = configWithPositions(layoutPreview.settings);
    transitionStudio('acceptPreview');
    projectHistory.commit(next);
    applyProjectHistory();
  },
  cancel() {
    transitionStudio('cancelPreview');
  },
  lock(id, locked) {
    if (!graph || !currentFrameState?.view.nodes.some((n) => n.id === id) || loading) return;
    transitionStudio('cancelPreview');
    const settings = projectHistory.value.layout ?? DEFAULT_LAYOUT_SETTINGS;
    const ids = new Set(settings.locked);
    if (locked) ids.add(id);
    else ids.delete(id);
    projectHistory.commit(configWithPositions({ ...settings, locked: [...ids].sort() }, [id]));
    applyProjectHistory({ preserveLayoutDraft: true });
  },
});
let imageUploadSerial = 0;
const projectHistory = new ProjectHistory();
const projectSavepoint = new ProjectSavepoint();
const projectActions: Parameters<typeof createProjectEditor>[2] & {
  undo(): void;
  redo(): void;
  save(): void;
} = {
  selectionChanged() {
    refreshSelectionFeedback();
  },
  change(config: ProjectConfig) {
    if (!graph || loading) return false;
    ++imageUploadSerial;
    projectEditor.imageBusy(false);
    const errors = validateProjectConfig(config, graph);
    if (errors.length) {
      projectEditor.error('配置无效：' + errors.join('；'));
      return false;
    }
    transitionStudio('commitEdit');
    projectEditor.error('');
    projectHistory.commit(config);
    applyProjectHistory();
    return true;
  },
  undo() {
    ++imageUploadSerial;
    projectEditor.imageBusy(false);
    if (graph) {
      transitionStudio('cancelPreview');
      projectHistory.undo();
      applyProjectHistory();
    }
  },
  redo() {
    ++imageUploadSerial;
    projectEditor.imageBusy(false);
    if (graph) {
      transitionStudio('cancelPreview');
      projectHistory.redo();
      applyProjectHistory();
    }
  },
  pause() {
    transitionStudio('pause');
  },
  draftChanged() {
    refreshUnsavedState();
  },
  async uploadImage(file: File, nodeId: string) {
    if (!graph || loading || !currentFrameState?.view.nodes.some((n) => n.id === nodeId)) return;
    const serial = ++imageUploadSerial,
      documentSerial = requestSerial,
      selectionRevision = projectEditor.selectionRevision(),
      owner = graph;
    transitionStudio('pause');
    projectEditor.error('');
    projectEditor.imageBusy(true);
    const current = () =>
      serial === imageUploadSerial &&
      documentSerial === requestSerial &&
      graph === owner &&
      !loading &&
      projectEditor.selectedNodeId() === nodeId &&
      projectEditor.selectionRevision() === selectionRevision &&
      currentFrameState?.view.nodes.some((n) => n.id === nodeId);
    try {
      const { id, asset } = await normalizeNodeImage(file);
      if (!current()) return;
      const node = currentFrameState!.view.nodes.find((n) => n.id === nodeId)!;
      const config = setNodeImage(projectHistory.value, node, id, asset),
        errors = validateProjectConfig(config, owner);
      if (errors.length) throw new Error('图片配置超出容量或包含无效字段：' + errors.join('；'));
      transitionStudio('cancelPreview');
      projectHistory.commit(config);
      applyProjectHistory();
    } catch (error) {
      if (current()) projectEditor.error(error instanceof Error ? error.message : String(error));
    } finally {
      if (serial === imageUploadSerial) projectEditor.imageBusy(false);
    }
  },
  save() {
    if (!graph || !currentLayout || sourceDocument === null || loading) return;
    if (
      dragging ||
      hasPendingCoordinateDraft() ||
      projectEditor.hasPendingDraft() ||
      strategyView.hasPendingDraft() ||
      projectEditor.isImageBusy()
    ) {
      const message = '仍有未提交的输入、拖动或图片处理，请完成后再保存项目。';
      projectEditor.error(message);
      documentToolbarView.message(message, true);
      refreshUnsavedState();
      return;
    }
    transitionStudio('cancelPreview');
    const config = {
      ...projectHistory.value,
      layout: {
        ...DEFAULT_LAYOUT_SETTINGS,
        locked: [],
        ...projectHistory.value.layout,
        positions: Object.fromEntries(currentLayout),
      },
    };
    const errors = validateProjectConfig(config, graph);
    if (errors.length) {
      const message = '保存失败：' + errors.join('；');
      projectEditor.error(message);
      documentToolbarView.message(message, true);
      return;
    }
    try {
      downloadJson(
        createProject(sourceDocument, config),
        sourceFilename.replace(/\.json$/i, '') + '.studio.json',
      );
      // Browsers can initiate downloads, but cannot verify the file was kept.
      projectSavepoint.markClean(projectHistory.value, currentLayout);
      const message = '已发起完整项目 JSON 下载，请确认浏览器已将文件保存到本机。';
      projectEditor.error(message);
      documentToolbarView.message(message);
      refreshUnsavedState();
    } catch (error) {
      const message = '保存失败：' + (error instanceof Error ? error.message : String(error));
      projectEditor.error(message);
      documentToolbarView.message(message, true);
    }
  },
};
const projectEditor = createProjectEditor(document, $('appearanceEditor'), projectActions);
const documentToolbarView = createDocumentToolbarView(
  {
    undo: requiredElement('visualUndo', HTMLButtonElement),
    redo: requiredElement('visualRedo', HTMLButtonElement),
    save: requiredElement('visualSave', HTMLButtonElement),
    exportSource: layoutExport,
    message: $('documentActionStatus'),
  },
  {
    undo: () => projectActions.undo(),
    redo: () => projectActions.redo(),
    save: () => projectActions.save(),
    exportSource: exportPositionedSource,
  },
);
const layoutControls = {
  canvas,
  toggle: layoutToggle,
  reset: layoutReset,
  editor: layoutEditor,
  select: layoutNode,
  x: layoutX,
  y: layoutY,
  apply: layoutApply,
  note: $('layoutNote'),
};
let graph: VisualGraph | null = null;
let renderer: CanvasRenderer | null = null;
let lastDisplayList: DisplayList | null = null;
let playback = createPlaybackState(1, FPS);
let requestSerial = 0,
  loading = false;
let animationId: number | null = null;
let currentFrameState: DirectorFrameState | null = null;
let currentDiagnostics: Pick<LoadResult, 'errors' | 'warnings'> | null = null;
let currentDetailAt: DetailAt = () => undefined;
let currentLayout: ReturnType<typeof layoutGraph> | null = null;
let originalLayout: ReturnType<typeof layoutGraph> | null = null;
// The strategy the document was loaded with: Reset restores it with the coordinates.
let originalLayoutType: LayoutType = 'manual';
let sourceDocument: unknown = null;
let sourceFilename = 'relgraph.json';
let activeSourceName = '尚未加载';
let activeSourceNameIsExample = false;
const displaySourceName = (): string =>
  activeSourceNameIsExample || activeSourceName === '尚未加载'
    ? uiText(activeSourceName)
    : activeSourceName;
let selectedLayoutNode: string | null = null;
// Coordinate errors belong to the coordinate editor, not the project model.
// Preserve their raw wording across locale-only renders and normal redraws.
let coordinateValidationMessage: string | null = null;
// Coordinates are edited only on Apply; keep uncommitted X/Y per node even
// when another node is selected or position-edit mode is temporarily hidden.
const coordinateDrafts = new Map<string, { x: string; y: string }>();
let layoutEditing = false;
let editCamera: DirectorFrameState['cameraResolved'] | null = null;
let dragging: PositionDrag | null = null;
const DOCUMENT_TITLE = 'RelGraph Studio · 导演工作台';
const DOCUMENT_TOOLBAR_NOTE = '完整项目包含外观、文案及坐标；坐标导出不保存样式。';
let lastDirtyStatus: boolean | null = null;

// Do not confuse numeric formatting with a meaningful coordinate change.
function coordinateDraftMatches(
  draft: { x: string; y: string },
  point: { x: number; y: number },
): boolean {
  const parsed = parseCoordinateInputs(draft.x, draft.y);
  return parsed !== null && parsed.x === point.x && parsed.y === point.y;
}
// The mutable currentLayout also holds temporary preview and drag positions.
// Only ProjectHistory plus the loaded baseline define *committed* positions.
function committedCoordinate(id: string): { x: number; y: number } | undefined {
  return projectHistory.value.layout?.positions?.[id] ?? originalLayout?.get(id);
}
// Called only after a real history transition, never from a drag frame/render.
function reconcileCommittedCoordinateDrafts(): void {
  for (const [id, draft] of coordinateDrafts) {
    const point = committedCoordinate(id);
    if (point && coordinateDraftMatches(draft, point)) coordinateDrafts.delete(id);
  }
}
function hasPendingCoordinateDraft(): boolean {
  return coordinateDrafts.size > 0;
}

function hasUnsavedChanges(): boolean {
  // A load already accepted for discard should not trigger another warning.
  return Boolean(
    !loading &&
    graph &&
    currentLayout &&
    (layoutPreview ||
      dragging ||
      hasPendingCoordinateDraft() ||
      projectEditor.isImageBusy() ||
      projectEditor.hasPendingDraft() ||
      strategyView.hasPendingDraft() ||
      projectSavepoint.isDirty(projectHistory.value, currentLayout)),
  );
}
function renderDocumentToolbar(): void {
  documentToolbarView.render({
    loaded: !loading && Boolean(graph && currentLayout && sourceDocument !== null),
    canUndo: projectHistory.canUndo,
    canRedo: projectHistory.canRedo,
  });
}
function refreshUnsavedState(): void {
  const dirty = hasUnsavedChanges();
  if (lastDirtyStatus === dirty) return;
  lastDirtyStatus = dirty;
  saveState.textContent = uiText(dirty ? '未保存修改' : '无未保存修改');
  saveState.setAttribute('data-dirty', String(dirty));
  document.title = dirty ? `● ${uiText(DOCUMENT_TITLE)}` : uiText(DOCUMENT_TITLE);
}
function confirmSourceReplacement(): boolean {
  return (
    !hasUnsavedChanges() ||
    window.confirm(uiText('当前项目有未保存的修改。继续加载其他数据将丢弃这些修改，是否继续？'))
  );
}
window.addEventListener('beforeunload', (event) => {
  if (!hasUnsavedChanges()) return;
  event.preventDefault();
  event.returnValue = '';
});
// Workspace and video share one theme. Without a saved choice it follows the OS.
const THEME_KEY = 'relgraph-theme',
  lightQuery = globalThis.matchMedia?.('(prefers-color-scheme: light)');
function savedTheme(): Theme | null {
  try {
    const value = globalThis.localStorage?.getItem(THEME_KEY);
    return value === 'light' || value === 'dark' ? value : null;
  } catch {
    return null;
  }
}
// The in-memory pin decides whether OS changes are followed, so a choice
// still sticks for this page when storage is unavailable or setItem fails.
let pinnedTheme = savedTheme();
let theme: Theme = pinnedTheme || (lightQuery?.matches ? 'light' : 'dark');
const setStatus = (text: string, state: WorkspaceStatus): void =>
  renderPlaybackStatus(playbackControls, text, state);
function syncPlaybackControls(): void {
  renderPlaybackControls(playbackControls, playback, Boolean(renderer), loading);
}
function setPlaying(next: boolean): void {
  if (animationId !== null) cancelAnimationFrame(animationId);
  animationId = null;
  playback = setPlaybackRunning(playback, next, Boolean(renderer && !loading));
  syncPlaybackControls();
  if (playback.playing) animationId = requestAnimationFrame(tick);
}
function tick(now: number): void {
  animationId = null;
  if (!playback.playing) return;
  playback = advancePlayback(playback, now);
  setFrame(playback.frame, false);
  if (!playback.playing) {
    transitionStudio('pause');
    return;
  }
  animationId = requestAnimationFrame(tick);
}
function seekToShot(targetFrame: number): void {
  transitionStudio('navigate');
  if (loading) return;
  setFrame(targetFrame);
}
function refreshSelectionFeedback(): void {
  const focus =
    layoutEditing &&
    selectedLayoutNode &&
    currentFrameState?.view.nodes.some((node) => node.id === selectedLayoutNode)
      ? {
          kind: 'node' as const,
          selection: { kind: 'node' as const, id: selectedLayoutNode },
          scope: 'object' as const,
        }
      : projectEditor.focus();
  selectionOverlayView.render(projectSelectionOverlay(currentFrameState, lastDisplayList, focus));
}
function setFrame(next: number, updatePosition = true): DirectorFrameState | undefined {
  if (!renderer) return;
  playback = seekPlayback(playback, next, !updatePosition);
  const frame = playback.frame;
  const { state, list } = renderer.renderFrameWithList(frame),
    p = state.playback;
  if (!p.scene) throw new Error('A loaded film must have a current scene');
  currentFrameState = state;
  lastDisplayList = list;
  strategyView.render(
    state,
    projectHistory.value.layout,
    Boolean(layoutPreview),
    loading,
    projectHistory.value,
  );
  renderPlaybackFrame(playbackControls, playbackDisplay(playback, p.index, p.totalSec));
  transcriptView.render(list.a11y);
  projectEditor.render(state, projectHistory.value);
  renderDocumentToolbar();
  refreshSelectionFeedback();
  shellView.renderDomainTime(p.domainAt, state.view.timeline?.unit);
  shotsView.render(p.index, list.a11y.scene.title, p.progress);
  return state;
}
function clearStudio(): void {
  transitionStudio('navigate');
  // Full document replacement also resets all authoritative mode owners.
  layoutPreview = null;
  strategyView.reset(undefined);
  strategyView.render(null, undefined, false, loading);
  graph = null;
  projectHistory.reset();
  projectSavepoint.clear();
  coordinateDrafts.clear();
  coordinateValidationMessage = null;
  projectEditor.clear();
  renderer = null;
  lastDisplayList = null;
  currentLayout = null;
  originalLayout = null;
  sourceDocument = null;
  selectedLayoutNode = null;
  dragging = null;
  editCamera = null;
  layoutEditing = false;
  renderEditorAvailability(layoutControls, false);
  updateLayoutEditor();
  updateLayoutControls();
  renderDocumentToolbar();
  currentFrameState = null;
  currentDetailAt = () => undefined;
  playback = createPlaybackState(1, FPS);
  resetPlaybackView(playbackControls);
  shotsView.clear();
  diagnosticsView.clear();
  transcriptView.reset();
  shellView.paintEmptyStage('请选择示例或导入有效的 JSON 数据', theme);
  shellView.resetMetadata();
  documentToolbarView.message(DOCUMENT_TOOLBAR_NOTE);
  refreshSelectionFeedback();
  refreshUnsavedState();
}
function applyResult(result: LoadResult, name: string, sourceText?: string, example = false): void {
  loading = false;
  clearStudio();
  currentDiagnostics = result;
  activeSourceName = name;
  activeSourceNameIsExample = example;
  diagnosticsView.render(result);
  shellView.renderSourceName(displaySourceName());
  if (!result.valid) {
    setStatus('数据校验失败', 'error');
    shellView.paintEmptyStage('数据校验失败 · 请查看右侧校验提示', theme);
    return;
  }
  graph = result.graph;
  sourceDocument = sourceText ? projectSource(JSON.parse(sourceText)) : null;
  projectHistory.reset(graph.project ?? {});
  strategyView.reset(graph.project?.layout);
  sourceFilename = /\.json$/i.test(name) ? name : 'relgraph.json';
  currentDetailAt = result.detailAt || (() => undefined);
  currentLayout = layoutGraph(graph);
  originalLayout = new Map([...currentLayout].map(([id, point]) => [id, { ...point }]));
  originalLayoutType = graph.project?.layout?.type ?? 'manual';
  projectSavepoint.markClean(projectHistory.value, currentLayout);
  renderEditorAvailability(layoutControls, sourceDocument !== null);
  renderer = createCanvasRenderer(canvas, graph, currentLayout, {
    fps: FPS,
    detailAt: currentDetailAt,
    theme,
  });
  playback = createPlaybackState(frameCount(graph, FPS), FPS);
  enablePlaybackView(playbackControls, playback.totalFrames);
  shotsView.build(shotMarkers(graph.scenes, playback.totalFrames, FPS), seekToShot);
  shellView.renderSourceSummary(graph.scenes.length, graph.meta.sourceNote, graph.meta.description);
  setStatus('就绪', 'ready');
  setFrame(0);
  refreshUnsavedState();
}
function beginLoad(): number {
  transitionStudio('navigate');
  ++imageUploadSerial;
  projectEditor.imageBusy(false);
  const serial = ++requestSerial;
  loading = true;
  renderDocumentToolbar();
  refreshUnsavedState();
  strategyView.render(currentFrameState, projectHistory.value.layout, false, true);
  disablePlaybackView(playbackControls);
  renderEditorAvailability(layoutControls, false);
  updateLayoutEditor();
  // Only the coordinator may commit a result after checking requestSerial.
  currentDiagnostics = null;
  diagnosticsView.clear();
  setStatus('正在加载…', 'loading');
  return serial;
}

function loadFailure(code: 'LOAD' | 'FILE', error: unknown): LoadResult {
  const message = error instanceof Error ? error.message : String(error);
  return {
    valid: false,
    errors: [
      {
        level: 'error',
        layer: 'studio',
        code,
        path: '$',
        id: '',
        message: `${code === 'LOAD' ? '无法读取示例' : '无法读取文件'}：${message}`,
        fix:
          code === 'LOAD'
            ? '从仓库根目录运行 npm run dev 或 npm run preview 后重新打开工作台。'
            : '请选择可读取的 JSON 文件。',
      },
    ],
    warnings: [],
  };
}

async function loadExample(path: string, name: string): Promise<void> {
  const serial = beginLoad();
  try {
    const response = await fetch(path);
    if (!response.ok) throw new Error(`HTTP ${response.status}`);
    const text = await response.text();
    if (serial === requestSerial) applyResult(parseDocument(text), name, text, true);
  } catch (error) {
    if (serial === requestSerial) applyResult(loadFailure('LOAD', error), name, undefined, true);
  }
}
exampleLiterature.addEventListener('click', () => {
  if (!confirmSourceReplacement()) return;
  shellView.markSource('exampleLiterature');
  return loadExample(
    '../examples/honglou-provisional.relgraph.json',
    '红楼梦 · 未经原著核实的技术演示',
  );
});
exampleBiology.addEventListener('click', () => {
  if (!confirmSourceReplacement()) return;
  shellView.markSource('exampleBiology');
  return loadExample('../examples/biology-egfr-mapk.json', '生物信号 · EGFR–MAPK 经典通路');
});
for (const [id, entry] of Object.entries(gallery))
  entry.button.addEventListener('click', () => {
    if (!confirmSourceReplacement()) return;
    shellView.markSource(id);
    return loadExample(`../examples/${entry.file}.graph.json`, entry.name);
  });
async function loadFile(file: File | undefined): Promise<void> {
  if (!file || !confirmSourceReplacement()) return;
  const serial = beginLoad();
  shellView.markSource(null);
  try {
    const text = await file.text();
    if (serial === requestSerial) applyResult(parseDocument(text), file.name, text);
  } catch (error) {
    if (serial === requestSerial) applyResult(loadFailure('FILE', error), file.name);
  }
}
fileInput.addEventListener('change', () => {
  const file = fileInput.files?.[0];
  // Clear immediately so choosing the same file again works and an older read
  // cannot clear a newer selection when it finishes.
  fileInput.value = '';
  void loadFile(file);
});
dropzone.addEventListener('dragover', (event) => {
  event.preventDefault();
  shellView.renderDropzoneDragging(true);
});
dropzone.addEventListener('dragleave', () => shellView.renderDropzoneDragging(false));
dropzone.addEventListener('drop', (event) => {
  event.preventDefault();
  shellView.renderDropzoneDragging(false);
  void loadFile(event.dataTransfer?.files?.[0]);
});
play.addEventListener('click', () => {
  transitionStudio(playback.playing ? 'pause' : 'play');
});
restart.addEventListener('click', () => {
  transitionStudio('navigate');
  setFrame(0);
});
scrubber.addEventListener('input', () => {
  // Editing teardown redraws the prior frame, so capture the requested frame first.
  const requestedFrame = Number(scrubber.value);
  transitionStudio('navigate');
  setFrame(requestedFrame);
});
window.addEventListener('keydown', (event) => {
  const target = event.target;
  const editingField =
    target instanceof Element &&
    Boolean(
      target.closest(
        'input,textarea,select,[contenteditable="true"],[contenteditable=""],[role="textbox"]',
      ),
    );
  const command = documentCommandFromShortcut(event, editingField);
  if (command) {
    const enabled = documentToolbarView.enabled(command);
    // Ctrl/Cmd+S must never accidentally save the HTML page instead of the
    // project, even while a new document is loading or validation has failed.
    if (enabled || command === 'save') {
      event.preventDefault();
      if (!event.repeat) {
        if (enabled) documentToolbarView.run(command);
        else documentToolbarView.message('当前没有可保存的完整项目，请先加载有效数据。', true);
      }
    }
    return;
  }
  if (
    loading ||
    event.altKey ||
    event.ctrlKey ||
    event.metaKey ||
    event.isComposing ||
    event.repeat
  )
    return;
  // Escape must work even while the position-mode button has keyboard focus.
  if (event.code === 'Escape' && layoutEditing) {
    event.preventDefault();
    transitionStudio('exitPositionEdit');
    return;
  }
  if (
    target instanceof Element &&
    target.closest('button,input,textarea,select,summary,[contenteditable],[role="button"]')
  )
    return;
  if (event.code === 'Space') {
    event.preventDefault();
    play.click();
  } else if (event.code === 'ArrowRight') {
    transitionStudio('navigate');
    setFrame(playback.frame + FPS);
  } else if (event.code === 'ArrowLeft') {
    transitionStudio('navigate');
    setFrame(playback.frame - FPS);
  }
});
function applyTheme(next: Theme, persist: boolean): void {
  // A theme transition exits editing and preview but preserves playback clock.
  transitionStudio('theme');
  theme = next;
  if (persist) {
    pinnedTheme = theme;
    try {
      globalThis.localStorage?.setItem(THEME_KEY, theme);
    } catch {
      // The in-memory choice remains pinned when storage is unavailable.
    }
  }
  shellView.renderTheme(theme, persist);
  // The theme is a renderer input: rebuild it and redraw the same frame
  // without disturbing the fractional playback position.
  if (renderer && graph && currentLayout) rebuildRenderer();
  else shellView.repaintEmptyStage(theme);
}

/**
 * Never expose names of future/hidden nodes in the keyboard selector.
 * Re-check the current spoiler-safe frame when applying a typed coordinate.
 */
function availableNodes(): VisualGraph['nodes'] {
  return layoutEditing && currentFrameState && currentLayout
    ? editableNodes(currentFrameState, currentLayout)
    : [];
}
/** Whether the selected node's X is its date: a dated node on an anchored timeline. */
function selectedNodeInTime(): boolean {
  const axis = graph ? timeAnchor(graph) : null,
    node = axis ? graph?.nodes.find((n) => n.id === selectedLayoutNode) : undefined;
  return Boolean(axis && node && placeInTime(node, axis) !== null);
}
function updateLayoutFields(): void {
  const point = selectedLayoutNode ? currentLayout?.get(selectedLayoutNode) : undefined;
  // The position map stores only applied values; restore this node's draft
  // after rendering the canonical values for selection or mode transitions.
  renderEditorFields(layoutControls, point, selectedNodeInTime());
  if (selectedLayoutNode && point) {
    const draft = coordinateDrafts.get(selectedLayoutNode);
    const committed = committedCoordinate(selectedLayoutNode);
    if (draft && (!committed || !coordinateDraftMatches(draft, committed))) {
      layoutX.value = draft.x;
      layoutY.value = draft.y;
    }
  }
  refreshUnsavedState();
}
function updateLayoutEditor(): void {
  const nodes = availableNodes();
  if (!selectedLayoutNode || !nodes.some((node) => node.id === selectedLayoutNode))
    selectedLayoutNode = nodes[0]?.id ?? null;
  renderEditorMode(layoutControls, layoutEditing);
  renderEditorNodes(document, layoutControls, nodes, selectedLayoutNode);
  updateLayoutFields();
}
function trackCoordinateDraft(): void {
  if (
    !layoutEditing ||
    !currentLayout ||
    !selectedLayoutNode ||
    layoutX.disabled ||
    layoutY.disabled
  )
    return;
  const point = committedCoordinate(selectedLayoutNode);
  if (!point) return;
  const draft = { x: layoutX.value, y: layoutY.value };
  coordinateValidationMessage = null;
  if (coordinateDraftMatches(draft, point)) coordinateDrafts.delete(selectedLayoutNode);
  else coordinateDrafts.set(selectedLayoutNode, draft);
  updateLayoutControls();
}
for (const input of [layoutX, layoutY]) {
  input.addEventListener('input', trackCoordinateDraft);
  input.addEventListener('change', trackCoordinateDraft);
}
layoutNode.addEventListener('change', () => {
  if (!availableNodes().some((node) => node.id === layoutNode.value)) return;
  selectedLayoutNode = layoutNode.value;
  coordinateValidationMessage = null;
  updateLayoutFields();
  refreshSelectionFeedback();
});
layoutApply.addEventListener('click', () => {
  if (
    !layoutEditing ||
    !currentLayout ||
    !selectedLayoutNode ||
    projectHistory.value.layout?.locked.includes(selectedLayoutNode) ||
    !availableNodes().some((node) => node.id === selectedLayoutNode)
  )
    return;
  const typed = parseCoordinateInputs(layoutX.value, layoutY.value);
  const point = typed && graph ? anchoredPoint(graph, selectedLayoutNode, typed) : typed;
  if (!point) {
    coordinateValidationMessage = '坐标必须是有限数字，请检查 X 和 Y';
    renderEditorMessage(layoutControls, coordinateValidationMessage);
    return;
  }
  if (
    !currentFrameState ||
    !updateEditableNodePosition(currentLayout, currentFrameState, selectedLayoutNode, point)
  )
    return;
  coordinateValidationMessage = null;
  projectSavepoint.positionsChanged();
  projectHistory.commit(configWithPositions(undefined, [selectedLayoutNode]));
  if (graph) graph.project = projectHistory.value;
  coordinateDrafts.delete(selectedLayoutNode);
  reconcileCommittedCoordinateDrafts();
  setFrame(playback.frame, false);
  updateLayoutFields();
  updateLayoutControls();
});

// A position edit uses the existing renderer but freezes the visible camera.
// No projection, timeline or authored source data changes until explicit export.
const layoutChanged = (): boolean =>
  Boolean(currentLayout && originalLayout && layoutHasChanges(currentLayout, originalLayout)) ||
  layoutTypeChanged();
/** Whether the applied strategy is no longer the one the document was loaded with. */
const layoutTypeChanged = (): boolean =>
  Boolean(graph) && (projectHistory.value.layout?.type ?? 'manual') !== originalLayoutType;
function updateLayoutControls(): void {
  renderEditorStatus(
    layoutControls,
    layoutEditing,
    layoutChanged() || hasPendingCoordinateDraft(),
    coordinateValidationMessage,
    Boolean(graph && timeAnchor(graph)),
  );
  refreshUnsavedState();
}
/**
 * The graph as it is being drawn: during a preview, under the previewed
 * strategy, so that the picture is on the time axis exactly when the applied
 * layout would be.
 */
function drawnGraph(): VisualGraph | null {
  if (!graph || !layoutPreview) return graph;
  const layout = graph.project?.layout ?? DEFAULT_LAYOUT_SETTINGS;
  return {
    ...graph,
    project: { ...graph.project, layout: { ...layout, type: layoutPreview.settings.type } },
  };
}
function rebuildRenderer(): void {
  const drawn = drawnGraph();
  if (!graph || !drawn || !currentLayout) return;
  renderer = createCanvasRenderer(canvas, drawn, currentLayout, {
    style: styleForGraph(graph),
    fps: FPS,
    detailAt: currentDetailAt,
    theme,
    ...(editCamera ? { cameraOverride: editCamera } : {}),
  });
  setFrame(playback.frame, false);
}
function releaseLayoutPointer(): void {
  if (dragging && canvas.hasPointerCapture(dragging.pointerId))
    canvas.releasePointerCapture(dragging.pointerId);
  dragging = null;
}
/** One cancellation path for history transitions, pointercancel and edit teardown. */
/** Returns whether cancelling this drag changed the coordinates being shown. */
function cancelActiveLayoutDrag(): boolean {
  if (!dragging) return false;
  const restored = Boolean(currentLayout && dragHasChanges(dragging, currentLayout));
  if (currentLayout) {
    cancelPositionDrag(currentLayout, dragging);
    projectSavepoint.positionsChanged();
  }
  releaseLayoutPointer();
  return restored;
}
function leavePositionEdit(): void {
  if (!layoutEditing) return;
  cancelActiveLayoutDrag();
  layoutEditing = false;
  editCamera = null;
  rebuildRenderer();
  updateLayoutEditor();
  updateLayoutControls();
  refreshSelectionFeedback();
}
layoutToggle.addEventListener('click', () => {
  if (!renderer || !currentFrameState || !currentLayout) {
    transitionStudio('cancelPreview');
    return;
  }
  transitionStudio(layoutEditing ? 'exitPositionEdit' : 'enterPositionEdit');
});
layoutReset.addEventListener('click', () => {
  transitionStudio('cancelPreview');
  if (!currentLayout || !originalLayout) return;
  const restoredDragPreview = cancelActiveLayoutDrag();
  const changedPositions = layoutChanged();
  // The loaded picture is its coordinates and the strategy it was drawn with,
  // which decides whether it is on the time axis.
  const settings = {
    ...(projectHistory.value.layout ?? DEFAULT_LAYOUT_SETTINGS),
    type: originalLayoutType,
  };
  // Like a strategy, Reset never moves a locked node: on the loaded time axis
  // it would have to move a locked dated node that sits away from its date.
  // Refuse before anything is discarded. Locked nodes are not restored, so
  // their current coordinates are the ones the axis would see.
  const axis =
    graph && changedPositions ? timeAnchor({ ...graph, project: { layout: settings } }) : null;
  const blocked = graph && axis ? offTime(graph, axis, currentLayout, settings.locked) : [];
  if (blocked.length) {
    if (restoredDragPreview) setFrame(playback.frame, false);
    coordinateValidationMessage = blockedResetMessage(blocked.map(nodeName));
    updateLayoutFields();
    updateLayoutControls();
    return;
  }
  // Reset is an explicit discard of all pending coordinate inputs, not a
  // new authored layout commit when only unsubmitted drafts existed.
  coordinateDrafts.clear();
  coordinateValidationMessage = null;
  if (!changedPositions) {
    // Cancelling the first, uncommitted drag can restore the saved positions
    // without creating a history change. The renderer still holds the pixels
    // from the last pointermove, so repaint before leaving this no-op branch.
    if (restoredDragPreview) setFrame(playback.frame, false);
    updateLayoutFields();
    updateLayoutControls();
    return;
  }
  for (const [id, p] of originalLayout)
    if (!settings.locked.includes(id)) currentLayout.set(id, { ...p });
  if (graph) {
    graph.project = { ...projectHistory.value, layout: { ...settings } };
    anchorToTime(graph, currentLayout);
  }
  projectSavepoint.positionsChanged();
  projectHistory.commit(configWithPositions(settings));
  if (graph) graph.project = projectHistory.value;
  strategyView.reset(projectHistory.value.layout);
  rebuildRenderer();
  updateLayoutFields();
  updateLayoutControls();
});
const pointerLocation = (event: PointerEvent): { x: number; y: number } | null =>
  canvasPoint({ x: event.clientX, y: event.clientY }, canvas.getBoundingClientRect(), canvas);
canvas.addEventListener('pointerdown', (event) => {
  if (!layoutEditing && !loading && renderer && currentFrameState) {
    const point = pointerLocation(event);
    if (point) projectEditor.pick(renderer.displayListAt(playback.frame), point);
  }
  if (!layoutEditing || !renderer || !currentLayout || !currentFrameState || dragging) return;
  if (event.isPrimary === false || (event.pointerType === 'mouse' && event.button !== 0)) return;
  const point = pointerLocation(event);
  if (!point) return;
  const rect = canvas.getBoundingClientRect();
  const radius = 24 * (canvas.width / Math.max(1, rect.width));
  const nextDrag = startPositionDrag(
    currentFrameState,
    currentLayout,
    renderer.frameSpec,
    point,
    radius,
    event.pointerId,
    // Hit the glyphs as they are drawn: spans only while the drawing keeps time.
    renderer.style,
    graph?.project,
  );
  if (!nextDrag || projectHistory.value.layout?.locked.includes(nextDrag.id)) return;
  dragging = nextDrag;
  selectedLayoutNode = nextDrag.id;
  renderEditorSelection(layoutControls, nextDrag.id);
  updateLayoutFields();
  refreshSelectionFeedback();
  canvas.setPointerCapture(event.pointerId);
  event.preventDefault();
});
function moveLayoutNode(event: PointerEvent): void {
  if (
    !dragging ||
    !renderer ||
    !currentLayout ||
    !currentFrameState ||
    dragging.pointerId !== event.pointerId
  )
    return;
  const point = pointerLocation(event);
  if (!point) return;
  const dragged = positionForDrag(
    dragging,
    point,
    currentFrameState.cameraResolved,
    renderer.frameSpec,
  );
  // On a timeline a bar changes lane, never its years.
  const moved = dragged && graph ? anchoredPoint(graph, dragging.id, dragged) : dragged;
  if (!moved || !updateEditableNodePosition(currentLayout, currentFrameState, dragging.id, moved))
    return;
  projectSavepoint.positionsChanged();
  setFrame(playback.frame, false);
  updateLayoutFields();
  updateLayoutControls();
  event.preventDefault();
}
canvas.addEventListener('pointermove', moveLayoutNode);
canvas.addEventListener('pointerup', (event) => {
  if (!dragging || dragging.pointerId !== event.pointerId) return;
  moveLayoutNode(event);
  if (currentLayout && dragHasChanges(dragging, currentLayout)) {
    projectHistory.commit(configWithPositions(undefined, [dragging.id]));
    if (graph) graph.project = projectHistory.value;
    reconcileCommittedCoordinateDrafts();
  }
  releaseLayoutPointer();
  setFrame(playback.frame, false);
  refreshUnsavedState();
});
canvas.addEventListener('pointercancel', (event) => {
  if (!dragging || dragging.pointerId !== event.pointerId || !currentLayout) return;
  cancelActiveLayoutDrag();
  setFrame(playback.frame, false);
  updateLayoutFields();
  updateLayoutControls();
});
function downloadJson(value: unknown, filename: string): void {
  const url = URL.createObjectURL(
    new Blob([JSON.stringify(value, null, 2) + '\n'], { type: 'application/json;charset=utf-8' }),
  );
  const link = document.createElement('a');
  link.href = url;
  link.download = filename;
  document.body.append(link);
  link.click();
  link.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}
function exportPositionedSource(): void {
  transitionStudio('cancelPreview');
  if (!graph || !currentLayout || sourceDocument === null) return;
  try {
    // A timeline taken off its axis says so in the file, or it would be redrawn on it.
    const output = applyGraphPositions(sourceDocument, graph, currentLayout, {
      // The declared state, not whether an axis exists: dates added later still draw one.
      ...(graph.diagram === 'timeline' ? { timeAxis: declaresTimeAxis(graph) } : {}),
    });
    const text = JSON.stringify(output.document, null, 2) + '\n';
    const check = parseDocument(text);
    if (!check.valid) throw new Error('导出的 JSON 没有通过数据校验');
    const blob = new Blob([text], { type: 'application/json;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.download = sourceFilename.replace(/\.json$/i, '') + '.positioned.json';
    document.body.append(link);
    link.click();
    link.remove();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
    const message =
      '已准备导出：' + link.download + '。此文件仅保存源数据坐标，不代表完整项目已保存。';
    renderEditorMessage(layoutControls, message);
    documentToolbarView.message(message);
  } catch (error) {
    const message = '导出失败：' + (error instanceof Error ? error.message : String(error));
    renderEditorMessage(layoutControls, message);
    documentToolbarView.message(message, true);
  }
}

function applyLanguage(next: StudioLanguage): void {
  if (next === studioLanguage()) return;
  setStudioLanguage(next, languageStorage);
  languageSelect.value = next;
  refreshStudioUi(document);
  refreshEditorFieldText(layoutControls);
  shellView.renderTheme(theme, false);
  shellView.renderSourceName(displaySourceName());
  if (graph)
    shellView.renderSourceSummary(
      graph.scenes.length,
      graph.meta.sourceNote,
      graph.meta.description,
    );
  if (currentFrameState && lastDisplayList) {
    const frame = currentFrameState.playback;
    strategyView.render(
      currentFrameState,
      projectHistory.value.layout,
      Boolean(layoutPreview),
      loading,
      projectHistory.value,
    );
    projectEditor.render(currentFrameState, projectHistory.value);
    transcriptView.render(lastDisplayList.a11y);
    shotsView.refreshLanguage();
    shotsView.render(frame.index, lastDisplayList.a11y.scene.title, frame.progress);
    shellView.renderDomainTime(frame.domainAt, currentFrameState.view.timeline?.unit);
    // Refresh the scrubber's localized aria-valuetext from the existing
    // playback model, without seeking or repainting the movie.
    renderPlaybackFrame(playbackControls, playbackDisplay(playback, frame.index, frame.totalSec));
  } else {
    strategyView.render(
      currentFrameState,
      projectHistory.value.layout,
      Boolean(layoutPreview),
      loading,
      projectHistory.value,
    );
    shellView.repaintEmptyStage(theme);
    if (!graph) {
      transcriptView.reset();
      shellView.renderEmptyDomainTime();
    }
  }
  refreshSelectionFeedback();
  if (currentDiagnostics) diagnosticsView.render(currentDiagnostics);
  updateLayoutControls();
  projectEditor.refreshLanguage();
  documentToolbarView.refreshLanguage();
  // Language is presentation state, never a project edit or history event.
  lastDirtyStatus = null;
  refreshUnsavedState();
  if (loading) setStatus('正在加载…', 'loading');
  else if (renderer) syncPlaybackControls();
  else if (currentDiagnostics?.errors.length) setStatus('数据校验失败', 'error');
  else setStatus('就绪', 'ready');
}
languageSelect.addEventListener('change', () => {
  const next = languageSelect.value;
  if (next !== 'zh-CN' && next !== 'en') {
    languageSelect.value = studioLanguage();
    return;
  }
  applyLanguage(next);
});
themeToggle.addEventListener('click', () => applyTheme(theme === 'light' ? 'dark' : 'light', true));
lightQuery?.addEventListener?.('change', (event) => {
  if (!pinnedTheme) applyTheme(event.matches ? 'light' : 'dark', false);
});
// Headless frame export and independent frame inspection; no recording or animation state.
window.renderAt = (f) => {
  if (!renderer || !Number.isInteger(f) || f < 0 || f >= playback.totalFrames) return false;
  transitionStudio('navigate');
  setFrame(f);
  return true;
};
window.studioFrame = () => (currentFrameState ? structuredClone(currentFrameState) : null);
/**
 * The film fonts declared in studio.css load on first use. Request every face
 * before the first frame so text measurement and pixels match the headless
 * export instead of a fallback font.
 */
async function loadFilmFonts(): Promise<void> {
  try {
    const loaded = await Promise.all(
      FILM_FONT_FACES.map((face) => document.fonts.load(filmFontQuery(face))),
    );
    const missing = FILM_FONT_FACES.filter((_, index) => !loaded[index]?.length);
    if (missing.length)
      console.warn(`Film fonts unavailable: ${missing.map(filmFontQuery).join(', ')}`);
  } catch (error) {
    console.warn('Film fonts failed to load; frames use fallback fonts.', error);
  }
  await document.fonts.ready;
}
applyTheme(theme, false);
clearStudio();
const startupSerial = requestSerial;
await loadFilmFonts();
// A film chosen while the fonts loaded was drawn with fallbacks; redraw it.
if (renderer) setFrame(playback.frame, false);
if (startupSerial === requestSerial) {
  shellView.markSource('exampleLiterature');
  await loadExample(
    '../examples/honglou-provisional.relgraph.json',
    '红楼梦 · 未经原著核实的技术演示',
  );
}
