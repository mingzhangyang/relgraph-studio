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

export function renderEditorFields(controls: EditorControls, position: Point | undefined): void {
  controls.x.value = position ? String(position.x) : '';
  controls.y.value = position ? String(position.y) : '';
}

export function renderEditorStatus(controls: EditorControls, active: boolean, dirty: boolean): void {
  controls.reset.disabled = !dirty;
  controls.note.textContent = active
    ? '拖动当前可见的节点 · ' + (dirty ? '有未保存调整' : '尚未调整') + ' · 导出后才会写入 JSON'
    : dirty
      ? '有未保存调整 · 点击导出含坐标 JSON 保存'
      : '调整模式关闭 · 只修改导出文件';
}
