# Network authoring acceptance · 2026-11-09

This is the original delivery snapshot. Subsequent Copilot corrections, new
regressions, six inspected Golden changes and squash handling are documented in
[the review-correction report](NETWORK-REVIEW-FIXES.md). Its results supersede
the original counts below.

The starting workspace was an empty managed `/workspace`; a fresh clone was clean.
Main was rechecked as `7e97225b73d17f3eaf695d0335b84cd16fc5bec4` (#21 merged).
#19/#20 are also merged. No competing PR was open, and #21 had no unresolved
inline threads. Its review still calls for independent editorial comparison of
source quotations and kinship interpretation before production. There is no
repository AGENTS.md or Actions workflow. Read README, architecture/ADR 003,
B1.5 acceptance, models/views, shared harness, render/layout/export code, and
#21's verification and B2-2 handoff. No graph/evidence data or domain schema was changed.

## Delivery and architecture

- A: [Draft PR #22](https://github.com/mingzhangyang/relgraph-studio/pull/22),
  `feat/network-appearance` → `main`. Appearance/text projects, shared default
  rendering, strict validation, pure continuous/clipped hit testing, safe stable
  property view, per-document history and configuration round trips.
- B: [Draft PR #23](https://github.com/mingzhangyang/relgraph-studio/pull/23),
  `feat/network-layouts` → `feat/network-appearance` (stacked).
  Deterministic generic layered/force/circle/manual layouts, explicit coordinate
  intent, safe locks, transient preview/apply/cancel and manual/layout history.
  Squash A first, then transplant B's independent tree delta onto the resulting
  main, retarget B and verify the remaining diff. See the correction report for
  preserving review-fix merge resolutions. Neither PR is automatically merged.
  Verified code snapshots: A `eb28307`, B `6bb3527`; this report/handoff is
  recorded in a separate documentation commit.

The [format/use guide](NETWORK-AUTHORING.md) documents all configuration fields,
limits and CLI reproduction. Source facts/provenance remain separate from display
copy, which is not automatically verified. Both backends consume the same pure
composition. Existing playback/position models, projection and load guards are
retained. Algorithms never run during playback. Biological role heads are
protected; generic layered positions do not claim family generations.

## Visual evidence

Before modifying rendering, installed dependencies with `npm ci` and captured
main using `npm run check:browser -- --update-reference`: **37/37**, 16 local PNG
reference frames. The main reference is preserved separately under local
`output/visual-main/`. Candidate comparison deliberately failed against old
pixels (up to approximately 1% for the illustrated literary frames); this was
reviewed before refreshing references. No failed functional check was hidden by
updating a baseline. All 44 headless hashes intentionally changed with the new
visual encoding; the refreshed manifest is committed in A.

[Four before/after pairs](NETWORK-AUTHORING.md#visual-review) cover both domains
and themes. Additional layout and inspector evidence:

- [Literature/circle/light](visuals/layouts/layout-literature-light-circle.png)
- [Literature/layered/dark](visuals/layouts/layout-literature-dark-layered.png)
- [Biology/layered/light](visuals/layouts/layout-biology-light-layered.png)
- [Biology/force/dark](visuals/layouts/layout-biology-dark-force.png)
- [Director workspace](visuals/layouts/workspace-dark.png)

Actually inspected labels, nodes, colors, highlights, biological arrows and
process shapes. The circle is often clearer for a wide literary overview;
generic layers describe graph connectivity, not genealogy. Wide/dense layers
can omit lower-priority labels instead of overlapping them; use a focused shot,
spacing adjustment or manual coordinates for final production. Group decoration
uses original group colors. Existing offline Noto fonts remain unchanged.

## Verification layers

| Actually executed command / layer | Result |
| --- | --- |
| `npm ci` | 157 pinned packages installed |
| `typecheck`, `lint`, `format:check`, `check:types` | All pass |
| `npm test -- --maxWorkers=1` on frozen code | **201/201**, **27/27 files**; no assertion/deadline changes |
| `build:packages`, `build` | Pass, JS/declarations and production Studio |
| `check:browser` on frozen code | **47/47 real Chromium checks** |
| Browser frames | **16/16** updated references match; 12 extra deterministic layout previews captured |
| `check:export` (repeated with `--no-build` after final package builds) | **13/13**, **44/44 Golden frames**, two full example MP4s and eight custom-project clips |
| `git diff --check` | Pass |

There are **20 new tests** over main: 7 configuration/appearance/hit tests and
13 layout strategy tests. The full 201 also includes pure functions, shared VM,
package-consumer/native-worker and integration checks; it is not 201 browser tests.

Pure/config tests exercise sparse inheritance, origins, clearing, invalid fields,
references/ranges, independent copy, saved positions, all three automatic
strategies on both examples and the merged verified dataset, shuffled node/edge
order, cycles, parallel/self edges, disconnected components, locks, preserve vs
missing vs rearrange, random frame access and clipping/continuous hit testing.
The existing seven #21 source/data tests remain part of the full suite.

Shared simulated DOM uses the **existing harness**, including 15 workspace tests
and an additional property-view mount test. It is not a new DOM implementation
and is not evidence of browser rasterization. Existing stale/concurrent loading,
shot-button focus, deduplicated live regions and position/playback tests remain.

Real Chromium adds property editing/history, focus retention, exact project PNG
round trips, hidden custom text withdrawal, layout preview/cancel/apply, exact
locks, undo/redo, import/document switching, and repeated deterministic previews
for three automatic layouts × two domains × two themes. Both 720p and 1080p
composition tests remain; browser preview is 720p. The 16 browser reference frames
were captured before and after the visual change, then compared on the same
Chromium/platform. Repeated PNG equality and main→candidate differences are
different checks.

Golden/MP4 checks use actual CPU Skia and FFmpeg. Both full technical-example
films are 1080p/24 FPS/H.264/yuv420p/BT.709: literature **960 frames / 40 seconds**,
biology **312 frames / 13 seconds**. Decoded target frames match PNG renders at
**40.71 dB** and **41.16 dB** PSNR respectively (minimum 35), beating neighboring
frames. CLI worker PNGs equal direct Skia RGBA exactly. Eight custom project
combinations (2 domains × 2 themes × 2 sizes) each additionally render a random
access worker PNG and a **four-frame MP4**; these are smoke clips, not full films.
Browser↔Skia pixel comparison is informational: mean **1.037%** differ by more
than 16/255 on Chromium 153/Linux x64, mostly font rasterization. It is not an
exact cross-backend equality claim.

## Environment, failures and limits

Linux x64, Node 24.22.1, npm 11.9.0, Chromium 153.0.8010.12, skia-canvas 4.0.0,
FFmpeg/ffprobe 7.1.5. `npm ci` installed 157 pinned packages; lockfile and fonts
are unchanged. Playwright Chromium was initially absent and was actually
installed. The default command sandbox could not reach the inherited network
proxy; approved outer-executor commands completed Git/npm/browser/nested tests.
No check remains blocked by this environment. Final logs are retained under
`output/network-acceptance/`; full clips and PNGs under `output/export-check/`,
with browser references/previews under `output/browser-reference/`,
`output/browser-check/` and `output/visual-main/`.

Initial tests exposed the expected old golden mismatch and an absent offline
npm registry metadata cache. Primed cache under `/tmp/relgraph-cache-prime`
without changing repository dependencies. A packed-consumer test also hit its
existing 60-second limit when competing with export; isolated execution passed
in 59.28 seconds. Frozen-code full-suite execution with `--maxWorkers=1` passed without
relaxing assertions or deadlines; the earlier two-worker run also passed before
the final additional boundary regressions. Browser pixel hashing now computes the exact
same raw RGBA SHA-256 in the page instead of transporting millions of integers
through Playwright; this removes a large test transport cost.

Acceptance review also fixed custom biological edge copy missing from a11y,
custom edge-label boxes not reserving their actual font height, negative-zero
layout serialization, sampled-edge hit gaps/clipping, and array-order dependence in missing-position
manual fallback. The focused layout run passed 31/31 after that correction. The reaction-copy test
initially asserted at stage 1 before the edge was safe to reveal; it now tests
stage 2 and explicitly asserts absence at stage 1. These are recorded failures
and fixes, not claims that the initial candidate passed.

A safety auto-review rejected an unqualified `git reset` because it could discard
index state. No code was lost. A's fixes were committed in its isolated worktree;
after verifying exact file equality and an empty index, narrowly scoped file
synchronization and fast-forward-only merges brought B forward safely. No
approval remains pending.

Remaining limits: no native screen-reader listening, other browser engine,
macOS/arm64, rare-glyph production-font coverage, source reinterpretation or
formal-film typography approval. Layout computation is synchronous and bounded;
large graphs may block the UI, and dense layouts can still need manual work.
Themes and FrameSpecs remain explicit renderer inputs (CLI flags); save and use
the same inputs when comparing preview/export. Projects include the complete
source and are authoring artifacts, not spoiler-redacted public distributions.

## Rollback and B2-2 entry

Revert B to remove strategy/lock/preview/manual-history integration while retaining
A's saved-coordinate project support. Revert A (after B) to remove appearance
projects and restore previous default rendering/golden hashes. Source domain
files/evidence need no migration. Export a plain coordinate JSON through the
existing command if a consumer requires the old source-only format.

The [Roadmap](ROADMAP.md) records both batches complete. For formal production,
start a new B2-2 branch from main after both PRs are reviewed/merged, use the
[verified source report](../datasets/honglou-chengjia-opening/VERIFICATION.md) and
[six-shot / 75-second handoff](../datasets/honglou-chengjia-opening/B2-2-HANDOFF.md),
review every proposed title/narration/inference label and save a separate project
with approved coordinates/styles. Its existing three-second presentation remains
QA only. This delivery creates no formal film, audio synchronization or subtitle
track. No GitHub Actions workflow was added, dispatched or rerun.
