# Four-layer local verification

There is no configured GitHub Actions workflow. Install pinned packages with
`npm ci`. Simulated DOM / VM tests are **not** real browser tests.

## Layer 1 — Pure models: no DOM

Frame/time/playback, deterministic layout and geometry, project history,
spoiler-safe projections, and declarative DisplayList semantics.

```bash
npm test -- tests/playback-model.test.mjs tests/layout-editor-model.test.mjs tests/layout-strategies.test.mjs tests/transcript-model.test.mjs
```

Other model tests include `layout.test.mjs`, `timeline.test.mjs`,
`graph-kernel.test.mjs`, `domain-migration.test.mjs`,
`project-customization.test.mjs`, and `node-images.test.mjs`.
Existing files may cover several layers.

## Layer 2 — Shared simulated DOM

`tests/helpers/studio-dom.mjs` owns **one** Element/Document/event/focus
simulation. `studio-harness.mjs` provides Studio-specific fake network,
canvas frame renderer, RAF and fixture setup. `studio-source.mjs` transpiles
the TypeScript coordinator for the source VM.

`tests/production-build.test.mjs` independently runs Vite, reads the
**actual emitted JavaScript bundle** and executes that bundle in a new VM with
the same DOM factory. It checks bundle startup, source selection, layout
controls and bundled project data. It does not substitute TypeScript imports
for the production bundle.

```bash
npm test -- tests/studio-dom.test.mjs tests/studio-workspace.test.mjs tests/production-build.test.mjs
```

Related Layer 2 coverage includes `position-tool.test.mjs`,
`project-customization.test.mjs`, `node-images.test.mjs` for async
ownership, layout/history, focus and ARIA. DOM simulation never proves
Chromium behavior.

## Layer 3 — Critical Playwright/Chromium

Real input events, focus, Canvas, uploads and downloads, layout/image flows,
theme and relevant visual/a11y DOM regressions:

```bash
npm run check:browser
```

Missing Chromium is an environment block, not a passing browser test.

## Layer 4 — Native Skia, FFmpeg and CLI

Native rendering, frame hashes, PNG/MP4 export, frame random access,
resolution/theme/image cases and retained golden references.

```bash
npm run build:packages
npm run check:export
```

Supporting tests: `render-pipeline.test.mjs`,
`canvas-renderer.test.mjs`, `cli.test.mjs`,
`package-build.test.mjs`, `film-fonts.test.mjs`.
Requires native Skia and FFmpeg/ffprobe. Do not change golden hashes to mask
an unexpected difference.

## Fast cycle and full local acceptance

| Entry | Coverage |
| --- | --- |
| `npm run typecheck` | Static TypeScript check, coordinator/models/views |
| `npm run lint` | Source/test hygiene |
| `npm run format:check` | Formatting, not functional regression |
| `npm run check:types` | Schema-generated type consistency |
| `npm test` | All Vitest: Layers 1–2 + supporting Layer 4 tests |
| `npm run build:packages` | Package compile / CLI prerequisites |
| `npm run build` | Production browser assets; Layer 2 also builds in test |
| `npm run check:browser` | Actual Layer 3 Chromium |
| `npm run check:export` | Actual Layer 4 native export |

Fast loop: `npm run typecheck && npm test`, plus focused layer tests above.

Complete local acceptance: run each command independently:

```bash
npm run typecheck
npm run lint
npm run format:check
npm run check:types
npm test
npm run build:packages
npm run build
npm run check:browser
npm run check:export
```

Record **actual** run results; do not promote an unrun or environment-blocked
command, an older PR's evidence, or a VM simulation into a current pass.
