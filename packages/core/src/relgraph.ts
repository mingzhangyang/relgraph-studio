/* RelGraph draft v0.1 validation & spoiler-safe projections. No dependencies. */
import schema from '../schema/relationship-graph.schema.json' with { type: 'json' };
import {
  SEMANTIC_WORDING,
  STRUCTURE_WORDING,
  worded,
  type DiagnosticParams,
} from './diagnostic-wording.js';
import type {
  Bio,
  Character,
  GraphDoc,
  PresentationStep,
  Quote,
  Relation,
} from '../types/relationship-graph.js';

export interface LiteraryDiagnostic {
  level: 'error' | 'warning';
  layer: 'structure' | 'semantic';
  code: string;
  /** Which wording of the code, where it has several (see STRUCTURE_WORDING). */
  variant?: string;
  /** The values the wording names. */
  params?: DiagnosticParams;
  path: string;
  id: string;
  message: string;
  fix: string;
}
export interface LiteraryDiagnostics {
  valid: boolean;
  errors: LiteraryDiagnostic[];
  warnings: LiteraryDiagnostic[];
}
type LiteraryInspection =
  | {
      valid: true;
      document: GraphDoc;
      errors: LiteraryDiagnostic[];
      warnings: LiteraryDiagnostic[];
    }
  | { valid: false; errors: LiteraryDiagnostic[]; warnings: LiteraryDiagnostic[] };

const object = (value: unknown): value is Record<string, unknown> =>
  value !== null && typeof value === 'object' && !Array.isArray(value);
const describe = (value: unknown): string => {
  try {
    return JSON.stringify(value) ?? String(value);
  } catch {
    return '[unserializable value]';
  }
};

// Refuse schema features this scanner cannot validate: otherwise a newly
// generated source type could become stricter than the runtime check.
const schemaKeywords = new Set([
  '$schema',
  '$ref',
  '$defs',
  'title',
  'description',
  'type',
  'const',
  'enum',
  'pattern',
  'minimum',
  'maximum',
  'minItems',
  'items',
  'required',
  'properties',
  'additionalProperties',
]);

/** The schema is also the source of GraphDoc. This guard scans that same schema. */
function scanStructure(doc: unknown, errors: LiteraryDiagnostic[]): doc is GraphDoc {
  const fail = (key: keyof typeof STRUCTURE_WORDING, path: string, params?: DiagnosticParams) =>
    errors.push({
      level: 'error',
      layer: 'structure',
      path,
      id: '',
      ...worded(STRUCTURE_WORDING, key, params),
    });
  const typeOK = (v: unknown, type: string): boolean =>
    type === 'object'
      ? object(v)
      : type === 'array'
        ? Array.isArray(v)
        : type === 'integer'
          ? Number.isInteger(v)
          : type === 'number'
            ? typeof v === 'number' && Number.isFinite(v)
            : typeof v === type;
  const scan = (v: unknown, rawRule: unknown, path: string): void => {
    if (!object(rawRule)) {
      fail('BROKEN_REF.rule', path);
      return;
    }
    const rule = rawRule;
    for (const keyword of Object.keys(rule)) {
      if (!schemaKeywords.has(keyword)) {
        fail('UNSUPPORTED_SCHEMA.keyword', path, { keyword });
        return;
      }
    }
    if (
      (rule.type !== undefined &&
        (typeof rule.type !== 'string' ||
          !['object', 'array', 'integer', 'number', 'string', 'boolean'].includes(rule.type))) ||
      (rule.additionalProperties !== undefined && typeof rule.additionalProperties !== 'boolean')
    ) {
      fail('UNSUPPORTED_SCHEMA.rule', path);
      return;
    }
    if (typeof rule.$ref === 'string') {
      if (Object.keys(rule).some((key) => !['$ref', 'title', 'description'].includes(key))) {
        fail('UNSUPPORTED_SCHEMA.siblings', path);
        return;
      }
      let ref: unknown = schema;
      for (const k of rule.$ref.split('/').slice(1)) ref = object(ref) ? ref[k] : undefined;
      if (ref) scan(v, ref, path);
      else fail('BROKEN_REF.ref', path, { ref: rule.$ref });
      return;
    }
    if (typeof rule.type === 'string' && !typeOK(v, rule.type)) {
      fail('TYPE', path, { type: rule.type });
      return;
    }
    if (Object.hasOwn(rule, 'const') && v !== rule.const)
      fail('VERSION', path, { value: describe(v) });
    if (Array.isArray(rule.enum) && !rule.enum.includes(v))
      fail('ENUM', path, { value: describe(v) });
    if (
      typeof v === 'string' &&
      typeof rule.pattern === 'string' &&
      !new RegExp(rule.pattern).test(v)
    )
      fail('PATTERN', path, { value: v });
    if (typeof v === 'number') {
      if (typeof rule.minimum === 'number' && v < rule.minimum)
        fail('MIN', path, { minimum: rule.minimum });
      if (typeof rule.maximum === 'number' && v > rule.maximum)
        fail('MAX', path, { maximum: rule.maximum });
    }
    if (Array.isArray(v)) {
      if (typeof rule.minItems === 'number' && v.length < rule.minItems)
        fail('ARRAY_SIZE', path, { minItems: rule.minItems });
      if (rule.items)
        v.forEach((item: unknown, i: number) => scan(item, rule.items, `${path}[${i}]`));
    } else if (object(v)) {
      if (Array.isArray(rule.required))
        for (const k of rule.required) {
          if (typeof k === 'string' && !Object.hasOwn(v, k))
            fail('REQUIRED', `${path}.${k}`, { property: k });
        }
      const properties = object(rule.properties) ? rule.properties : {};
      if (rule.additionalProperties === false)
        for (const k of Object.keys(v)) {
          if (!Object.hasOwn(properties, k)) fail('UNKNOWN_FIELD', `${path}.${k}`, { property: k });
        }
      for (const [k, sub] of Object.entries(properties))
        if (Object.hasOwn(v, k)) scan(v[k], sub, `${path}.${k}`);
    }
  };
  scan(doc, schema, '$');
  return errors.length === 0;
}

export function inspectRelGraph(doc: unknown): LiteraryInspection {
  const errors: LiteraryDiagnostic[] = [],
    warnings: LiteraryDiagnostic[] = [];
  type Key = keyof typeof SEMANTIC_WORDING;
  const issue = (
    level: LiteraryDiagnostic['level'],
    key: Key,
    path: string,
    id: string,
    params?: DiagnosticParams,
  ): LiteraryDiagnostic => ({
    level,
    layer: 'semantic',
    path,
    id: id || '',
    ...worded(SEMANTIC_WORDING, key, params),
  });
  const fail = (key: Key, path: string, id: string, params?: DiagnosticParams) =>
    errors.push(issue('error', key, path, id, params));
  const warn = (key: Key, path: string, id: string, params?: DiagnosticParams) =>
    warnings.push(issue('warning', key, path, id, params));
  if (!scanStructure(doc, errors)) return { valid: false, errors, warnings };
  const collections: [string, ReadonlyArray<{ id: string }>][] = [
    ['factions', doc.factions || []],
    ['characters', doc.characters],
    ['relations', doc.relations],
    ['presentation', doc.presentation || []],
  ];
  for (const [kind, items] of collections) {
    const seen = new Set();
    items.forEach((x, i) => {
      if (seen.has(x.id)) fail('DUPLICATE_ID', `${kind}[${i}].id`, x.id, { id: x.id });
      seen.add(x.id);
    });
  }
  const chars = new Set(doc.characters.map((c) => c.id)),
    factions = new Set((doc.factions || []).map((f) => f.id)),
    rels = new Set(doc.relations.map((r) => r.id)),
    relationById = new Map(doc.relations.map((r) => [r.id, r]));
  const limit = doc.timeline?.total;
  const time = (v: number | undefined, path: string, who: string) => {
    if (v !== undefined && (v < 1 || (limit !== undefined && v > limit)))
      fail('TIME_RANGE', path, who, { value: v, limit: limit ?? '∞' });
  };
  const degree = Object.fromEntries(doc.characters.map((c) => [c.id, 0]));
  doc.characters.forEach((c, i) => {
    const path = `characters[${i}]`;
    if (c.factionId && !factions.has(c.factionId))
      fail('UNKNOWN_FACTION', `${path}.factionId`, c.id, { faction: c.factionId });
    time(c.firstAppearance, `${path}.firstAppearance`, c.id);
    if (Array.from(c.bio.summary).length > 120) warn('BIO_LENGTH', `${path}.bio.summary`, c.id);
    (c.bio.quotes || []).forEach((q, j) => time(q.at, `${path}.bio.quotes[${j}].at`, c.id));
  });
  const signatures = new Map<string, string>();
  doc.relations.forEach((r, i) => {
    const path = `relations[${i}]`;
    if (!chars.has(r.source)) fail('UNKNOWN_SOURCE', `${path}.source`, r.id, { ref: r.source });
    if (!chars.has(r.target)) fail('UNKNOWN_TARGET', `${path}.target`, r.id, { ref: r.target });
    if (r.source === r.target) fail('SELF_LOOP', path, r.id);
    if (r.type === 'other' && !r.label) fail('OTHER_LABEL', `${path}.label`, r.id);
    const endpoints = r.directed === true ? [r.source, r.target] : [r.source, r.target].sort();
    const signature = JSON.stringify([r.directed === true, ...endpoints, r.type, r.label || '']);
    if (signatures.has(signature))
      fail('DUPLICATE_RELATION', path, r.id, { relation: signatures.get(signature)! });
    signatures.set(signature, r.id);
    if (chars.has(r.source)) degree[r.source]++;
    if (chars.has(r.target)) degree[r.target]++;
    time(r.chapters?.from, `${path}.chapters.from`, r.id);
    time(r.chapters?.to, `${path}.chapters.to`, r.id);
    if (
      r.chapters?.from !== undefined &&
      r.chapters?.to !== undefined &&
      r.chapters.from > r.chapters.to
    )
      fail('INVERTED_INTERVAL', `${path}.chapters`, r.id);
    (r.evidence || []).forEach((q, j) => time(q.at, `${path}.evidence[${j}].at`, r.id));
  });
  (doc.presentation || []).forEach((s, i) => {
    const path = `presentation[${i}]`;
    if (s.durationSec <= 0) fail('DURATION', `${path}.durationSec`, s.id);
    if (s.transitionMs !== undefined && s.transitionMs < 0)
      fail('TRANSITION', `${path}.transitionMs`, s.id);
    const c = s.camera || {},
      h = s.highlight || {};
    if (c.focusNodeId && c.fitIds?.length) fail('CAMERA_CONFLICT', `${path}.camera`, s.id);
    const testRef = (value: string | undefined, set: Set<string>, path: string, kind: string) => {
      if (value && !set.has(value)) fail('UNKNOWN_REF', path, s.id, { kind, ref: value });
    };
    testRef(c.focusNodeId, chars, `${path}.camera.focusNodeId`, 'character');
    (c.fitIds || []).forEach((x, j) =>
      testRef(x, chars, `${path}.camera.fitIds[${j}]`, 'character'),
    );
    (h.characterIds || []).forEach((x, j) =>
      testRef(x, chars, `${path}.highlight.characterIds[${j}]`, 'character'),
    );
    (h.relationIds || []).forEach((x, j) =>
      testRef(x, rels, `${path}.highlight.relationIds[${j}]`, 'relation'),
    );
    testRef(h.factionId, factions, `${path}.highlight.factionId`, 'faction');
    testRef(s.openBioId, chars, `${path}.openBioId`, 'character');
    time(s.chapterAt, `${path}.chapterAt`, s.id);
    if (s.evidence) {
      // A card shows a relation's quotations; indices count every quotation
      // as written, and one without text can never be shown.
      const at = `${path}.evidence`,
        { edgeId, items } = s.evidence,
        relation = relationById.get(edgeId);
      if (!relation) testRef(edgeId, rels, `${at}.edgeId`, 'relation');
      else {
        const quotes = relation.evidence || [],
          shown = (n: number) => n < quotes.length && quotes[n].text.trim() !== '';
        if (!quotes.some((_, n) => shown(n))) fail('SCENE_EVIDENCE.empty', at, s.id);
        else if (items?.some((n, j) => !shown(n) || items.indexOf(n) !== j))
          fail('SCENE_EVIDENCE.items', `${at}.items`, s.id, { last: quotes.length - 1 });
      }
      if (s.openBioId) fail('SCENE_EVIDENCE.card', at, s.id);
    }
  });
  if (doc.characters.filter((c) => c.importance === 5).length > 2)
    warn('TOO_MANY_LEADS', '$.characters', '');
  if (
    doc.relations.length &&
    doc.relations.filter((r) => r.strength === 5).length / doc.relations.length > 0.15
  )
    warn('TOO_MANY_STRONG', '$.relations', '');
  doc.characters.forEach((c, i) => {
    if (degree[c.id] === 0 && c.status !== 'mentioned') warn('ORPHAN', `characters[${i}]`, c.id);
  });
  if (
    doc.timeline &&
    (doc.presentation || []).some((s) => s.chapterAt !== undefined) &&
    doc.relations.every((r) => r.chapters === undefined)
  )
    warn('UNTIMED_EDGES', '$.relations', '');
  if (doc.characters.filter((c) => !c.position).length / doc.characters.length > 0.5)
    warn('MISSING_POSITIONS', '$.characters', '');
  return errors.length
    ? { valid: false, errors, warnings }
    : { valid: true, document: doc, errors, warnings };
}

export function validateRelGraph(doc: unknown): LiteraryDiagnostics {
  const { valid, errors, warnings } = inspectRelGraph(doc);
  return { valid, errors, warnings };
}

export function visibleStory(
  doc: GraphDoc,
  chapter: number | null = null,
  spoilerSafe = true,
): { characters: Character[]; relations: Relation[]; bios: Record<string, Bio> } {
  const point = chapter !== null && Number.isFinite(chapter) ? chapter : null;
  // Quotations without a known chapter remain hidden whenever a chapter is selected.
  // Never change the source document.
  const visibleQuote = (q: Quote) => point === null || (q.at !== undefined && q.at <= point);
  const characters = doc.characters
    .filter((c) => point === null || c.firstAppearance === undefined || c.firstAppearance <= point)
    .map((c) => {
      if (!spoilerSafe) return c;
      const bio = { ...c.bio };
      delete bio.fate;
      // A complete character arc is also a potential future spoiler.
      delete bio.arc;
      if (bio.quotes) bio.quotes = bio.quotes.filter(visibleQuote).map((q) => ({ ...q }));
      // v0.1 has no timestamp for a death event. Do not leak mortality status.
      return { ...c, bio, status: c.status === 'deceased' ? 'unknown' : c.status };
    });
  const ids = new Set(characters.map((c) => c.id));
  const relations = doc.relations
    .filter(
      (r) =>
        ids.has(r.source) &&
        ids.has(r.target) &&
        (point === null ||
          ((r.chapters?.from ?? 1) <= point && (r.chapters?.to ?? Infinity) >= point)),
    )
    .map((r) => {
      if (!spoilerSafe) return r;
      const safe = { ...r };
      if (r.evidence) safe.evidence = r.evidence.filter(visibleQuote).map((q) => ({ ...q }));
      return safe;
    });
  const bios = Object.fromEntries(characters.map((c) => [c.id, c.bio]));
  return { characters, relations, bios };
}
export function timelineScenes(
  doc: GraphDoc,
): (PresentationStep & { startSec: number; endSec: number; chapter: number | null })[] {
  let startSec = 0,
    chapter: number | null = null;
  return (doc.presentation || []).map((step) => {
    if (step.chapterAt !== undefined) chapter = step.chapterAt;
    const s = { ...step, startSec, endSec: startSec + step.durationSec, chapter };
    startSec = s.endSec;
    return s;
  });
}
