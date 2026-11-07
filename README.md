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
- Both source formats use the same validation → domain adapter → `VisualGraph` → deterministic Canvas renderer. Errors and warnings appear separately with a field path, object ID when available, explanation and repair advice.
- The time in the player is **video time**; `chapterAt` / `domainAt` is **domain time**. If any objects have visibility intervals, the first shot must specify a domain time. Future graph objects and references are filtered before rendering. If a shot explicitly refers to an invisible object, its title and narration are withheld as well. Non-active shot titles are withheld because scene order can move backward in domain time.
- Author-provided free text is not automatically fact-checked or semantically censored: write titles, narration, biography summaries and relationship labels for the intended point in the story. Untimed source data cannot provide reliable chapter-level spoiler protection. The provisional Honglou example intentionally has no invented chapter timestamps.
- Node positions provided in JSON are preserved. Missing positions use a deterministic static fallback; no physics runs during playback. Overlapping authored positions and very dense graphs can still need manual editing.

### Local verification

```bash
npm test
npm run typecheck
npm run check:types
npm run lint
npm run format:check
npm run build
```

The Vitest suite covers adapters, source diagnostics, spoiler projections, reaction roles, camera interpolation, static layouts and deterministic Canvas drawing commands. Strict TypeScript, ESLint and Prettier currently cover the migrated TypeScript and tooling; the remaining JavaScript modules will be migrated in later batches. The literary validator reads the JSON Schema directly and derives the checked document type from it; the biological adapter checks the values it consumes before narrowing imported data. After editing the literary schema, run `npm run generate:types` and commit the regenerated types. `npm run check:types` detects a stale generated file.

The development-only `minimatch` override temporarily selects the patched 11.x release for a glob denial-of-service advisory. It crosses the lint tools' declared 10.x dependency range; keep the lint checks when updating dependencies and remove the override when those tools support a patched version themselves.

The browser workspace additionally exposes `window.renderAt(frame)` for a validated integer frame in the loaded film and `window.studioFrame()` for its current safe state. The canvas is 1280 × 720 at 24 FPS; `renderAt` pauses playback and redraws independently of prior frames. Pixel identity is expected within the same browser, fonts, and rendering environment, not across different operating systems or font rasterizers. A packaged batch PNG/MP4 exporter is not yet included.

## Source data and scope

- [Literary draft and example](examples/honglou-provisional.relgraph.json): 17 characters, 17 relations and five shots. **This is provisional, not source-verified literary scholarship.** See the [JSON Schema](schema/relationship-graph.schema.json) and [TypeScript types](types/relationship-graph.ts).
- [Biology draft and synthetic example](examples/biology-signaling-synthetic.json): fictional molecules, typed interactions and a multi-participant reaction. It makes **no experimental claim** and `relgraph.bio/0.1-draft` is not PSI-MI, SBGN, SBML or BioPAX.
- [Neutral graph contract](src/graph/core.ts), [literature adapter](src/domains/literature.ts), [biology adapter](src/domains/biology.ts), [director state](src/director/state.ts) and [Canvas renderer](src/render/canvas.mjs) are reusable modules.

See [architecture](docs/ARCHITECTURE.md), [cross-domain decision](docs/ADR-002-domain-adapters.md), [proposed render pipeline and foundations](docs/ADR-003-render-pipeline-and-foundations.md) and [roadmap](docs/ROADMAP.md). The project has no GitHub Actions workflow; validation is local.

**License:** not selected yet. A public repository does not by itself grant an open-source or commercial-use license.
