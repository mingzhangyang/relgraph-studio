/* RelGraph draft v0.1 validation & spoiler-safe projections. No dependencies. */
import schema from '../schema/relationship-graph.schema.json' with { type: 'json' };
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
  const fail = (code: string, path: string, message: string, fix: string) =>
    errors.push({ level: 'error', layer: 'structure', code, path, id: '', message, fix });
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
      fail('BROKEN_REF', path, 'Schema rule is invalid', '修复 Schema。');
      return;
    }
    const rule = rawRule;
    for (const keyword of Object.keys(rule)) {
      if (!schemaKeywords.has(keyword)) {
        fail(
          'UNSUPPORTED_SCHEMA',
          path,
          `Unsupported schema keyword ${keyword}`,
          '更新 Schema 校验器。',
        );
        return;
      }
    }
    if (
      (rule.type !== undefined &&
        (typeof rule.type !== 'string' ||
          !['object', 'array', 'integer', 'number', 'string', 'boolean'].includes(rule.type))) ||
      (rule.additionalProperties !== undefined && typeof rule.additionalProperties !== 'boolean')
    ) {
      fail('UNSUPPORTED_SCHEMA', path, 'Unsupported schema rule', '更新 Schema 校验器。');
      return;
    }
    if (typeof rule.$ref === 'string') {
      if (Object.keys(rule).some((key) => !['$ref', 'title', 'description'].includes(key))) {
        fail(
          'UNSUPPORTED_SCHEMA',
          path,
          'Schema reference has unsupported siblings',
          '更新 Schema 校验器。',
        );
        return;
      }
      let ref: unknown = schema;
      for (const k of rule.$ref.split('/').slice(1)) ref = object(ref) ? ref[k] : undefined;
      if (ref) scan(v, ref, path);
      else fail('BROKEN_REF', path, `Schema reference ${rule.$ref} is invalid`, '修复 Schema。');
      return;
    }
    if (typeof rule.type === 'string' && !typeOK(v, rule.type)) {
      fail('TYPE', path, `Expected ${rule.type}`, '修正字段类型。');
      return;
    }
    if (Object.hasOwn(rule, 'const') && v !== rule.const)
      fail(
        'VERSION',
        path,
        `Unsupported schemaVersion ${describe(v)}; supported: 0.1`,
        '请使用 0.1 数据，或升级播放器。',
      );
    if (Array.isArray(rule.enum) && !rule.enum.includes(v))
      fail('ENUM', path, `Invalid value ${describe(v)}`, '使用规范中的枚举值。');
    if (
      typeof v === 'string' &&
      typeof rule.pattern === 'string' &&
      !new RegExp(rule.pattern).test(v)
    )
      fail(
        'PATTERN',
        path,
        `Invalid value ${v}`,
        'id 使用小写 ASCII、数字与连字符；颜色使用 #RRGGBB。',
      );
    if (typeof v === 'number') {
      if (typeof rule.minimum === 'number' && v < rule.minimum)
        fail('MIN', path, `Must be >= ${rule.minimum}`, '提高数值。');
      if (typeof rule.maximum === 'number' && v > rule.maximum)
        fail('MAX', path, `Must be <= ${rule.maximum}`, '降低数值。');
    }
    if (Array.isArray(v)) {
      if (typeof rule.minItems === 'number' && v.length < rule.minItems)
        fail('ARRAY_SIZE', path, `Expected at least ${rule.minItems} item(s)`, '增加必填数组项。');
      if (rule.items)
        v.forEach((item: unknown, i: number) => scan(item, rule.items, `${path}[${i}]`));
    } else if (object(v)) {
      if (Array.isArray(rule.required))
        for (const k of rule.required) {
          if (typeof k === 'string' && !Object.hasOwn(v, k))
            fail('REQUIRED', `${path}.${k}`, `Missing required property ${k}`, '补全必填字段。');
        }
      const properties = object(rule.properties) ? rule.properties : {};
      if (rule.additionalProperties === false)
        for (const k of Object.keys(v)) {
          if (!Object.hasOwn(properties, k))
            fail(
              'UNKNOWN_FIELD',
              `${path}.${k}`,
              `Unknown property ${k}`,
              '移到允许的 extra 对象或删除。',
            );
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
  const issue = (
    level: LiteraryDiagnostic['level'],
    layer: LiteraryDiagnostic['layer'],
    code: string,
    path: string,
    id: string,
    message: string,
    fix: string,
  ): LiteraryDiagnostic => ({
    level,
    layer,
    code,
    path,
    id: id || '',
    message,
    fix,
  });
  const fail = (
    layer: LiteraryDiagnostic['layer'],
    code: string,
    path: string,
    id: string,
    message: string,
    fix: string,
  ) => errors.push(issue('error', layer, code, path, id, message, fix));
  const warn = (code: string, path: string, id: string, message: string, fix: string) =>
    warnings.push(issue('warning', 'semantic', code, path, id, message, fix));
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
      if (seen.has(x.id))
        fail(
          'semantic',
          'DUPLICATE_ID',
          `${kind}[${i}].id`,
          x.id,
          `Duplicate id: ${x.id}`,
          '使用未占用的稳定 id。',
        );
      seen.add(x.id);
    });
  }
  const chars = new Set(doc.characters.map((c) => c.id)),
    factions = new Set((doc.factions || []).map((f) => f.id)),
    rels = new Set(doc.relations.map((r) => r.id));
  const limit = doc.timeline?.total;
  const time = (v: number | undefined, path: string, who: string) => {
    if (v !== undefined && (v < 1 || (limit !== undefined && v > limit)))
      fail(
        'semantic',
        'TIME_RANGE',
        path,
        who,
        `Time point ${v} outside [1, ${limit ?? '∞'}]`,
        '调整为有效时点。',
      );
  };
  const degree = Object.fromEntries(doc.characters.map((c) => [c.id, 0]));
  doc.characters.forEach((c, i) => {
    const path = `characters[${i}]`;
    if (c.factionId && !factions.has(c.factionId))
      fail(
        'semantic',
        'UNKNOWN_FACTION',
        `${path}.factionId`,
        c.id,
        `Unknown faction ${c.factionId}`,
        '在 factions 中添加阵营或修改引用。',
      );
    time(c.firstAppearance, `${path}.firstAppearance`, c.id);
    if (Array.from(c.bio.summary).length > 120)
      warn(
        'BIO_LENGTH',
        `${path}.bio.summary`,
        c.id,
        'Biography summary exceeds 120 characters',
        '缩短摘要。',
      );
    (c.bio.quotes || []).forEach((q, j) => time(q.at, `${path}.bio.quotes[${j}].at`, c.id));
  });
  const signatures = new Map<string, string>();
  doc.relations.forEach((r, i) => {
    const path = `relations[${i}]`;
    if (!chars.has(r.source))
      fail(
        'semantic',
        'UNKNOWN_SOURCE',
        `${path}.source`,
        r.id,
        `Unknown source ${r.source}`,
        '改为已有的人物 id。',
      );
    if (!chars.has(r.target))
      fail(
        'semantic',
        'UNKNOWN_TARGET',
        `${path}.target`,
        r.id,
        `Unknown target ${r.target}`,
        '改为已有的人物 id。',
      );
    if (r.source === r.target)
      fail('semantic', 'SELF_LOOP', path, r.id, 'Self-loop forbidden', '改写到人物小传。');
    if (r.type === 'other' && !r.label)
      fail(
        'semantic',
        'OTHER_LABEL',
        `${path}.label`,
        r.id,
        'other requires a label',
        '提供关系短标签。',
      );
    const endpoints = r.directed === true ? [r.source, r.target] : [r.source, r.target].sort();
    const signature = JSON.stringify([r.directed === true, ...endpoints, r.type, r.label || '']);
    if (signatures.has(signature))
      fail(
        'semantic',
        'DUPLICATE_RELATION',
        path,
        r.id,
        `Duplicate of ${signatures.get(signature)}`,
        '合并相同人物对、type、label 的关系。',
      );
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
      fail(
        'semantic',
        'INVERTED_INTERVAL',
        `${path}.chapters`,
        r.id,
        'chapters.from exceeds chapters.to',
        '修正生效区间。',
      );
    (r.evidence || []).forEach((q, j) => time(q.at, `${path}.evidence[${j}].at`, r.id));
  });
  (doc.presentation || []).forEach((s, i) => {
    const path = `presentation[${i}]`;
    if (s.durationSec <= 0)
      fail(
        'semantic',
        'DURATION',
        `${path}.durationSec`,
        s.id,
        'durationSec must be positive',
        '设置正数秒数。',
      );
    if (s.transitionMs !== undefined && s.transitionMs < 0)
      fail(
        'semantic',
        'TRANSITION',
        `${path}.transitionMs`,
        s.id,
        'transitionMs must not be negative',
        '改为非负毫秒数。',
      );
    const c = s.camera || {},
      h = s.highlight || {};
    if (c.focusNodeId && c.fitIds?.length)
      fail(
        'semantic',
        'CAMERA_CONFLICT',
        `${path}.camera`,
        s.id,
        'focusNodeId and fitIds are mutually exclusive',
        '选择一种镜头目标。',
      );
    const testRef = (value: string | undefined, set: Set<string>, path: string, kind: string) => {
      if (value && !set.has(value))
        fail(
          'semantic',
          'UNKNOWN_REF',
          path,
          s.id,
          `Unknown ${kind}: ${value}`,
          '替换为对应集合中的有效 id。',
        );
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
  });
  if (doc.characters.filter((c) => c.importance === 5).length > 2)
    warn(
      'TOO_MANY_LEADS',
      '$.characters',
      '',
      'More than two importance 5 characters',
      '建议最多两个绝对主角。',
    );
  if (
    doc.relations.length &&
    doc.relations.filter((r) => r.strength === 5).length / doc.relations.length > 0.15
  )
    warn(
      'TOO_MANY_STRONG',
      '$.relations',
      '',
      'More than 15% of edges have strength 5',
      '只保留最核心的关系。',
    );
  doc.characters.forEach((c, i) => {
    if (degree[c.id] === 0 && c.status !== 'mentioned')
      warn('ORPHAN', `characters[${i}]`, c.id, 'Unconnected character', '核实关系或标为仅提及。');
  });
  if (
    doc.timeline &&
    (doc.presentation || []).some((s) => s.chapterAt !== undefined) &&
    doc.relations.every((r) => r.chapters === undefined)
  )
    warn(
      'UNTIMED_EDGES',
      '$.relations',
      '',
      'Timeline scenes exist but no relation has chapters',
      '为随时间变化的关系添加章节区间。',
    );
  if (doc.characters.filter((c) => !c.position).length / doc.characters.length > 0.5)
    warn(
      'MISSING_POSITIONS',
      '$.characters',
      '',
      'More than half of characters lack positions',
      '给关键人物预置坐标，避免开场布局跳动。',
    );
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
