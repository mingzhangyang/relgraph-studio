import { uiText } from './i18n.js';

/** Passive workspace presentation: no graph source, request identity or playback rules. */
type Theme = 'dark' | 'light';
type ExampleId = string;
interface ShellElements {
  canvas: HTMLCanvasElement;
  domainTime: HTMLElement;
  sceneCount: HTMLElement;
  sourceName: HTMLElement;
  sourceNote: HTMLElement;
  /** Example buttons by element id. */
  examples: Readonly<Record<ExampleId, HTMLButtonElement>>;
  themeToggle: HTMLButtonElement;
  dropzone: HTMLLabelElement;
}
const EMPTY_STAGE = {
  dark: { bg: '#101b2a', kicker: '#cfae84', text: '#c4d0d1' },
  light: { bg: '#f6f1e8', kicker: '#a0672a', text: '#3f4c57' },
};
export function createWorkspaceShellView(
  document: Pick<Document, 'documentElement'>,
  elements: ShellElements,
) {
  let emptyMessage = '';
  function paintEmptyStage(message: string, theme: Theme): void {
    const ctx = elements.canvas.getContext('2d'),
      colors = EMPTY_STAGE[theme];
    emptyMessage = message;
    if (!ctx) throw new Error('Canvas 2D context is unavailable');
    const { width, height } = elements.canvas;
    ctx.fillStyle = colors.bg;
    ctx.fillRect(0, 0, width, height);
    // Centred on the canvas of any frame spec. The 720p landscape preview
    // keeps its sizes; portrait and square previews are larger bitmaps shown
    // smaller, so the type grows with the shorter side.
    const k = Math.max(1, Math.min(width, height) / 720);
    ctx.textAlign = 'center';
    ctx.fillStyle = colors.kicker;
    ctx.font = `600 ${13 * k}px system-ui`;
    ctx.fillText('RELGRAPH  /  DIRECTOR STUDIO', width / 2, height / 2 - 30 * k);
    ctx.fillStyle = colors.text;
    ctx.font = `${22 * k}px system-ui`;
    ctx.fillText(uiText(message), width / 2, height / 2 + 12 * k);
    ctx.textAlign = 'left';
  }
  return {
    renderEmptyDomainTime(): void {
      const label = uiText('领域时间：—');
      if (elements.domainTime.textContent !== label) elements.domainTime.textContent = label;
    },
    resetMetadata(): void {
      // Preserve prior source name until a new result is accepted.
      const label = uiText('领域时间：—');
      if (elements.domainTime.textContent !== label) elements.domainTime.textContent = label;
      elements.sceneCount.textContent = '0';
      elements.sourceNote.textContent = '—';
    },
    renderDomainTime(domainAt: number | null, unit: string | undefined): void {
      const text =
        domainAt === null
          ? uiText('领域时间：未指定')
          : `${uiText('领域时间：')}${unit || uiText('时点')} ${domainAt}`;
      if (elements.domainTime.textContent !== text) elements.domainTime.textContent = text;
    },
    renderSourceName(name: string): void {
      elements.sourceName.textContent = name;
    },
    renderSourceSummary(count: number, note?: string, description?: string): void {
      elements.sceneCount.textContent = String(count);
      elements.sourceNote.textContent = note || description || uiText('此数据未提供来源说明。');
    },
    markSource(id: ExampleId | null): void {
      for (const [key, button] of Object.entries(elements.examples))
        button.setAttribute('aria-pressed', String(id === key));
    },
    renderTheme(theme: Theme, persist: boolean): void {
      if (persist) document.documentElement?.setAttribute('data-theme', theme);
      elements.themeToggle.setAttribute(
        'aria-label',
        theme === 'light' ? uiText('切换到深色模式') : uiText('切换到浅色模式'),
      );
      if (elements.themeToggle.lastElementChild)
        elements.themeToggle.lastElementChild.textContent =
          theme === 'light' ? uiText('浅色') : uiText('深色');
    },
    renderDropzoneDragging(dragging: boolean): void {
      elements.dropzone.className = dragging ? 'dropzone dragging' : 'dropzone';
    },
    paintEmptyStage,
    repaintEmptyStage(theme: Theme): void {
      paintEmptyStage(emptyMessage, theme);
    },
  };
}
