import {
  diagnosticHeading,
  diagnosticText,
  NO_DIAGNOSTICS_TEXT,
  parseDocument,
  type LoadResult,
} from '@relgraph/core';
import { layoutGraph } from '@relgraph/core';
import { frameCount } from '@relgraph/core';
import type { Bio } from '@relgraph/core';
import type { DirectorFrameState, ScenePlayback, FrameScene, VisualGraph } from '@relgraph/core';
import {
  createCanvasRenderer,
  FILM_FONT_FACES,
  filmFontQuery,
  type CanvasRenderer,
} from '@relgraph/render';

declare global {
  interface Window {
    renderAt(frame: number): boolean;
    studioFrame(): DirectorFrameState | null;
  }
}

type Theme = 'dark' | 'light';
type Status = 'playing' | 'ready' | 'loading' | 'error';
type DetailAt = (id: string, at: number | null) => Bio | undefined;
type ExampleId = 'exampleLiterature' | 'exampleBiology';

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
  dropzone = requiredElement('dropzone', HTMLLabelElement),
  shots = $('shots'),
  strip = $('sceneStrip');
let graph: VisualGraph | null = null;
let renderer: CanvasRenderer | null = null;
let frame = 0,
  totalFrames = 1,
  playing = false,
  position = 0,
  announcedScene = -1,
  requestSerial = 0,
  loading = false;
let animationId: number | null = null;
let lastTick: number | null = null;
let currentFrameState: DirectorFrameState | null = null;
let currentDetailAt: DetailAt = () => undefined;
let currentLayout: ReturnType<typeof layoutGraph> | null = null;
let emptyMessage = '';
// Workspace and video share one theme. Without a saved choice it follows the OS.
const THEME_KEY = 'relgraph-theme',
  lightQuery = globalThis.matchMedia?.('(prefers-color-scheme: light)');
const EMPTY_STAGE = {
  dark: { bg: '#101b2a', kicker: '#cfae84', text: '#c4d0d1' },
  light: { bg: '#f6f1e8', kicker: '#a0672a', text: '#3f4c57' },
};
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
const setStatus = (text: string, state: Status): void => {
  $('status').textContent = text;
  $('status').setAttribute('data-state', state);
};
const stamp = (seconds: number): string => {
  const t = Math.max(0, seconds),
    minutes = Math.floor(t / 60),
    s = (t % 60).toFixed(2).padStart(5, '0');
  return `${String(minutes).padStart(2, '0')}:${s}`;
};
function setPlaying(next: boolean): void {
  if (animationId !== null) cancelAnimationFrame(animationId);
  animationId = null;
  playing = Boolean(next && renderer && !loading);
  lastTick = null;
  position = frame;
  play.textContent = playing ? '❚❚' : '▶';
  play.setAttribute('aria-label', playing ? '暂停' : '播放');
  play.className = 'icon-button play' + (playing ? ' is-playing' : '');
  if (playing) setStatus('播放中', 'playing');
  else if (renderer && !loading) setStatus('就绪', 'ready');
  if (playing) animationId = requestAnimationFrame(tick);
}
function tick(now: number): void {
  animationId = null;
  if (!playing) return;
  if (lastTick !== null) position += (Math.max(0, now - lastTick) * FPS) / 1000;
  lastTick = now;
  setFrame(Math.floor(position), false);
  if (position >= totalFrames - 1) {
    setPlaying(false);
    return;
  }
  if (playing) animationId = requestAnimationFrame(tick);
}
function renderDiagnostics(result: LoadResult): void {
  for (const [name, entries] of [
    ['errors', result.errors || []],
    ['warnings', result.warnings || []],
  ] as const) {
    const container = $(name);
    container.replaceChildren();
    container.className = '';
    if (!entries.length) continue;
    const heading = document.createElement('h3');
    heading.textContent = diagnosticHeading(name, entries.length);
    container.append(heading);
    for (const entry of entries) {
      const text = diagnosticText(entry);
      const item = document.createElement('div');
      item.className = `diagnostic-item ${name === 'warnings' ? 'warning' : 'error'}`;
      const title = document.createElement('strong');
      title.textContent = text.title;
      const path = document.createElement('code');
      path.textContent = text.path;
      const message = document.createElement('p');
      message.textContent = text.message;
      const fix = document.createElement('p');
      fix.className = 'fix';
      fix.textContent = text.fix;
      item.append(title, path, message, fix);
      container.append(item);
    }
  }
  const errorCount = (result.errors || []).length,
    total = errorCount + (result.warnings || []).length,
    count = $('diagCount');
  count.hidden = !total;
  count.textContent = String(total);
  count.setAttribute('data-level', errorCount ? 'error' : 'warning');
  if (!total) {
    $('warnings').textContent = NO_DIAGNOSTICS_TEXT;
    $('warnings').className = 'ok';
  }
}
function buildShots(graph: VisualGraph): void {
  shots.replaceChildren();
  strip.replaceChildren();
  let start = 0;
  graph.scenes.forEach((scene, index) => {
    const button = document.createElement('button');
    button.type = 'button';
    button.className = 'shot';
    button.setAttribute('aria-label', `跳转至分镜 ${index + 1}`);
    const top = document.createElement('small'),
      number = document.createElement('span');
    number.className = 'shot-index';
    number.textContent = String(index + 1).padStart(2, '0');
    top.append(number, ` ${stamp(start)} · ${scene.durationSec}s`);
    const progress = document.createElement('span');
    progress.className = 'shot-progress';
    progress.setAttribute('aria-hidden', 'true');
    const title = document.createElement('strong');
    title.textContent = `分镜 ${index + 1}`;
    button.append(progress, top, title);
    const target = Math.min(totalFrames - 1, Math.ceil(start * FPS - 1e-9));
    button.addEventListener('click', () => {
      if (loading) return;
      setPlaying(false);
      setFrame(target);
    });
    shots.append(button);
    const segment = document.createElement('span');
    segment.className = 'segment';
    segment.setAttribute('style', `flex-grow:${scene.durationSec}`);
    strip.append(segment);
    start += scene.durationSec;
  });
}
function renderShots(activeIndex: number, activeTitle: string): void {
  // Update existing buttons so focus survives both seeking and playback.
  for (const [index, button] of [...shots.children].entries()) {
    const active = index === activeIndex;
    button.className = 'shot' + (active ? ' active' : '');
    if (active) button.setAttribute('aria-current', 'step');
    else button.removeAttribute('aria-current');
    // Scene order need not match chapter/stage order: reveal only this title.
    if (button.lastElementChild)
      button.lastElementChild.textContent = active ? activeTitle : `分镜 ${index + 1}`;
  }
  for (const [index, segment] of [...strip.children].entries())
    segment.className =
      'segment' + (index === activeIndex ? ' active' : index < activeIndex ? ' done' : '');
}
function updateShotProgress(p: ScenePlayback<FrameScene>): void {
  for (const [index, button] of [...shots.children].entries())
    button.children[0]?.setAttribute(
      'style',
      `transform:scaleX(${index === p.index ? p.progress : 0})`,
    );
}
function updateTranscript(state: DirectorFrameState): void {
  const { view, playback } = state,
    transcript = $('transcript');
  if (!playback.scene) throw new Error('A loaded film must have a current scene');
  transcript.replaceChildren();
  const intro = document.createElement('p');
  intro.textContent = `${playback.scene.title}。${playback.scene.narration || ''}`;
  transcript.append(intro);
  const names = new Map(view.nodes.map((node) => [node.id, node.label]));
  const overlay = state.overlay;
  const detailNode = overlay ? view.nodes.find((node) => node.id === overlay.nodeId) : undefined;
  const detail = detailNode ? currentDetailAt(detailNode.id, playback.domainAt) : undefined;
  const detailText = detailNode && detail?.summary ? `${detailNode.label}：${detail.summary}` : '';
  if (detailText) {
    const heading = document.createElement('strong');
    heading.textContent = '当前人物简介';
    const summary = document.createElement('p');
    summary.textContent = detailText;
    transcript.append(heading, summary);
  }
  const add = (title: string, values: string[]): void => {
    const heading = document.createElement('strong');
    heading.textContent = title;
    const list = document.createElement('ul');
    for (const value of values) {
      const li = document.createElement('li');
      li.textContent = value;
      list.append(li);
    }
    transcript.append(heading, list);
  };
  add(
    '当前可见节点',
    view.nodes.map((node) => node.label),
  );
  add(
    '当前可见关系',
    view.edges.map(
      (edge) =>
        `${names.get(edge.source)} ${edge.directed ? '→' : '—'} ${names.get(edge.target)}：${edge.label || edge.kind} (${edge.kind})`,
    ),
  );
  $('sceneDescription').textContent =
    `${playback.scene.title}。${playback.scene.narration || ''} 当前 ${view.nodes.length} 个节点，${view.edges.length} 条关系。${detailText}`;
}
function setFrame(next: number, updatePosition = true): DirectorFrameState | undefined {
  if (!renderer) return;
  frame = Math.max(0, Math.min(totalFrames - 1, Math.floor(next)));
  if (updatePosition) position = frame;
  const state = renderer.renderFrame(frame),
    p = state.playback;
  if (!p.scene) throw new Error('A loaded film must have a current scene');
  currentFrameState = state;
  scrubber.value = String(frame);
  scrubber.setAttribute(
    'style',
    `--fill:${totalFrames > 1 ? (frame / (totalFrames - 1)) * 100 : 0}%`,
  );
  scrubber.setAttribute('aria-valuetext', `${stamp(frame / FPS)}，分镜 ${p.index + 1}`);
  $('frameNumber').textContent = `FRAME ${frame}`;
  $('time').textContent = `${stamp(frame / FPS)} / ${stamp(p.totalSec)}`;
  $('currentShot').textContent =
    p.scene.title + (p.scene.narration ? '\n' + p.scene.narration : '');
  $('domainTime').textContent =
    p.domainAt === null
      ? '领域时间：未指定'
      : `领域时间：${state.view.timeline?.unit || '时点'} ${p.domainAt}`;
  $('nodeCount').textContent = String(state.view.nodes.length);
  $('edgeCount').textContent = String(state.view.edges.length);
  if (p.index !== announcedScene) {
    announcedScene = p.index;
    renderShots(p.index, p.scene.title);
    updateTranscript(state);
  }
  updateShotProgress(p);
  return state;
}
function paintEmptyStage(message: string): void {
  const ctx = canvas.getContext('2d'),
    colors = EMPTY_STAGE[theme];
  emptyMessage = message;
  if (!ctx) throw new Error('Canvas 2D context is unavailable');
  ctx.fillStyle = colors.bg;
  ctx.fillRect(0, 0, canvas.width, canvas.height);
  ctx.textAlign = 'center';
  ctx.fillStyle = colors.kicker;
  ctx.font = '600 13px system-ui';
  ctx.fillText('RELGRAPH  /  DIRECTOR STUDIO', 640, 330);
  ctx.fillStyle = colors.text;
  ctx.font = '22px system-ui';
  ctx.fillText(message, 640, 372);
  ctx.textAlign = 'left';
}
function clearStudio(): void {
  setPlaying(false);
  graph = null;
  renderer = null;
  currentLayout = null;
  currentFrameState = null;
  currentDetailAt = () => undefined;
  frame = 0;
  position = 0;
  totalFrames = 1;
  announcedScene = -1;
  play.disabled = true;
  restart.disabled = true;
  scrubber.disabled = true;
  scrubber.max = '0';
  scrubber.value = '0';
  scrubber.setAttribute('style', '--fill:0%');
  shots.replaceChildren();
  strip.replaceChildren();
  paintEmptyStage('请选择示例或导入有效的 JSON 数据');
  $('currentShot').textContent = '—';
  $('domainTime').textContent = '领域时间：—';
  $('nodeCount').textContent = '0';
  $('edgeCount').textContent = '0';
  $('sceneCount').textContent = '0';
  $('sourceNote').textContent = '—';
  $('transcript').replaceChildren();
  $('sceneDescription').textContent = '没有已加载的有效数据。';
  $('time').textContent = '00:00.00 / 00:00.00';
  $('frameNumber').textContent = 'FRAME 0';
}
function applyResult(result: LoadResult, name: string): void {
  loading = false;
  clearStudio();
  renderDiagnostics(result);
  $('sourceName').textContent = name;
  if (!result.valid) {
    setStatus('数据校验失败', 'error');
    paintEmptyStage('数据校验失败 · 请查看右侧校验提示');
    return;
  }
  graph = result.graph;
  currentDetailAt = result.detailAt || (() => undefined);
  currentLayout = layoutGraph(graph);
  renderer = createCanvasRenderer(canvas, graph, currentLayout, {
    fps: FPS,
    detailAt: currentDetailAt,
    theme,
  });
  totalFrames = frameCount(graph, FPS);
  scrubber.max = String(totalFrames - 1);
  scrubber.disabled = false;
  play.disabled = false;
  restart.disabled = false;
  buildShots(graph);
  $('sceneCount').textContent = String(graph.scenes.length);
  $('sourceNote').textContent =
    graph.meta.sourceNote || graph.meta.description || '此数据未提供来源说明。';
  setStatus('就绪', 'ready');
  setFrame(0);
}
function beginLoad(): number {
  const serial = ++requestSerial;
  loading = true;
  setPlaying(false);
  play.disabled = true;
  restart.disabled = true;
  scrubber.disabled = true;
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
    if (serial === requestSerial) applyResult(parseDocument(text), name);
  } catch (error) {
    if (serial === requestSerial) applyResult(loadFailure('LOAD', error), name);
  }
}
const markSource = (id: ExampleId | null): void => {
  exampleLiterature.setAttribute('aria-pressed', String(id === 'exampleLiterature'));
  exampleBiology.setAttribute('aria-pressed', String(id === 'exampleBiology'));
};
exampleLiterature.addEventListener('click', () => {
  markSource('exampleLiterature');
  return loadExample(
    '../examples/honglou-provisional.relgraph.json',
    '红楼梦 · 未经原著核实的技术演示',
  );
});
exampleBiology.addEventListener('click', () => {
  markSource('exampleBiology');
  return loadExample('../examples/biology-signaling-synthetic.json', '生物信号 · 虚构合成示例');
});
async function loadFile(file: File | undefined): Promise<void> {
  if (!file) return;
  const serial = beginLoad();
  markSource(null);
  try {
    const text = await file.text();
    if (serial === requestSerial) applyResult(parseDocument(text), file.name);
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
  dropzone.className = 'dropzone dragging';
});
dropzone.addEventListener('dragleave', () => (dropzone.className = 'dropzone'));
dropzone.addEventListener('drop', (event) => {
  event.preventDefault();
  dropzone.className = 'dropzone';
  void loadFile(event.dataTransfer?.files?.[0]);
});
play.addEventListener('click', () => {
  if (!playing && frame >= totalFrames - 1) setFrame(0);
  setPlaying(!playing);
});
restart.addEventListener('click', () => {
  setPlaying(false);
  setFrame(0);
});
scrubber.addEventListener('input', () => {
  setPlaying(false);
  setFrame(Number(scrubber.value));
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
    setPlaying(false);
    setFrame(frame + FPS);
  } else if (event.code === 'ArrowLeft') {
    setPlaying(false);
    setFrame(frame - FPS);
  }
});
function applyTheme(next: Theme, persist: boolean): void {
  theme = next;
  if (persist) {
    pinnedTheme = theme;
    try {
      globalThis.localStorage?.setItem(THEME_KEY, theme);
    } catch {
      // The in-memory choice remains pinned when storage is unavailable.
    }
    document.documentElement?.setAttribute('data-theme', theme);
  }
  const other = theme === 'light' ? '深色' : '浅色';
  themeToggle.setAttribute('aria-label', `切换到${other}模式`);
  if (themeToggle.lastElementChild)
    themeToggle.lastElementChild.textContent = theme === 'light' ? '浅色' : '深色';
  // The theme is a renderer input: rebuild it and redraw the same frame
  // without disturbing the fractional playback position.
  if (renderer && graph && currentLayout) {
    renderer = createCanvasRenderer(canvas, graph, currentLayout, {
      fps: FPS,
      detailAt: currentDetailAt,
      theme,
    });
    setFrame(frame, false);
  } else paintEmptyStage(emptyMessage);
}
themeToggle.addEventListener('click', () => applyTheme(theme === 'light' ? 'dark' : 'light', true));
lightQuery?.addEventListener?.('change', (event) => {
  if (!pinnedTheme) applyTheme(event.matches ? 'light' : 'dark', false);
});
// Headless frame export and independent frame inspection; no recording or animation state.
window.renderAt = (f) => {
  if (!renderer || !Number.isInteger(f) || f < 0 || f >= totalFrames) return false;
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
if (renderer) setFrame(frame, false);
if (startupSerial === requestSerial) {
  markSource('exampleLiterature');
  await loadExample(
    '../examples/honglou-provisional.relgraph.json',
    '红楼梦 · 未经原著核实的技术演示',
  );
}
