# RelGraph Studio · 关系叙事工作室

**Video-first, data-driven visualization of complex relationships.** A shared graph and film engine for narrative literature and, eventually, molecular biology. Domain-specific source semantics remain separate.

## Current milestone (v0.1 draft)

- **[Offline director demo](demo/standalone.html)** — open the HTML file directly in a browser to preview a 40-second / five-scene silent technical storyboard (Canvas 2D, 1280×720, 24 FPS).
- **[JSON Schema](schema/relationship-graph.schema.json)** and **[TypeScript types](types/relationship-graph.ts)** — structural contract for `schemaVersion: "0.1"`.
- **[Validator and chapter projection](src/relgraph.mjs)** — structural and semantic checks, spoiler-safe character/edge filtering, declarative scene timing.
- **[Provisional Honglou data](examples/honglou-provisional.relgraph.json)** — 17 characters / 17 links / 5 scenes, migrated from the visual demo. **Not source-verified; do not treat as literary scholarship.**
- **[Neutral graph and frame-state engine](src/graph/core.mjs)** — renderer-independent nodes, edges, groups, timeline and safe frame projection.
- **[Literature adapter](src/domains/literature.mjs)** — maps literary v0.1 into a visual graph while retaining separate spoiler-safe biographies.
- **[Biology adapter](src/domains/biology.mjs)** and **[synthetic example](examples/biology-signaling-synthetic.json)** — experimental protein states, typed physical vs functional interactions, multi-participant reaction nodes and evidence metadata. The example is invented, not a verified scientific dataset.

### Run tests

```bash
node --test tests/*.test.mjs
```

Node.js 22+ recommended. No dependencies or network required for the core tests or offline demo.

## Architecture and scope

The offline HTML is an **existing visual proof of concept**; it currently embeds its legacy fixture rather than loading the v0.1 contract. The reusable validator/schema and v0.1 example are separate foundational artifacts. Integrating them into the renderer and video-export pipeline is the next development task, **not a completed claim**.

The 40-second MP4 export has been tested locally, but rendered media and frame sequences are intentionally excluded from Git history. See [architecture](docs/ARCHITECTURE.md), [cross-domain decision](docs/ADR-002-domain-adapters.md) and [roadmap](docs/ROADMAP.md).

## Design principles

1. Accuracy over completeness. Do not invent relations, quotation evidence, chapter timestamps or outcomes.
2. Spoiler safety is first-class. Hide future characters, relations, ending information and future quotations at the selected chapter.
3. Deterministic, declarative scenes. Source of truth is JSON, never an interaction recording.
4. Preserve human-authored layout positions; offline/local-first input and export.
5. The application goals lead; the draft schema may still evolve before 1.0.

**License:** not selected yet. A public repository does not by itself grant an open-source or commercial-use license.
