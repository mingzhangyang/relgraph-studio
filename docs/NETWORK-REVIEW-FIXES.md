# Network authoring review corrections · 2026-11-09

All eleven Copilot findings on [#22](https://github.com/mingzhangyang/relgraph-studio/pull/22)
and [#23](https://github.com/mingzhangyang/relgraph-studio/pull/23) were reproduced
or covered by targeted regressions. Corrections were made in their owning layer
and merged forward into [#24](https://github.com/mingzhangyang/relgraph-studio/pull/24),
preserving uploaded images. Existing remote commit history was retained.

## Corrections and regression evidence

| PR / finding | Correction | Executed regression layer |
| --- | --- | --- |
| #22 global fields disappear without selection | Pure inspector resolution reads the chosen global/category/object scope, with matching origins | Pure model and real Chromium |
| #22 pending input commits to newly picked node | Blur the active inspector control before changing Canvas selection | Real Chromium: label and font edits stay on original node |
| #22 saved project can reject its own coordinates | Validate the final assembled configuration before download | Real Chromium: invalid project reports diagnostics and creates no download |
| #22 customized glyph cannot be dragged at stage edge | Shared resolved size/shape/stroke geometry drives composition, clipping and position hit testing | Pure geometry/position tests across circle, pill and diamond |
| #22 undrawn edge suffix intercepts selection | Hit samples cover only the currently rendered reveal prefix | Pure composed-frame hit test |
| #22 top multiline label rejects itself | Top and diagonal candidates use measured text height | Pure two-line placement regression, native visual audit |
| #23 one lock/manual edit promotes every fallback position | Preserve sparse authored positions for individual edits; full snapshots require an explicit whole-layout operation | Pure sparse snapshot/ownership tests and real Chromium |
| #23 coordinate export includes a temporary preview | Cancel preview before coordinate-only export | Real Chromium compares downloaded coordinates with committed coordinates |
| #23 a click destroys redo | Commit a drag only when its coordinate changed | Pure history and real Chromium redo preservation |
| #23 Escape leaves an uncommitted move | Restore the exact previous coordinate before releasing drag capture | Pure cancellation and real Chromium unfinished-drag cancellation |
| #23 spacing overflows finite locked anchors | Pass spacing into the seeded solver instead of rescaling anchors | Pure 1.5e308-anchor cases at spacing 64/160/400 |

Resolved geometry also exposed a native Canvas rule: assigning `lineWidth = 0`
is ignored. Drawing now skips a zero-width stroke explicitly; a backend test
checks zero and positive widths. Sparse snapshots own their coordinate objects,
so editing a new snapshot cannot mutate an earlier undo state.

## Visual audit

The pre-correction #24 tree (`54a918d`) was built in an isolated worktree with
its own core/render package links. It reproduced **44/44** existing Skia hashes.
Against that snapshot, **38/44** new frames were unchanged. Exactly six changed:
literature frames **264, 368, 591**, each in **light and dark**, at 1080p. Their
accessible text is unchanged. Measured label height enables a valid position
above the node; collision scoring can then choose that position instead of a
side fallback. Source coordinates, relationship meanings and colors did not change.

Two representative full-resolution before/after pairs are committed:

| Frame | Before | After |
| --- | --- | --- |
| Literature / light / 264 | [PNG](visuals/review-fixes/literature-light-264-before.png) | [PNG](visuals/review-fixes/literature-light-264-after.png) |
| Literature / dark / 368 | [PNG](visuals/review-fixes/literature-dark-368-before.png) | [PNG](visuals/review-fixes/literature-dark-368-after.png) |

All six changed frames were inspected before updating only their six manifest
hashes. No `--update` command was used to hide the export failure. All **16/16**
Chromium reference PNGs remain byte-identical; that baseline was not refreshed.
The remaining before/after images are in local ignored `output/review-fixes/`.

## Validation and merge handling

The independently tested correction snapshots passed **192/192** Vitest and
**43/43** Chromium checks on A, and **208/208** Vitest and **49/49** Chromium
checks on B. These counts precede the additional zero-stroke case. They include
pure and existing shared simulated-DOM tests; they are not browser-test counts.
The snapshot-ownership refinement also passed its **16/16** targeted layout
tests, and zero-stroke plus render tests passed **35/35**. Final combined #24
validation is recorded in [the image report](https://github.com/mingzhangyang/relgraph-studio/blob/feat/node-images/docs/NODE-IMAGES.md#review-correction-validation).

### Historical merge handling versus current delivery

The original #22 → #23 → #24 squash/transplant instructions are historical.
#22 reached `main`, but #23 was merged into `feat/network-appearance` and
#24 into `feat/network-layouts`. Neither was delivered to `main` by those
merges. Do not retarget or rerun those merged PRs.

[PR #25](https://github.com/mingzhangyang/relgraph-studio/pull/25) now restores
their **final reviewed trees** together, directly against `main`. The first
three Copilot findings on #25 prompted restoration of existing mainline
geometry and safe relationship selector regressions; lock-only layout-draft
preservation and stale delivery guidance have also been addressed on #25.
Do not treat the original counts above as fresh #25 verification. Locally
validate the actual #25 tree, merge only into `main`, then check the expected
files and fixes on the new `main` before starting B2-2 or another feature.
GitHub's Merged label alone is insufficient. No GitHub Actions dispatch.

No dependency, font, domain schema, source fact or evidence changed. Native
screen-reader sessions, additional platforms/engines, rare glyphs and dense
production typography remain unverified. The dataset's three-second timeline
is still QA; formal B2-2 editorial work starts only after review and merge.
No Actions workflow was added, dispatched or rerun.
