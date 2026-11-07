import { readFile } from 'node:fs/promises';
import {
  diagnosticHeading,
  diagnosticText,
  NO_DIAGNOSTICS_TEXT,
  parseDocument,
  type LoadResult,
} from '@relgraph/core';

/** Read and validate a document exactly as the workspace does. */
export async function loadFile(path: string): Promise<{ text: string; result: LoadResult }> {
  let text: string;
  try {
    text = await readFile(path, 'utf8');
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    return {
      text: '',
      result: {
        valid: false,
        errors: [
          {
            level: 'error',
            layer: 'cli',
            code: 'FILE',
            path: '$',
            id: '',
            message: `无法读取文件：${message}`,
            fix: '检查文件路径和读取权限。',
          },
        ],
        warnings: [],
      },
    };
  }
  return { text, result: parseDocument(text) };
}

/**
 * Diagnostics as the workspace lists them: a heading per list, then each
 * entry's code and ID, JSON path, message and suggested fix.
 */
export function formatDiagnostics(result: Pick<LoadResult, 'errors' | 'warnings'>): string {
  const lines: string[] = [];
  for (const [kind, entries] of [
    ['errors', result.errors],
    ['warnings', result.warnings],
  ] as const) {
    if (!entries.length) continue;
    lines.push(diagnosticHeading(kind, entries.length));
    for (const entry of entries) {
      const text = diagnosticText(entry);
      lines.push(
        `  ${kind === 'errors' ? '✗' : '!'} ${text.title}`,
        `    ${text.path}`,
        `    ${text.message}`,
        `    ${text.fix}`,
      );
    }
  }
  if (!lines.length) lines.push(NO_DIAGNOSTICS_TEXT);
  return lines.join('\n') + '\n';
}

/** Every string value of a parsed JSON document (keys excluded). */
export function* documentStrings(value: unknown): Generator<string> {
  if (typeof value === 'string') yield value;
  else if (Array.isArray(value)) for (const item of value) yield* documentStrings(item);
  else if (value && typeof value === 'object')
    for (const item of Object.values(value)) yield* documentStrings(item);
}
