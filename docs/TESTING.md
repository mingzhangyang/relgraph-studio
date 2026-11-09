# Four-layer local verification

There is no configured GitHub Actions workflow. Install pinned packages with
`npm ci`. Simulated DOM / VM tests are **not** real browser tests.

## Prerequisites

- Use Node.js `^20.19.0 || ^22.13.0 || >=24.0.0` as declared in `package.json`.
- Run `npm ci` from the repository root. This also installs the CLI's pinned
  `skia-canvas` dependency and its platform-specific native module.
- Install the Chromium revision required by the pinned Playwright package:
  `npx playwright install chromium`. Linux also needs Playwright's Chromium
  system libraries; install them using the supported package manager or
  `npx playwright install-deps chromium` where system installation is permitted.
- Put `ffmpeg` (with the `libx264` encoder) and `ffprobe` on `PATH` for the
  export check. Playwright's downloaded FFmpeg does not replace these CLI tools.
- Keep the vendored fonts under `packages/render/fonts/`. Browser checks start
  a local preview server and need permission to launch Chromium.

### Offline package-consumer test cache

`tests/package-build.test.mjs` installs the built tarballs in an isolated
consumer with `npm install --offline`. It also resolves `@types/node`,
`skia-canvas` and their dependencies from the npm cache. Use the same cache for
setup and tests (including the same `npm_config_cache` if customized).
`npm ci` with a fresh cache can populate tarballs without the registry metadata
this offline install needs. If it fails with `ENOTCACHED`, prime those exact
direct versions in a separate temporary directory, then rerun the unchanged
tests. For example, on Linux/macOS:

```bash
npm install --prefix /tmp/relgraph-test-cache-warm --ignore-scripts --no-audit --no-fund --package-lock=false @types/node@22.20.5 skia-canvas@4.0.0
npm test
```

Use the versions from the repository manifests if they change. This setup step
does not modify the repository's dependencies or lockfile, and does not disable
the offline consumer assertions.

## Layer 1 — Pure models: no DOM

Frame/time/playback, deterministic layout and geometry, project history,
spoiler-safe projections, and declarative DisplayList semantics.

```bash
npm test -- tests/playback-model.test.mjs tests/layout-editor-model.test.mjs tests/layout-strategies.test.mjs tests/transcript-model.test.mjs
```

Other model tests include `layout.test.mjs`, `timeline.test.mjs`,
`graph-kernel.test.mjs`, `domain-migration.test.mjs`,
and the pure model cases in `project-customization.test.mjs`,
`studio-workspace.test.mjs` (the `studio-mode-model.ts` transition table),
and `node-images.test.mjs`. Those two files also contain simulated-DOM or native
Skia cases; selecting an entire file does not isolate the pure layer.

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
npm test -- tests/studio-dom.test.mjs tests/workspace-shell-view.test.mjs tests/studio-workspace.test.mjs tests/production-build.test.mjs
```

Related Layer 2 coverage includes `position-tool.test.mjs`,
`project-customization.test.mjs`, `node-images.test.mjs` for async
ownership, layout/history, focus and ARIA. The shared Studio harness also
checks mode changes while playing, layout previews, and active pointer drags,
including rejected late events. DOM simulation never proves
Chromium behavior. `workspace-shell-view.test.mjs` records Canvas commands,
colors, text and retained messages; it does not rasterize pixels.

## Layer 3 — Critical Playwright/Chromium

Real input events, focus, Canvas, uploads and downloads, layout/image flows,
theme and relevant visual/a11y DOM regressions:

```bash
npm run check:browser
```

Missing Chromium is an environment block, not a passing browser test.
The script builds the production Studio itself and writes captures to
`output/browser-check/`. Pixel comparison against `output/browser-reference/`
is enforced only when that local baseline exists and matches the Chromium
version and platform. A fresh checkout can pass the functional checks and
capture frames without establishing visual equivalence to an earlier build.
For a rendering change, capture a baseline on the unchanged revision with
`npm run check:browser -- --update-reference`, then run the normal check on the
changed revision in the same environment. Do not replace a baseline to hide a
regression.

## Layer 4 — Native Skia, FFmpeg and CLI

Native rendering, frame hashes, PNG/MP4 export, frame random access,
resolution/theme/image cases and retained golden references.

```bash
npm run check:export
```

This command builds the packages and production Studio by default. It requires
native Skia, FFmpeg/ffprobe **and Chromium** for its final browser/headless
comparison. `--no-browser` skips that comparison and is only a partial run;
`--no-build` requires current package and Studio builds.

Native Vitest coverage includes `node-images.test.mjs`, all 44 committed golden
frames across four example/theme cases in `cli.test.mjs` and the built-package/CLI
smoke in `package-build.test.mjs`.
`render-pipeline.test.mjs` and `canvas-renderer.test.mjs` use a recording/fake
Canvas context: they verify composition/backend commands, not native pixels.
`film-fonts.test.mjs` checks vendored font metadata, hashes and coverage.

Export artifacts go to `output/export-check/`. Golden hashes are enforced only
when the recorded Skia version and font digest match; other environments report
differences without failing that comparison. Browser/headless pixel differences
are informational. Read the output to distinguish an enforced match from an
informational comparison. Do not change golden hashes to mask an unexpected
difference. See [the reviewed label-layout baseline](GOLDEN-BASELINE-REVIEW.md)
for the current hashes and the regression that expanded the former one-frame
smoke test to all 44 frames.

## Fast cycle and full local acceptance

| Entry                    | Coverage                                                                                                           |
| ------------------------ | ------------------------------------------------------------------------------------------------------------------ |
| `npm run typecheck`      | Static TypeScript check, coordinator/models/views                                                                  |
| `npm run lint`           | Source/test hygiene                                                                                                |
| `npm run format:check`   | Formatting, not functional regression                                                                              |
| `npm run check:types`    | Schema-generated type consistency                                                                                  |
| `npm test`               | All Vitest: pure/recording-Canvas, simulated DOM, built bundle, native Skia and package/CLI tests; no real browser |
| `npm run build:packages` | Package compile / CLI prerequisites                                                                                |
| `npm run build`          | Production browser assets; Layer 2 also builds in test                                                             |
| `npm run check:browser`  | Actual Layer 3 Chromium                                                                                            |
| `npm run check:export`   | Actual Layer 4 native export                                                                                       |

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
