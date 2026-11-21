# ADR 004 — Evidence, claims and output formats

Status: **Accepted** · proposed 2026-11-20 (#53), accepted 2026-11-21 after P0 (#54–#58) was implemented as decided · Refines [ADR 003](ADR-003-render-pipeline-and-foundations.md); supersedes nothing

## Context

The Tang poet acquaintance films ([`datasets/tang-poets-met`](../datasets/tang-poets-met/README.md), built in [mingzhangyang/tangshi](https://github.com/mingzhangyang/tangshi) `network/`) are the first films made from an outside, evidence-heavy dataset: 64 poets, 119 relations in five kinds, five period groups, two `待考` nodes without relations, rendered at 1080p with music mixed in afterwards. What worked is what ADR 003 set out to provide: line style bound to declared relation kinds, reproducible layout, fixed fonts with golden frames, and re-rendering after a data change.

Producing them exposed seven limits. Reading the code at `06abe50` shows where each one comes from:

| # | Limit met in production | Where it comes from |
|---|---|---|
| 1 | Landscape only; platforms such as 小红书 are portrait-first | `FRAME_SPECS` has `landscape-720p` and `landscape-1080p` only. Geometry is already parameterized (`FrameSpec`), but band layout (`compose/furniture.ts`), legend position (`compose/legend.ts`), the horizontal time axis (`compose/time-axis.ts`), label side order (`compose/labels.ts`), the engines' ~2.8:1 target (`layout-engines.ts`), `MIN_BAND_HEIGHT`, the studio preview and `check:export` (1920 × 1080) all assume landscape. |
| 2 | One shot grammar, one rhythm | `durationSec` is already per shot (the dataset chose 7 s throughout). The real gap: every object a shot reveals starts at the shot's first instant (`compileTimeline`), the camera has one target per shot, and nothing checks caption length against duration. |
| 3 | Evidence never reaches the picture | `evidence`, `sources`, `year`, `place` are unknown fields of `relgraph.graph/1` and are ignored by the loader. |
| 4 | Absence is hard to show | A `待考` node is just a node kind with a square shape; "named together but not connected" has no representation at all. |
| 5 | Labels are dropped silently | `compose/labels.ts`: `if (!box) continue;`. The label stays in `a11y` but no diagnostic is raised. 王维 and 严武 were lost once; tangshi moved its layout to compensate. |
| 6 | Adding a node rearranges everyone | Partly solved already: the studio's `missing` mode and locks keep positions, and `relgraph layout` fills only missing coordinates. But only `force` honours anchors, the timeline engine puts a new dated node in the first free lane regardless of whom it knew, and there is no reusable layout check. tangshi implemented both itself (incremental placement; clearance / crowding / chronology checks). |
| 7 | No audio and no event sync | No audio stream. `FilmTimeline` already holds every shot boundary, reveal cue and caption cue as data, but nothing exports it. |

A portrait prototype made outside the repository (Canvas, Playwright, FFmpeg; 1080 × 1920, 92 s) tested remedies: evidence written out verbatim with the names circled and lines drawn from the words to the people, a vertical time scroll with eleven evidence cards exported from and checked against `graph.json`, a passage about the unconnected, a non-uniform overview, and music driven by the same event table as the picture.

The risk this ADR addresses as much as the features: freer forms can overstate. Putting poets on a map, or drawing a relation as two people walking towards each other, asserts that they met, which most of these relations do not claim (the dataset README is explicit that a line does not mean a meeting).

## Decision

### Keep

Everything ADR 003 keeps, in particular:

1. **Pure frame function.** Every new feature is a function of `(document, layout, frame, options)`. No feature reads previous frames or wall-clock time.
2. **Spoiler safety at projection.** New overlays (evidence cards, absence markers, events) read only the safe projection; a reference to an unprojected object withholds the overlay, as unsafe narration is withheld today.
3. **Authored data is authoritative.** Source evidence is never rewritten by display copy (`config.text`), layout or style; the renderer never paraphrases.
4. **Local-first, no physics during playback, authored coordinates preserved.**
5. **Existing output is stable.** No change in this ADR may alter a landscape pixel unless its PR says so and regenerates golden frames with a reviewed reason. The 236 committed golden hashes are the acceptance line for every phase below.

### D1. Render diagnostics: omitted labels and reading speed (P0)

- Label passes record what they could not place. `DisplayList` gains `omitted: { kind: 'node-label' | 'edge-label'; id: string }[]`. Placement is unchanged, so pixels and golden hashes are unchanged.
- A label counts as omitted only when it would be drawn (its object is past half its reveal) and only in a shot's **settled** frames: after the camera transition and reveals have finished. Omissions during a camera move are noise.
- `relgraph render` reports omissions per shot (shot id, frames, labels) from the workers' compositions at no extra cost; `--fail-on-omitted-labels` turns them into an error. `relgraph validate --frames-check` (name open) composes the settled frames without drawing, so a dataset can be checked before rendering. The studio lists the same diagnostics.
- A warning when a shot's title plus narration exceeds a reading rate over its `durationSec` (starting point: about 5 CJK characters or 3 Latin words per second, after the caption fade-in; configurable, final numbers in the PR). Warning only; durations stay authored.
- These two may land in one PR as distinct commits: both are diagnostics without pixel changes.
  *As shipped (#54):* the pre-render check is its own command, `relgraph check-labels <file>`, not a `validate` flag. Reading rates are 9 CJK characters and 17 other letters or digits per second (`READING_RATE` in `director/reading-speed.ts`), counted over the time the caption is fully shown; the warning suggests the shortest sufficient `durationSec` in half seconds.

### D2. Layout check and neighbour-aware incremental placement (P0)

Two independent PRs.

- **`relgraph check-layout <file>`** (name open): the three checks tangshi runs, generalised, as pure functions in core with diagnostics in the usual shape:
  - *clearance*: no relation passes within `clearance` world units of a node that is not one of its ends;
  - *crowding*: two nodes are not closer than their labels need;
  - *chronology*: two nodes whose times differ by more than `tolerance` are not drawn in reverse order along the time direction. A node's time is its `start`, else the mean `visibleFrom` of its relations.
  Thresholds are options with documented defaults. Relations are checked as drawn (bowed), using the same curve geometry as the composer, not as straight segments; tangshi's README notes that straight-line checks miss bowed curves.
  *Implementation note (D2a PR):* the composer lays relation curves out in screen space (bow, parallel offsets and where strokes stop at glyph rims depend on the camera), so "as drawn" is a property of a frame. Clearance and crowding are therefore checked on composed frames, in the settled frames that `check-labels` samples, from each frame's hit geometry, with thresholds in 720p pixels: a relation within `--clearance` (default 4) of a glyph it does not join, or touching it, and two glyphs within `--crowding` (default 2). Gaps are measured between what is painted: the hit geometry carries each glyph's drawn outline (circle, rounded rectangle, diamond, hexagon) and border, and each relation's stroke width, and the whole drawn path is checked up to the rims of its own ends. Two bars on a time axis may sit close or abut by design, but are reported when they overlap. Whether names have room is `check-labels`' job (D1), so crowding measures glyphs. Chronology stays camera-independent and reads the stored layout; it runs only when `--chronology-tolerance` is given, because x means time only in time-ordered drawings. A node's time follows tangshi: the mean `visibleFrom` of its timed relations, else its own span start or `visibleFrom`.
- **Neighbour-aware `missing` placement.** In `relgraph layout` and the studio's `missing` mode, every engine treats existing coordinates as fixed anchors. A new node starts at the barycentre of its placed neighbours and is moved to the nearest free place; on a timeline that keeps time, x is its date and the lane is the free lane nearest its neighbours' lanes. Invariant, tested for every engine: no existing coordinate changes.
  *Implementation note (D2b PR):* `placeIncrementally` (`director/incremental-placement.ts`) serves both `relgraph layout` and the `missing` mode of every strategy. New nodes join one at a time, the one with the most placed neighbours first. The starting point is the barycentre of its placed neighbours (else of its group's placed members, else of the whole drawing) plus the offset the engine gives it from them: the engine draws the whole graph once, that drawing is aligned to the anchors by a least-squares similarity, and the offset counts as much as the alignment explains the anchors (R²), at most two rooms long. A drawing made with the same engine thus gets a new node where the engine would put it (a child below its parent in layers); one the engine does not resemble gets the plain barycentre. "Free" means outside the engines' own glyph ellipse around every node, with no relation passing beside it and none of its relations passing beside another node, checked as straight segments; the room scales with how sparsely the anchors are drawn compared with the engine's drawing of the same nodes. A timeline that keeps time uses `anchorToTime` with the graph's neighbours: the free lane nearest the neighbours' mean lane, or a new lane just above or below. Anchors beyond ±10⁹ keep the overflow-safe force solver. `relgraph layout --chronology-tolerance N` (opt-in, core option `chronologyTolerance`) also keeps a new node in time order along x against every placed node, as `check-layout` checks it, for drawings whose x means time without keeping time on an axis; filling the 34 poets the 64-poet file adds to the 30-poet drawing this way (tolerance 20) gives `check-layout` 0 crowded pairs, 0 chronology inversions and 15 distinct near passes, against 0, 0 and 16 for tangshi's own 64-poet placement; `check-labels` omits 2 names in the final overview against tangshi's 1. Without the option the same placement has 195 inversions.
- The player's fallback for partly positioned documents is **not** changed by this ADR, so no existing film moves.

### D3. Event export and audio mux (P0)

- `relgraph render --events events.json` writes `relgraph.events/1`: `fps`, `frameCount`, `durationSec` and an ordered list of events `{frame, sec, type, id, ...}` with `type` in `shot`, `caption`, `reveal` (with node or edge, kind, group) and `domain-time`, later `beat` and `evidence` (D4, D7). It is derived from `compileTimeline` after projection, so it is spoiler-safe by construction, and it uses the same frame-grid rounding as rendering. `relgraph events <file>` produces it without rendering.
- `relgraph render --audio track.wav` muxes an existing audio file into the MP4 with FFmpeg. Decoded video frames must be identical with and without `--audio` (checked by frame MD5 in `check:export`); a length mismatch is a warning.
- Music is composed outside the repository (for example tangshi's `make_audio.py`) from the event file. Relgraph Studio does not synthesise sound.

### D4. Evidence as data; evidence cards (P1)

- `relgraph.graph/1` gains an optional, validated `evidence` array on edges and nodes. Each item is either
  - a string: a **citation only** (`"骆宾王《在江南赠宋五之问》"`), which is how tangshi writes it today, so existing files stay valid; or
  - an object `{ cite: string, quote?: string, url?: string, locator?: string }`, where `quote` is verbatim source text and `cite` names the work.
  The literary `quote` and biology `{source, recordId}` evidence shapes stay as they are; their adapters map them to the same neutral `VisualEvidence` on `VisualGraph`.
- A shot may show an evidence card: `evidence: { edgeId | nodeId, items?: number[] }`. The shot field and the object field share the name `evidence` on purpose: on a node or edge it holds the evidence, on a shot it says which evidence to show, as `highlight` names ids without holding the objects. Neither name collides with an existing shot field in the literary, biology or generic formats.
- Evidence on a node (a biographical note, the reason a person has no attested relation) uses the same card. The detail card stays for `summary` and is never used to present evidence. For the Tang data, the `待考` explanations now in `summary` would move to `evidence` items to appear on a card.
- A card shows `quote` exactly as written followed by `cite`; a citation-only item shows `cite` alone. There is no free-text card and `config.text` cannot override card text.
- **No silent truncation.** If a card does not fit its region at the chosen frame spec, rendering fails with a diagnostic naming the shot and item. Choosing fewer items or a shorter quote is an editorial decision for the data owner.
- The card's relation (or node) is highlighted for the card's duration; the card never covers the relation or its ends (the camera fits into the graph area minus the card region). A card whose object is not projected is withheld.
- Card text enters `DisplayList.a11y` (`FrameText.evidence`) and the event file.
- Card text is covered by the font check like any other text; for datasets in `TEXT_SOURCES` an uncovered character fails `npm test`, as today.
- Data consequence: tangshi currently embeds quotations in `sources[].title` (`《旧唐书·宋之问传》：“初征令与杨炯分直内教”`). To use cards it will emit `{cite, quote, url}` items; `sources` remains an ignored field.

### D5. Claims belong to a domain format; the renderer checks a neutral allowlist (P3)

What a relation asserts (that two people met, that a contact is inferred, that a person has no attested contact) is domain semantics. Following ADR 002 (separate ontologies, one neutral graph) and ADR 003 D4 (no domain vocabulary in the renderer), it does **not** enter `relgraph.graph/1`.

- **A social-network domain format, `relgraph.social/0.1-draft`**, for **any evidence-based social network**: historical persons, literary circles, correspondence networks, scholarly or institutional networks, present-day organisations. It has its own schema, validator, adapter and style sheet, like `relgraph.bio/0.1-draft`. Its vocabulary must hold for all of these, not only for Tang poets, and is designed in its own PR; the needs measured on the Tang data are:
  - per relation kind: whether it asserts co-presence (a meeting) and whether it is attested or inferred. Undeclared means the most conservative reading;
  - per person: that no attested relation was found in this graph (D6);
  - pairs examined and rejected, with reason and evidence (D6).
  Tang mapping, for illustration: 当面交往 asserts co-presence; 诗文往来, 官场联系 and 史料交往 do not; 交往推定 is inferred.
- **The renderer sees only a neutral allowlist.** The domain style sheet gives each edge kind the set of forms it permits (`DomainStyle.edges[kind].forms`). The renderer keeps a registry of forms (line treatments, motions, layouts, overlays); a form outside a kind's allowlist is refused with a diagnostic. Forms that imply co-presence (converging paths, co-location on a map, an animated meeting) are never in the default allowlist, so a generic graph, which declares no claims, cannot use them. The social adapter adds them only for kinds that assert co-presence; its validator warns when an inferred kind is given an attested-looking line (solid).
- Biology keeps `evidenceStatus`; its style sheet may derive its own allowlist from it. No shared claim vocabulary across domains.
- This extends the existing rule that a line style belongs to a declared kind. None of the forms added by this ADR implies co-presence; the registry exists so that the first form that does (see Non-goals) cannot arrive without the check.
- Data consequence: to use claims and D6, tangshi emits the social format instead of `relgraph.graph/1`. The current generic files remain valid and keep working without these features.

### D6. Absence, in the social format (P3)

- The adapter maps "no attested relation" to a neutral node treatment in the style sheet (for example a hollow body with a broken outline, independent of the kind's shape) and a legend entry worded by the domain locale as "no attested relation found", never "did not know". A relation incident to such a person is a source error.
- Rejected pairs become neutral pair notes on `VisualGraph` (`{ id, nodes: [a, b], label, evidence }`). They are **never drawn as paths**. A shot may show one as a card (D4), where reason and evidence are visible; they also enter `a11y`.
- Tang mapping: 王勃 and 卢照邻 are people without attested relations; the Four Talents' "齐名不等于相识" pairs are rejected pairs.
- The generic format keeps what it has: an author may still declare a kind such as `待考` with its own shape.

### D7. Output formats: portrait, 3:4 and square (P2, three steps)

Adding a portrait preset alone is not enough: a ~2.8:1 layout fitted into a portrait graph area makes a 64-node overview unreadable. The work is split into three steps; each merges to `main` and is verified there before the next starts.

1. **Specs and frame furniture.** Presets `portrait-1080x1920`, `portrait-1080x1440` (3:4) and `square-1080`, each with its own safe areas: title and caption bands stacked, captions up to four lines, legend placed per spec. `MIN_BAND_HEIGHT` becomes per spec. The type scale is chosen per spec (fixed in the step's design note). `--frame-spec` accepts them; the studio preview takes its canvas size from the spec; `check:export` reads expected dimensions from the spec. Landscape output is byte-identical.
2. **Orientation of time.** For drawings on a time axis, a render-time **transpose**: x and y swap, the axis is drawn vertically, label side order follows. It is an **explicit field of the Studio project** (`relgraph.studio/1` `config`, name fixed in the step's PR, for example `config.view.timeAxis: "horizontal" | "vertical"`), validated with the rest of `config` and kept through undo/redo and project export. It is never inferred from the frame spec, and the CLI has no override, so a render is reproducible from the file and the `--frame-spec` choice alone. A plain source file is drawn horizontally; `relgraph render` warns when a portrait spec draws a horizontal time axis. Stored coordinates are not regenerated, so a data owner's precomputed and checked layout (tangshi) stays valid, and `check-layout` runs on the transposed geometry too. Engines read their target aspect from the spec instead of the 2.8:1 constant when a layout is computed for a portrait film. Other layouts (force, circle, …) are fitted as stored; per-spec coordinate sets are out of scope.
3. **In-shot motion** (shared with D8): camera keyframes inside a shot, so a shot can scroll along time.

### D8. Beats inside a shot (P2, with D7 step 3)

Beats are presentation, not domain data: like `durationSec` and `highlight`, they live in the shot schema shared by the generic and biology formats (and by the social format), and say nothing about what a relation means. The name `beats` is kept; it collides with no existing field.

- A shot may list `beats: [{ atSec, reveal?, highlight?, camera?, evidence? }]`. A beat can only order and emphasise objects already projected at the shot's domain time; it can never bring in a future object, so spoiler safety is unchanged.
- Beats compile into the existing tracks; reveal cues start at the beat instead of the shot start. A shot without beats compiles exactly as today.
- Beats appear in the event file, which is how music follows the picture.

## Delivery

One PR per row, each from current `main` and targeting `main` (see AGENTS.md). Rows within a phase are independent unless noted.

| Phase | PR | Depends on | Exit criterion |
|---|---|---|---|
| 0 | This ADR and ROADMAP update | — | Accepted |
| P0 | D1 omitted-label diagnostics (+ reading-speed warning, separate commit) | ADR | Diagnostics on the Tang 64 film; 236 golden hashes unchanged |
| P0 | D2a `check-layout` | ADR | Reproduces tangshi's results on both Tang files |
| P0 | D2b neighbour-aware `missing` placement | ADR | No-move invariant for every engine; golden unchanged |
| P0 | D3 events export and `--audio` | ADR | Event frames match rendered reveals; identical video frames with/without audio |
| P1 | D4 evidence field and evidence cards | ADR | Cards for the Tang data after tangshi emits structured quotes; overflow fails; golden unchanged for documents without cards |
| P2 | D7 step 1 specs and furniture | P1 merged | New golden manifest per spec; landscape unchanged |
| P2 | D7 step 2 time transpose (project field) | step 1 on `main` | Tang 64 overview legible in portrait; `check-layout` clean; field round-trips through project export |
| P2 | D7 step 3 + D8 in-shot camera and beats | step 2 on `main` | Scrolling timeline film; beats in events |
| P3 | D5 social domain format (`relgraph.social/0.1-draft`), form registry and allowlists | P1 on `main` | Format, adapter and style sheet; generic and biology pixels unchanged |
| P3 | D6 absence in the social format | D5 on `main` | Tang people without attested relations and rejected pairs shown without lines |

P3 touches the source formats and style sheets rather than the frame furniture, so it may proceed in parallel with P2 as independent PRs from `main`. Each PR states exactly which local checks ran; no GitHub Actions workflow is added or run.

### Golden frames and fonts

- `examples/golden-frames.json` keeps its format and stays the landscape-1080p manifest. Each new spec gets its own manifest (`examples/golden-frames.<spec>.json`), so adding a spec never rewrites the existing file.
- No new glyphs are needed for portrait; what changes is line breaking in narrower bands, which is layout. New card text follows the existing subset rule.

## Alternatives considered

- **Only add a portrait `FrameSpec`.** Cheap, but the overview of any time-ordered graph becomes too small to read, and label omission rises sharply without D1 to show it.
- **Durations derived from content by default.** Takes timing away from the author and couples timing to text measurement. A reading-speed warning gives the information without the coupling.
- **Synthesising audio in the renderer.** Pulls a sound engine, licences and taste into a graph renderer. Exporting events keeps the renderer deterministic and lets each project choose its sound.
- **Free-text cards or quotes in `config.text`.** Would let display copy pose as evidence. Cards read only source evidence.
- **Drawing rejected relations as faded or broken lines.** Any line between two people reads as a relation. Excluded pairs appear in cards and text only.
- **Per-spec coordinate sets.** Would double layout authoring and checking. Transposing time covers the measured need.
- **Claim fields in `relgraph.graph/1`.** Co-presence, attestation and rejected pairs are social-network semantics; in the generic format they would be meaningless for most graphs and invite one universal ontology, which ADR 002 rejects. A domain format holds them; the renderer sees only allowlists.
- **Transpose inferred from the frame spec, or a CLI flag.** Either would let the same file render two different drawings without the file saying so.

## Non-goals

- Maps, routes, and any motion that brings two nodes together. They need co-presence and place-time evidence per node, and their own ADR on top of D5.
- Explainer segments that are not a graph (an opening question, the prototype's "what counts as a line", brush strokes, ink dispersing). Make them outside and cut them into the film; relgraph provides the evidence card as its building block.
- Music composition, covers and thumbnails.
- Translating source evidence.

## Consequences

- **Positive:** a film can show why each line exists; dropped labels and layout regressions become visible before release; music can follow the picture without the renderer producing sound; portrait films for time-ordered data without re-authoring layouts; the "no overstatement" rule becomes checkable rather than editorial.
- **Negative:** `relgraph.graph/1` grows by `evidence`, the shared shot schema by `evidence` and `beats`, project `config` by the time-axis direction; a third domain format to maintain; `DisplayList`, `FrameText` and `DomainStyle` grow; more golden manifests; data owners must emit structured quotes to use cards, and the social format to use claims and absence.
- **Risk:** cards and portrait both take stage space and increase label omission. D1 lands first so the effect is measured, not discovered.

## Open questions

Resolved while drafting: the social format covers any evidence-based social network; `beats` and the shot's `evidence` keep their names; node evidence uses the evidence card; the time-axis direction is an explicit project field.

1. Card region per spec: beside the graph in landscape, between graph and caption in portrait? Fixed in the D4 PR's design note for the landscape specs; the portrait, 3:4 and square regions are fixed in D7 step 1.

Resolved since acceptance: the D1 reading-rate defaults (#54, see D1).
