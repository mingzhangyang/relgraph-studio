import { uiDiagnostic, uiText } from './i18n.js';
import {
  diagnosticText,
  NO_DIAGNOSTICS_TEXT,
  type Diagnostic,
  type LoadResult,
} from '@relgraph/core';

/**
 * DOM-only diagnostic rendering. The loader owns validation and error wording;
 * studio.ts owns request serials so stale async results never reach this view.
 */
export interface DiagnosticsElements {
  errors: HTMLElement;
  warnings: HTMLElement;
  count: HTMLElement;
}

export interface DiagnosticsView {
  clear(): void;
  render(result: Pick<LoadResult, 'errors' | 'warnings'>): void;
}

export function createDiagnosticsView(
  document: Pick<Document, 'createElement'>,
  elements: DiagnosticsElements,
): DiagnosticsView {
  function clear(): void {
    elements.errors.replaceChildren();
    elements.warnings.replaceChildren();
    elements.errors.className = '';
    elements.warnings.className = '';
    elements.count.hidden = true;
    elements.count.textContent = '0';
    elements.count.removeAttribute('data-level');
  }

  function renderEntries(
    kind: 'errors' | 'warnings',
    entries: readonly Diagnostic[],
    container: HTMLElement,
  ): void {
    if (!entries.length) return;
    const heading = document.createElement('h3');
    heading.textContent = uiText(kind === 'errors' ? '错误' : '警告') + ' · ' + entries.length;
    container.append(heading);
    for (const entry of entries) {
      const text = diagnosticText(entry);
      const item = document.createElement('div');
      item.className = 'diagnostic-item ' + (kind === 'warnings' ? 'warning' : 'error');
      const title = document.createElement('strong');
      title.textContent = text.title.replace(/^提示(?= ·|$)/, uiText('提示'));
      const path = document.createElement('code');
      path.textContent = text.path;
      const message = document.createElement('p');
      message.textContent = uiDiagnostic(text.message);
      const fix = document.createElement('p');
      fix.className = 'fix';
      fix.textContent = uiDiagnostic(text.fix);
      item.append(title, path, message, fix);
      container.append(item);
    }
  }

  return {
    clear,
    render(result) {
      clear();
      renderEntries('errors', result.errors, elements.errors);
      renderEntries('warnings', result.warnings, elements.warnings);
      const errorCount = result.errors.length;
      const total = errorCount + result.warnings.length;
      elements.count.hidden = total === 0;
      elements.count.textContent = String(total);
      elements.count.setAttribute('data-level', errorCount ? 'error' : 'warning');
      if (total === 0) {
        elements.warnings.textContent = uiText(NO_DIAGNOSTICS_TEXT);
        elements.warnings.className = 'ok';
      }
    },
  };
}
