# RelGraph Studio · 关系叙事工作室

**Video-first, data-driven visualization of complex relationships.** RelGraph Studio turns domain data and declarative shots into a shared Canvas film. Literary and molecular-biology source semantics remain separate.

## Run the director workspace

Use Node.js 20.19+ on the 20.x line, 22.13+ on the 22.x line, or 24+. Install the pinned development dependencies and start the local Vite server:

```bash
npm ci
npm run dev
```

Open **http://127.0.0.1:5173/demo/** in a desktop browser. The workspace loads the provisional literary example at startup; switch to the synthetic biology example, or select / drag-and-drop a local JSON file. The file is read locally in the browser. Vite compiles the TypeScript modules, so the integrated workspace cannot be served directly by `python -m http.server` or opened using `file://`. To serve a production build locally, run `npm run build` followed by `npm run preview` and open the `/demo/` URL printed by Vite. The older [standalone prototype](demo/standalone.html) remains directly openable as a historical demo; it is not the integrated player. The workspace makes no network requests other than to its local server and does not require accounts or databases.

- The workspace and the rendered film share a light (paper) or dark theme. It follows the operating system until you pick one with the theme button; the choice is remembered in this browser. `renderAt` draws with the current theme, and `createCanvasRenderer(..., {theme: 'light' | 'dark'})` takes it as an explicit input, so a frame stays deterministic per theme.
- Play, pause, restart, drag the frame timeline, or select a shot. Space toggles playback outside focused controls; left/right arrows seek by one second.
- Both source formats use the same validation → domain adapter → `VisualGraph` → display-list composition → Canvas pipeline as the headless exporter (see below). Errors and warnings appear separately with a field path, object ID when available, explanation and repair advice.
- The time in the player is **video time**; `chapterAt` / `domainAt` is **domain time**. The step 4 draft compiles `presentation` to pure keyframe tracks after spoiler projection: domain-time advances fade/scale new nodes in 0.6 seconds and draw new edges along their exact curved paths in 0.8 seconds; a backwards domain step removes them instantly. Shot title and narration fade in/out 0.3 seconds at either end; camera and highlight interpolation retain their former values. If any objects have visibility intervals, the first shot must specify a domain time. Future graph objects and references are filtered before rendering. If a shot explicitly refers to an invisible object, its title and narration are withheld as well. Non-active shot titles are withheld because scene order can move backward in domain time.
- Author-provided free text is not automatically fact-checked or semantically censored: write titles, narration, biography summaries and relationship labels for the intended point in the story. Untimed source data cannot provide reliable chapter-level spoiler protection. The provisional Honglou example intentionally has no invented chapter timestamps.
- Node positions provided in JSON are preserved. Missing positions use a deterministic static fallback; no physics runs during playback. Overlapping authored positions and very dense graphs can still need manual editing.

### Local verification

```bash
npm test
npm run typecheck
npm run check:types
npm run lint
npm run format:check
npm run build:packages
npm run build
npm run check:browser
npm run check:export
```

The Vitest suite covers adapters, source diagnostics, spoiler projections, reaction roles, camera interpolation, timeline compilation, reveal boundaries, accurate partial Bézier paths, static layouts, deterministic display lists (including spoiler-filtered accessible text and exact 720p → 1080p scaling), domain style sheets, the Canvas backend's translation and workspace behavior. It also separately builds and packs the packages, installs the tarballs in an isolated consumer and checks their runtime and TypeScript interfaces against both examples. The workspace, core and renderer are checked with strict TypeScript, ESLint and Prettier. Workspace tests use a simulated DOM, so `npm run check:browser` additionally builds the studio, serves it with `vite preview` and drives it in headless Chromium through the pinned Playwright dev dependency. It covers both examples, file selection, malformed and schema-invalid files, drag-and-drop, playback, seeking, keyboard shortcuts, theme switching and persistence, deterministic `renderAt` frames, console errors and non-local requests. If Playwright has no browser installed yet, run `npx playwright install chromium` once. The check also saves mid-shot frames of both examples in both themes to `output/browser-check/`. Before a rendering change, run `npm run check:browser -- --update-reference` to save them as a local baseline in `output/browser-reference/`; later runs on the same machine fail when more than 0.5% of a frame's pixels differ. The baseline is not committed because pixels depend on the browser version and fonts; with a different Chromium version or platform the comparison is reported but not enforced. Use `--no-build` to reuse an existing `dist/`. Changing fonts or rasterization intentionally changes these frames, so re-save the baseline afterwards.

`npm run check:export` (FFmpeg and ffprobe required; not part of `npm test`, which stays fast) builds the packages and checks the headless export. It compares 32 key frames (each shot's middle, mid-transition frames and the last frame of both examples in both film themes at 1080p) with the SHA-256 hashes in `examples/golden-frames.json`. They are enforced only when skia-canvas and the vendored fonts match the recorded versions; otherwise differences are reported without failing, like the browser baseline. It then exports both examples as MP4 with `relgraph render` and verifies with ffprobe the codec, `yuv420p`, 1920 × 1080, 24 fps, BT.709 tags, a decoded frame count equal to `frameCount(graph, fps)` and the matching duration. It decodes a mid-transition frame from each video and compares it with the PNG that `relgraph render --frames` writes for the same index: the PNG must equal the in-process render exactly, and the decoded frame must match it (at least 35 dB PSNR) better than its neighbours. Finally it reports, for information, how far the browser preview and the headless export differ at 720p. Outputs go to `output/export-check/`. Run `npm run check:export -- --update` to rewrite the golden hashes after an intended rendering change, and use `--no-build` or `--no-browser` to skip steps. `npm test` also renders one golden frame when the versions match. To regenerate the font subsets, see [packages/render/fonts/README.md](packages/render/fonts/README.md).

The literary validator reads the JSON Schema directly and derives the checked document type from it; the biological adapter checks the values it consumes before narrowing imported data. After editing the literary schema, run `npm run generate:types` and commit the regenerated types. `npm run check:types` detects a stale generated file.

The source is organized into the npm workspaces `@relgraph/core` (model, schema, validation, domain adapters, projections, layout, timeline compilation and director state), `@relgraph/render` (frame specs, display-list composition, video themes, renderer captions, vendored fonts, the Canvas 2D backend and, in the Node-only `@relgraph/render/skia` entry, the skia-canvas backend) and `@relgraph/cli` (the `relgraph` command), plus `apps/studio` (workspace behavior). `demo/index.html` remains the integrated entry point. The studio's Vite and TypeScript configuration resolves these package names to workspace sources, so `npm run dev` and `npm run build` do not require prebuilt packages. Installed consumers use the packages' explicit ESM and type exports instead.

Use `npm run build:packages` to build core, render and the CLI in that order, emitting JavaScript and declarations to each package's `dist/`. The individual commands are `npm run build --workspace=@relgraph/core`, `--workspace=@relgraph/render` and `--workspace=@relgraph/cli`; each requires current builds of the packages before it. skia-canvas is an optional peer dependency of render (only `@relgraph/render/skia` needs it) and a dependency of the CLI. The packages are private and are not published. The schema at `packages/core/schema/relationship-graph.schema.json` is the single source used for both runtime validation and generated types; the core build emits a derived copy into its output, including in package tarballs.

The development-only `minimatch` override temporarily selects the patched 11.x release for a glob denial-of-service advisory. It crosses the lint tools' declared 10.x dependency range; keep the lint checks when updating dependencies and remove the override when those tools support a patched version themselves.

The browser workspace additionally exposes `window.renderAt(frame)` for a validated integer frame in the loaded film and `window.studioFrame()` for its current safe state. The studio canvas uses the `landscape-720p` frame spec (1280 × 720 at 24 FPS); `renderAt` pauses playback and redraws independently of prior frames. The workspace loads the vendored film fonts before its first frame. Pixel identity in the browser is expected within the same browser version and rasterizer; for video output use `relgraph render`, whose frames are reproducible for the same skia-canvas version and fonts.

## Export a film without a browser

The `relgraph` command line (`packages/cli`) renders a document with the same composition code as the workspace, drawn by [skia-canvas](https://skia-canvas.org) instead of a browser canvas, and encodes the frames with FFmpeg.

Requirements:

- The Node.js versions above. `npm ci` installs skia-canvas 4.0.0, whose prebuilt native module comes from an npm package for your platform (macOS, Linux glibc/musl or Windows, x64 or arm64); nothing is downloaded from GitHub and no compiler is needed.
- For MP4 output, [FFmpeg](https://ffmpeg.org/download.html) with the libx264 encoder, on `PATH` or passed with `--ffmpeg <path>` (macOS: `brew install ffmpeg`; Debian/Ubuntu: `sudo apt install ffmpeg`; Windows: `winget install Gyan.FFmpeg`). PNG frame sequences need no FFmpeg. Without a usable FFmpeg, `relgraph render --out` stops before rendering and says how to install one.

```bash
npm ci
npm run build:packages
npm run relgraph -- validate examples/honglou-provisional.relgraph.json
npm run relgraph -- render examples/honglou-provisional.relgraph.json --out output/honglou.mp4
npm run relgraph -- render examples/biology-signaling-synthetic.json --frames output/bio/%05d.png --theme dark --from 96 --to 120
```

`npm run relgraph -- …` runs `packages/cli/dist/bin.js`; after `npm run build:packages`, a later `npm install` also links `npx relgraph`. Installed from its package, the binary is called `relgraph`.

- `relgraph validate <file> [--json]` prints the same errors and warnings as the workspace (code and record ID, JSON path, explanation, `建议：` fix) and exits with status 1 when there are errors.
- `relgraph render <file> --out film.mp4 | --frames out/%05d.png` renders every frame (or `--from N --to M`, inclusive, counted from 0) in parallel worker threads (`--jobs N`, default up to 8). The frame count is `frameCount(graph, fps)`. Options: `--frame-spec landscape-1080p` (default; `landscape-720p` matches the workspace preview), `--theme light` (default) or `dark`, chosen independently of the workspace theme, and `--locale zh-CN` (default) or `en` for renderer captions.
- MP4 output is H.264 (libx264, CRF 16), `yuv420p`, converted from sRGB with the BT.709 matrix and tagged BT.709 limited range, at exactly the frame spec's rate (24 fps), with one video frame per rendered frame. `--frames` writes lossless RGBA PNGs named after the absolute frame index, using `%d` or `%0Nd` like FFmpeg.

Every frame is a pure function of the document, layout, frame index and options, so any single frame can be re-rendered on its own (`--from N --to N`) and is pixel-identical to the same frame in a full export. Text uses the vendored [Noto Sans / Serif / Sans Mono CJK SC subsets](packages/render/fonts/README.md) (SIL OFL 1.1), which both the workspace and the exporter register under the names that lead `FONT_STACKS`. They cover both examples, the renderer copy, the 3,755 level-1 GB 2312 hanzi, Latin and common punctuation (4,798 characters in every face, listed in `packages/render/fonts/coverage.txt`). `relgraph render` warns when a document uses characters outside the subset, because those fall back to system fonts. Pixels are meant to be reproducible across machines with the same skia-canvas version and fonts: rendering uses skia-canvas's CPU rasterizer, never the GPU, and the registered fonts take precedence over installed fonts of the same name. The committed [golden frames](examples/golden-frames.json) record both versions and the platform they were made on (so far linux-x64); `npm run check:export` on another platform shows whether its hashes agree. Programmatic use: `createHeadlessRenderer` from `@relgraph/render/skia` and `renderFilm` from `@relgraph/cli`.

## Source data and scope

- [Literary draft and example](examples/honglou-provisional.relgraph.json): 17 characters, 17 relations and five shots. **This is provisional, not source-verified literary scholarship.** See the [JSON Schema](packages/core/schema/relationship-graph.schema.json) and [TypeScript types](packages/core/types/relationship-graph.ts).
- [Biology draft and synthetic example](examples/biology-signaling-synthetic.json): fictional molecules, typed interactions and a multi-participant reaction. It makes **no experimental claim** and `relgraph.bio/0.1-draft` is not PSI-MI, SBGN, SBML or BioPAX.
- [Neutral graph contract](packages/core/src/graph/core.ts), [literature adapter](packages/core/src/domains/literature.ts), [biology adapter](packages/core/src/domains/biology.ts), [director state](packages/core/src/director/state.ts), [domain style sheets](packages/core/src/style.ts), [frame specs](packages/render/src/frame-spec.ts), [display-list composition](packages/render/src/compose.ts), the [Canvas backend](packages/render/src/backends/canvas2d.ts), the [skia-canvas backend](packages/render/src/backends/skia.ts) and the [CLI](packages/cli/src/index.ts) are reusable modules. `createCanvasRenderer(canvas, graph, layout, {frameSpec, theme, locale, style})` draws frames and `displayListAt(frame)` returns a frame's display list without drawing it. `renderFrameWithList(frame)` returns the exact drawn frame state and its `a11y`-bearing display list for the studio transcript; `compileTimeline(graph, fps)` is exported from core and does not mutate source data.

**ADR 003 step 4 acceptance is pending:** these source changes were pushed through the GitHub connector without a checkout in the coding container. No browser reference, golden PNG/RGBA hashes, screenshot or new MP4 has been generated or validated on this branch, and the nine local checks above still need to run. On an environment with checkout access, capture `main` with `npm run check:browser -- --update-reference` first, compare the branch with `npm run check:browser`, inspect both reveal and caption-only differences, run `npm run check:export -- --update`, refresh the browser reference, re-run the nine commands, and deliver the two MP4s and reveal stills. Do not interpret the existing 32 hashes as post-change baselines.

See [architecture](docs/ARCHITECTURE.md), [cross-domain decision](docs/ADR-002-domain-adapters.md), [render pipeline and foundations](docs/ADR-003-render-pipeline-and-foundations.md) and [roadmap](docs/ROADMAP.md). The project has no GitHub Actions workflow; validation is local.

**License:** not selected yet. A public repository does not by itself grant an open-source or commercial-use license.
