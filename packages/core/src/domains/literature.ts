/** Adapter for the literary relgraph 0.1 draft. */
import { inspectRelGraph, visibleStory } from '../relgraph.js';
import type { Bio, GraphDoc, ShotEvidence } from '../../types/relationship-graph.js';
import type { VisualEvidenceRef, VisualGraph } from '../../types/visual-graph.js';
import { validateVisualGraph } from '../graph/core.js';
const defaults = {
  family: 'positive',
  marriage: 'positive',
  romance: 'positive',
  friendship: 'positive',
  alliance: 'neutral',
  rivalry: 'negative',
  mentorship: 'positive',
  service: 'neutral',
  other: 'neutral',
};
export function adaptLiteratureDocument(input: unknown) {
  const inspected = inspectRelGraph(input);
  const { valid, errors, warnings } = inspected;
  const diagnostics = { valid, errors, warnings };
  if (!inspected.valid)
    throw Object.assign(new Error('Invalid literary document'), { issues: diagnostics.errors });
  const doc = inspected.document;
  // A shot names quotations by their place in the source. Quotations without
  // text are not projected, so the card's indices follow the projected list.
  const evidenceCard = ({ edgeId, items }: ShotEvidence): VisualEvidenceRef => {
    const quotes = doc.relations.find((r) => r.id === edgeId)?.evidence || [];
    const projected = quotes.flatMap((q, n) => (q.text.trim() ? [n] : []));
    return {
      edgeId,
      ...(items ? { items: items.map((n) => projected.indexOf(n)) } : {}),
    };
  };
  const graph: VisualGraph = {
    domain: 'literature',
    meta: {
      title: doc.meta.title,
      description: doc.meta.description,
      sourceNote: doc.meta.sourceNote,
    },
    timeline: doc.timeline ? { unit: doc.timeline.unit, total: doc.timeline.total } : undefined,
    groups: (doc.factions || []).map((f) => ({
      id: f.id,
      label: f.name,
      kind: 'faction',
      color: f.color,
    })),
    nodes: doc.characters.map((c) => ({
      id: c.id,
      label: c.name,
      kind: 'person',
      groupId: c.factionId,
      importance: c.importance,
      color: c.color,
      position: c.position ? { ...c.position } : undefined,
      pinned: c.pinned,
      visibility: c.firstAppearance === undefined ? undefined : { from: c.firstAppearance },
    })),
    edges: doc.relations.map((r) => ({
      id: r.id,
      source: r.source,
      target: r.target,
      kind: r.type,
      label: r.label,
      directed: r.directed ?? false,
      strength: r.strength,
      polarity: r.polarity ?? defaults[r.type],
      visibility: r.chapters ? { ...r.chapters } : undefined,
      // A quotation is shown from the chapter it is quoted at, never earlier.
      ...(r.evidence?.some((q) => q.text.trim())
        ? {
            evidence: r.evidence
              .filter((q) => q.text.trim())
              .map((q) => ({
                quote: q.text,
                ...(q.at === undefined ? {} : { from: q.at }),
              })),
          }
        : {}),
    })),
    scenes: (doc.presentation || []).map((s) => ({
      id: s.id,
      title: s.title,
      narration: s.narration,
      durationSec: s.durationSec,
      transitionMs: s.transitionMs,
      domainAt: s.chapterAt,
      camera: s.camera
        ? { ...s.camera, fitIds: s.camera.fitIds ? [...s.camera.fitIds] : undefined }
        : undefined,
      highlight: s.highlight
        ? {
            nodeIds: s.highlight.characterIds ? [...s.highlight.characterIds] : undefined,
            edgeIds: s.highlight.relationIds ? [...s.highlight.relationIds] : undefined,
            groupId: s.highlight.factionId,
          }
        : undefined,
      openDetailNodeId: s.openBioId,
      ...(s.evidence ? { evidence: evidenceCard(s.evidence) } : {}),
    })),
  };
  const check = validateVisualGraph(graph);
  if (!check.valid)
    throw Object.assign(new Error('Literary projection invalid'), { issues: check.errors });
  return { graph, diagnostics };
}
/** Biography and quotations stay in the source and pass through spoiler filtering. */
export function literaryDetailsAt(
  doc: GraphDoc,
  chapterAt: number | null = null,
  { spoilerSafe = true } = {},
): Record<string, Bio> {
  const view = visibleStory(doc, chapterAt, spoilerSafe);
  return Object.fromEntries(view.characters.map((c) => [c.id, view.bios[c.id]]));
}
