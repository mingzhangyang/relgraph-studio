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
- [x] Packaged offline frame-sequence / MP4 export (`relgraph render`, B1.5 below)
- [ ] Production-quality typography QA
- [ ] Full label placement for dense or coincident graphs; additional viewport and font coverage

## B1.5 — Foundations (see [ADR 003](ADR-003-render-pipeline-and-foundations.md))

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
- [x] `FrameSpec` safe areas instead of 1280×720 literals; display-list composition with a Canvas backend
  - 720p and 1080p 16:9 presets; 1080p composes exactly as 720p scaled by 1.5, and 720p frames are byte-identical to the pre-refactor browser baseline
  - Each display list carries its spoiler-filtered accessible text (`a11y`); the workspace transcript and live region now consume it in the step 4 draft
- [x] Domain style sheets and a locale table instead of edge kinds and captions in the renderer
  - Renderer captions use `zh-CN` and `en`; localizing source diagnostics (currently English messages with Chinese fixes) and the workspace UI remains open
- [x] Headless `relgraph render` CLI (skia-canvas + FFmpeg) with vendored fonts and golden frames
  - `@relgraph/render/skia` draws through the shared composition and Canvas 2D backend on skia-canvas 4.0.0 (CPU); `@relgraph/cli` provides `relgraph validate` and `relgraph render` (parallel worker threads, FFmpeg/libx264, `yuv420p`, BT.709)
  - Both examples export as complete 1080p MP4s with `frameCount(graph, fps)` frames; any frame re-renders identically on its own
  - Vendored OFL subsets of Noto Sans / Serif / Sans Mono CJK SC, registered by both the workspace and the exporter, with a reproducible subsetting script
  - 32 golden frame hashes and `npm run check:export` (ffprobe, MP4 ↔ PNG round trip, informational preview ↔ export difference: about 0.3% of pixels at 720p)
  - Follow-ups: `relgraph layout` (step 5); golden hashes confirmed on a second platform (macOS, arm64); fonts for characters outside the subset (rare hanzi in future sources) instead of a fallback warning; audio and caption tracks in the MP4 (B2); 9:16 and square presets (B3); an SVG still backend
- [ ] Accept ADR 003 step 4: track/keyframe timeline, default reveals and caption timing (implementation in draft; local verification and visual assets outstanding)
  - [x] Implement pure `compileTimeline` of camera, highlight, step-domain-time, reveals and captions after safe projection
  - [x] Node fade/scale (0.6 s), quadratic edge draw-on (0.8 s), 0.3 s subtitle fades and instant removal on backward domain steps
  - [x] Use `DisplayList.a11y` for the workspace transcript and live region; both drawing backends unchanged
  - [x] Add targeted compiler/projection/frame-boundary/geometry/random-access regression tests (not yet executed)
  - [ ] Save a `main` browser baseline, inspect predicted mid-shot and boundary-frame changes, and refresh browser references
  - [ ] Run `npm test`, `typecheck`, `check:types`, `lint`, `format:check`, `build:packages`, `build`, `check:browser`, and `check:export`; update the 32 goldens and add mid-reveal samples
  - [ ] Re-export both full MP4s, validate video metadata and deliver screenshots before/mid/after reveal

After step 4 acceptance, proceed to **ADR 003 step 5**: seeded deterministic `relgraph layout` with write-back and a limited position-tweak tool, followed by the first source-verified 60–90 s film. Audio synchronization and independent MP4 subtitle streams remain B2 work.

## B2 — Source-verified film

- [ ] Curate an auditable literary dataset; verify character debuts, relationships and evidence
- [ ] Script a 60–90 second narration without premature spoilers
- [ ] Add optional narration/audio sync, captions, credited licensed sounds and 1080p QA

## B3 — Templates and output

- [ ] Storyboard presets, cross-work typography and thematic palettes
- [ ] 9:16 and square `FrameSpec` presets with their own safe areas; second work exported without core code edits
- [ ] Production batch video/image exports; defer a full graph editor until proven demand

No GitHub Actions workflow is included; local verification only.
