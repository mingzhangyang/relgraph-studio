# ADR 003 — Display-list rendering, track timeline and project foundations

Status: **Accepted** · proposed 2026-11-06, accepted 2026-11-07 with migration step 2; steps 1–3 merged; step 4 complete 2026-11-08 · Supersedes nothing; refines [ADR 001](ARCHITECTURE.md) and [ADR 002](ADR-002-domain-adapters.md)

The context and paths below describe the project when this ADR was proposed. For the current source layout and migration status, see the [README](../README.md) and [roadmap](ROADMAP.md). Migration steps 1–3 are complete: core and render have separate builds, frames are composed into display lists from a `FrameSpec`, edge and node vocabularies live in domain style sheets, and `relgraph render` exports MP4s headlessly through skia-canvas with vendored fonts and golden frames. Step 4 adds the compiled track timeline, default reveals and the caption track. Step 5's layout CLI and position tools are merged, as are the workspace model/view extractions. See [final acceptance](B1.5-FINAL-ACCEPTANCE.md) for measured verification and the corrective-PR merge gate before B2.

## Context

B1 proved the core idea: two unrelated source domains (literature, molecular biology) flow through validation → domain adapter → `VisualGraph` → frame state → one Canvas renderer, and every video frame is a pure function of its integer index. The project is still small (≈2k lines), so structural changes are cheap now and expensive later.

Reviewing B1 against the "video-first" goal exposed these structural gaps:

| Gap | Where it shows today |
|---|---|
| No video can be produced | The roadmap's exporter is unchecked; `renderAt` needs a live browser and screen capture. |
| Rendering is one imperative function | `src/render/canvas.mjs` mixes camera use, label avoidance, palette and Canvas calls; tests intercept Canvas calls through a `Proxy` to compare output. |
| Frame geometry is hard-coded | 1280×720 and literals such as `26,108,1228,434`, `640,330`, `550/195` in renderer and camera; 9:16 (B3) would touch every one. |
| Domain semantics leak into the renderer | Edge kinds (`catalyst`, `inhibitor`, …), their Chinese captions and dash styles live in `canvas.mjs`. A third domain requires core edits. |
| Motion is limited to camera and attention | Nodes and edges appear abruptly when domain time changes; there are no reveal animations, caption timing or audio alignment. |
| Determinism stops at the font | Pixels match only on the same machine and font set; nothing is bundled. |
| Weak engineering guard rails | `types/*.ts` (≈20 lines) is not type-checked against the code; the JSON Schema exists both in `schema/` and inline in `src/relgraph.mjs`; most modules are written as dense one-line statements that are hard to review. |

## Decision

### Keep (unchanged principles)

1. **Layered pipeline** — source format → validator → domain adapter → neutral `VisualGraph` → projection → frame state → renderer. Domains keep separate ontologies (ADR 002).
2. **Pure frame function** — any frame is computed from `(document, layout, frame, options)` with no dependence on previously drawn frames.
3. **Two clocks** — video time and domain time (chapter, stage, event index) stay independent.
4. **Spoiler safety at projection** — hidden nodes, edges, groups, highlights, camera targets and detail targets are removed before anything is drawn; unsafe scene text is withheld.
5. **Local-first, no physics during playback, authored coordinates preserved.**

### Change

#### D1. Compose to a display list; draw through thin backends

Split rendering into a pure *composition* step and replaceable *backends*:

```
FrameState ──▶ compose(frameState, frameSpec, style, theme) ──▶ DisplayList ──▶ backend
                         (pure, deterministic data)                         ├─ Canvas 2D   (browser preview)
                                                                            ├─ skia-canvas (headless export)
                                                                            └─ SVG         (later: print / stills)
```

```ts
type DisplayItem =
  | {type:'path'; d:PathCommand[]; stroke?:Paint; fill?:Paint; width?:number; dash?:number[]; alpha?:number}
  | {type:'text'; text:string; x:number; y:number; font:FontRef; fill:Paint; align?:'left'|'center'|'right'; halo?:Paint; alpha?:number}
  | {type:'group'; clip?:Rect; items:DisplayItem[]};
interface DisplayList {width:number; height:number; background:Paint; items:DisplayItem[]; a11y:FrameText}
```

- Label placement, edge curves, camera transform and palette resolution happen in `compose`; backends only translate items to drawing calls.
- Tests assert on `DisplayList` values (snapshots and targeted queries) instead of recording Canvas calls.
- `a11y` carries the visible, spoiler-filtered text (titles, narration, detail summary, visible nodes/relations) so the workspace transcript and live region come from the same source as the pixels.

##### Rendering backend: Canvas 2D primary, SVG secondary, no three.js

The deliverable is a video, so backends are judged on frame-exact raster output, headless batch rendering and stable CJK text, not on DOM interactivity.

| | Canvas 2D | SVG | three.js (WebGL) |
|---|---|---|---|
| Frames for video | Direct raster frames | Each frame must be rasterized (e.g. resvg) | Possible, via GPU read-back |
| Headless export | skia-canvas: near-identical API; Chrome also rasterizes with Skia | resvg: fast and deterministic, but a different engine from browser preview | Needs headless-gl or a GPU |
| Cross-machine reproducibility | Good with vendored fonts and one backend version | Good (resvg) | Poor: output varies by GPU and driver |
| CJK text and label avoidance | `measureText` in browser and headless | `getBBox` needs a DOM; headless needs separate metrics | Hard: thousands of glyphs need an SDF atlas (e.g. troika-three-text) |
| Glows and gradients | Cheap | SVG filters are expensive in browsers | Cheap |
| Per-frame redraw | Full redraw of hundreds of nodes is trivial | Mutating many DOM attributes per frame gets slow | Fastest, unnecessary at this scale |
| Accessibility, selection, hit-testing | Weak; supplemented separately | Strong | Weak |
| Vector output (papers, print) | No | Native | No |

Decision:

- **Canvas 2D is the primary backend.** The browser preview uses Canvas 2D and headless export uses skia-canvas, so both share one drawing API and both rasterize through Skia, which keeps preview and final frames closest. Existing label avoidance, glow effects and determinism tests already target this model.
- **SVG is a later secondary backend** for vector stills, posters, paper figures and inspectable debugging output. With the display list in place it is cheap to add. It is not the video path, because preview and export would then use different rasterizers. Its accessibility advantage is already covered by `DisplayList.a11y`.
- **three.js is rejected.** The graphs are two-dimensional, so its strengths (3D scenes, lighting, very large object counts) bring no benefit, while CJK text, GPU-dependent headless export and GPU-varying pixels would break the reproducible-frame foundation.
- **Revisit triggers:**
  - Graphs beyond roughly 10k visible elements: add a GPU 2D backend such as PixiJS or regl, not a 3D engine.
  - Three-dimensional molecular structures: render them with a specialised viewer (Mol\*, NGL) as a separate clip and cut it into the film, instead of turning the graph renderer 3D.

Because backends only translate a `DisplayList` into drawing calls, adding SVG or a GPU backend later does not change composition, timeline or domain code.

#### D2. Parameterize frame geometry with a `FrameSpec`

```ts
interface FrameSpec {
  width:number; height:number; fps:number;
  safe:{title:Rect; graph:Rect; caption:Rect};   // in output pixels
  typeScale:number;                              // relative to a 720p baseline
}
// Presets: landscape-720p, landscape-1080p, portrait-1080x1920, square-1080
```

Camera fitting, clipping and label bounds derive from `FrameSpec.safe.graph`; title and caption layout from their rects. No pixel literals remain in camera or composition code.

#### D3. Timeline as tracks and keyframes; scenes compile into tracks

```ts
interface Timeline {
  durationSec:number;
  camera:Keyframe<CameraTarget>[];
  reveal:{targetId:string; inSec:number; outSec?:number; effect:'fade'|'draw'|'grow'}[];
  highlight:Keyframe<HighlightSet>[];
  captions:{inSec:number; outSec:number; title?:string; text?:string}[];
  domainTime:Keyframe<number>[];               // step-interpolated
}
interface Keyframe<T> {atSec:number; value:T; ease?:'linear'|'smooth'|'hold'}
```

- The existing `presentation` (shots with `durationSec`, `camera`, `highlight`, `chapterAt`/`domainAt`) remains the authoring format and compiles deterministically into a `Timeline`. No source format change is required.
- Nodes and edges that become visible at a domain-time step receive a default `reveal` (fade for nodes, draw-on for edges) instead of appearing abruptly.
- Spoiler projection runs **before** compilation, so no track can reference a hidden object.
- Later, caption timing can be driven by narration audio length without touching other tracks.

##### Step 4 implementation details

- `compileTimeline(graph, fps = 24)` returns a `FilmTimeline` (the name `Timeline` is already taken by the literary schema's generated type) and builds safe shot projections, keyframes and reveal cues in one pure pass. Each scene is filtered and redacted *before* camera, highlight or caption track generation, ensuring invisible references and suppressed narration never enter tracks.
- D3's sketch is refined: `domainTime` is `number | null` for untimed authored scenes; camera keys add `transitionSec`; reveal cues add target kind and duration; caption cues add fade durations; and `shots` stores safe pre-projected values for deterministic random access.
- Forward domain steps reveal newly projected nodes (fade and 82% → 100% scale in **0.6 s**) and edges (exact quadratic Bézier prefix draw-on in **0.8 s**) together. Opening-shot objects remain fully visible. Backward steps instantly withdraw missing objects; a later reappearance gets a new cue. Directed end markers appear after the full edge.
- Node and edge labels do not draw or participate in avoidance until more than 50% of their reveal has elapsed, then fade in. A node's detail card follows the same rule. Camera and highlight transitions retain their old 1200 ms smooth default and geometry. The Canvas2D and skia backends are unchanged.
- Each shot's title and narration fade in and out over **0.3 s**; shots shorter than 0.6 s cap each fade to half their duration. The last shot's caption does not fade out, so the film ends on a readable title. Counters and global film title remain steady. The audio stream and independently muxed MP4 subtitle tracks remain B2 work.
- **A11y:** projected nodes and edges enter `DisplayList.a11y` at the *first reveal frame*, including a zero-alpha first pixel frame; caption text enters from the beginning of its fade-in. Both are semantically active even while transition pixels have opacity zero. The workbench transcript and live region now read that same `DisplayList.a11y`, rather than reinterpreting the graph.
- **Measured impact:** against a browser baseline and golden manifest taken from `main`, all 16 browser mid-shot frames and 28 of the 32 previous golden frames are byte-identical, so camera, highlight and caption pixels outside reveal windows are unchanged. The 4 changed frames are biology 111 and 231 in both themes, where entering edges are mid-draw. `check:export` now also samples each shot at start + 0.3 s (mid node reveal), for 44 golden frames.

#### D4. Visual encoding comes from a domain style sheet

```ts
interface DomainStyle {
  edges:Record<string,{stroke:'plain'|'physical'|'regulatory'; dash?:number[]; head:'arrow'|'bar'|'hollow-circle'|'none'; caption?:LocalizedText}>;
  nodes:Record<string,{shape:'circle'|'pill'|'diamond'; baseRadius:number}>;
  legend:{kind:string; label:LocalizedText}[];
}
```

- `src/domains/literature.style.*` and `src/domains/biology.style.*` own their vocabularies; the renderer only reads resolved styles.
- All user-facing strings (renderer captions, diagnostics, workspace UI) go through a locale table (`zh-CN` first, `en` second). Diagnostics stop mixing languages.
- Themes (`VIDEO_THEMES`, introduced on the B1 UI branch) stay renderer inputs and resolve the style's semantic paints (`plain`, `regulatory`, `highlight`, …) to colours.

#### D5. Layout is data, computed before playback

- Authored coordinates are preserved (unchanged).
- A CLI command fills missing coordinates with a seeded, deterministic stress/force layout and **writes them back** to the document, so the film is reproducible from the file alone.
- The workspace may offer node dragging that exports coordinates; it is a position tweak tool, not a general graph editor.

#### D6. Headless export is a first-class deliverable

```bash
relgraph validate story.json
relgraph layout   story.json --write
relgraph render   story.json --aspect 16:9 --theme light --out film.mp4   # or --frames out/%05d.png
```

- Uses the skia-canvas backend (no browser), renders frames in parallel, encodes with FFmpeg.
- Fonts (subset Noto Sans/Serif CJK SC) are vendored and registered by both backends, making pixel output reproducible across machines with the same backend version.
- A golden-frame test renders a handful of frames per example and compares hashes in CI-less local runs.
- *Implemented in step 3:* the frame size is chosen with `--frame-spec <preset>` (default `landscape-1080p`) rather than `--aspect`, because portrait and square need their own safe areas (B3). The skia backend reuses `createCanvasRenderer`, `drawDisplayList` and `canvasTextMeasurer` unchanged on a CPU skia-canvas canvas. Fonts are WOFF2 subsets of Noto Sans, Serif and Sans Mono CJK SC; the mono family was added so frame metadata does not depend on system fonts. Golden hashes are SHA-256 of RGBA pixels, enforced for the same skia-canvas version and font digest and otherwise reported, and checked by `npm run check:export`, outside `npm test`.

#### D7. Engineering foundations

- **TypeScript** (strict) for all modules, compiled with Vite for the studio and `tsc` for packages; **Vitest** replaces `node --test`; **Prettier** + ESLint enforce readable formatting.
- **One schema source**: JSON Schema files in `schema/` are the single source of truth; TypeScript types and the runtime validator are generated or derived from them. The inline schema in `src/relgraph.mjs` is removed.
- **Layout of the repository**:

```
packages/
  core/     model, schemas, validation, adapters, projection, timeline compiler   (zero runtime deps)
  render/   FrameSpec, compose → DisplayList, themes, backends (canvas2d, skia, svg)
  cli/      validate / layout / render / export
apps/
  studio/   director workspace (preview, diagnostics, timeline, position tweaks)
examples/   literature and biology fixtures, plus golden frames
```

#### D8. Optional: Markdown storyboard scripts

A scene-per-section Markdown script (title, narration, front-matter for camera/highlight/domain time) may compile into `presentation`. Graph data stays in JSON; scripts become reviewable prose diffs. Adopt only if hand-editing `presentation` JSON proves to be the bottleneck in B2.

## Alternatives considered

- **Keep the imperative Canvas renderer and export via browser screen capture.** Lowest effort, but couples export to a browser, cannot render in parallel, and keeps tests tied to drawing-call order.
- **SVG/DOM rendering with CSS animation.** Easy to inspect, but frame-exact seeking and identical raster output for video are harder; still viable as a later backend of the display list.
- **WebGL via three.js.** Rejected for a 2D graph film: CJK text, GPU-dependent headless export and non-reproducible pixels outweigh speed that is not needed at this scale (see D1, Rendering backend).
- **One universal ontology across domains.** Rejected again for the reasons in ADR 002; styles and vocabularies stay per domain.
- **Adopt a UI framework now.** Deferred: the workspace is small. Revisit when the studio gains a timeline editor or position tweaking; Preact or Svelte would fit the size.

## Consequences

- **Positive:** a real video deliverable; 9:16 and new themes become configuration; a third domain needs no core edits; tests become value assertions; accessible text and pixels cannot drift apart; reproducible output across machines.
- **Negative:** a one-time refactor touching most files; a build step and dev dependencies (TypeScript, Vite, Vitest, skia-canvas, FFmpeg for export); the display list is another contract to version.
- **Risk:** the refactor collides with in-flight feature work. Mitigation: merge PR #2 first, then do D7 (tooling) alone, then D1/D2/D4 behind the existing public API (`createCanvasRenderer`, `renderAt`, `studioFrame`) so the workspace keeps working at every step.

## Migration plan

| Step | Scope | Exit criterion |
|---|---|---|
| 0 | Merge PR #2 (B1 + UI/theme branch). | Main contains the B1 workspace. |
| 1 | D7 tooling only: TypeScript, Vite, Vitest, Prettier; mechanical port; single schema source. | Existing tests pass unchanged in behaviour; formatter clean. |
| 2 | D2 `FrameSpec` + D1 `compose`/`DisplayList` + Canvas backend; D4 style sheets and locale table. | Same examples render visually equivalent at 16:9; tests assert on display lists. |
| 3 | D6 skia backend, vendored fonts, `relgraph render` CLI, golden frames. | A complete MP4 of each example is produced headlessly. |
| 4 | D3 track timeline with default reveals; caption track. **Complete.** | Nodes/edges animate in, deterministic frames confirmed by browser and headless regression, refreshed golden hashes, both MP4s exported. |
| 5 | D5 layout CLI and position tweak tool; then B2 source-verified film; D8 only if needed. | First source-verified 60–90 s film exported. |

## Non-goals

- A general-purpose graph editor or real-time physics.
- Standards-based biological import/export (PSI-MI, SBGN, SBML, BioPAX) in this ADR; tracked separately.
- Cloud services, accounts or uploads; the project stays local-first.

## Open questions

1. ~~Is 1080p the default export size, with 720p reserved for preview?~~ **Resolved in step 3: yes.** `relgraph render` defaults to `landscape-1080p`, and the workspace preview stays `landscape-720p`. Both compose from the same 720p design (1080p is exactly 1.5×), and `--frame-spec landscape-720p` exports at preview size.
2. ~~Should the light "paper" palette be the default film theme, independent of the workspace theme?~~ **Resolved in step 3: yes.** Films default to `light`, with `--theme dark` available. The workspace theme (OS preference or the pinned toggle) only affects the preview.
3. Is `zh-CN` the only required locale for B2, with `en` best-effort? Still open. `relgraph render --locale` accepts both renderer locales, and the vendored fonts cover Latin text, but source diagnostics and the workspace UI are not localized yet.
