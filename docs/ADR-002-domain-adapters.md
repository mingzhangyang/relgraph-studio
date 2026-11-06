# ADR 002 — Neutral graph engine with domain adapters

Status: Accepted for prototype, November 6, 2026

## Decision

Literature and molecular biology share graph layout, camera, animation, visibility, and video rendering, but not one common ontology.

1. Preserve literary schemaVersion 0.1 and its character/relationship meaning without modifications.
2. Keep a separate experimental biological source format: relgraph.bio/0.1-draft.
3. Convert either source using a domain adapter into an internal VisualGraph (nodes, edges, groups, scenes).
4. Video durationSec is distinct from domainAt (chapters, biochemical stages or event indexes).
5. Multi-participant chemical reactions become explicit reaction nodes with typed consumption / production / catalyst arcs. Never manufacture a binary physical PPI from a functional signaling pathway.
6. EvidenceStatus distinguishes curated, hypothesis and illustrative assertions. A curated record requires a traceable source + recordId. Validation cannot independently prove an experimental claim.
7. Literary biographies stay in domain data, not the generic renderer model. The spoiler-aware accessor removes fate and future quotations, while the generic frame projector excludes future nodes, edges, highlights, focus targets and empty groups.

## Non-goals of this increment

- The offline legacy demo still uses embedded legacy fixture; it has NOT been reconnected to these adapters yet.
- No scientific assertions are made by the intentionally synthetic biology example.
- No direct PSI-MI, SBGN, SBML or BioPAX import/export yet. Future adapters should use those standards rather than claim this draft replaces them.
- No audio, 4K output, browser editing or interactive biological viewer.

## Planned next step

Update the player to load validated JSON through the adapters and share the same frame-state engine across literature and biology. Keep original documents for export and scientific provenance.

## Internal generated identities (November 6 review)

Source biological identifiers are lowercase hyphenated slugs; internally generated reaction nodes use `bio:process:<process-id>` and participant arcs use `bio:arc:<role>:<process-id>:<entity-id>`. Colons are forbidden in source IDs, and the role/process/entity components cannot contain colons, so generated IDs cannot collide with source IDs or with each other. The adapter understands unambiguous older `process-<id>` camera aliases, but a real entity with that id takes precedence; use the namespaced ID to explicitly select the reaction. The synthetic example now uses the namespaced target.

All optional scene camera/highlight collections are checked for array types before iteration. Invalid structures receive diagnostic paths and repair hints instead of unhandled exceptions.
