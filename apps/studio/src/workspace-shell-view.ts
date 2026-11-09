/** Passive workspace presentation: no graph source, request identity or playback rules. */
type Theme = 'dark' | 'light';
type ExampleId = 'exampleLiterature' | 'exampleBiology';
interface ShellElements {
  canvas: HTMLCanvasElement;
  domainTime: HTMLElement;
  sceneCount: HTMLElement;
  sourceName: HTMLElement;
  sourceNote: HTMLElement;
  exampleLiterature: HTMLButtonElement;
  exampleBiology: HTMLButtonElement;
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
    ctx.fillStyle = colors.bg;
    ctx.fillRect(0, 0, elements.canvas.width, elements.canvas.height);
    ctx.textAlign = 'center';
    ctx.fillStyle = colors.kicker;
    ctx.font = '600 13px system-ui';
    ctx.fillText('RELGRAPH  /  DIRECTOR STUDIO', 640, 330);
    ctx.fillStyle = colors.text;
    ctx.font = '22px system-ui';
    ctx.fillText(message, 640, 372);
    ctx.textAlign = 'left';
  }
  return {
    resetMetadata(): void {
      // Preserve prior source name until a new result is accepted.
      elements.domainTime.textContent = '领域时间：—';
      elements.sceneCount.textContent = '0';
      elements.sourceNote.textContent = '—';
    },
    renderDomainTime(domainAt: number | null, unit: string | undefined): void {
      const text =
        domainAt === null ? '领域时间：未指定' : `领域时间：${unit || '时点'} ${domainAt}`;
      if (elements.domainTime.textContent !== text) elements.domainTime.textContent = text;
    },
    renderSourceName(name: string): void {
      elements.sourceName.textContent = name;
    },
    renderSourceSummary(count: number, note?: string, description?: string): void {
      elements.sceneCount.textContent = String(count);
      elements.sourceNote.textContent = note || description || '此数据未提供来源说明。';
    },
    markSource(id: ExampleId | null): void {
      elements.exampleLiterature.setAttribute('aria-pressed', String(id === 'exampleLiterature'));
      elements.exampleBiology.setAttribute('aria-pressed', String(id === 'exampleBiology'));
    },
    renderTheme(theme: Theme, persist: boolean): void {
      if (persist) document.documentElement?.setAttribute('data-theme', theme);
      const other = theme === 'light' ? '深色' : '浅色';
      elements.themeToggle.setAttribute('aria-label', `切换到${other}模式`);
      if (elements.themeToggle.lastElementChild)
        elements.themeToggle.lastElementChild.textContent = theme === 'light' ? '浅色' : '深色';
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
