# Roadmap · RelGraph Studio

## B0 / B0.5 — Baseline and cross-domain kernel

- [x] Draft literary schema, structural/semantic validator and spoiler-aware projections
- [x] Neutral graph and deterministic frame-state contract with domain adapters
- [x] Synthetic biology example, reaction participant roles and provenance fields
- [x] Original standalone visual prototype and local Node regression tests
- [ ] Source verification and standards-based biological import/export

## B1 — Connect the film renderer

- [x] Load either example or local JSON through the same validation and adapter path
- [x] Show separate actionable errors and warnings in the director workspace
- [x] Use presentation data for playback, seeking, titles, subtitles, camera and highlights
- [x] Project chapters/stages before rendering; withhold hidden references and unsafe shot text
- [x] Preserve supplied layout, use static fallback coordinates and avoid label overlap when possible
- [x] Shared 16:9 Canvas renderer with reaction role distinctions and deterministic frame API
- [x] Local regression tests and browser checks without GitHub Actions
- [ ] Packaged offline frame-sequence / MP4 export and production-quality typography QA
- [ ] Full label placement for dense or coincident graphs; additional viewport and font coverage

## B1.5 — Foundations (proposed, see [ADR 003](ADR-003-render-pipeline-and-foundations.md))

- [x] TypeScript, Vite, Vitest and Prettier; one JSON Schema source for types and validation
  - [x] Establish the toolchain, migrate the layout module, and derive literary types and structural validation from the JSON Schema
  - [x] Migrate neutral graph validation, spoiler-safe projection and director frame evaluation to strict TypeScript
  - [x] Migrate literary validation and spoiler-safe projections, both domain adapters and the unified document loader to strict TypeScript
  - [x] Migrate the Canvas renderer to strict TypeScript while retaining the existing rendering API
  - [x] Migrate the director workspace to strict TypeScript, including DOM, playback, import and theme state
  - [x] Organize current code under `packages/core`, `packages/render` and `apps/studio`; keep one literary schema for validation and generated types
  - [x] Establish separately buildable core and render packages with explicit exports and package-level TypeScript builds
  - [x] Verify the migrated production build in a real browser across both examples, file imports, playback, seeking and themes (`npm run check:browser`, with a local frame baseline for the rendering refactor)
  - The CLI package moves to the headless `relgraph render` item below, where its functionality first exists
- [ ] `FrameSpec` safe areas instead of 1280×720 literals; display-list composition with a Canvas backend
- [ ] Domain style sheets and a locale table instead of edge kinds and captions in the renderer
- [ ] Headless `relgraph render` CLI (skia-canvas + FFmpeg) with vendored fonts and golden frames
- [ ] Track/keyframe timeline compiled from `presentation`, with default reveal animations

## B2 — Source-verified film

- [ ] Curate an auditable literary dataset; verify character debuts, relationships and evidence
- [ ] Script a 60–90 second narration without premature spoilers
- [ ] Add optional narration/audio sync, captions, credited licensed sounds and 1080p QA

## B3 — Templates and output

- [ ] Storyboard presets, cross-work typography and thematic palettes
- [ ] 9:16 recrop and safe areas; second work exported without core code edits
- [ ] Production batch video/image exports; defer a full graph editor until proven demand

No GitHub Actions workflow is included; local verification only.
