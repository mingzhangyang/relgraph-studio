# RelGraph Studio · 关系叙事工作室

**Video-first, data-driven visualization of complex relationships.** RelGraph Studio turns domain data and declarative shots into a shared Canvas film. Literary and molecular-biology source semantics remain separate.

## Run the director workspace

Use Node.js 22+ for tests and Python 3 for the local development server. There are no runtime packages, accounts, databases, or network requests other than the local server serving the project files.

```bash
# From the repository root
python3 -m http.server 8000 --bind 127.0.0.1
```

Open **http://127.0.0.1:8000/demo/** in a desktop browser. The workspace loads the provisional literary example at startup; switch to the synthetic biology example or select a local JSON file. The file is read locally in the browser. Native ES modules and example loading require HTTP, so opening `demo/index.html` using `file://` is not supported. The older [standalone prototype](demo/standalone.html) remains available as a historical, directly openable demo; it is not the integrated player.

- Play, pause, restart, drag the frame timeline, or select a shot. Space toggles playback outside focused controls; left/right arrows seek by one second.
- Both source formats use the same validation → domain adapter → `VisualGraph` → deterministic Canvas renderer. Errors and warnings appear separately with a field path, object ID when available, explanation and repair advice.
- The time in the player is **video time**; `chapterAt` / `domainAt` is **domain time**. If any objects have visibility intervals, the first shot must specify a domain time. Future graph objects and references are filtered before rendering. If a shot explicitly refers to an invisible object, its title and narration are withheld as well. Non-active shot titles are withheld because scene order can move backward in domain time.
- Author-provided free text is not automatically fact-checked or semantically censored: write titles, narration, biography summaries and relationship labels for the intended point in the story. Untimed source data cannot provide reliable chapter-level spoiler protection. The provisional Honglou example intentionally has no invented chapter timestamps.
- Node positions provided in JSON are preserved. Missing positions use a deterministic static fallback; no physics runs during playback. Overlapping authored positions and very dense graphs can still need manual editing.

### Local verification

```bash
npm test
```

The dependency-free Node suite covers adapters, source diagnostics, spoiler projections, reaction roles, camera interpolation, static layouts and deterministic Canvas drawing commands. The browser workspace additionally exposes `window.renderAt(frame)` for a validated integer frame in the loaded film and `window.studioFrame()` for its current safe state. The canvas is 1280 × 720 at 24 FPS; `renderAt` pauses playback and redraws independently of prior frames. Pixel identity is expected within the same browser, fonts, and rendering environment, not across different operating systems or font rasterizers. A packaged batch PNG/MP4 exporter is not yet included.

## Source data and scope

- [Literary draft and example](examples/honglou-provisional.relgraph.json): 17 characters, 17 relations and five shots. **This is provisional, not source-verified literary scholarship.** See the [JSON Schema](schema/relationship-graph.schema.json) and [TypeScript types](types/relationship-graph.ts).
- [Biology draft and synthetic example](examples/biology-signaling-synthetic.json): fictional molecules, typed interactions and a multi-participant reaction. It makes **no experimental claim** and `relgraph.bio/0.1-draft` is not PSI-MI, SBGN, SBML or BioPAX.
- [Neutral graph contract](src/graph/core.mjs), [literature adapter](src/domains/literature.mjs), [biology adapter](src/domains/biology.mjs), [director state](src/director/state.mjs) and [Canvas renderer](src/render/canvas.mjs) are reusable modules.

See [architecture](docs/ARCHITECTURE.md), [cross-domain decision](docs/ADR-002-domain-adapters.md) and [roadmap](docs/ROADMAP.md). The project has no GitHub Actions workflow; validation is local.

**License:** not selected yet. A public repository does not by itself grant an open-source or commercial-use license.
