# Uploaded node images

Select a **currently visible node** on Canvas or in **当前安全可见对象**. Use
**节点图片 · 仅当前节点** to choose a PNG, JPEG or WebP file. The file stays local.
The first decoded frame is used; animated playback is not supported. SVG, GIF,
remote URLs and unreadable files are rejected with a message.

- **填满 · 居中裁切** fills the current node shape. **完整显示 · 保留留白** keeps
  the entire image within the shape's inscribed content area (not merely its
  bounding rectangle). This adds intentional padding at round/diamond corners.
  Circle, pill and diamond clips share composition with Canvas and Skia; labels
  and border styles remain independently editable. Cover cropping is unchanged.
- If no explicit node radius is inherited, uploading sets a 32-design-pixel
  radius so the image is visible; an existing custom size is preserved. Change
  the radius in advanced styles. Removing an image keeps other style settings.
- **移除图片** writes an explicit `image: null`, suppressing inherited imagery.
  **恢复继承图片** clears that object's image override. Existing global/category
  styles can reference images in project JSON; uploading itself targets only
  the selected node, independently of the style-scope selector.
- Upload/replace/remove/fit changes participate in the existing undo/redo history.
  **保存项目 JSON** embeds the pixels; reimport needs no original file or URL.
  The old coordinate-only source export intentionally does not save imagery.

Files must be nonempty and at most **8 MiB**. Encoded PNG IHDR, JPEG SOF and
WebP VP8/VP8L/VP8X/animation-frame dimensions are checked **before decoding**;
anything above **16,777,216 pixels**, or missing readable dimensions, is rejected.
The decoded dimensions are checked again. This header preflight is not a full
codec validator; the browser still rejects corrupt image data. Normalization applies EXIF orientation and resizes without
upscaling to a maximum longest edge of **256 pixels**, retaining aspect ratio.
It drops filenames/EXIF and stores normalized RGBA, not the original photo.
Projects support at most **32 assets** and **4 MiB of decoded RGBA pixels**.
Unreferenced assets are pruned on replace/remove; undo retains its own previous
resources. The original graph, domain roles, provenance and fact verification
status remain unchanged. Images are display decoration, not verified evidence.

## Project representation and rendering

The existing `relgraph.studio/1` envelope remains compatible. Projects without
images render identically. A minimal config fragment (ID must match a source node):

```json
{
  "assets": {
    "portrait": { "format": "rgba8", "width": 2, "height": 1, "data": "/wAA/wAA//8=" }
  },
  "nodes": {
    "objects": {
      "node-id": { "image": "portrait", "imageFit": "cover", "size": 32 }
    }
  }
}
```

`data` is base64, exactly `width * height * 4` bytes in RGBA order. Uploads use a
SHA-256 asset ID including dimensions/pixels, deduplicating identical normalized
uploads. Import validates dimensions, encoding, resource budget and references
before committing a document; errors use `PROJECT_CONFIG`. No domain schema was
extended. Invalid uploads leave the previous picture intact.

The pure composer resolves images only for projected visible nodes and emits
source crop, destination rectangle and the existing node outline as a clip.
The outline fills beneath the image and strokes exactly once above it, keeping
reveal and dimming opacity consistent with ordinary nodes.
Display lists contain only currently visible asset references, never a global
resource map. The backends create native bitmap canvases before frames run; no
network request, decoder or mutable loading state runs inside playback. The
headless renderer uses the same crop/clip/drawing commands and materializes RGBA
synchronously, retaining its random-access API. Custom backend consumers can
supply `imageFactory` to `createCanvasRenderer` or resources to `drawDisplayList`.

Asynchronous local upload processing captures the document/request and original
node; it checks the safe projection and current selection again before commit.
A newer document, selection, upload, undo or property edit cannot be overwritten
by an older result. Hidden nodes/images never appear in selectors or ARIA before
the existing projection permits them. The node's existing display name is its
accessible description; pixel contents are not OCR'd or automatically censored.
Choose imagery that is appropriate for that node's reveal time.

## Run and export

```bash
npm ci
npm run dev
# Open /demo/, select a node, choose its image, then save the project.
npm run build:packages
npm run relgraph -- validate path/to/story.studio.json
npm run relgraph -- render path/to/story.studio.json --frames output/image-%05d.png --from 100 --to 100 --theme light
npm run relgraph -- render path/to/story.studio.json --out output/image.mp4 --theme light
```

Use matching theme and FrameSpec inputs for preview/export. The preview is 720p;
CLI defaults to 1080p. Images are normalized at upload time, so later import/export
reuses those exact pixels rather than re-decoding the original on each platform.

## Delivery and main-branch verification · updated 2026-11-09

The original plan was to squash **#22 → #23 → #24**, but that is **historical,
not an instruction to execute**. #22 reached `main`; #23 was merged only into
`feat/network-appearance`, and #24 only into `feat/network-layouts`.
Their GitHub **Merged** labels did not deliver their features to `main`.
Do **not** retarget, rebase or remerge #23/#24.

The current delivery vehicle is [PR #25](https://github.com/mingzhangyang/relgraph-studio/pull/25):
one PR whose `base.ref` is **`main`**, restoring the complete final reviewed
#23 and #24 file trees in two separate commits, followed by the repository's
no-stacked-PR policy and review fixes. Nothing here claims #25 is already merged.

Before merging #25, verify its actual `main` base, latest reviewed commit,
review findings, local typecheck/lint/format, Vitest, real Chromium flows,
44 Skia Golden hashes and native export matrix; do not blindly refresh visual
baselines and do not run GitHub Actions without approval. The execution counts
below describe **historical #22–#24 snapshots**, not fresh #25 test results.
After merging #25 into `main`, fetch `main` again and verify the restored layout
strategies, history, image assets, Canvas/Skia export, regression fixes, tests
and `AGENTS.md` are **actually present**, rather than trusting the Merged label.
Only then create further feature branches from the new `main`.

[Light preview](visuals/node-images/light.png) · [Dark preview](visuals/node-images/dark.png).
The previews use a simple two-color raster fixture to make cropping visible; no
literary portrait or biological identity is claimed. Rare glyphs, native screen
readers, other engines/platforms and original-file archival remain outside this
feature.

### Rollback scope (combined PR #25 versus images only)

- **Before #25 merges:** closing #25 leaves the existing `main` unchanged;
  neither the restored #23 layout features nor #24 node images reach `main`.
- **If #25 merges and the entire restoration must be undone:** revert the
  combined #25 merge on `main` through a separately reviewed, direct-to-`main`
  change. This removes **both** restored layout authoring (strategies, locks,
  previews, history integration) **and** node-image support. Check any later
  dependencies and saved projects before reverting; do not describe this as an
  image-only rollback.
- **If only images must be disabled while retaining layouts:** make a focused
  independent change from the latest `main` removing image upload UI and
  image-style/assets validation, image materialization/composition and their
  export paths, while **preserving** layout strategy controls, authored
  positions, locks and undo/redo. Review the scoped diff and rerun the affected
  local, Chromium and native export tests. This is **not** accomplished by
  reverting #25 wholesale.

Image-bearing saved projects need an explicit compatibility or migration plan
before loading them in an image-free version: remove or convert `assets`,
`image` and `imageFit` fields as appropriate; never silently drop authored
user content.

## Original image-delivery verification · 2026-11-09

This records the original image snapshot. The review-correction validation below
supersedes its counts and unchanged-Golden statement.

On Linux x64 / Node 24.22.1 / Chromium 153.0.8010.12 / skia-canvas 4.0.0 /
FFmpeg 7.1.5, with the existing lockfile and fonts:

| Executed check | Result |
| --- | --- |
| Typecheck, lint, format:check, check:types | Pass |
| Full Vitest, `npm test -- --maxWorkers=1` | **214/214**, **28 files** |
| New image tests | **13/13**: five config/codec/history/crop/projection cases and eight actual Skia domain/theme/size cases |
| Shared simulated DOM | Existing workspace harness/tests pass; no new DOM simulation |
| Real Chromium | **51/51**; PNG/JPEG/WebP uploads, both themes, fit/removal/history, exact saved-project PNG round trip and stale decode/document switch |
| Separate package JS/declaration builds and Studio production build | Pass |
| Existing browser/Golden references | **16/16 browser PNG references**, **44/44 Skia hashes** unchanged; no baseline update |
| CLI/MP4 export matrix | **13/13**; eight custom image-project size/theme combinations produce exact worker PNGs and four-frame MP4s; both complete technical-example films also pass ffprobe/round-trip |
| `git diff --check` | Pass |

The full suite includes pure, simulated DOM, native and package integration
checks; it is not 214 browser tests. A first combined eight-combination Skia test
hit Vitest's default five-second limit. It was split into eight independently
named cases; assertions and deadlines were not relaxed. The final 13 image tests
and full suite actually passed. Formatting checks were rerun after adding the
format-specific browser checks. No dependency, source schema or source dataset
changed. No Actions workflow was added, dispatched or rerun, and no merge was
performed. Logs and original captures remain in local ignored
`output/node-images-acceptance/` and `output/browser-check/`.

## Review correction validation

The eleven #22/#23 findings are mapped to fixes and regression layers in the
[review report](NETWORK-REVIEW-FIXES.md). Those corrections were merged forward
without rewriting the existing PR histories. #24 additionally fixes all three
of its Copilot findings:

- Read encoded PNG/JPEG/WebP dimensions before calling `createImageBitmap`,
  including WebP canvas, bitstream and animation-frame dimensions. Retain the
  decoded check and close rejected bitmaps. Bounded header parsing is DOM-free.
- Restore image inheritance on the selected object's layer regardless of the
  global/category style selector; retain inherited resources and prune unused
  object resources. Other nodes' inherited imagery stays intact.
- Fill the node outline beneath the image and stroke once above it, preserving
  reveal/dimming opacity. Zero-width borders also stay disabled in native Canvas.

Publication encountered concurrent remote commits `6907f02` and `59c8762` for
the same image findings. They were merged, preserving both regression suites
and their object-inheritance helper. The exported dimension-reader API uses the
same DOM-free parser as uploads, including all nested WebP dimension checks.
Header fixtures include a complete IHDR and an extended-WebP frame chunk;
malformed/truncated-file assertions remain. No remote history was overwritten.

On the same Linux/Node/Chromium/Skia/FFmpeg versions and unchanged lockfile:
`npm ci` installed **157** packages; typecheck, lint, format:check, check:types,
package JS/declaration builds and production build passed. Final full Vitest
passed **228/228 in 28 files** with `--maxWorkers=1`. The image file contains
**19/19** tests, including new header/budget, pre/post-decode guard and
reveal/dimming single-stroke cases. Existing pure, simulated-DOM, native and
package integration tests remain distinct from browser checks.

Real Chromium passed **55/55**, including all six oversized encoding fixtures
(PNG, baseline/progressive JPEG, lossy/lossless/extended WebP) with **zero decoder
calls**, unchanged Canvas on rejection, and restoring inheritance for both an
image override and `null` in both global/category scopes. Actual PNG/JPEG/WebP
uploads, stale decoder/document guards, undo/redo, exact project round trips,
projection and focus checks also passed. All **16/16 browser baseline PNGs**
are byte-identical. The baseline was not refreshed.

Final `npm run check:export` passed **13/13**, including **44/44 Skia Golden
frames**, both full technical-example MP4s (960/312 frames at 1080p/24 FPS),
exact direct-Skia/worker PNG checks, decoded-video frame comparisons and all
eight custom image-project domain/theme/720p/1080p combinations. Preview↔Skia
raster differences remain informational (mean **1.037%** pixels over 16/255),
not exact cross-backend equality. Logs are retained locally in
`output/review-fixes/logs/`; the final executable source snapshot is `8893531`.

The first new stroke test incorrectly traversed a leaf-only helper and sampled
the provisional example's fully visible initial nodes. It was corrected to
inspect nested groups and the verified dataset's actual chapter reveal, keeping
the assertions for both reveal and dimming. The targeted **19/19** run and the
complete **228/228** run then passed. Source data/timing was not changed.

The six intentional Skia Golden changes and two committed before/after pairs
are explained in the review report; **38/44** hashes remain unchanged from the
pre-review snapshot. No unverified result is implied for native screen readers,
additional platforms/engines, rare glyphs or production typography. No formal
film, Actions dispatch/rerun or merge into main was performed.
