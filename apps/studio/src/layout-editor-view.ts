import { uiStatus, uiText } from './i18n.js';
import type { VisualNode } from '@relgraph/core';
import type { Point } from './position-tool.js';

/**
 * DOM-only adapter for the workspace position tools. It knows how to update
 * controls, but never decides which graph node may be edited or calculates
 * where any node belongs.
 */
export interface EditorControls {
  canvas: HTMLCanvasElement;
  toggle: HTMLButtonElement;
  reset: HTMLButtonElement;
  editor: HTMLElement;
  select: HTMLSelectElement;
  x: HTMLInputElement;
  y: HTMLInputElement;
  apply: HTMLButtonElement;
  note: HTMLElement;
}

/** Coordinator owns eligibility; this adapter only updates button state. */
export function renderEditorAvailability(controls: EditorControls, available: boolean): void {
  controls.toggle.disabled = !available;
  if (!available) controls.reset.disabled = true;
}

export function renderEditorMode(controls: EditorControls, active: boolean): void {
  controls.editor.hidden = !active;
  controls.toggle.setAttribute('aria-pressed', String(active));
  if (active) controls.canvas.classList.add('is-layout-editing');
  else controls.canvas.classList.remove('is-layout-editing');
}

export function renderEditorNodes(
  document: Pick<Document, 'createElement'>,
  controls: EditorControls,
  nodes: readonly Pick<VisualNode, 'id' | 'label'>[],
  selected: string | null,
): void {
  controls.select.replaceChildren();
  for (const node of nodes) {
    const option = document.createElement('option');
    option.value = node.id;
    option.textContent = node.label;
    controls.select.append(option);
  }
  const available = selected !== null;
  controls.select.disabled = !available;
  controls.x.disabled = !available;
  controls.y.disabled = !available;
  controls.apply.disabled = !available;
  controls.select.value = selected ?? '';
}

/** `inTime`: the node's X is its date on a timeline, so only its lane (Y) is edited. */
export function renderEditorFields(
  controls: EditorControls,
  position: Point | undefined,
  inTime = false,
): void {
  controls.x.value = position ? String(position.x) : '';
  controls.y.value = position ? String(position.y) : '';
  controls.x.readOnly = inTime;
  controls.x.title = inTime ? uiText('时间轴：横坐标由日期决定') : '';
}

/** Re-translate the field hints after a language switch, without touching values. */
export function refreshEditorFieldText(controls: EditorControls): void {
  controls.x.title = controls.x.readOnly ? uiText('时间轴：横坐标由日期决定') : '';
}

export function renderEditorStatus(
  controls: EditorControls,
  active: boolean,
  dirty: boolean,
  validationMessage: string | null = null,
  inTime = false,
): void {
  controls.reset.disabled = !dirty;
  const text = validationMessage
    ? uiStatus(validationMessage)
    : active
      ? uiText(inTime ? '时间轴 · 拖动可换泳道，横坐标由日期决定 · ' : '拖动当前可见节点 · ') +
        uiText(dirty ? '有坐标调整' : '尚未调整') +
        uiText(' · 通过文档工具栏导出保存')
      : dirty
        ? uiText('已有坐标调整 · 可保存完整项目或单独导出坐标')
        : uiText('调整模式关闭 · 保存完整项目请使用上方工具栏');
  if (controls.note.textContent !== text) controls.note.textContent = text;
}

export function renderEditorSelection(controls: EditorControls, selected: string): void {
  controls.select.value = selected;
}

export function renderEditorMessage(controls: EditorControls, message: string): void {
  const localized = uiStatus(message);
  if (controls.note.textContent !== localized) controls.note.textContent = localized;
}
