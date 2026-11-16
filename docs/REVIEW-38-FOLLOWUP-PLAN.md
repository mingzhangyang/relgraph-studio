# Follow-up plan · review of #37 and #38

Status: **open** · baseline `main` at `73af432` · reviewed 2026-11-12 ·
PR 1 merged as `a2589bf`, PR 2 as `682dbbd` and PR 1b as `a63875c` on 2026-11-13,
PR 3 as `ca0edd8` and PR 4 as `ad49ba5` on 2026-11-14,
PR 5 as `cb532f9` and PR 6 as `62103bb` on 2026-11-15

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

| PR  | Scope                     | Items | Golden frames                               | Status                                                                                                                          |
| --- | ------------------------- | ----- | ------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------- |
| 1   | Behaviour fixes           | F1–F5 | Tree example changes (F5); others identical | ☑ [#40](https://github.com/mingzhangyang/relgraph-studio/pull/40) merged as `a2589bf` (2026-11-13); leftover 3 tracked as F6    |
| 1b  | Behaviour fix             | F6    | Must stay identical                         | ☑ [#42](https://github.com/mingzhangyang/relgraph-studio/pull/42) merged as `a63875c` (2026-11-13); golden frames identical     |
| 2   | Per-frame cost and limits | P1–P3 | Must stay identical                         | ☑ [#41](https://github.com/mingzhangyang/relgraph-studio/pull/41) merged as `682dbbd` (2026-11-13)                              |
| 3   | Core structure            | S1–S3 | Must stay identical                         | ☑ [#43](https://github.com/mingzhangyang/relgraph-studio/pull/43) merged as `ca0edd8` (2026-11-14); golden frames identical     |
| 4   | Render structure          | S4–S6 | Must stay identical                         | ☑ [#44](https://github.com/mingzhangyang/relgraph-studio/pull/44) merged as `ad49ba5` (2026-11-14); display lists identical     |
| 5   | Tooling and docs          | T1–T4 | Not affected                                | ☑ [#45](https://github.com/mingzhangyang/relgraph-studio/pull/45) merged as `cb532f9` (2026-11-15); tree identical to `26fd0fd` |
| 6   | Workspace UI              | W1–W5 | Not affected                                | ☑ [#46](https://github.com/mingzhangyang/relgraph-studio/pull/46) merged as `62103bb` (2026-11-15); tree identical to `afd6679` |
| 7   | Film frame refinement     | V1–V4 | Regenerated, with before/after frames       | ◐ implemented on branch `claude/film-frame-v1-v4` from `62103bb`; 166 golden hashes regenerated                                 |

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
recommendations of D1, D2 and D4, and PR 2 that of D3; the owner confirmed
all four on 2026-11-13.

| Id  | Question                                            | Recommendation                                                                                                                                                                                                                                                                                         | Decided                                                                                  |
| --- | --------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | ---------------------------------------------------------------------------------------- |
| D1  | How does a drawing remain a timeline (F1)?          | Make it a declared state instead of inferring it from coordinates every frame: while a drawing is time-anchored, a dated node's x is derived from its time and only its lane (y) is stored and editable. Leaving that state is an explicit act (applying another strategy), shown in the layout panel. | ☑ as recommended (owner, 2026-11-13); implemented in #40, lanes-only storage in #42 (F6) |
| D2  | Which layout defaults are canonical (F3)?           | The load-time values (spacing 150, iterations 300), exported once and used by the panel too: the golden frames and browser baselines are recorded against them.                                                                                                                                        | ☑ as recommended (owner, 2026-11-13); implemented in #40                                 |
| D3  | What happens to the 5,000 / 20,000 limits (P3)?     | Keep them as hard limits, add a warning diagnostic above a measured preview budget, and document both numbers.                                                                                                                                                                                         | ☑ budget 300 / 600, from measured playback (#41 review, item 3)                          |
| D4  | How deep does the "STEP" fix go in PR 1 (F5 vs S3)? | PR 1 only stops showing the internal unit. Separating reveal order from domain time is S3, in PR 3.                                                                                                                                                                                                    | ☑ as recommended (owner, 2026-11-13); F5 in #40, S3 in #43                               |

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
| ----------------- | ---------------------- |
| 200 / 400         | 18–33 ms               |
| 500 / 1,000       | 35–67 ms               |
| 1,500 / 3,000     | 128–277 ms             |
| 5,000 / 20,000    | 1.4–4.5 s              |

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

S1–S3 landed in [#43](https://github.com/mingzhangyang/relgraph-studio/pull/43),
merged to `main` as `ca0edd8`. After the merge, the tree of `ca0edd8` was
compared with the reviewed head `54f5f98`: identical (base `a63875c`, which
`main` had not moved from).

## PR 4 · Render structure

No behaviour change; golden hashes and browser baselines identical.

- [x] **S4 · `composeFrame` in passes.** It is one closure of about 1,300
      lines (`packages/render/src/compose.ts:306`–`1609`).
  - Done when: background, time axis, hulls, relations, nodes, legend, labels
    and frame furniture are separate functions over a shared frame context,
    each testable alone.
- [x] **S5 · One source for repeated constants.** Dash rhythms are defined in
      `style.ts`, `literature.style.ts` and `compose.ts:748`; shape proportions in
      `node-geometry.ts` and again for legend miniatures at `compose.ts:1211`; the
      importance scale for radius and type in three places.
- [x] **S6 · The resolved style has one owner.** "Read a drawing through
      `styleForPositions`" is a comment, not a contract:
      `apps/studio/src/position-tool.ts:70` defaults to the neutral style,
      `apps/studio/src/layout-editor-model.ts:85` defaults to the domain lookup
      (neutral for generic graphs), and only `apps/studio/src/studio.ts:1125`
      passes the right one.
  - Done when: the renderer exposes the style it drew with, hit tests and
    overlays take it from there, and the defaults are removed. D1 may make
    `styleForPositions` unnecessary.

## PR 5 · Tooling and docs

- [x] **T1 · One example manifest.** The list is kept in `demo/index.html`,
      `apps/studio/src/studio.ts:128` and `vite.config.mjs`.
- [x] **T2 · Lint and format by glob.** `package.json` names every test file
      by hand in three scripts.
- [x] **T3 · Translate diagnostics by code.** `apps/studio/src/i18n.ts:473`
      parses core's Chinese sentences with regular expressions; a reworded message
      silently falls back to Chinese.
  - Done when: diagnostics carry their parameters, the studio translates by
    `code`, and a test fails when a code has no English text.
- [x] **T4 · Repair `docs/GENERIC-GRAPH.md`.** The "Diagram kinds" table has
      rows from the layout table merged into it; update `docs/ARCHITECTURE.md`
      after PRs 3 and 4.

## PR 6 · Workspace UI

- [x] **W1 · The layout panel follows the strategy.** Seed, spacing and
      iterations are shown for all eleven strategies although most ignore one or
      more of them.
- [x] **W2 · The panel says what drew the picture.** A document arranged
      automatically on load shows "手动 · 保留微调".
- [x] **W3 · Applicability before applying.** Show which strategies suit the
      graph (dates present, forest, directed and acyclic) and what the others will
      do. Builds on F4.
- [x] **W4 · One heading.** The disclosure "布局策略 · 预览后应用" is followed
      by a second heading "布局 · 预览后应用".
- [x] **W5 · Data source first on narrow screens.** At 390 px wide it sits at
      the bottom of a page about 6,000 px long. Example buttons have uneven
      heights in both languages.

## PR 7 · Film frame refinement

Each item changes pixels: regenerate the baselines and include before/after
frames in both themes.

- [x] **V1 · Label rules per diagram kind.** In a tree, inner labels land left
      of some nodes and below others because they use the network's free-side
      search.
- [x] **V2 · Timeline label scale.** Labels inside bars are 13 px; labels that
      do not fit are set outside at 16–19 px and bold, so the shortest spans read
      loudest.
- [x] **V3 · Flowchart relations.** Neutral grey strokes have low contrast,
      the "否，重试" tag sits away from its relation, and a long return passes
      under an unrelated step.
- [x] **V4 · Legend size.** At 12 px it is the smallest text in the frame
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

| Nodes / relations | Before (`a2589bf`) | After  |
| ----------------- | ------------------ | ------ |
| 200 / 400         | 23 ms              | 14 ms  |
| 500 / 1,000       | 65 ms              | 34 ms  |
| 1,500 / 3,000     | 281 ms             | 93 ms  |
| 5,000 / 20,000    | 3.2 s              | 0.53 s |

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

### PR 3 · review of #43

The [acceptance review](https://github.com/mingzhangyang/relgraph-studio/pull/43#pullrequestreview-5898806305)
found one P2: `autoStoryboard` stepped only through `visibility`, so
regenerating the storyboard of an unfolded graph gave one overview shot
showing everything (a root → child → leaf tree: one shot of three nodes,
where `a63875c` gave three shots of one, two and three). Fixed in `2569a4a`:
a graph with reveal steps gets one shot per step, titled by what arrives and
setting `revealStep`; a graph that also has dates keeps its domain-time
storyboard, so no dated fact shows early. The new test fails on `1fb9bd5`.

Validation on the tree of `2569a4a`, linux-x64, Node 22.23.4:
`npm run typecheck`, `npm run check:types`, `npm run lint`,
`npm run format:check` passed; `npm test` 402 tests in 36 files passed;
`npm run check:export` 31/31 passed with the 236 golden frames matching (no
`--update`); `npm run check:browser` 76/76 passed (no local baseline). No
GitHub Actions workflow was added, dispatched or rerun.

### PR 4 · as implemented

One commit per item, on a branch from `ca0edd8`. No behaviour change.

- **S4** · `composeFrame` (`packages/render/src/compose.ts`) runs passes over
  one read-only `FrameContext` (`compose/context.ts`), each a function in
  `packages/render/src/compose/`: `composeBackground`, `drawnNodes` and
  `nodeObstacles`, `composeTimeAxis`, `composeGroups`, `relationLayout` and
  `composeRelations`, `composeNodes`, `composeLegend`, `composeNodeLabels`,
  `composeRelationLabels`, `composeDetailCard`, `composeFurniture` and
  `frameText`. Each returns its own items. Label space is the one state they
  share: a pass that places text or a plate takes its room in an explicit
  `occupied` index, in the order the closure did. Code is moved, not
  rewritten. `tests/compose-passes.test.mjs` runs each pass alone and checks
  that a frame is exactly its passes in order. The source guard in
  `tests/render-pipeline.test.mjs` (no domain vocabulary, no 720p pixel
  positions) now reads every pass module; it read only `compose.ts`, which
  would have left it checking a few lines.
- **S5** · Line rhythms: `packages/core/src/line-styles.ts` (`LINE_STYLES`,
  `LINE_DASH`), a leaf module so the domain sheets that `style.ts` imports
  can read it. The derived sheets, the literature and biology sheets and the
  composer's authored dashes use it; the catalyst's `[2, 5]` stays its own
  rhythm. Shape proportions: `compactExtents` in `node-geometry.ts` defines
  the square, hexagon and circle for both the glyph and its legend miniature
  (`miniatureGeometry`); the miniature-only proportions of shapes sized by
  their words or years sit beside it. Importance:
  `packages/render/src/importance.ts` is the one scale for glyph radius, span
  bar, held words, the label beside a node and the principal's glow and
  solid fill. `tests/style-constants.test.mjs` checks each reader against
  the one source.
- **S6** · `drawingStyle` (exported) is how the composer resolves the style
  of a drawing, and `CanvasRenderer.style` returns it for the positions as
  they are now (a getter: an authoring drag moves them in place).
  `hitVisibleNode` and `startPositionDrag` require the style and have no
  default; the studio passes `renderer.style`. Before, the studio's pointer
  handler recomputed the style from the stored graph, not from the graph
  being drawn under a previewed strategy; drags are not blocked during a
  preview, so the two could differ, though this was not reproduced as a
  visible defect. The simulated-DOM harness's renderer stub composes with the
  style the studio gives it, not `domainStyle` (neutral for generic graphs),
  and has the same getter. D1 did not make `styleForPositions` unnecessary:
  it remains the coordinate guard inside `styleForDrawing`. A new case in
  `tests/canvas-renderer.test.mjs` checks that the boxes a hit test computes
  with `renderer.style` are the boxes drawn, and that moving a bar off its
  years takes the axis away from `renderer.style` at once.

Regression evidence: every frame of every example, of the Honglou dataset and
of the dynasties timeline with one bar pushed off its years, plus every 37th
frame of a 300-node synthetic graph, in both themes, both locales, at 720p
and 1080p (50,832 frames), composes to a byte-identical display list against
the built packages of `ca0edd8`, after each of the three commits. Each build
runs its own core and render packages. A change of one part per million to
the legend glyph size is caught at once. The hexagon miniature now computes
its height as width × √3/2, as the glyph does; no example puts a hexagon in
its legend, and where one does the height can differ in the last bit at
some type scales (1080p, for example).

Public API: core adds `LINE_DASH` (`LINE_STYLES` and `LineStyle` move to
`line-styles.ts` and are re-exported); render adds `drawingStyle`,
`miniatureGeometry` and `CanvasRenderer.style`. In the studio,
`startPositionDrag` takes the style before the optional config.

Validation, run locally on linux-x64, Node 22.23.4, on the tree of
`87e4354` (later commits are docs only): `npm run typecheck`,
`npm run check:types`, `npm run lint`, `npm run format:check` passed;
`npm test` 416 tests in 38 files passed; `npm run check:export` 31/31 passed
with the 236 golden frames matching (no `--update`); `npm run check:browser`
76/76 passed in Chromium 153.0.8010.12 (no local baseline, so the baseline
comparisons did not run). No GitHub Actions workflow was added, dispatched
or rerun.

### PR 4 · review of #44

The [review at `9b01211`](https://github.com/mingzhangyang/relgraph-studio/pull/44#pullrequestreview-5905625208)
found one P2: S6 made the simulated-DOM harness's renderer stub forward
`options.style` to the composer, but the studio creates the first renderer
of each document without a `style` (`studio.ts:765`). The production
renderer then resolves `styleForGraph(graph)`; the stub drew under the
neutral style, so first-load DOM tests exercised other shapes, captions and
legends than the UI. Fixed: the stub resolves `options.style ??
styleForGraph(graph)` once, as `createCanvasRenderer` does, for both
composition and its `style` getter. A new simulated-DOM case loads the
literature, biology, generic and timeline examples and requires each drawn
frame to equal a recomposition under `styleForGraph(graph)`, and to differ
from one under the neutral style. It fails with the stub of `9b01211`.

Validation of the fix, linux-x64, Node 22.23.4: `npm run typecheck`,
`npm run lint`, `npm run format:check` passed; `npm test` 417 tests in 38
files passed. Only test files changed, so `check:types`, `check:export` and
`check:browser` were not rerun. No GitHub Actions workflow was added,
dispatched or rerun.

### PR 4 · merged

#44 merged as `ad49ba5` on 2026-11-14: a squash onto `ca0edd8`, which `main`
had not moved from. Its tree (`1f57935`) is identical to that of the reviewed
head `277eac0`.

### PR 5 · as implemented

Branch `claude/funny-planck-lbzpcv` from `ad49ba5`, one commit per item:

- **T2 · Lint and format by glob.** `package.json` and `eslint.config.mjs`
  read `tests/**/*.mjs` and `tests/**/*.ts` instead of test files listed by
  hand: 29 in each of the three scripts, 20 in the ESLint config. Nine older
  test files were in neither list; a preceding commit formats them with
  Prettier and drops the one unused import ESLint then reports.
- **T1 · One example manifest.** `examples/manifest.json` gives each example
  its button id, file, source name, button title and subtitle. The page keeps
  one `<!-- relgraph:examples -->` slot, which a plugin in `vite.config.mjs`
  fills in dev and build (it fails the build unless there is exactly one); the
  same plugin file copies the listed files into the build. The studio binds
  one handler per entry and opens the first, and the workspace shell takes the
  buttons as one map. The simulated DOM, the production-build test and both
  browser scripts read the file too, so the list is no longer repeated in
  seven places. `tests/studio-examples.test.mjs` requires unique ids and
  files, a valid document per file and an English text for every name, title
  and subtitle.
- **T3 · Translate diagnostics by code.** One code often has several wordings
  (`TYPE` alone has seventeen sites in the generic parser), so translation is keyed by the code, or
  `CODE.variant` where it has several. `packages/core/src/diagnostic-wording.ts`
  words every diagnostic of the `structure`, `semantic`, `graph-source` and
  `studio` layers from a table; a diagnostic carries its `variant` and the
  values the wording names as `params` (fields, limits, counts, allowed
  values), and codes, paths, messages and fixes are unchanged. The studio's
  `ENGLISH_DIAGNOSTICS` is typed against those tables, so a key without
  English fails typecheck; `uiDiagnosticText` replaces the regular expressions
  of `uiDiagnostic`, and 118 sentence entries leave the English string table.
  The workspace's own `LOAD` and `FILE` diagnostics are worded the same way.
  The `biology` and `graph` layers write English only and are shown as
  written. `tests/diagnostic-wording.test.mjs` fails when a key has no English
  text, when the English names other values than the original, when a produced
  diagnostic is not worded from its key and parameters, or when a validator
  writes Chinese text outside the tables; both the missing-key and the
  Chinese-literal cases were planted and caught.
- **T4 · Docs.** The "Diagram kinds" table of `docs/GENERIC-GRAPH.md` had held
  three rows of the layout table since #38 and had lost its flowchart row. The
  flowchart row is rewritten from `style.ts` and `storyboard.ts`, the `tree`,
  `mindmap` and `timeline` strategy rows return to the layout table, and `flow`
  gets back its sentence about feedback relations. `docs/ARCHITECTURE.md` lists
  the eleven layout strategies instead of four, and describes the diagnostic
  tables and the example manifest.

Regression evidence: every message and fix of 7,926 diagnostics is
byte-identical before and after T3. They come from each example with every
field (first two array items, six levels deep) replaced by sixteen kinds of
value, two invalid projects per example and 24 hand-made invalid documents.

Validation, linux-x64, Node 22.23.4: see the PR.

### PR 5 · merged

#45 merged as `cb532f9` on 2026-11-15: a squash onto `ad49ba5`, which `main`
had not moved from. Its tree (`eff4a13`) is identical to that of the reviewed
head `26fd0fd`. The squash commit kept only the title of the branch's first
commit ("style: format the nine test files…"); its content is all of T1–T4.

### PR 6 · as implemented

Branch `claude/workspace-ui-w1-w5` from `cb532f9`, one commit per item, plus
one structural core commit kept apart from the UI work:

- **Core, no behaviour change** (`7c196a1`). `autoEngine` (`layout.ts`) is
  the automatic choice: the diagram kind's engine, else a grid above
  `AUTO_LAYOUT_NODE_LIMIT`, else `chooseLayoutEngine`. `structuralLayout`
  uses it. `strategyEngine` (`layout-strategies.ts`) adds the undated-timeline
  fallback and is what `planLayout` reads, so the panel can say what a
  strategy draws before it runs. Golden frames identical.
- **W4 · One heading** (`3207c4a`). The panel no longer adds the heading
  "布局 · 预览后应用"; the disclosure summary is its only heading.
- **W1 · The panel follows the strategy** (`6ab1cef`). `ENGINE_PARAMETERS`
  (`layout-engines.ts`): force reads seed, spacing and iterations; radial and
  circle seed and spacing; layered, flow, tree, mind map, timeline and grid
  spacing only. `strategyParameters(graph, type)` gives a strategy's settings
  for a graph (`auto` those of its engine, an undated timeline those of the
  tree, `manual` none). The panel hides the other settings, and the
  coordinate policy under `manual`. A hidden setting is not validated, is
  previewed with its stored value and is not an unsaved draft. A pure test
  changes, on every example, each setting an engine does not list and
  requires the same drawing, and requires a listed one to change some
  drawing. The browser check no longer types into hidden fields; its circle
  project saves the stored iterations (300 instead of 123). Real Chromium
  showed that `.appearance-editor label { display: grid }` overrode the
  `hidden` attribute, which the simulated DOM cannot see; a CSS rule fixes
  it and the browser check asserts the field is not visible.
- **W2 · What drew the picture** (`b6c6b6f`). `drawingOrigin(graph)`
  (`layout.ts`) says how `layoutGraph` draws a document: the stored strategy,
  the engine and reason of an automatic drawing (an undated timeline as a
  tree), stored coordinates, or stored coordinates with `missing` nodes
  placed beside them. The panel opens with "当前画面：…": the applied
  strategy, else the origin at load, with "，并有手动微调" once a node was
  moved by hand (Reset, undo and redo follow; a pending preview keeps its
  "实际绘制" note). `manual` is renamed "保留当前画面 · 手动微调", the strategy
  that keeps the picture rather than a description of it. Hand moves after
  an applied strategy are not detected: the line still names that strategy.
  A stored type alone no longer counts as applied: see the review of #46.
- **W3 · Applicability before applying** (`01aad10`). `graphTraits` (dates,
  any relation, at least 70% directed as `auto` counts, directed without
  cycles, a forest) and `layoutFit(graph)`: per strategy whether it suits the
  graph, a note why, and the engine it draws with. A timeline needs dates and
  otherwise draws a tree; tree, mind map and radial need a forest and
  otherwise follow a spanning tree; layered needs directed relations without
  cycles (a cycle shares one level); flow suits directed relations and reads
  a loop as feedback; engines that follow relations say when there are none;
  force and circle suit any graph and the grid keeps the file's order. The
  menu marks unsuitable strategies "（不适合此图）" and a line under it words
  the chosen one (`auto` with its engine). The menu labels are written by
  the panel, not by the static translation pass.
- **W5 · Data source first; one button height** (`7ef9ad2`). At 840 px and
  below the sidebar was `display: contents` and the source card was placed
  first with `order`, while keyboard and screen-reader order still followed
  the document (preview, then sidebar). The review of #46 replaced this: the
  source card now comes first in the document (see below). The buttons are still rendered from
  `examples/manifest.json` by `vite.config.mjs`; `grid-auto-rows: 1fr` gives
  every row the tallest button's height, text at the top. On a narrow screen
  the section numbers now read 03 before 01.

All new interface texts have English in `apps/studio/src/i18n.ts`; no
diagnostic was added. Measured in Chromium with the bookshop loaded and the
layout panel open (the plan's "about 6,000 px" was not reproduced at
`cb532f9`):

| Viewport, language | Page height, before → after | Source card top, before → after | Button heights before → after |
| ------------------ | --------------------------- | ------------------------------- | ----------------------------- |
| 1440 px, Chinese   | 1,398 → 1,398               | 99 → 99 (sidebar)               | 76, 60 → all 76               |
| 1440 px, English   | 1,421 → 1,421               | 99 → 99 (sidebar)               | 95, 76, 60 → all 95           |
| 390 px, Chinese    | 3,963 → 3,762               | 1,327 → 75 (preview at 761)     | all 60 → all 60               |
| 390 px, English    | 4,256 → 4,100               | 1,438 → 122 (preview at 919)    | 79, 76, 60 → all 79           |

Tests: `tests/layout-description.test.mjs` (pure: `strategyEngine` against
`planLayout`, `ENGINE_PARAMETERS` against the engines, `drawingOrigin`,
`graphTraits` and `layoutFit` on the examples) and
`tests/studio-layout-panel.test.mjs` (simulated DOM: no heading in the
panel, settings per strategy, hidden-setting rules, the origin line through
edits, Reset, Apply, undo and redo, the menu marks and the fit line, and no
Chinese left in the English panel). Old simulated-DOM cases find the note by
id (`strategyNote`). Real Chromium: a new browser check at 1440, 840 and
390 px in both languages (one button height, source placement, no
horizontal overflow, one landmark). Before/after screenshots (desktop and
390 px, both languages) were taken with real Chromium from builds of
`cb532f9` and `7ef9ad2`.

Validation, run locally on linux-x64, Node 22.23.4, on the tree of
`7ef9ad2`: `npm run typecheck`, `npm run check:types`, `npm run lint`,
`npm run format:check` passed; `npm test` 436 tests in 42 files passed;
`npm run check:export` 31/31 passed with the 236 golden frames matching (no
`--update`); `npm run check:browser` 77/77 passed in Chromium 153.0.8010.12
(no local baseline, so the baseline comparisons did not run;
`--update-reference` not used). No GitHub Actions workflow was added,
dispatched or rerun.

### PR 6 · review of #46

The [review at `c76a0ea`](https://github.com/mingzhangyang/relgraph-studio/pull/46#pullrequestreview-5909193479)
found three P2 and one P3, all fixed on the branch:

- **P2 · Provenance from the stored type alone** (`cfc2b5e`). A valid
  project may store `layout.type: 'grid'` with no or partial `positions`;
  `placeNodes` ignores the type, so the structure or the fallback draws, yet
  the panel said "已应用：网格". `drawingOrigin` now reports a strategy only
  when the project holds a coordinate for every node, which is what Apply
  writes, and otherwise what actually drew. The studio reads the current
  project the same way.
- **P2 · "No dates" for dates at one time** (`cfc2b5e`). `timeAxis` is also
  null when every date is equal. `hasTimes` (`graph/time-axis.ts`) tells the
  cases apart: the new reason `instant` (`LAYOUT_REASONS`) and fit note say
  "所有日期都在同一时间", `untimed` keeps "没有节点带日期". `drawnEngine`
  (`layout.ts`) is now the one place where a timeline without an axis
  becomes a tree, for `strategyEngine` and `drawingOrigin`. `graphTraits`
  gains `ranged`, which is `dated` with an actual time range.
- **P2 · Focus order on narrow screens** (`eab487d`). The source card is now
  first in `demo/index.html`, outside the aside. The aside stays the one
  complementary landmark; the card keeps its labelled section. On wide
  screens, grid areas place it atop the right column above the sticky
  sidebar, in a wrapper with the sidebar's padding and scrollbar gutter so
  both column edges align. Stacked, the page follows the document: data
  source, preview, sidebar. The `order` and `display: contents` rules are
  gone. Trade-off on wide screens: the source card is no longer inside the
  sidebar's scroll area, so the sidebar starts below it and its lower part
  is reached by scrolling the page. At the end of the page the sticky
  sidebar's top meets the header as it did on `cb532f9` (5 px from the top
  in both, measured).
- **P3 · No heading left** (`87f1f42`). The summary now holds an
  `<h2 class="summary-heading">` with the same text, styled inline. Chromium
  exposes it as a level-2 heading with the disclosure open or closed, and the
  static translation pass still translates it.

Measured in Chromium at `87f1f42`, bookshop loaded, layout panel open. Page
heights at 1440 px grow because the sidebar starts below the source card:

| Viewport, language | Page height (`cb532f9` → `7ef9ad2` → `87f1f42`) | Source card top (`87f1f42`) |
| ------------------ | ----------------------------------------------- | --------------------------- |
| 1440 px, Chinese   | 1,398 → 1,398 → 1,504                           | 99, right column            |
| 1440 px, English   | 1,421 → 1,421 → 1,597                           | 99, right column            |
| 390 px, Chinese    | 3,963 → 3,762 → 3,730                           | 75, preview at 761          |
| 390 px, English    | 4,256 → 4,100 → 4,068                           | 122, preview at 919         |

Tests: the "#46 review" pure cases in `tests/layout-description.test.mjs`:
a type with empty, partial and full positions; undated, single-date and
same-date fixtures across `graphTraits`, `layoutFit`, `strategyEngine`,
`planLayout` and `drawingOrigin`. Simulated-DOM cases in
`tests/studio-layout-panel.test.mjs` for both P2s through load, a hand edit,
Apply and English. All of these fail on `c76a0ea`. The W4 case now requires
exactly one heading, the h2 in the summary. Real Chromium:

- a 390 px focus sequence: from the top, Tab reaches every example button and
  the file input before any control of the preview, and in one pass focus
  moves down the page through source, preview and sidebar;
- one level-2 heading role for the panel, open and closed.

Validation, run locally on linux-x64, Node 22.23.4, on the tree of
`87f1f42`: `npm run typecheck`, `npm run check:types`, `npm run lint`,
`npm run format:check` passed; `npm test` 440 tests in 42 files passed;
`npm run check:export` 31/31 passed with the 236 golden frames matching (no
`--update`); `npm run check:browser` 77/77 passed in Chromium 153.0.8010.12
(no local baseline; `--update-reference` not used). No GitHub Actions
workflow was added, dispatched or rerun.

### PR 6 · re-review of #46

The [re-review at `1ac58d6`](https://github.com/mingzhangyang/relgraph-studio/pull/46#pullrequestreview-5909265708)
verified the four fixes above (their threads resolved) and found one P3,
fixed in `48fbbf5`: a valid one-node graph with no coordinates anywhere fell
through the `nodes.length > 1` guard and was reported as `partial`
("文档保存的坐标；1 个没有坐标的节点排在旁边"), although `placeNodes` simply puts
the node at the origin. `drawingOrigin` has a new kind, `single`, which
claims no engine; the panel says "没有保存坐标，唯一的节点放在原点". An empty
graph is rejected by validation (`EMPTY`). A pure case (no coordinates,
source position, project position, two nodes) and a simulated-DOM case in
both languages fail on `1ac58d6`.

Validation, run locally on linux-x64, Node 22.23.4, on the tree of
`48fbbf5`: `npm run typecheck`, `npm run check:types`, `npm run lint`,
`npm run format:check` passed; `npm test` 442 tests in 42 files passed;
`npm run check:export` 31/31 passed with the 236 golden frames matching (no
`--update`); `npm run check:browser` 77/77 passed in Chromium 153.0.8010.12
(no local baseline; `--update-reference` not used). No GitHub Actions
workflow was added, dispatched or rerun.

### PR 6 · merged

#46 merged as `62103bb` on 2026-11-15: a squash onto `cb532f9`, which `main`
had not moved from. Its tree (`6ba1d33`) is identical to that of the reviewed
head `afd6679`.

### PR 7 · as implemented

Branch `claude/film-frame-v1-v4` from `62103bb`, one commit per item. Before
coding, `npm run check:browser -- --update-reference` captured a local
browser baseline at `62103bb` (22 frames, Chromium 153.0.8010.12), kept for
the comparison below.

- **V1 · Label rules per diagram kind** (`7a7b4ae`). A tree's derived style
  declares `labelSides: 'tree'`. The label pass reads each node's role from
  the whole tree and the direction it grows from the drawing (`treeReading`
  in `packages/render/src/compose/labels.ts`): a leaf is labelled ahead of
  its node, the root behind it, an inner node across the growth (below a
  sideways tree), ending where the node ends so it stays clear of the
  relations to its children; then the other side across, the same two
  centred, and the sides along the growth last (`treePlaces`). Roles come
  from the full graph, so an inner node shown before its children keeps its
  side; the "neighbour's name" penalty does not apply, since the side is how
  a reader pairs label and node. An authored `textPosition` still wins;
  networks, mind maps (labels inside boxes) and flowcharts are unchanged.
  `ComposeOptions.graph` now includes `edges`; `FrameContext` exposes
  `positions`. In the vertebrates tree every leaf is labelled right, the root
  left, and seven of eight inner nodes below (Mammalia above, where below would
  cross its parent's relation); before, inner labels were left or below.
- **V2 · Timeline label scale** (`4d9f7e2`). `SPAN_LABEL` (13, weight 500,
  `packages/render/src/importance.ts`) is the size and weight of a span's
  words inside its bar and beside it; before, a span too short to hold its
  name was labelled at its importance size (16–19, bold). Points keep the
  importance scale.
- **V3 · Flowchart relations** (`3fa605f`). A flowchart's derived style
  declares `edgeContrast: 'strong'` and `returns: 'over'`. Neutral relations
  take the new theme colour `edge.strong` (light `#5a6b74`, dark `#b4c9ce`)
  at 92 % presence: at least 3.7:1 against every paper tone of both themes,
  where the plain neutral at 66 % gave 1.8:1 on the light paper.
  `relationLayout(view, points, style)` finds the returns (relations against
  the way most relations advance, in a drawing that advances sideways) and
  routes each up out of its step, over every step between its ends and down
  into the top of its target, with its tag on the crossing: "否，重试" now
  sits on its line, and the relation it pairs with is a plain elbow again.
  The style argument is required, so no caller can silently skip the rule.
  The example's "long return" was not reproduced at `62103bb` (its long
  relation, 通知缺货 → 结束, runs forward below the steps); a synthetic
  five-step flow with a return over two steps covers it.
- **V4 · Legend size** (`c2904e0`). `LEGEND` (`compose/legend.ts`) sets the
  legend at 14 (720p units; 21 px at 1080p, about 10.5 px in the workspace
  preview), above the scene label and group names (13); marks, swatch and
  plate grow with it.

Tests: `tests/film-frame.test.mjs`, pure (composed display lists): V1 roles
and growth (sideways, turned, mirrored), the side per role on the whole tree,
stability while the tree unfolds, networks and authored sides; V2 one font
for every span label, inside and beside, and the importance scale off the
axis; V3 the 3:1 contrast in both themes and unchanged network strokes, the
retry route and tag, and a long return clear of the steps it passes; V4 the
legend size against the scene label and its plate. The V1, V2 and V3 cases
fail on the commit before each item; the V4 case imports `LEGEND`, which
does not exist before it, and its size assertion fails on 12.
`tests/compose-passes.test.mjs` and `tests/style-constants.test.mjs` pass
the style to `relationLayout`.

Golden frames (`examples/golden-frames.json`, regenerated with
`npm run check:export -- --update` after each item; 166 of 236 change in
all, literature and biology 62 unchanged):

| Item | Changed hashes | Which                                                                                  |
| ---- | -------------- | -------------------------------------------------------------------------------------- |
| V1   | 58             | Tree: all 58 (both themes, every shot)                                                 |
| V2   | 6              | Timeline shot 13 (transition 878, mid 918, last 971), both themes                      |
| V3   | 0              | No golden example is a flowchart                                                       |
| V4   | 108            | Graph: all 40; timeline: 68 of 76 (shots 1–2 show one kind and draw no legend; 8 kept) |

Browser baselines: `npm run check:browser` on the final tree against the
`62103bb` baseline passed 79/79 (the two baseline comparisons ran);
`--update-reference` then saved 22 frames byte-identical to the `62103bb`
ones. The baseline holds only literature and biology mid-shot frames, which
draw neither a tree, a timeline, a flowchart nor a legend.

Before/after frames: every mid-shot and last frame of the tree, timeline,
flowchart, bookshop and mind-map examples, both themes, 1080p, rendered with
the skia backend from builds of `62103bb` and `c2904e0` (94 pairs): tree
22/22, timeline 24/28, flowchart 16/18 and bookshop 16/16 differ; mind map
0/10. Side-by-side pairs of the last frames (bookshop shot 2) in both themes
accompany the PR.

Validation, run locally on linux-x64, Node 22.23.4, on the tree of
`c2904e0`: `npm run typecheck`, `npm run check:types`, `npm run lint`,
`npm run format:check` passed; `npm test` 452 tests in 43 files passed;
`npm run check:export` 31/31 passed with the 236 regenerated golden frames
matching (no `--update` on this run); `npm run check:browser` 79/79 passed
in Chromium 153.0.8010.12 against the `62103bb` baseline, then 77/77 with
`--update-reference`. No GitHub Actions workflow was added, dispatched or
rerun.

## Review evidence

Ran locally on linux-x64, Node 22.23.4, at `73af432`: `npm run typecheck`,
`npm test` (356 tests in 33 files, all passing), the dev server in real
Chromium for all seven examples, and the core and render experiments quoted
above against `npm run build:packages` output. Not run during the review:
`npm run lint`, `npm run format:check`, `npm run check:browser`,
`npm run check:export`. No GitHub Actions workflow was added, dispatched or
rerun.

## Progress log

| Date       | Item                                          | PR  | Commit on `main`                        | Note                                                                                             |
| ---------- | --------------------------------------------- | --- | --------------------------------------- | ------------------------------------------------------------------------------------------------ |
| 2026-11-12 | Plan                                          | —   | —                                       | Review completed; plan written                                                                   |
| 2026-11-12 | F1–F4                                         | #40 | `a2589bf` (branch `94a97d3`)            | Golden frames unchanged                                                                          |
| 2026-11-12 | F5                                            | #40 | `a2589bf` (branch `6034b30`)            | 58 tree golden hashes regenerated                                                                |
| 2026-11-13 | #40 review, items 1–8 and minor               | #40 | `a2589bf` (branch `588bb88`)            | One anchor definition; golden frames unchanged                                                   |
| 2026-11-13 | #40 re-review, leftovers 1–2 and unsaved flag | #40 | `a2589bf` (branch `0348d87`)            | Leftover 3 tracked as F6                                                                         |
| 2026-11-13 | PR 1 merged                                   | #40 | `a2589bf`                               | Squash of `0348d87` onto `08c8e57`; tree identical to the reviewed head                          |
| 2026-11-13 | P1, P2                                        | #41 | `682dbbd` (branch `dd2fa58`)            | Display lists and golden frames identical                                                        |
| 2026-11-13 | P3                                            | #41 | `682dbbd` (branch `f54385b`)            | `LARGE_GRAPH` above 500 nodes or 1,000 relations                                                 |
| 2026-11-13 | #41 review, items 1–3 and minor               | #41 | `682dbbd` (branch `72beefa`)            | Budget lowered to 300 / 600 (D3); golden frames unchanged                                        |
| 2026-11-13 | PR 2 merged                                   | #41 | `682dbbd`                               | Squash of `72beefa` onto `a2589bf`; tree identical to the reviewed head                          |
| 2026-11-13 | F6                                            | #42 | `a63875c` (branch `e29cc70`, `a8c2a80`) | Lanes only for anchored dated nodes; golden frames unchanged                                     |
| 2026-11-13 | #42 review and follow-up review               | #42 | `a63875c` (branch `ada4d09`, `1271551`) | One lane rule for writer and reader; `LANE_ONLY` warning; golden frames unchanged                |
| 2026-11-13 | PR 1b merged                                  | #42 | `a63875c`                               | Squash of `1271551` onto `682dbbd`; tree identical to the reviewed head                          |
| 2026-11-13 | S1                                            | —   | — (branch `5e21269`)                    | Graph analysis, time axis and layout names in their own modules; exports unchanged               |
| 2026-11-13 | S2                                            | —   | — (branch `8e49fc2`)                    | Parser split by section, storyboard module, one parse per load; 87 documents identical           |
| 2026-11-13 | S3                                            | —   | — (branch `9c7ae0a`)                    | `revealStep` track; 5,376 frames identical; golden frames unchanged                              |
| 2026-11-13 | D1, D2, D4                                    | #43 | —                                       | Owner confirmed the recommendations; all four decisions closed                                   |
| 2026-11-13 | #43 review, P2                                | #43 | — (branch `2569a4a`)                    | Regenerated storyboard of an unfolded graph unfolds; golden frames unchanged                     |
| 2026-11-14 | PR 3 merged                                   | #43 | `ca0edd8`                               | Squash of `54f5f98` onto `a63875c`; tree identical to the reviewed head                          |
| 2026-11-14 | S4                                            | —   | — (branch `6882f62`)                    | `composeFrame` in passes over a frame context; 50,832 display lists identical                    |
| 2026-11-14 | S5                                            | —   | — (branch `9d13310`)                    | One source for line rhythms, shape proportions and the importance scale; display lists identical |
| 2026-11-14 | S6                                            | —   | — (branch `87e4354`)                    | The renderer owns the drawn style; hit tests have no default; display lists identical            |
| 2026-11-14 | #44 review, P2                                | #44 | —                                       | Harness renderer resolves the graph's style on first load, as production does                    |
| 2026-11-14 | PR 4 merged                                   | #44 | `ad49ba5`                               | Squash of `277eac0` onto `ca0edd8`; tree identical to the reviewed head                          |
| 2026-11-15 | T2                                            | —   | — (branch `3939a8c`, `a298444`)         | Tests linted and formatted by glob                                                               |
| 2026-11-15 | T1                                            | —   | — (branch `8c14f13`)                    | `examples/manifest.json`; buttons rendered from it                                               |
| 2026-11-15 | T3                                            | —   | — (branch `9117a8b`)                    | Diagnostics worded by key; 7,926 messages and fixes identical                                    |
| 2026-11-15 | T4                                            | —   | —                                       | Diagram kinds and layout tables repaired; architecture updated                                   |
| 2026-11-15 | PR 5 merged                                   | #45 | `cb532f9`                               | Squash of `26fd0fd` onto `ad49ba5`; tree identical to the reviewed head                          |
| 2026-11-15 | W4                                            | —   | — (branch `3207c4a`)                    | One heading in the layout panel                                                                  |
| 2026-11-15 | Core: `autoEngine`, `strategyEngine`          | —   | — (branch `7c196a1`)                    | One rule for the engine a strategy draws with; golden frames identical                           |
| 2026-11-15 | W1                                            | —   | — (branch `6ab1cef`)                    | Panel shows only the settings the strategy reads (`ENGINE_PARAMETERS`)                           |
| 2026-11-15 | W2                                            | —   | — (branch `b6c6b6f`)                    | "当前画面" line from `drawingOrigin`; manual renamed                                             |
| 2026-11-15 | W3                                            | —   | — (branch `01aad10`)                    | `layoutFit`: suitability marked in the menu and worded under it                                  |
| 2026-11-15 | W5                                            | —   | — (branch `7ef9ad2`)                    | Data source first at ≤ 840 px; example buttons of one height                                     |
| 2026-11-15 | #46 review, P2 ×2                             | #46 | — (branch `cfc2b5e`)                    | Provenance from coordinates, not the stored type; `instant` beside `untimed`                     |
| 2026-11-15 | #46 review, P2 and P3                         | #46 | — (branch `eab487d`, `87f1f42`)         | Source card first in the document, focus follows the layout; one h2 in the summary               |
| 2026-11-15 | #46 re-review, P3                             | #46 | — (branch `48fbbf5`)                    | A lone node without coordinates is `single`, not `partial`                                       |
| 2026-11-15 | PR 6 merged                                   | #46 | `62103bb`                               | Squash of `afd6679` onto `cb532f9`; tree identical to the reviewed head                          |
| 2026-11-16 | V1                                            | —   | — (branch `7a7b4ae`)                    | Tree labels by role; 58 tree golden hashes regenerated                                           |
| 2026-11-16 | V2                                            | —   | — (branch `4d9f7e2`)                    | One size for span labels; 6 timeline golden hashes regenerated                                   |
| 2026-11-16 | V3                                            | —   | — (branch `3fa605f`)                    | Strong flowchart strokes; returns over the steps; golden frames unchanged                        |
| 2026-11-16 | V4                                            | —   | — (branch `c2904e0`)                    | Legend at 14; 108 golden hashes regenerated; browser baseline identical                          |
