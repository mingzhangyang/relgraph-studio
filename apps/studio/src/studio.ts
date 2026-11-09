import { normalizeNodeImage } from './node-image.js';
import { setNodeImage } from './project-editor-model.js';
import {
  configWithLayoutPositions,
  dragHasChanges,
  cancelPositionDrag,
} from './layout-history-model.js';
import { computeLayout, DEFAULT_LAYOUT_SETTINGS, type LayoutSettings } from '@relgraph/core';
import { createLayoutStrategyView } from './layout-strategy-view.js';
import { createProject, projectSource, validateProjectConfig } from '@relgraph/core';
import { ProjectHistory } from './project-editor-model.js';
import { ProjectSavepoint } from './unsaved-changes-model.js';
import { createProjectEditor } from './project-editor-view.js';
import { parseDocument, applyGraphPositions, type LoadResult } from '@relgraph/core';
import { layoutGraph } from '@relgraph/core';
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
const $ = (id: string): HTMLElement => requiredElement(id, HTMLElement);
const canvas = requiredElement('stage', HTMLCanvasElement),
  play = requiredElement('play', HTMLButtonElement),
  restart = requiredElement('restart', HTMLButtonElement),
  scrubber = requiredElement('scrubber', HTMLInputElement),
  fileInput = requiredElement('fileInput', HTMLInputElement),
  exampleLiterature = requiredElement('exampleLiterature', HTMLButtonElement),
  exampleBiology = requiredElement('exampleBiology', HTMLButtonElement),
  themeToggle = requiredElement('themeToggle', HTMLButtonElement),
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
  themeToggle,
  dropzone,
});
let layoutPreview: {
  settings: LayoutSettings;
  before: Map<string, { x: number; y: number }>;
  serial: number;
} | null = null;
function cancelLayoutPreview(): void {
  if (!layoutPreview) return;
  if (currentLayout) restoreLayoutPositions(currentLayout, layoutPreview.before);
  layoutPreview = null;
  rebuildRenderer();
  refreshUnsavedState();
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
  graph.project = projectHistory.value;
  restoreLayoutPositions(currentLayout, originalLayout);
  for (const [id, p] of Object.entries(graph.project.layout?.positions ?? {}))
    currentLayout.set(id, { ...p });
  // Lock-only commits update persisted coordinates/locks, not the user's pending
  // strategy inputs. Undo/redo, apply and other config transitions still reset.
  if (!preserveLayoutDraft) strategyView.reset(graph.project.layout);
  rebuildRenderer();
  updateLayoutFields();
  updateLayoutControls();
}
const strategyView = createLayoutStrategyView(document, $('layoutStrategyEditor'), {
  preview(settings) {
    if (!graph || !currentLayout || loading) return;
    if (layoutEditing) stopLayoutEdit();
    setPlaying(false);
    cancelLayoutPreview();
    try {
      const before = new Map([...currentLayout].map(([id, p]) => [id, { ...p }]));
      const next = computeLayout(graph, settings, currentLayout);
      layoutPreview = { settings, before, serial: requestSerial };
      restoreLayoutPositions(currentLayout, next);
      rebuildRenderer();
      refreshUnsavedState();
    } catch (error) {
      strategyView.error(error instanceof Error ? error.message : String(error));
    }
  },
  apply() {
    if (!graph || !layoutPreview || loading || layoutPreview.serial !== requestSerial) return;
    const next = configWithPositions(layoutPreview.settings);
    layoutPreview = null;
    projectHistory.commit(next);
    applyProjectHistory();
  },
  cancel: cancelLayoutPreview,
  lock(id, locked) {
    if (!graph || !currentFrameState?.view.nodes.some((n) => n.id === id) || loading) return;
    cancelLayoutPreview();
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
const projectEditor = createProjectEditor(document, $('appearanceEditor'), {
  change(config) {
    if (!graph || loading) return;
    ++imageUploadSerial;
    projectEditor.imageBusy(false);
    const errors = validateProjectConfig(config, graph);
    if (errors.length) {
      projectEditor.error('配置无效：' + errors.join('；'));
      return;
    }
    cancelLayoutPreview();
    projectEditor.error('');
    setPlaying(false);
    projectHistory.commit(config);
    applyProjectHistory();
  },
  undo() {
    ++imageUploadSerial;
    projectEditor.imageBusy(false);
    if (graph) {
      cancelLayoutPreview();
      projectHistory.undo();
      applyProjectHistory();
    }
  },
  redo() {
    ++imageUploadSerial;
    projectEditor.imageBusy(false);
    if (graph) {
      cancelLayoutPreview();
      projectHistory.redo();
      applyProjectHistory();
    }
  },
  pause() {
    setPlaying(false);
  },
  draftChanged() {
    refreshUnsavedState();
  },
  async uploadImage(file, nodeId) {
    if (!graph || loading || !currentFrameState?.view.nodes.some((n) => n.id === nodeId)) return;
    const serial = ++imageUploadSerial,
      documentSerial = requestSerial,
      selectionRevision = projectEditor.selectionRevision(),
      owner = graph;
    setPlaying(false);
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
      cancelLayoutPreview();
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
    if (dragging || projectEditor.hasPendingDraft() || projectEditor.isImageBusy()) {
      projectEditor.error('仍有未提交的输入、拖动或图片处理，请完成后再保存项目。');
      refreshUnsavedState();
      return;
    }
    cancelLayoutPreview();
    const config = {
      ...projectHistory.value,
      layout: {
        type: 'manual' as const,
        mode: 'preserve' as const,
        seed: 0,
        spacing: 160,
        iterations: 160,
        locked: [],
        ...projectHistory.value.layout,
        positions: Object.fromEntries(currentLayout),
      },
    };
    const errors = validateProjectConfig(config, graph);
    if (errors.length) {
      projectEditor.error('保存失败：' + errors.join('；'));
      return;
    }
    try {
      downloadJson(
        createProject(sourceDocument, config),
        sourceFilename.replace(/\.json$/i, '') + '.studio.json',
      );
      // Browsers can initiate downloads, but cannot verify the file was kept.
      projectSavepoint.markClean(projectHistory.value, currentLayout);
      projectEditor.error('已发起完整项目 JSON 下载，请确认浏览器已将文件保存到本机。');
      refreshUnsavedState();
    } catch (error) {
      projectEditor.error('保存失败：' + (error instanceof Error ? error.message : String(error)));
    }
  }
});
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
let playback = createPlaybackState(1, FPS);
let requestSerial = 0,
  loading = false;
let animationId: number | null = null;
let currentFrameState: DirectorFrameState | null = null;
let currentDetailAt: DetailAt = () => undefined;
let currentLayout: ReturnType<typeof layoutGraph> | null = null;
let originalLayout: ReturnType<typeof layoutGraph> | null = null;
let sourceDocument: unknown = null;
let sourceFilename = 'relgraph.json';
let selectedLayoutNode: string | null = null;
let layoutEditing = false;
let editCamera: DirectorFrameState['cameraResolved'] | null = null;
let dragging: PositionDrag | null = null;
const DOCUMENT_TITLE = 'RelGraph Studio · 导演工作台';
let lastDirtyStatus: boolean | null = null;

function hasUnsavedChanges(): boolean {
  // A load already accepted for discard should not trigger another warning.
  return Boolean(
    !loading &&
    graph &&
    currentLayout &&
    (projectSavepoint.isDirty(projectHistory.value, currentLayout) ||
      layoutPreview ||
      dragging ||
      projectEditor.isImageBusy() ||
      projectEditor.hasPendingDraft()),
  );
}
function refreshUnsavedState(): void {
  const dirty = hasUnsavedChanges();
  if (lastDirtyStatus === dirty) return;
  lastDirtyStatus = dirty;
  saveState.textContent = dirty ? '未保存修改' : '无未保存修改';
  saveState.setAttribute('data-dirty', String(dirty));
  document.title = dirty ? `● ${DOCUMENT_TITLE}` : DOCUMENT_TITLE;
}
function confirmSourceReplacement(): boolean {
  return !hasUnsavedChanges() || window.confirm('当前项目有未保存的修改。继续加载其他数据将丢弃这些修改，是否继续？');
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
    setPlaying(false);
    return;
  }
  animationId = requestAnimationFrame(tick);
}
function seekToShot(targetFrame: number): void {
  cancelLayoutPreview();
  if (layoutEditing) stopLayoutEdit();
  if (loading) return;
  setPlaying(false);
  setFrame(targetFrame);
}
function setFrame(next: number, updatePosition = true): DirectorFrameState | undefined {
  if (!renderer) return;
  playback = seekPlayback(playback, next, !updatePosition);
  const frame = playback.frame;
  const { state, list } = renderer.renderFrameWithList(frame),
    p = state.playback;
  if (!p.scene) throw new Error('A loaded film must have a current scene');
  currentFrameState = state;
  strategyView.render(
    state,
    projectHistory.value.layout,
    Boolean(layoutPreview),
    loading,
    projectHistory.value,
  );
  renderPlaybackFrame(playbackControls, playbackDisplay(playback, p.index, p.totalSec));
  transcriptView.render(list.a11y);
  projectEditor.render(state, projectHistory.value, projectHistory.canUndo, projectHistory.canRedo);
  shellView.renderDomainTime(p.domainAt, state.view.timeline?.unit);
  shotsView.render(p.index, list.a11y.scene.title, p.progress);
  return state;
}
function clearStudio(): void {
  setPlaying(false);
  layoutPreview = null;
  strategyView.reset(undefined);
  strategyView.render(null, undefined, false, loading);
  graph = null;
  projectHistory.reset();
  projectSavepoint.clear();
  projectEditor.clear();
  renderer = null;
  currentLayout = null;
  originalLayout = null;
  sourceDocument = null;
  selectedLayoutNode = null;
  dragging = null;
  editCamera = null;
  layoutEditing = false;
  renderEditorAvailability(layoutControls, layoutExport, false);
  updateLayoutEditor();
  updateLayoutControls();
  currentFrameState = null;
  currentDetailAt = () => undefined;
  playback = createPlaybackState(1, FPS);
  resetPlaybackView(playbackControls);
  shotsView.clear();
  diagnosticsView.clear();
  transcriptView.reset();
  shellView.paintEmptyStage('请选择示例或导入有效的 JSON 数据', theme);
  shellView.resetMetadata();
  refreshUnsavedState();
}
function applyResult(result: LoadResult, name: string, sourceText?: string): void {
  loading = false;
  clearStudio();
  diagnosticsView.render(result);
  shellView.renderSourceName(name);
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
  projectSavepoint.markClean(projectHistory.value, currentLayout);
  renderEditorAvailability(layoutControls, layoutExport, sourceDocument !== null);
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
  cancelLayoutPreview();
  ++imageUploadSerial;
  projectEditor.imageBusy(false);
  const serial = ++requestSerial;
  if (layoutEditing) stopLayoutEdit();
  loading = true;
  refreshUnsavedState();
  strategyView.render(currentFrameState, projectHistory.value.layout, false, true);
  setPlaying(false);
  disablePlaybackView(playbackControls);
  renderEditorAvailability(layoutControls, layoutExport, false);
  updateLayoutEditor();
  // Only the coordinator may commit a result after checking requestSerial.
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
    if (serial === requestSerial) applyResult(parseDocument(text), name, text);
  } catch (error) {
    if (serial === requestSerial) applyResult(loadFailure('LOAD', error), name);
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
  return loadExample('../examples/biology-signaling-synthetic.json', '生物信号 · 虚构合成示例');
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
  cancelLayoutPreview();
  if (layoutEditing) stopLayoutEdit();
  if (!playback.playing && playback.frame >= playback.totalFrames - 1) setFrame(0);
  setPlaying(!playback.playing);
});
restart.addEventListener('click', () => {
  cancelLayoutPreview();
  if (layoutEditing) stopLayoutEdit();
  setPlaying(false);
  setFrame(0);
});
scrubber.addEventListener('input', () => {
  // Editing teardown redraws the prior frame, so capture the requested frame first.
  const requestedFrame = Number(scrubber.value);
  cancelLayoutPreview();
  if (layoutEditing) stopLayoutEdit();
  setPlaying(false);
  setFrame(requestedFrame);
});
window.addEventListener('keydown', (event) => {
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
    stopLayoutEdit();
    return;
  }
  const target = event.target;
  if (
    target instanceof Element &&
    target.closest('button,input,textarea,select,summary,[contenteditable],[role="button"]')
  )
    return;
  if (event.code === 'Space') {
    event.preventDefault();
    play.click();
  } else if (event.code === 'ArrowRight') {
    cancelLayoutPreview();
    if (layoutEditing) stopLayoutEdit();
    setPlaying(false);
    setFrame(playback.frame + FPS);
  } else if (event.code === 'ArrowLeft') {
    cancelLayoutPreview();
    if (layoutEditing) stopLayoutEdit();
    setPlaying(false);
    setFrame(playback.frame - FPS);
  }
});
function applyTheme(next: Theme, persist: boolean): void {
  cancelLayoutPreview();
  // A theme is a normal renderer transition; never carry a frozen shot camera.
  if (layoutEditing) stopLayoutEdit();
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
  if (renderer && graph && currentLayout) {
    renderer = createCanvasRenderer(canvas, graph, currentLayout, {
      fps: FPS,
      detailAt: currentDetailAt,
      theme,
    });
    setFrame(playback.frame, false);
  } else shellView.repaintEmptyStage(theme);
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
function updateLayoutFields(): void {
  renderEditorFields(
    layoutControls,
    selectedLayoutNode ? currentLayout?.get(selectedLayoutNode) : undefined,
  );
}
function updateLayoutEditor(): void {
  const nodes = availableNodes();
  if (!selectedLayoutNode || !nodes.some((node) => node.id === selectedLayoutNode))
    selectedLayoutNode = nodes[0]?.id ?? null;
  renderEditorMode(layoutControls, layoutEditing);
  renderEditorNodes(document, layoutControls, nodes, selectedLayoutNode);
  updateLayoutFields();
}
layoutNode.addEventListener('change', () => {
  if (!availableNodes().some((node) => node.id === layoutNode.value)) return;
  selectedLayoutNode = layoutNode.value;
  updateLayoutFields();
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
  const point = parseCoordinateInputs(layoutX.value, layoutY.value);
  if (!point) {
    renderEditorMessage(layoutControls, '坐标必须是有限数字，请检查 X 和 Y');
    return;
  }
  if (
    !currentFrameState ||
    !updateEditableNodePosition(currentLayout, currentFrameState, selectedLayoutNode, point)
  )
    return;
  projectHistory.commit(configWithPositions(undefined, [selectedLayoutNode]));
  if (graph) graph.project = projectHistory.value;
  setFrame(playback.frame, false);
  updateLayoutControls();
});

// A position edit uses the existing renderer but freezes the visible camera.
// No projection, timeline or authored source data changes until explicit export.
const layoutChanged = (): boolean =>
  Boolean(currentLayout && originalLayout && layoutHasChanges(currentLayout, originalLayout));
function updateLayoutControls(): void {
  renderEditorStatus(layoutControls, layoutEditing, layoutChanged());
  refreshUnsavedState();
}
function rebuildRenderer(): void {
  if (!graph || !currentLayout) return;
  renderer = createCanvasRenderer(canvas, graph, currentLayout, {
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
function stopLayoutEdit(): void {
  if (!layoutEditing) return;
  if (dragging && currentLayout) cancelPositionDrag(currentLayout, dragging);
  releaseLayoutPointer();
  layoutEditing = false;
  editCamera = null;
  rebuildRenderer();
  updateLayoutEditor();
  updateLayoutControls();
}
layoutToggle.addEventListener('click', () => {
  cancelLayoutPreview();
  if (!renderer || !currentFrameState || !currentLayout) return;
  if (layoutEditing) {
    stopLayoutEdit();
    return;
  }
  setPlaying(false);
  editCamera = { ...currentFrameState.cameraResolved };
  layoutEditing = true;
  rebuildRenderer();
  updateLayoutEditor();
  updateLayoutControls();
});
layoutReset.addEventListener('click', () => {
  cancelLayoutPreview();
  if (!currentLayout || !originalLayout) return;
  releaseLayoutPointer();
  for (const [id, p] of originalLayout)
    if (!projectHistory.value.layout?.locked.includes(id)) currentLayout.set(id, { ...p });
  projectHistory.commit(configWithPositions());
  if (graph) graph.project = projectHistory.value;
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
    graph?.project,
  );
  if (!nextDrag || projectHistory.value.layout?.locked.includes(nextDrag.id)) return;
  dragging = nextDrag;
  selectedLayoutNode = nextDrag.id;
  renderEditorSelection(layoutControls, nextDrag.id);
  updateLayoutFields();
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
  const moved = positionForDrag(
    dragging,
    point,
    currentFrameState.cameraResolved,
    renderer.frameSpec,
  );
  if (!moved || !updateEditableNodePosition(currentLayout, currentFrameState, dragging.id, moved))
    return;
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
  }
  releaseLayoutPointer();
  setFrame(playback.frame, false);
  refreshUnsavedState();
});
canvas.addEventListener('pointercancel', (event) => {
  if (!dragging || dragging.pointerId !== event.pointerId || !currentLayout) return;
  currentLayout.set(dragging.id, dragging.previous);
  releaseLayoutPointer();
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
layoutExport.addEventListener('click', () => {
  cancelLayoutPreview();
  if (!graph || !currentLayout || sourceDocument === null) return;
  try {
    const output = applyGraphPositions(sourceDocument, graph, currentLayout);
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
    renderEditorMessage(
      layoutControls,
      '已准备导出：' + link.download + '。此文件仅保存源数据坐标，不代表完整项目已保存。',
    );
  } catch (error) {
    renderEditorMessage(
      layoutControls,
      '导出失败：' + (error instanceof Error ? error.message : String(error)),
    );
  }
});

themeToggle.addEventListener('click', () => applyTheme(theme === 'light' ? 'dark' : 'light', true));
lightQuery?.addEventListener?.('change', (event) => {
  if (!pinnedTheme) applyTheme(event.matches ? 'light' : 'dark', false);
});
// Headless frame export and independent frame inspection; no recording or animation state.
window.renderAt = (f) => {
  if (!renderer || !Number.isInteger(f) || f < 0 || f >= playback.totalFrames) return false;
  cancelLayoutPreview();
  if (layoutEditing) stopLayoutEdit();
  setPlaying(false);
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
