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

- The original offline legacy demo retains its embedded fixture. The integrated HTTP-served workspace at `demo/index.html` now uses these adapters and one shared Canvas renderer.
- No scientific assertions are made by the intentionally synthetic biology example.
- No direct PSI-MI, SBGN, SBML or BioPAX import/export yet. Future adapters should use those standards rather than claim this draft replaces them.
- No audio, 4K output, browser editing or interactive biological viewer.

## B1 integration

The director workspace now loads either source through its validator and adapter, projects the same VisualGraph at a selected domain time, and renders frame-indexed camera, highlights and captions with one Canvas module. Literary detail summaries are retrieved through the spoiler-safe source accessor only for visible detail targets. The player does not make scientific claims or perform source verification. A packaged batch export pipeline remains future work.

## Internal generated identities (November 6 review)

Source biological identifiers are lowercase hyphenated slugs; internally generated reaction nodes use `bio:process:<process-id>` and participant arcs use `bio:arc:<role>:<process-id>:<entity-id>`. Colons are forbidden in source IDs, and the role/process/entity components cannot contain colons, so generated IDs cannot collide with source IDs or with each other. The adapter understands unambiguous older `process-<id>` camera aliases, but a real entity with that id takes precedence; use the namespaced ID to explicitly select the reaction. The synthetic example now uses the namespaced target.

All optional scene camera/highlight collections are checked for array types before iteration. Invalid structures receive diagnostic paths and repair hints instead of unhandled exceptions.
