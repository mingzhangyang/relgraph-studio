import { validateProjectConfig, type ProjectConfig } from '../project.js';
import { adaptLiteratureDocument, literaryDetailsAt } from '../domains/literature.js';
import { inspectRelGraph } from '../relgraph.js';
import { adaptBiologyDocument, validateBiologyDocument } from '../domains/biology.js';
import type { Bio } from '../../types/relationship-graph.js';
import type { VisualGraph } from '../../types/visual-graph.js';

export interface Diagnostic {
  level: 'error' | 'warning';
  layer: string;
  code: string;
  path: string;
  id: unknown;
  message: string;
  fix: string;
}

/** One diagnostic as the workspace and the CLI show it. */
export interface DiagnosticText {
  /** Code and record ID, e.g. `UNKNOWN_TARGET · r01`. */
  title: string;
  /** JSON path of the offending value. */
  path: string;
  message: string;
  /** Suggested fix, prefixed with 建议：. */
  fix: string;
}
export function diagnosticText(entry: Partial<Diagnostic>): DiagnosticText {
  const id = entry.id;
  const displayId =
    typeof id === 'string' || typeof id === 'number' || typeof id === 'boolean' ? String(id) : '';
  return {
    title: `${entry.code || '提示'}${displayId ? ' · ' + displayId : ''}`,
    path: entry.path || '$',
    message: entry.message || '数据无效',
    fix: '建议：' + (entry.fix || '检查数据并重试。'),
  };
}
/** Heading of a diagnostics list, e.g. `错误 · 2`. */
export const diagnosticHeading = (kind: 'errors' | 'warnings', count: number): string =>
  `${kind === 'errors' ? '错误' : '警告'} · ${count}`;
/** Shown when a document has neither errors nor warnings. */
export const NO_DIAGNOSTICS_TEXT = '未发现校验问题。';

type DetailAt = (id: string, at: number | null) => Bio | undefined;
export type LoadResult =
  | {
      valid: true;
      graph: VisualGraph;
      errors: Diagnostic[];
      warnings: Diagnostic[];
      detailAt: DetailAt;
    }
  | { valid: false; errors: Diagnostic[]; warnings: Diagnostic[] };
const object = (value: unknown): value is Record<string, unknown> =>
  value !== null && typeof value === 'object' && !Array.isArray(value);
const issue = (code: string, path: string, message: string, fix: string, id = ''): Diagnostic => ({
  level: 'error',
  layer: 'studio',
  code,
  path,
  id,
  message,
  fix,
});
const isDiagnostic = (value: unknown): value is Diagnostic =>
  object(value) &&
  (value.level === 'error' || value.level === 'warning') &&
  typeof value.layer === 'string' &&
  typeof value.code === 'string' &&
  typeof value.path === 'string' &&
  typeof value.message === 'string' &&
  typeof value.fix === 'string';

// Recover the enclosing record ID without ever displaying its source value.
function withOwner(doc: unknown, entry: Diagnostic): Diagnostic {
  if (
    entry.id &&
    (typeof entry.id === 'string' || typeof entry.id === 'number' || typeof entry.id === 'boolean')
  )
    return entry;
  const match = entry.path.match(
    /^\$?\.?(characters|relations|factions|entities|interactions|processes|compartments|presentation)\[(\d+)\]/,
  );
  const collection: unknown = match && object(doc) ? doc[match[1]] : undefined;
  const record: unknown =
    match && Array.isArray(collection) ? collection[Number(match[2])] : undefined;
  const id = object(record) ? record.id : undefined;
  return { ...entry, id: typeof id === 'string' ? id : '' };
}

/** One entry point for built-in examples and untrusted local JSON files. */
export function loadDocument(doc: unknown): LoadResult {
  try {
    if (object(doc) && doc.format === 'relgraph.studio/1') {
      const errors = validateProjectConfig(doc.config);
      if (Object.keys(doc).some((k) => !['format', 'source', 'config'].includes(k)))
        errors.push('project: unknown field');
      if (object(doc.source) && doc.source.format === 'relgraph.studio/1')
        errors.push('project: nested project');
      if (errors.length)
        return {
          valid: false,
          errors: errors.map((path) =>
            issue('PROJECT_CONFIG', path, '项目配置无效。', '修正该配置字段或移除覆盖。'),
          ),
          warnings: [],
        };
      const result = loadDocument(doc.source);
      if (!result.valid) return result;
      const checked = validateProjectConfig(doc.config, result.graph);
      if (checked.length)
        return {
          valid: false,
          errors: checked.map((path) =>
            issue('PROJECT_CONFIG', path, '项目配置无效。', '检查对象引用与样式范围。'),
          ),
          warnings: [],
        };
      return { ...result, graph: { ...result.graph, project: doc.config as ProjectConfig } };
    }
    let adapted;
    let detailAt: DetailAt = () => undefined;
    if (object(doc) && Object.hasOwn(doc, 'schemaVersion')) {
      const inspected = inspectRelGraph(doc);
      if (!inspected.valid)
        return {
          valid: false,
          errors: inspected.errors.map((entry) => withOwner(doc, entry)),
          warnings: inspected.warnings.map((entry) => withOwner(doc, entry)),
        };
      adapted = adaptLiteratureDocument(doc);
      const source = inspected.document;
      detailAt = (id, at) => literaryDetailsAt(source, at, { spoilerSafe: true })[id];
    } else if (object(doc) && Object.hasOwn(doc, 'format')) {
      const sourceDiagnostics = validateBiologyDocument(doc);
      if (!sourceDiagnostics.valid)
        return {
          valid: false,
          errors: sourceDiagnostics.errors.map((entry) => withOwner(doc, entry)),
          warnings: sourceDiagnostics.warnings.map((entry) => withOwner(doc, entry)),
        };
      adapted = adaptBiologyDocument(doc);
    } else {
      return {
        valid: false,
        errors: [
          issue(
            'FORMAT',
            '$',
            '无法识别数据格式。',
            '文学数据需要 schemaVersion: "0.1"；生物学数据需要 format: "relgraph.bio/0.1-draft"。',
          ),
        ],
        warnings: [],
      };
    }
    const { graph, diagnostics } = adapted;
    const errors: Diagnostic[] = [];
    if (!graph.scenes.length)
      errors.push(
        issue(
          'NO_SCENES',
          '$.presentation',
          '没有可播放的分镜。',
          '请在 presentation 中至少添加一个分镜。',
        ),
      );
    // Timed facts must not be revealed before the first explicit domain time.
    const hasTimedFacts = [...graph.nodes, ...graph.edges].some(
      (item) =>
        item.visibility && (item.visibility.from !== undefined || item.visibility.to !== undefined),
    );
    if (hasTimedFacts && graph.scenes.length && graph.scenes[0].domainAt === undefined) {
      const field = graph.domain === 'literature' ? 'chapterAt' : 'domainAt';
      errors.push(
        issue(
          'INITIAL_DOMAIN_TIME',
          `$.presentation[0].${field}`,
          '数据包含时间范围，但首个分镜没有指定领域时间。',
          `为首个分镜设置 ${field}，以避免提前显示未来对象。`,
          graph.scenes[0].id,
        ),
      );
    }
    const warnings = diagnostics.warnings.map((entry) => withOwner(doc, entry));
    if (errors.length) return { valid: false, errors, warnings };
    return { valid: true, graph, errors: [], warnings, detailAt };
  } catch (error: unknown) {
    const issues: unknown = object(error) ? error.issues : undefined;
    const entries: Diagnostic[] =
      Array.isArray(issues) && issues.length && issues.every(isDiagnostic)
        ? issues
        : [
            issue(
              'INVALID_DATA',
              '$',
              '数据无法转换为图谱。',
              '检查文件格式、字段类型和必填字段后重试。',
            ),
          ];
    return { valid: false, errors: entries.map((entry) => withOwner(doc, entry)), warnings: [] };
  }
}
export function parseDocument(text: string): LoadResult {
  try {
    const value: unknown = JSON.parse(text);
    return loadDocument(value);
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : String(error);
    return {
      valid: false,
      errors: [issue('JSON', '$', `JSON 语法错误：${message}`, '检查引号、逗号和括号后重试。')],
      warnings: [],
    };
  }
}
