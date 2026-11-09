# Native golden baseline review · 2026-11-09

The 36 hash changes in this review approve the existing mainline label layout.
They do not change the renderer. They resolve the stale baseline found during
local acceptance of [PR #26](https://github.com/mingzhangyang/relgraph-studio/pull/26),
following the reviewed geometry corrections in #22 and their preservation in #25.

## Cause and isolation

The manifest last changed at `2f2eae2`. Subsequent commits `4f1dca3` and
`6956f48` changed node-label collision obstacles and candidate positions to
account for actual shapes and strokes, but did not update the manifest.
Those changes were already on main at `29aa881` (#22).

With the same native module and vendored fonts:

| Build                                   | Matches the old manifest |
| --------------------------------------- | ------------------------ |
| Historical `2f2eae2`                    | 44/44                    |
| Main at `29aa881`                       | 8/44                     |
| Main at `864fd676` (#25)                | 8/44                     |
| PR #26 before this approval (`6aa8d9b`) | 8/44                     |

All 44 RGBA hashes from `29aa881`, `864fd676` and `6aa8d9b` agree. In an
isolated historical build, replacing only the node/label placement stage with
the `2f2eae2` implementation restores 44/44 old hashes while keeping the newer
edge attachment code. Reverting only the label candidates restores 36/44;
the larger collision obstacles explain the remaining eight differences.

The previous `npm test` smoke selected only the first literature transition
(frame 183, light), which remains unchanged. The replacement checks every
manifest entry in four domain/theme groups. With the old manifest, all four
groups fail on a label-layout frame; with the reviewed manifest, all 44 pass.

## Approved changes

Each listed frame changes in both light and dark themes:

| Example    | Frame indices                                   | Changed hashes |
| ---------- | ----------------------------------------------- | -------------- |
| Literature | 84, 176, 264, 368, 591, 672, 776, 783, 864, 959 | 20             |
| Biology    | 48, 104, 111, 156, 224, 231, 264, 311           | 16             |

The remaining eight literature hashes (183, 375, 468, 584 in both themes)
remain byte-for-byte unchanged. No entries, environment fields, frame indices,
themes, locales, frame specs or source documents are changed.

Before approval, all 36 full-frame before/after/difference images were generated
and reviewed as four contact sheets. The corresponding DisplayLists confirm:

- Accessible semantics are identical on all 44 frames.
- Non-rectangular drawing paths, including graph nodes and edges, are identical.
- Existing text is retained with identical font, paint and opacity; changes are
  to label coordinates and collision-driven visibility.
- The existing biology edge label `产物` becomes drawable at frames 231, 264
  and 311 in each theme after nearby label placement changes. No text is removed.
- Exact pixel differences occupy 0.0674%–0.5828% of each affected frame and are
  localized to labels and their backgrounds/halos. Some coordinates also differ
  by floating-point rounding after the obstacle arithmetic was rearranged.

For example, literature frame 84 moves `王夫人` from the side fallback to the
clear position above its node. Biology labels now clear their pill/diamond
outlines and allow the product edge label in the final shot. These are accepted
consequences of the existing stroked-glyph clearance rules. No geometry rule is
reverted to recover an older hash.

## Environment and reproduction

The audit used Linux x64, skia-canvas 4.0.0, `landscape-1080p`, locale `zh-CN`
and vendored font digest
`b9c7c2b43b1d9cce17c6660834043a0f0815bdc1e00a4482d469a3199f343cff`.
These match the manifest's enforcement environment. Font or engine changes
were not used to disable comparison.

To compare a representative frame, create an isolated worktree at `2f2eae2`,
install its dependencies and run `npm run build:packages`. In both that worktree
and the current build, render the same input with the respective CLI:

```bash
node packages/cli/dist/bin.js render examples/honglou-provisional.relgraph.json --frames /tmp/relgraph-audit/%05d.png --from 84 --to 84 --frame-spec landscape-1080p --theme light --locale zh-CN
```

Use separate output directories for the before and after builds. The full audit
artifacts for this session are retained locally in
`output/local-validation/golden-audit/`, including every before/after/difference
PNG, four contact sheets and per-label coordinates in `audit.json`.

The approved hashes were copied only for the explicit 36-frame allowlist after
matching each old hash against the reproduced historical frame. A blanket
`check:export -- --update` was not used. Validate the resulting manifest with:

```bash
npm test -- tests/cli.test.mjs
npm test
npm run check:export
```

The export command must run normally, with golden enforcement and the browser
comparison enabled. Future intentional drawing changes require a new visual
review; updating hashes is not a substitute for investigating a failed check.

## Verification of this approval

On the reviewed working tree, all 30 Vitest files / 247 tests passed, including
the four native golden groups with no skips. Full `npm run check:export` passed
13/13 checks, with all 44 hashes enforced, both complete MP4 exports, PNG/video
round trips, the browser comparison and all eight custom-project combinations.
Typecheck, lint, formatting and generated-type consistency also passed.

The runtime renderer and Studio sources are unchanged by this approval. The
earlier PR #26 Chromium run passed 56/56 checks, with all 16 captured PNGs
byte-identical to main's baseline; that baseline has not been refreshed here.
No GitHub Actions workflow was added, dispatched or rerun.
