import { validateProjectConfig, type ProjectConfig } from '../project.js';
import { adaptLiteratureDocument, literaryDetailsAt } from '../domains/literature.js';
import { inspectRelGraph } from '../relgraph.js';
import { adaptBiologyDocument, validateBiologyDocument } from '../domains/biology.js';
import { timeAnchor } from './time-anchor.js';
import { GENERIC_FORMAT, inspectGenericDocument } from '../domains/generic.js';
import { LOAD_WORDING, worded, type DiagnosticParams } from '../diagnostic-wording.js';
import type { Bio } from '../../types/relationship-graph.js';
import type { VisualGraph } from '../../types/visual-graph.js';

export interface Diagnostic {
  level: 'error' | 'warning';
  layer: string;
  code: string;
  /**
   * Which wording of the code, where one code has several; with `code` it
   * names the diagnostic's entry in DIAGNOSTIC_WORDING (see diagnosticKey).
   */
  variant?: string;
  /** The values the wording names: fields, limits, counts, allowed values. */
  params?: DiagnosticParams;
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
const issue = (
  key: keyof typeof LOAD_WORDING,
  path: string,
  params?: DiagnosticParams,
  id = '',
): Diagnostic => ({
  level: 'error',
  layer: 'studio',
  path,
  id,
  ...worded(LOAD_WORDING, key, params),
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
    /^\$?\.?(characters|relations|factions|entities|interactions|processes|compartments|presentation|nodes|edges|groups)\[(\d+)\]/,
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
          errors: errors.map((path) => issue('PROJECT_CONFIG.field', path)),
          warnings: [],
        };
      const result = loadDocument(doc.source);
      if (!result.valid) return result;
      const checked = validateProjectConfig(doc.config, result.graph);
      if (checked.length)
        return {
          valid: false,
          errors: checked.map((path) => issue('PROJECT_CONFIG.reference', path)),
          warnings: [],
        };
      const graph = { ...result.graph, project: doc.config as ProjectConfig };
      // A project drawn off the time axis is not redrawn on it, whatever its source says.
      const warnings = timeAnchor(graph)
        ? result.warnings
        : result.warnings.filter((entry) => entry.code !== 'OFF_TIME_AXIS');
      return { ...result, graph, warnings };
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
    } else if (object(doc) && doc.format === GENERIC_FORMAT) {
      // One parse validates and adapts the source.
      const inspected = inspectGenericDocument(doc);
      if (!inspected.valid)
        return {
          valid: false,
          errors: inspected.errors.map((entry) => withOwner(doc, entry)),
          warnings: inspected.warnings.map((entry) => withOwner(doc, entry)),
        };
      const generic = inspected.adapted;
      adapted = generic;
      detailAt = (id) => generic.detailAt(id);
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
        errors: [issue('FORMAT', '$')],
        warnings: [],
      };
    }
    const { graph, diagnostics } = adapted;
    const errors: Diagnostic[] = [];
    if (!graph.scenes.length) errors.push(issue('NO_SCENES', '$.presentation'));
    // Timed facts must not be revealed before the first explicit domain time.
    const hasTimedFacts = [...graph.nodes, ...graph.edges].some(
      (item) =>
        item.visibility && (item.visibility.from !== undefined || item.visibility.to !== undefined),
    );
    if (hasTimedFacts && graph.scenes.length && graph.scenes[0].domainAt === undefined) {
      const field = graph.domain === 'literature' ? 'chapterAt' : 'domainAt';
      errors.push(
        issue('INITIAL_DOMAIN_TIME', `$.presentation[0].${field}`, { field }, graph.scenes[0].id),
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
        : [issue('INVALID_DATA', '$')];
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
      errors: [issue('JSON', '$', { detail: message })],
      warnings: [],
    };
  }
}
