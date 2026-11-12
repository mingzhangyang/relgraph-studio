# Follow-up plan · review of #37 and #38

Status: **open** · baseline `main` at `73af432` · reviewed 2026-11-12

This is the tracking document for the work that came out of reviewing
[#38](https://github.com/mingzhangyang/relgraph-studio/pull/38) (generic graphs,
diagram kinds, redrawn network) and
[#37](https://github.com/mingzhangyang/relgraph-studio/pull/37) (EGFR–MAPK
example). Each item has an id, the evidence it rests on, the files it touches
and what "done" means. Tick the box and fill in the PR and commit when an item
lands; add a line to the [progress log](#progress-log).

The review verdict in one line: the pipeline (source → adapter → `VisualGraph`
→ layout → frame state → display list → backend) is intact and the "one graph,
several conventions" model is sound, but four behaviours fail in ways a user
meets quickly, three dependencies point the wrong way, and two modules have
outgrown their shape.

## How this is delivered

The repository rules in [AGENTS.md](../AGENTS.md) apply to every step:

- One PR at a time, **never stacked**. Each branch starts from the current
  `main`; the next PR starts only after the previous one is merged and its
  files are verified on `main`.
- Fixes, structural changes and UI work stay in separate PRs.
- No GitHub Actions workflow is added, dispatched or rerun. Every PR states
  which local validations actually ran.

| PR | Scope | Items | Golden frames | Status |
| --- | --- | --- | --- | --- |
| 1 | Behaviour fixes | F1–F5 | Tree example changes (F5); others identical | ☐ not started |
| 2 | Per-frame cost and limits | P1–P3 | Must stay identical | ☐ not started |
| 3 | Core structure | S1–S3 | Must stay identical | ☐ not started |
| 4 | Render structure | S4–S6 | Must stay identical | ☐ not started |
| 5 | Tooling and docs | T1–T4 | Not affected | ☐ not started |
| 6 | Workspace UI | W1–W5 | Not affected | ☐ not started |
| 7 | Film frame refinement | V1–V4 | Regenerated, with before/after frames | ☐ not started |

PR 1 comes first because its items are user-visible defects. PRs 3 and 4 come
before the UI work so that PR 6 and PR 7 build on the split modules instead of
adding to the large ones. PR 5 is independent and can move earlier if useful.

Validation for every PR, run locally and reported as run or not run:
`npm run typecheck`, `npm run check:types`, `npm run lint`,
`npm run format:check`, `npm test`, `npm run check:browser`,
`npm run check:export`. A PR whose table row says "must stay identical" does
not pass `--update` to the golden or browser baselines.

## Decisions needed before coding

These are choices for the owner. Each has a recommendation; the plan assumes
the recommendation until it is changed here.

| Id | Question | Recommendation | Decided |
| --- | --- | --- | --- |
| D1 | How does a drawing remain a timeline (F1)? | Make it a declared state instead of inferring it from coordinates every frame: while a drawing is time-anchored, a dated node's x is derived from its time and only its lane (y) is stored and editable. Leaving that state is an explicit act (applying another strategy), shown in the layout panel. | ☐ |
| D2 | Which layout defaults are canonical (F3)? | The load-time values (spacing 150, iterations 300), exported once and used by the panel too: the golden frames and browser baselines are recorded against them. | ☐ |
| D3 | What happens to the 5,000 / 20,000 limits (P3)? | Keep them as hard limits, add a warning diagnostic above a measured preview budget, and document both numbers. | ☐ |
| D4 | How deep does the "STEP" fix go in PR 1 (F5 vs S3)? | PR 1 only stops showing the internal unit. Separating reveal order from domain time is S3, in PR 3. | ☐ |

## PR 1 · Behaviour fixes

- [ ] **F1 · A timeline collapses when one bar moves sideways.** Whether the
  axis is drawn is inferred each frame by comparing stored coordinates with a
  recomputed axis, with a tolerance of 0.02 world units
  (`keepsTime`, `packages/core/src/director/layout-engines.ts:1064`;
  `styleForPositions`, `packages/core/src/style.ts`).
  - Evidence (real Chromium): in the dynasties example, entering position
    editing and dragging 唐 about 12 px to the right removes the axis and turns
    all 18 bars into circles. The legend still shows bars.
  - Evidence (core): after writing the layout back with `applyGraphPositions`,
    adding one dated node without a position, or changing one `end` by one
    year, drops the axis for the whole drawing. Dragging in y alone keeps it.
  - Done when: a sideways drag cannot remove the axis; a source with saved
    coordinates keeps its axis after a date is edited or a dated node is added,
    with every bar at its time; the legend glyph matches the glyph drawn; a
    pure test and a real-browser drag check cover it. Depends on D1.
- [ ] **F2 · Preview can be a no-op that looks pending.** The coordinate policy
  defaults to "preserve", and `computeLayout` returns the current positions for
  any strategy in that mode
  (`packages/core/src/director/layout-strategies.ts:57`). The panel still
  reports "临时预览 · 尚未保存" and enables Apply.
  - Done when: choosing a strategy other than manual cannot produce an
    unchanged preview without saying so. Either the policy follows the
    strategy, or the preview is refused with a message. Apply stays disabled
    when nothing moved.
- [ ] **F3 · Two sets of layout defaults.** `structuralLayout` uses spacing 150
  and 300 iterations (`packages/core/src/director/layout.ts:33`);
  `DEFAULT_LAYOUT_SETTINGS` uses 160 and 160
  (`packages/core/src/director/layout-strategies.ts:24`).
  - Evidence: "auto + rearrange" with the panel defaults moves every node of
    the bookshop (15/15), tree (22/22) and flowchart (8/8) examples, and 10 of
    18 in the dynasties example, although the document was already arranged by
    the same engine.
  - Done when: one exported constant feeds both paths, and a test asserts that
    "auto + rearrange" on a freshly loaded coordinate-free document moves
    nothing. Depends on D2.
- [ ] **F4 · Strategies that do not apply degrade silently.** Applying
  `timeline` to a graph without dates draws the tree instead; the two frames
  are identical and the panel says nothing.
  - Done when: `computeLayout` (or a small companion) reports the engine that
    actually ran and why, and the panel shows it.
- [ ] **F5 · "STEP 9" appears in the film.** `shapeDiagram` unfolds a tree,
  mind map or flowchart by rewriting `visibility` and setting
  `timeline.unit = 'STEP'` (`packages/core/src/domains/generic.ts:880`), so the
  frame's domain-time slot shows an internal counter.
  - Done when: a derived unfolding shows no domain time. Golden frames of the
    tree example are regenerated and the change is listed in the PR. Depends
    on D4.

## PR 2 · Per-frame cost and limits

Measured on the built packages with a constant-time text measurer, so real
frames are slower. Synthetic graph, six groups, three relation kinds.

| Nodes / relations | Compose time per frame |
| --- | --- |
| 200 / 400 | 18–33 ms |
| 500 / 1,000 | 35–67 ms |
| 1,500 / 3,000 | 128–277 ms |
| 5,000 / 20,000 | 1.4–4.5 s |

The preview budget at 24 fps is about 42 ms.

- [ ] **P1 · Remove quadratic work from `composeFrame`.** Known sites: the
  label ambiguity check scans every other label per candidate
  (`packages/render/src/compose.ts:1361`); `shotAttention` scans all nodes per
  edge when a group is highlighted (`compose.ts:180`); self-loop ordering and
  legend progress filter the whole view per item; spoke angles are rebuilt by
  array copy.
  - Done when: lookups go through maps built once per frame, a spatial bucket
    serves the label check, and every golden hash is unchanged.
- [ ] **P2 · A cost test.** A pure test composes a fixed synthetic graph and
  fails on a regression in operation count (not wall time), so it is stable on
  any machine.
- [ ] **P3 · Limits that mean something.** Depends on D3.
  - Done when: `GENERIC_LIMITS` and `docs/GENERIC-GRAPH.md` state the hard
    limit and the measured preview budget, and loading a graph above the budget
    produces a warning diagnostic.

## PR 3 · Core structure

No behaviour change; golden hashes and browser baselines identical.

- [ ] **S1 · Dependencies point inward.** Today `style.ts` imports
  `timeAxis` / `keepsTime` from `director/layout-engines.ts`,
  `domains/generic.ts` imports `diagramStructure` from it, and `project.ts`
  imports the strategy lists from `director/layout-strategies.ts`.
  - Done when: graph analysis (components, strongly connected components, tree
    and flow levels) lives in a module under `packages/core/src/graph/`, the
    time-axis model lives in its own module, and the strategy and mode name
    lists live beside the project types. Adapters, styles and engines import
    those; none of them imports an engine.
- [ ] **S2 · `generic.ts` does one job per module.** It currently holds the
  parser and validator (one 570-line `parse`), the id mapping, the visual
  hierarchy and the storyboard derivation.
  - Done when: storyboard derivation (`autoStoryboard`, `timedStoryboard`,
    `shapeDiagram`) is a module that works on any `VisualGraph`; `parse` is
    split by section; `loadDocument` parses a document once instead of twice
    (`packages/core/src/director/load.ts:141` and `:148`).
- [ ] **S3 · Reveal order is not domain time.** Completes F5: unfolding has its
  own track in the compiled timeline instead of borrowing `visibility` and
  `timeline.unit`.
  - Done when: a graph can both unfold and carry real domain time, and the
    spoiler projection is unchanged for timed documents.

## PR 4 · Render structure

No behaviour change; golden hashes and browser baselines identical.

- [ ] **S4 · `composeFrame` in passes.** It is one closure of about 1,300
  lines (`packages/render/src/compose.ts:306`–`1609`).
  - Done when: background, time axis, hulls, relations, nodes, legend, labels
    and frame furniture are separate functions over a shared frame context,
    each testable alone.
- [ ] **S5 · One source for repeated constants.** Dash rhythms are defined in
  `style.ts`, `literature.style.ts` and `compose.ts:748`; shape proportions in
  `node-geometry.ts` and again for legend miniatures at `compose.ts:1211`; the
  importance scale for radius and type in three places.
- [ ] **S6 · The resolved style has one owner.** "Read a drawing through
  `styleForPositions`" is a comment, not a contract:
  `apps/studio/src/position-tool.ts:70` defaults to the neutral style,
  `apps/studio/src/layout-editor-model.ts:85` defaults to the domain lookup
  (neutral for generic graphs), and only `apps/studio/src/studio.ts:1125`
  passes the right one.
  - Done when: the renderer exposes the style it drew with, hit tests and
    overlays take it from there, and the defaults are removed. D1 may make
    `styleForPositions` unnecessary.

## PR 5 · Tooling and docs

- [ ] **T1 · One example manifest.** The list is kept in `demo/index.html`,
  `apps/studio/src/studio.ts:128` and `vite.config.mjs`.
- [ ] **T2 · Lint and format by glob.** `package.json` names every test file
  by hand in three scripts.
- [ ] **T3 · Translate diagnostics by code.** `apps/studio/src/i18n.ts:473`
  parses core's Chinese sentences with regular expressions; a reworded message
  silently falls back to Chinese.
  - Done when: diagnostics carry their parameters, the studio translates by
    `code`, and a test fails when a code has no English text.
- [ ] **T4 · Repair `docs/GENERIC-GRAPH.md`.** The "Diagram kinds" table has
  rows from the layout table merged into it; update `docs/ARCHITECTURE.md`
  after PRs 3 and 4.

## PR 6 · Workspace UI

- [ ] **W1 · The layout panel follows the strategy.** Seed, spacing and
  iterations are shown for all eleven strategies although most ignore one or
  more of them.
- [ ] **W2 · The panel says what drew the picture.** A document arranged
  automatically on load shows "手动 · 保留微调".
- [ ] **W3 · Applicability before applying.** Show which strategies suit the
  graph (dates present, forest, directed and acyclic) and what the others will
  do. Builds on F4.
- [ ] **W4 · One heading.** The disclosure "布局策略 · 预览后应用" is followed
  by a second heading "布局 · 预览后应用".
- [ ] **W5 · Data source first on narrow screens.** At 390 px wide it sits at
  the bottom of a page about 6,000 px long. Example buttons have uneven
  heights in both languages.

## PR 7 · Film frame refinement

Each item changes pixels: regenerate the baselines and include before/after
frames in both themes.

- [ ] **V1 · Label rules per diagram kind.** In a tree, inner labels land left
  of some nodes and below others because they use the network's free-side
  search.
- [ ] **V2 · Timeline label scale.** Labels inside bars are 13 px; labels that
  do not fit are set outside at 16–19 px and bold, so the shortest spans read
  loudest.
- [ ] **V3 · Flowchart relations.** Neutral grey strokes have low contrast,
  the "否，重试" tag sits away from its relation, and a long return passes
  under an unrelated step.
- [ ] **V4 · Legend size.** At 12 px it is the smallest text in the frame
  (about 9 px in the workspace preview).

## Review evidence

Ran locally on linux-x64, Node 22.23.4, at `73af432`: `npm run typecheck`,
`npm test` (356 tests in 33 files, all passing), the dev server in real
Chromium for all seven examples, and the core and render experiments quoted
above against `npm run build:packages` output. Not run during the review:
`npm run lint`, `npm run format:check`, `npm run check:browser`,
`npm run check:export`. No GitHub Actions workflow was added, dispatched or
rerun.

## Progress log

| Date | Item | PR | Commit on `main` | Note |
| --- | --- | --- | --- | --- |
| 2026-11-12 | Plan | — | — | Review completed; plan written |
