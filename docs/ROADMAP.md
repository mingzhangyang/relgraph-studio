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
  - Each display list carries its spoiler-filtered accessible text (`a11y`); the workspace transcript and live region consume it since step 4
- [x] Domain style sheets and a locale table instead of edge kinds and captions in the renderer
  - Renderer captions use `zh-CN` and `en`; localizing source diagnostics (currently English messages with Chinese fixes) and the workspace UI remains open
- [x] Headless `relgraph render` CLI (skia-canvas + FFmpeg) with vendored fonts and golden frames
  - `@relgraph/render/skia` draws through the shared composition and Canvas 2D backend on skia-canvas 4.0.0 (CPU); `@relgraph/cli` provides `relgraph validate` and `relgraph render` (parallel worker threads, FFmpeg/libx264, `yuv420p`, BT.709)
  - Both examples export as complete 1080p MP4s with `frameCount(graph, fps)` frames; any frame re-renders identically on its own
  - Vendored OFL subsets of Noto Sans / Serif / Sans Mono CJK SC, registered by both the workspace and the exporter, with a reproducible subsetting script
  - 32 golden frame hashes and `npm run check:export` (ffprobe, MP4 ↔ PNG round trip, informational preview ↔ export difference: about 0.3% of pixels at 720p)
  - Follow-ups: `relgraph layout` (step 5); golden hashes confirmed on a second platform (macOS, arm64); fonts for characters outside the subset (rare hanzi in future sources) instead of a fallback warning; audio and caption tracks in the MP4 (B2); 9:16 and square presets (B3); an SVG still backend
- [x] ADR 003 step 4: track/keyframe timeline, default reveals and caption timing
  - [x] Implement pure `compileTimeline` of camera, highlight, step-domain-time, reveals and captions after safe projection
  - [x] Node fade/scale (0.6 s), quadratic edge draw-on (0.8 s), 0.3 s subtitle fades (the last caption holds) and instant removal on backward domain steps; detail cards follow their node's reveal
  - [x] Use `DisplayList.a11y` for the workspace transcript and live region; both drawing backends unchanged
  - [x] Add targeted compiler/projection/frame-boundary/geometry/random-access regression tests
  - [x] Measured against `main`: 16/16 browser mid-shot frames and 28/32 golden frames byte-identical; the 4 changed are biology mid-draw frames
  - [x] 44 golden frames including 12 mid-reveal samples; both MP4s re-exported and validated by `check:export`

ADR 003 step 5 is split into two reviewable batches:
- [x] **Step 5a:** seeded deterministic `relgraph layout` for missing coordinates, with opt-in validated source write-back and regression tests (merged PR #13).
- [x] **Step 5b:** opt-in director canvas drag adjustment for currently visible nodes, frozen preview camera, reset, and validated JSON export. Default playback and original source are unchanged (PR #14 ported to main by merged PR #15).

Workspace architecture follow-up (after step 5b, in separate reviewable PRs):
- [x] **Playback Core:** move frame clock, play/pause/seek transitions, shot-marker time math and UI timestamp formatting into DOM-free `apps/studio/src/playback-model.ts`; retain the existing director timeline as authoritative and the workspace as the animation scheduler. PR #16 merged into the #15 stack; code is on main and locally verified with the final acceptance fixes.
- [x] **Workspace Views:** keep playback and timing rules in the pure model, and put DOM presentation behind focused adapters. Both batches merged; locally verified together with the final acceptance fixes on 2026-11-08.
  - [x] **Batch 1 — Playback & Shot Views:** merged PR #17; stable shot buttons, safe titles and derived playback labels.
  - [x] **Batch 2 — Diagnostics & Transcript Views:** merged PR #18. Dedicated diagnostic DOM adapter; `DisplayList.a11y`-only transcript and live region; pure semantic snapshots detect within-shot reveals and backward seeks without repeated announcements. Verified through pure tests, the shared VM harness and real Chromium.
  - [ ] **Final acceptance on main / B2 gate:** PR #19 merged as `140af71`; its tree matches the locally accepted candidate, and post-merge static checks, 174 tests, 37 Chromium checks and 5 export checks passed. Further B2 verification reproduced the previously unexplained fake-encoder child failure as a native `SIGABRT`: forced worker termination can interrupt Skia. Merge the independent graceful-worker-shutdown fix and recheck latest main before releasing B2-1. See [worker regression](ENCODER-WORKER-SHUTDOWN.md). The prepared literary data remains isolated; no data is included in the runtime fix.
  - **Actual local results:** 174/174 Vitest tests (24 files), 37/37 Chromium checks, 16/16 browser PNGs byte-identical to unmodified main, 44/44 unchanged headless golden frames, 5/5 full export checks, and 8/8 short MP4 matrix checks. Typecheck, lint, formatting, generated types, package builds and studio build pass. See [final acceptance report](B1.5-FINAL-ACCEPTANCE.md) for failures, fixes, commands and limitations.

The accepted B1.5 scope is deterministic data → adapter → graph → pure timeline → DisplayList → Canvas/Skia → MP4, plus the separated workspace models and views. Native screen-reader listening, additional platforms and production typography QA are not implied by automated acceptance. The B2 entry gate requires the corrective PR to be merged; B2-1 data work has not started in this acceptance branch.

## B2 — Source-verified film

- [ ] Curate an auditable literary dataset; verify character debuts, relationships and evidence
- B2-1 starts from the latest main **after the acceptance fixes merge**. Keep the source-verified Honglou subset, evidence report, data-quality tests and B2-2 handoff separate from the provisional example. B2-2 storyboard/video work follows approval of that dataset; target 60–90 s, 1920×1080, 24 FPS, chapter-safe reveals. Audio and subtitle streams are outside B2-1.
- [ ] Script a 60–90 second narration without premature spoilers
- [ ] Add optional narration/audio sync, captions, credited licensed sounds and 1080p QA

## B3 — Templates and output

- [ ] Storyboard presets, cross-work typography and thematic palettes
- [ ] 9:16 and square `FrameSpec` presets with their own safe areas; second work exported without core code edits
- [ ] Production batch video/image exports; defer a full graph editor until proven demand

No GitHub Actions workflow is included; local verification only.
