import { SOCIAL_WORDING, worded } from '../diagnostic-wording.js';
import type { Diagnostic } from '../director/load.js';
import { edgeAppearance, type EdgeAppearance } from '../project.js';
import type { VisualGraph } from '../../types/visual-graph.js';
import { GENERIC_FORMAT, inspectGenericDocument } from './generic.js';
import { socialEdgeStyle, type SocialClaim } from './social.style.js';

export const SOCIAL_FORMAT = 'relgraph.social/0.1-draft';

const record = (v: unknown): v is Record<string, unknown> =>
  v !== null && typeof v === 'object' && !Array.isArray(v);

/** Recompute line warnings after the project cascade, preserving unrelated diagnostics. */
export function socialAppearanceWarnings(
  source: unknown,
  graph: VisualGraph,
  warnings: readonly Diagnostic[] = [],
): Diagnostic[] {
  if (!record(source) || source.format !== SOCIAL_FORMAT || graph.domain !== 'social')
    return [...warnings];
  const next = warnings.filter(
    (entry) => entry.layer !== 'social-source' || entry.code !== 'INFERRED_SOLID',
  );
  const declared = record(source.kinds) && record(source.kinds.edges) ? source.kinds.edges : {};
  const declarations = new Map(
    Object.entries(declared)
      .filter((entry): entry is [string, Record<string, unknown>] => record(entry[1]))
      .map(([name, value]) => [name.trim(), { value, path: `kinds.edges.${name}.line` }]),
  );
  const seen = new Set<string>();
  const warn = (kind: string, path: string): void => {
    const key = JSON.stringify([kind, path]);
    if (seen.has(key)) return;
    seen.add(key);
    next.push({
      level: 'warning',
      layer: 'social-source',
      ...worded(SOCIAL_WORDING, 'INFERRED_SOLID'),
      path,
      id: kind,
    });
  };
  const ownDash = (map: Record<string, EdgeAppearance> | undefined, key: string) =>
    map && Object.hasOwn(map, key) ? map[key].dash : undefined;
  const used = new Set<string>();
  for (const edge of graph.edges) {
    used.add(edge.kind);
    const declaration = declarations.get(edge.kind);
    if (declaration?.value.basis === 'attested') continue;
    const dash = edgeAppearance(graph.project, edge).dash ?? declaration?.value.line ?? 'dashed';
    if (dash !== 'solid') continue;
    const layers = graph.project?.edges;
    const path =
      ownDash(layers?.objects, edge.id) !== undefined
        ? `config.edges.objects.${edge.id}.dash`
        : ownDash(layers?.categories, edge.kind) !== undefined
          ? `config.edges.categories.${edge.kind}.dash`
          : layers?.defaults?.dash !== undefined
            ? 'config.edges.defaults.dash'
            : declaration!.path;
    warn(edge.kind, path);
  }
  // Unused declarations still deserve the original source-level warning.
  for (const [kind, { value, path }] of declarations)
    if (!used.has(kind) && value.basis !== 'attested' && value.line === 'solid') warn(kind, path);
  return next;
}

/** Social sources share graph/1's entity, evidence and storyboard grammar. */
export function inspectSocialDocument(doc: unknown) {
  const errors: Diagnostic[] = [],
    warnings: Diagnostic[] = [];
  function issue(
    level: 'error' | 'warning',
    code: keyof typeof SOCIAL_WORDING,
    path: string,
    id: string,
  ) {
    (level === 'error' ? errors : warnings).push({
      level,
      layer: 'social-source',
      ...worded(SOCIAL_WORDING, code),
      path,
      id,
    });
  }
  if (!record(doc) || doc.format !== SOCIAL_FORMAT) {
    issue('error', 'SOCIAL_FORMAT', 'format', '');
    return { valid: false as const, errors, warnings };
  }
  const claims = new Map<string, SocialClaim>();
  const declarations = record(doc.kinds) && record(doc.kinds.edges) ? doc.kinds.edges : {};
  for (const [name, value] of Object.entries(declarations)) {
    if (!record(value)) continue; // The shared validator reports malformed declarations.
    const path = 'kinds.edges.' + name;
    if (value.assertsCoPresence !== undefined && typeof value.assertsCoPresence !== 'boolean')
      issue('error', 'SOCIAL_CO_PRESENCE', path + '.assertsCoPresence', name);
    if (value.basis !== undefined && value.basis !== 'attested' && value.basis !== 'inferred')
      issue('error', 'SOCIAL_BASIS', path + '.basis', name);
    const basis = value.basis === 'attested' ? 'attested' : 'inferred';
    claims.set(name.trim(), { assertsCoPresence: value.assertsCoPresence === true, basis });
    if (basis === 'inferred' && value.line === 'solid')
      issue('warning', 'INFERRED_SOLID', path + '.line', name);
  }
  const result = inspectGenericDocument({ ...doc, format: GENERIC_FORMAT });
  if (!result.valid)
    return {
      valid: false as const,
      errors: [...errors, ...result.errors],
      warnings: [...warnings, ...result.warnings],
    };
  const { graph, diagnostics } = result.adapted;
  warnings.push(...diagnostics.warnings);
  if (errors.length) return { valid: false as const, errors, warnings };
  const declared = graph.kinds?.edges ?? {};
  const kinds = new Set([...Object.keys(declared), ...graph.edges.map((edge) => edge.kind)]);
  graph.domain = 'social';
  graph.kinds = {
    ...graph.kinds,
    edges: Object.fromEntries(
      [...kinds].map((kind) => [
        kind,
        {
          ...socialEdgeStyle(
            Object.hasOwn(declared, kind) ? declared[kind] : undefined,
            claims.get(kind),
          ),
          ...(!Object.hasOwn(declared, kind) ? { implicit: true as const } : {}),
        },
      ]),
    ),
  };
  return {
    valid: true as const,
    adapted: {
      ...result.adapted,
      diagnostics: { ...diagnostics, warnings: socialAppearanceWarnings(doc, graph, warnings) },
    },
  };
}

export function validateSocialDocument(doc: unknown) {
  const checked = inspectSocialDocument(doc);
  return checked.valid ? checked.adapted.diagnostics : checked;
}

export function adaptSocialDocument(doc: unknown) {
  const checked = inspectSocialDocument(doc);
  if (!checked.valid)
    throw Object.assign(new Error('Invalid social network document'), { issues: checked.errors });
  return checked.adapted;
}
