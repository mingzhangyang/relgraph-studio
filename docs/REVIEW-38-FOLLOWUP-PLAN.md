# Follow-up plan · review of #37 and #38

Status: **open** · baseline `main` at `73af432` · reviewed 2026-11-12 ·
PR 1 merged as `a2589bf`, PR 2 as `682dbbd` and PR 1b as `a63875c` on 2026-11-13

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
| 1 | Behaviour fixes | F1–F5 | Tree example changes (F5); others identical | ☑ [#40](https://github.com/mingzhangyang/relgraph-studio/pull/40) merged as `a2589bf` (2026-11-13); leftover 3 tracked as F6 |
| 1b | Behaviour fix | F6 | Must stay identical | ☑ [#42](https://github.com/mingzhangyang/relgraph-studio/pull/42) merged as `a63875c` (2026-11-13); golden frames identical |
| 2 | Per-frame cost and limits | P1–P3 | Must stay identical | ☑ [#41](https://github.com/mingzhangyang/relgraph-studio/pull/41) merged as `682dbbd` (2026-11-13) |
| 3 | Core structure | S1–S3 | Must stay identical | ◐ implemented on branch `claude/eloquent-feynman-qhxjit` from `a63875c`; golden frames identical |
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
the recommendation until it is changed here. PR 1 implements the
recommendations of D1, D2 and D4, and PR 2 that of D3; the boxes stay open
until the owner confirms them.

| Id | Question | Recommendation | Decided |
| --- | --- | --- | --- |
| D1 | How does a drawing remain a timeline (F1)? | Make it a declared state instead of inferring it from coordinates every frame: while a drawing is time-anchored, a dated node's x is derived from its time and only its lane (y) is stored and editable. Leaving that state is an explicit act (applying another strategy), shown in the layout panel. | ☐ |
| D2 | Which layout defaults are canonical (F3)? | The load-time values (spacing 150, iterations 300), exported once and used by the panel too: the golden frames and browser baselines are recorded against them. | ☐ |
| D3 | What happens to the 5,000 / 20,000 limits (P3)? | Keep them as hard limits, add a warning diagnostic above a measured preview budget, and document both numbers. | ☑ budget 300 / 600, from measured playback (#41 review, item 3) |
| D4 | How deep does the "STEP" fix go in PR 1 (F5 vs S3)? | PR 1 only stops showing the internal unit. Separating reveal order from domain time is S3, in PR 3. | ☐ |

## PR 1 · Behaviour fixes

- [x] **F1 · A timeline collapses when one bar moves sideways.** Whether the
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
- [x] **F2 · Preview can be a no-op that looks pending.** The coordinate policy
  defaults to "preserve", and `computeLayout` returns the current positions for
  any strategy in that mode
  (`packages/core/src/director/layout-strategies.ts:57`). The panel still
  reports "临时预览 · 尚未保存" and enables Apply.
  - Done when: choosing a strategy other than manual cannot produce an
    unchanged preview without saying so. Either the policy follows the
    strategy, or the preview is refused with a message. Apply stays disabled
    when nothing moved.
- [x] **F3 · Two sets of layout defaults.** `structuralLayout` uses spacing 150
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
- [x] **F4 · Strategies that do not apply degrade silently.** Applying
  `timeline` to a graph without dates draws the tree instead; the two frames
  are identical and the panel says nothing.
  - Done when: `computeLayout` (or a small companion) reports the engine that
    actually ran and why, and the panel shows it.
- [x] **F5 · "STEP 9" appears in the film.** `shapeDiagram` unfolds a tree,
  mind map or flowchart by rewriting `visibility` and setting
  `timeline.unit = 'STEP'` (`packages/core/src/domains/generic.ts:880`), so the
  frame's domain-time slot shows an internal counter.
  - Done when: a derived unfolding shows no domain time. Golden frames of the
    tree example are regenerated and the change is listed in the PR. Depends
    on D4.

F1–F5 landed in [#40](https://github.com/mingzhangyang/relgraph-studio/pull/40),
merged to `main` as `a2589bf`. After the merge, the tree of `a2589bf` was
compared with the reviewed head `0348d87`: identical (base `08c8e57`, which
`main` had not moved from).

## Follow-up · from the re-review of #40

F6 is a behaviour fix, so it does not travel with the cost work of PR 2 or
the structural work of PRs 3 and 4; it gets its own fix PR from `main`.

- [x] **F6 · A date edit must not look like an off-axis drawing.** The source
  of an anchored timeline still stores each dated node's x, although D1 meant
  to store only its lane. After an ordinary date edit the stored x no longer
  matches the date, so loading reports `OFF_TIME_AXIS`: one node when one
  `end` changes, all 18 of the dynasties example when the end of the axis
  moves (the axis rescales). The only fix the warning offers is
  `"timeAxis": false`, which is the wrong advice here.
  - Evidence: re-review of #40 at `588bb88`, leftover 3, reproduced with a
    script.
  - Done when: an anchored timeline's x is not authored data. Either the
    positioned source stores only lanes for dated nodes (x derived on load),
    or the warning distinguishes "the axis moved since the coordinates were
    written" from "the author placed x by hand" and offers re-exporting the
    coordinates. A pure test covers a changed `end` and a moved axis end.
    Golden frames unchanged.

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

- [x] **P1 · Remove quadratic work from `composeFrame`.** Known sites: the
  label ambiguity check scans every other label per candidate
  (`packages/render/src/compose.ts:1361`); `shotAttention` scans all nodes per
  edge when a group is highlighted (`compose.ts:180`); self-loop ordering and
  legend progress filter the whole view per item; spoke angles are rebuilt by
  array copy.
  - Done when: lookups go through maps built once per frame, a spatial bucket
    serves the label check, and every golden hash is unchanged.
- [x] **P2 · A cost test.** A pure test composes a fixed synthetic graph and
  fails on a regression in operation count (not wall time), so it is stable on
  any machine.
- [x] **P3 · Limits that mean something.** Depends on D3.
  - Done when: `GENERIC_LIMITS` and `docs/GENERIC-GRAPH.md` state the hard
    limit and the measured preview budget, and loading a graph above the budget
    produces a warning diagnostic.

P1–P3 landed in [#41](https://github.com/mingzhangyang/relgraph-studio/pull/41),
merged to `main` as `682dbbd`. After the merge, the tree of `682dbbd` was
compared with the reviewed head `72beefa`: identical (base `a2589bf`, which
`main` had not moved from).

## PR 3 · Core structure

No behaviour change; golden hashes and browser baselines identical.

- [x] **S1 · Dependencies point inward.** Today `style.ts` imports
  `timeAxis` / `keepsTime` from `director/layout-engines.ts`,
  `domains/generic.ts` imports `diagramStructure` from it, and `project.ts`
  imports the strategy lists from `director/layout-strategies.ts`.
  - Done when: graph analysis (components, strongly connected components, tree
    and flow levels) lives in a module under `packages/core/src/graph/`, the
    time-axis model lives in its own module, and the strategy and mode name
    lists live beside the project types. Adapters, styles and engines import
    those; none of them imports an engine.
- [x] **S2 · `generic.ts` does one job per module.** It currently holds the
  parser and validator (one 570-line `parse`), the id mapping, the visual
  hierarchy and the storyboard derivation.
  - Done when: storyboard derivation (`autoStoryboard`, `timedStoryboard`,
    `shapeDiagram`) is a module that works on any `VisualGraph`; `parse` is
    split by section; `loadDocument` parses a document once instead of twice
    (`packages/core/src/director/load.ts:141` and `:148`).
- [x] **S3 · Reveal order is not domain time.** Completes F5: unfolding has its
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

### PR 1 · as implemented

- **F1** · `packages/core/src/director/time-anchor.ts`: `timeAnchor` (a
  timeline diagram under `manual`, `auto` or `timeline` is anchored),
  `anchoredPoint` (a dated node's x is its time) and `anchorToTime` (pin every
  dated node; first-fit lanes for dated nodes without coordinates).
  `layoutGraph`, the studio's history replay, reset, drag and numeric X/Y use
  them. The legend miniature of a span is a point when the drawing has no
  axis. Tests: `tests/layout-behaviour.test.mjs` (F1), the updated case in
  `tests/diagrams.test.mjs`, and the real-browser check "timeline: dragging a
  bar sideways keeps it in time; down changes lane".
- **F2 / F4** · `planLayout` returns the positions with the engine that ran,
  the reason (`kept`, `diagram`, `structure`, `size`, `untimed`) and the
  number of nodes moved; `computeLayout` is its positions. The panel refuses a
  preview that moves nothing and names the engine of a pending preview.
  Tests: `tests/layout-behaviour.test.mjs` (F2, F4) and the simulated-DOM case
  in `tests/studio-workspace.test.mjs`; the generic-example browser check now
  expects `auto` and `flow` to be refused (they reproduce the loaded drawing).
- **F3** · `LAYOUT_DEFAULTS` (150 / 300) in `layout-engines.ts` feeds
  `structuralLayout`, `autoLayout`, `DEFAULT_LAYOUT_SETTINGS`, the panel
  inputs and project save. Auto + rearrange on every coordinate-free example
  now moves no node (before: bookshop 15, tree 22, flowchart 8, dynasties 10,
  mind map 18).
- **F5** · a derived unfolding sets `timeline.ordinal`; the composer and the
  studio show no domain time for it. The 58 tree golden hashes are
  regenerated; the other 178 are unchanged.

### PR 1 · review of #40 at `2319903`

The review found that "is this a timeline" had two sources of truth: the
renderer inferred it from coordinates (`styleForPositions` / `keepsTime`), the
editor from the stored strategy (`timeAnchor`). Now `timeAnchor` is the only
definition and every reader uses it:

- **Declared state.** A timeline diagram is anchored when its stored strategy
  is `auto` or `timeline`, or when none was applied (`manual`) and the source
  does not declare `"timeAxis": false`. `manual` is no longer an anchoring
  strategy of its own. The renderer reads drawings through
  `styleForDrawing(style, graph, positions)`; coordinates can only veto the
  axis, as a guard for callers that pass unpinned positions.
  `styleForPositions` remains as that guard alone.
- **Item 1 · the off-axis state survives a save.** The generic format accepts
  `timeAxis` (boolean). `applyGraphPositions(…, { timeAxis })` writes
  `"timeAxis": false` for a drawing off the axis and removes it for one on the
  axis; the studio's positioned-source export passes the declared state.
  Hand-authored off-axis x without the field is drawn at its dates with the
  `OFF_TIME_AXIS` warning (translated in the studio), which names the field.
  A `.studio.json` whose strategy leaves the axis does not show that warning.
- **Item 2 · locks.** A strategy on the axis is refused (`plan.blocked`) while
  a locked dated node is away from its date; the panel names the nodes. On an
  anchored drawing a lock holds the lane, and x is the date.
- **Item 3 · preview equals apply.** `planLayout` pins the result of a strategy
  on the axis: generic collision displacement skips dated nodes, and dated
  nodes whose bars touch a fixed bar in its lane (`crowdedBy`) are re-laned by
  `anchorToTime`, so the stored layout is exactly the preview.
- **Item 4 · strategy-only changes.** `LayoutPlan.anchored` and
  `anchorChanged` report the target state; the panel refuses a preview only
  when nothing moves and the state does not change. During a preview the
  renderer draws under the previewed strategy (`drawnGraph`).
- **Item 5 · Reset.** Reset restores the loaded strategy with the coordinates,
  and is enabled when only the strategy differs.
- **Item 6 · CLI.** `relgraph layout` fills gaps with `LAYOUT_DEFAULTS` and then
  `anchorToTime`, so a new dated node is written at its years in a free lane;
  what it writes is what the player draws.
- **Item 7 · reveal steps.** `timedNodes` drops visibility from an ordinal
  graph before any time is derived (`runLayoutEngine` for `timeline`,
  `planLayout`'s `untimed` check, `timeAnchor`); the timeline strategy on the
  vertebrates tree reports `tree` / `untimed`.
- **Minor.** The X tooltip is re-translated on a language switch
  (`refreshEditorFieldText`). `TIMELINE_LANE` and `TIMELINE_GAP` are shared by
  the engine and `anchorToTime`; a new lane is one of the drawing's own lane
  steps (at least half the default), and the lane index is built only when a
  node is waiting for a lane.
- Tests: `#40 item …` cases in `tests/layout-behaviour.test.mjs` (pure, CLI
  through `layoutFile`) and the simulated-DOM case "#40 items 4 and 5" in
  `tests/studio-workspace.test.mjs`. Golden frames are unchanged by these
  fixes; browser frames match a baseline captured at `2319903`.

### PR 1 · re-review of #40 at `588bb88`

Verdict: ready to merge, with three leftovers. Two are fixed here, the third
is tracked as F6.

- **Leftover 1 · export of an undated timeline.** The positioned-source export
  wrote `"timeAxis": false` whenever no axis existed, including for a timeline
  that simply had no dates yet. It now records the declared state
  (`declaresTimeAxis`), so dates added later draw the axis.
- **Leftover 2 · Reset and locks.** Reset restored the loaded timeline and then
  pinned a locked node to its year, moving it sideways. Reset now applies the
  same rule as a strategy: it is refused before anything is discarded while
  the loaded axis would move a locked dated node, and it names the nodes.
- **Unsaved flag.** A preview refused because it would change nothing no
  longer leaves its strategy inputs counted as an unsaved draft; any further
  edit makes them a draft again.
- **Leftover 3** · tracked as F6 above, as the re-review suggested.
- Tests: "#40 re-review" cases in `tests/layout-behaviour.test.mjs` and
  `tests/studio-workspace.test.mjs`.

### F6 · as implemented

The first of the two ways the item allows: an anchored timeline's x is not
in the file.

- **Lanes only.** `applyGraphPositions` writes a dated node of an anchored
  timeline as `"position": { "y": … }` (`lanedNodes` in
  `packages/core/src/director/time-anchor.ts`). Whether the timeline is
  anchored is the state written to the file (`sourceKeepsTime` of the
  output: the `timeAxis` option applied, or the field as is when omitted),
  never a stored strategy the file does not record, so the output always
  loads. The studio's positioned export passes its declared state and
  `relgraph layout` omits it; both write lanes. Off the axis, for undated
  nodes, while there is no axis yet (fewer than two distinct times, where x
  is layout, not a date) and in the literature and biology formats, x is
  written as before.
- **x on load.** One rule for both directions: the adapter derives x
  (`timeCoordinate`, rounded as stored coordinates are) for exactly the nodes
  `lanedNodes` names under the source's own state. A lane-only position
  anywhere else (an undated node, `"timeAxis": false`, another diagram kind,
  no axis) is not an error: the node is unplaced, the layout fills the gap
  and a `LANE_ONLY` warning says how to add x. Hand edits of an exported
  timeline therefore still load, and nothing is stacked at x 0.
  `relgraph layout` counts such a node as missing and fills it.
- **The warning.** `OFF_TIME_AXIS` still reports x written by hand, or by an
  export from before F6, and now names both fixes: keep only y, which
  re-exporting the positioned source does, or declare `"timeAxis": false`.
  The studio translates the new texts.
- Tests: the "F6" cases in `tests/layout-behaviour.test.mjs` (one changed
  `end`, a moved end of the axis, an added dated node, a pre-F6 file repaired
  by re-export, lane-only positions that cannot be placed, `relgraph layout`
  filling them, what stays `{x, y}`, an export under a strategy the file does
  not record) and the simulated-DOM case "F6" in
  `tests/studio-workspace.test.mjs`, which exports from the studio, moves the
  end of the axis and loads the file again. All fail against the core of
  `682dbbd`; the item 6 CLI case now checks the CLI's own placement, the
  derived x and the drawn point against one another.
- Golden frames are unaffected: no example stores timeline coordinates.

Validation, run locally on linux-x64, Node 22.23.4: `npm run typecheck`,
`npm run check:types`, `npm run lint`, `npm run format:check` passed and
`npm test` 395 tests in 36 files passed, on the tree of `a8c2a80`;
`npm run check:export` 31/31 passed with the 236 golden frames matching (no
`--update`) and `npm run check:browser` 76/76 passed (no local baseline, so
the two baseline comparisons did not run), on the sources of `e29cc70`,
which `a8c2a80` changes only by a test. No GitHub Actions workflow was added,
dispatched or rerun.

Review of #42, fixed in `ada4d09`: the writer could produce a file the
parser refused (a stored strategy decided the lanes, not the file's own
state), writer and parser used different rules, and an unplaceable lane-only
position was an error or stacked at x 0. Validation on the tree of
`ada4d09`, linux-x64, Node 22.23.4: `npm run typecheck`,
`npm run check:types`, `npm run lint`, `npm run format:check` passed;
`npm test` 396 tests in 36 files passed; `npm run check:export` 31/31 passed
with the golden frames matching (no `--update`); `npm run check:browser`
76/76 passed (no local baseline). The new "F6" cases fail against the core
of `e631ac9`. No GitHub Actions workflow was added, dispatched or rerun.

### F6 · follow-up review of `61a6b48`

The [five inline comments](https://github.com/mingzhangyang/relgraph-studio/pull/42#pullrequestreview-5893708808)
and the [subsequent P3 browser-test finding](https://github.com/mingzhangyang/relgraph-studio/pull/42#pullrequestreview-5894118716)
are addressed together:

- The writer takes diagram/time-axis metadata from the source, including
  when callers pass only `{ nodes }`. Optional caller metadata cannot switch
  which nodes are written as lanes.
- The shared source parser resolves lanes and reports each unplaceable lane
  at `nodes[i].position` with its source id. Validation-only callers and
  imports receive the same warning, without duplicate import warnings.
- The warning and `GENERIC-GRAPH.md` explicitly say that unplacing discards
  y too, and document how to supply full coordinates before disabling the
  axis. This takes the design comment's documentation option; holding y
  fixed during partial layout is not implemented by this PR.
- `onlyMissing` preserves invalid supplied positions for validation to
  reject, rather than silently overwriting them. The documented exceptions
  are missing positions and generic null/unplaceable lane-only positions.
- The Chromium drag check asserts the lane-only schema, imports both
  exports and reads every actual x from the position editor. A date mutation
  must change the observed x while retaining y, so two absent x fields can
  no longer satisfy the assertion.

Regression evidence: all three `F6 review` unit cases fail on `61a6b48` and
pass with these fixes. They cover the nodes-only API, per-node source
warnings and invalid-value preservation. The real-browser check also covers
export, reimport and a changed date.

Validation of this follow-up (linux-x64, Node 24.22.1): `typecheck`,
`check:types`, `lint`, `format:check` and `build:packages` passed; `npm test`
passed all 399 tests in 36 files. `check:browser` passed 76/76 in Chromium
153.0.8010.12, including the strengthened export check. `check:export --
--no-build`, using the just-built packages and Studio, passed 31/31; all
236 golden hashes matched without `--update`. No local browser baseline
was present, so cross-revision browser pixel comparisons did not run.
The sandbox did not capture Node child-process stdout in the package
consumer tests; the unchanged tests and then the full suite passed outside
that sandbox. No GitHub Actions workflow was added, dispatched or rerun.

### PR 2 · as implemented

- **P1** · `composeFrame` no longer scans the whole view per item.
  Attention under a highlight is a lookup built once per frame
  (`attentionUnder`; `shotAttention` keeps its signature). Label collisions
  go through a uniform grid over the label bounds (`RectIndex` in
  `packages/render/src/spatial.ts`), for placed labels and obstacles and for
  the relation obstacles counted as crossings; the "reads as a neighbour's
  name" check asks a point hash grid (`PointIndex`). Self-loop order, group
  members and legend progress are maps built once, spoke angles are pushed
  instead of copied, and ids sort with one `Intl.Collator`. The indexes only
  narrow candidates and the original predicate decides each answer, so
  results equal a full scan: 21,440 frames (nine examples and a 300-node
  synthetic graph, both themes, both locales, 720p and 1080p) give
  byte-identical display lists against the build of `a2589bf`, and the 236
  golden hashes are unchanged.
- **P2** · `tests/compose-cost.test.mjs` composes the synthetic graph of
  `tests/helpers/synthetic-graph.mjs` at 400 and 1,600 nodes under a fixed
  camera and counts reads of the view, text measurements and collision
  tests. Four times the graph may cost at most 4.5 times the reads and
  measurements, and the counts stay within a recorded budget. Run against the
  previous composer, the view is read 35.6 million times at 1,600 nodes
  (budget 145,000; 15.9 times the count at 400 nodes) and the test fails.
  `tests/spatial-index.test.mjs` checks both indexes against a full scan.
- **P3** · `GENERIC_LIMITS.previewNodes` (300) and `previewEdges` (600):
  above either, loading warns with `LARGE_GRAPH` (translated in the
  studio); 5,000 / 20,000 stay hard limits. `docs/GENERIC-GRAPH.md`, "Size",
  states both and the measurements; `scripts/bench-compose.mjs` reproduces
  them.

Compose time per frame at 1080p, means of seven frames, same machine and
method as the table above (`scripts/bench-compose.mjs --baseline`):

| Nodes / relations | Before (`a2589bf`) | After |
| --- | --- | --- |
| 200 / 400 | 23 ms | 14 ms |
| 500 / 1,000 | 65 ms | 34 ms |
| 1,500 / 3,000 | 281 ms | 93 ms |
| 5,000 / 20,000 | 3.2 s | 0.53 s |

Under a camera that shows part of the graph, what remains is linear:
selection outlines (33 samples per relation), hull sampling and garbage
collection. A whole-graph shot is not linear in its collision tests; see the
review of #41 below. Frame-state evaluation (`directorFrameAt`
with a compiled timeline) adds 4 ms at 500 nodes and 84 ms at 5,000; it is
outside P1.

Validation, run locally on linux-x64, Node 22.23.4, on the tree of
`f54385b`: `npm run typecheck`, `npm run check:types`, `npm run lint`,
`npm run format:check` passed; `npm test` 389 tests in 36 files passed;
`npm run check:export` 31/31 passed with the 236 golden frames matching
(no `--update`); `npm run check:browser` 76/76 passed (no local baseline
from an earlier commit was present, so the two baseline comparisons did not
run). No GitHub Actions workflow was added, dispatched or rerun.

### PR 2 · review of #41

The review of #41 at `d794160` found the frames identical and the speed-up
real, and raised three items:

- **1 · "Linear work" did not hold for a whole-graph shot.** The cost test
  fixed the camera at scale 1, so about 100 nodes were on stage at every
  size. Under the fit camera every node is on stage, and a 64-unit cell held
  more rectangles the larger the graph. Fixed: the grid cell is now 16 units
  (about a label line), which brings rectangle tests of a whole-graph shot at
  1,600 nodes from 376,901 to 85,950 (5.8 times the count at 400 nodes, was
  10.0). `docs/GENERIC-GRAPH.md` now says that composition is bounded per
  node and relation only while the density on stage is, and that a
  whole-graph shot still grows faster than the graph.
- **2 · The cost test did not catch the regression it named.** It counted
  only tests made through the indexes. Fixed: the test now counts at the
  predicates, every call of `rectsIntersect` (through `vi.mock`) and of
  `Math.hypot` (through `vi.spyOn`), and adds a whole-graph shot under the
  fit camera with its own growth bound and budget. Each of these mutations
  now fails it: the ambiguity check as a scan of every labelled node
  (189,483 distances, budget 99,000), placed labels or relation obstacles as
  a list scan (261,077 and 2,345,052 rectangle tests, budget 129,000), and
  the 64-unit cell (growth 10.0, bound 7).
- **3 · The preview budget (D3).** Playback measured in the built studio
  ran at 18 fps at 500 / 1,000. The owner chose to lower the budget to
  300 / 600, where playback measured 31 fps.
- **Minor.** The "Size" table names `--per-node 4` for its last row; the
  label loop's `cost` is now `placeCost`; `ComposeOptions.cost` is removed
  (the test no longer needs a hook, so it is not public surface).

Compose time at 1080p after these changes, `scripts/bench-compose.mjs
--baseline` against the build of `a2589bf`, identical lists 7/7 at every
size: 200 / 400 at 13 ms (was 24), 300 / 600 at 20 ms (36), 500 / 1,000 at
33 ms (66), 1,500 / 3,000 at 85 ms (265), 5,000 / 20,000 at 0.54 s (3.5 s).

Validation, run locally on linux-x64, Node 22.23.4, on the tree with these
fixes: `npm run typecheck`, `npm run check:types`, `npm run lint`,
`npm run format:check` passed; `npm test` 390 tests in 36 files passed;
`npm run check:export` 31/31 passed with the 236 golden frames matching (no
`--update`); `npm run check:browser` 76/76 passed (no local baseline, so the
two baseline comparisons did not run). The playback figures of item 3 are
the reviewer's and were not re-measured. No GitHub Actions workflow was
added, dispatched or rerun.

### PR 3 · as implemented

- **S1** · Three modules that import no engine:
  `packages/core/src/graph/analysis.ts` (`prepare`, components, clusters,
  hub and centre, spanning and reading trees, strongly connected components,
  ranks, flow ranks, `diagramStructure`), `packages/core/src/graph/time-axis.ts`
  (`TimeAxis`, `timeAxis`, `placeInTime`, `TIME_TOLERANCE`, `keepsTime`, the
  lane geometry) and `packages/core/src/project-layout.ts`, beside the project
  types (`LAYOUT_ENGINES`, `LAYOUT_TYPES`, `LAYOUT_MODES`, `LAYOUT_DEFAULTS`).
  `style.ts`, `domains/generic.ts`, `project.ts`, `director/time-anchor.ts`,
  the engines and the strategies import them. `time-anchor.ts` stays in
  `director/`: it imports no engine, and the adapter and the styles read the
  anchored state from it. The built package exports the same 113 names.
- **S2** · `domains/generic-source.ts` is the parser and validator: one
  function per section over a shared `Reader`, called in the order the old
  `parse` read the file, so diagnostics keep their order.
  `director/storyboard.ts` holds `autoStoryboard`, `timedStoryboard` and
  `shapeDiagram`, which now reads the kind from the graph and works on any
  `VisualGraph`. `domains/generic.ts` adapts; `inspectGenericDocument`
  validates and adapts with one parse, and `loadDocument` uses it. On 87
  documents (every example and dataset, 16 malformed or edge-case sources and
  each generic example with one top-level field removed or broken),
  `loadDocument`, `validateGenericDocument` and `adaptGenericDocument` return
  the same results as `a63875c`. A test counts reads of the source; it fails
  on `a63875c`.
- **S3** · Reveal order is `revealStep` on nodes, relations and shots, a
  track of its own: `compileTimeline` keeps `revealSteps` beside `domainTime`,
  each shot inherits each value separately, and `projectVisualGraph(graph,
  domainAt, revealStep)` admits an object only when both admit it.
  `timeline.ordinal` and `timedNodes` are gone, with the checks in the
  timeline engine, the composer and the studio: `visibility` is always domain
  time. Every frame of every example (5,376 frames, 8 films) composes to the
  same display list as `a63875c`; for the three unfolding examples the old
  `domainTime` values are now the `revealSteps` values. A test builds a graph
  that unfolds and has dates and checks both tracks; it fails on `a63875c`.
  Public API: `inspectGenericDocument` is added, `timedNodes` is removed.

Not done here: the generic adapter still unfolds only graphs without timed
facts, so a tree with dates is revealed by its dates, as before. Unfolding a
dated tree level by level is now possible in the model, but choosing it for
a source is a behaviour change for a later PR.

Validation, run locally on linux-x64, Node 22.23.4, on the tree of
`9c7ae0a`: `npm run typecheck`, `npm run check:types`, `npm run lint`,
`npm run format:check` passed; `npm test` 401 tests in 36 files passed;
`npm run check:export` 31/31 passed with the 236 golden frames matching (no
`--update`); `npm run check:browser` 76/76 passed in real Chromium (no local
baseline, so the baseline comparisons did not run). The comparisons against
`a63875c` above used both commits' built packages. No GitHub Actions
workflow was added, dispatched or rerun.

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
| 2026-11-12 | F1–F4 | #40 | `a2589bf` (branch `94a97d3`) | Golden frames unchanged |
| 2026-11-12 | F5 | #40 | `a2589bf` (branch `6034b30`) | 58 tree golden hashes regenerated |
| 2026-11-13 | #40 review, items 1–8 and minor | #40 | `a2589bf` (branch `588bb88`) | One anchor definition; golden frames unchanged |
| 2026-11-13 | #40 re-review, leftovers 1–2 and unsaved flag | #40 | `a2589bf` (branch `0348d87`) | Leftover 3 tracked as F6 |
| 2026-11-13 | PR 1 merged | #40 | `a2589bf` | Squash of `0348d87` onto `08c8e57`; tree identical to the reviewed head |
| 2026-11-13 | P1, P2 | #41 | `682dbbd` (branch `dd2fa58`) | Display lists and golden frames identical |
| 2026-11-13 | P3 | #41 | `682dbbd` (branch `f54385b`) | `LARGE_GRAPH` above 500 nodes or 1,000 relations |
| 2026-11-13 | #41 review, items 1–3 and minor | #41 | `682dbbd` (branch `72beefa`) | Budget lowered to 300 / 600 (D3); golden frames unchanged |
| 2026-11-13 | PR 2 merged | #41 | `682dbbd` | Squash of `72beefa` onto `a2589bf`; tree identical to the reviewed head |
| 2026-11-13 | F6 | #42 | `a63875c` (branch `e29cc70`, `a8c2a80`) | Lanes only for anchored dated nodes; golden frames unchanged |
| 2026-11-13 | #42 review and follow-up review | #42 | `a63875c` (branch `ada4d09`, `1271551`) | One lane rule for writer and reader; `LANE_ONLY` warning; golden frames unchanged |
| 2026-11-13 | PR 1b merged | #42 | `a63875c` | Squash of `1271551` onto `682dbbd`; tree identical to the reviewed head |
| 2026-11-13 | S1 | — | — (branch `5e21269`) | Graph analysis, time axis and layout names in their own modules; exports unchanged |
| 2026-11-13 | S2 | — | — (branch `8e49fc2`) | Parser split by section, storyboard module, one parse per load; 87 documents identical |
| 2026-11-13 | S3 | — | — (branch `9c7ae0a`) | `revealStep` track; 5,376 frames identical; golden frames unchanged |
