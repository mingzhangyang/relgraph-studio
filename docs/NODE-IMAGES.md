# Uploaded node images

Select a **currently visible node** on Canvas or in **当前安全可见对象**. Use
**节点图片 · 仅当前节点** to choose a PNG, JPEG or WebP file. The file stays local.
The first decoded frame is used; animated playback is not supported. SVG, GIF,
remote URLs and unreadable files are rejected with a message.

- **填满 · 居中裁切** fills the current node shape. **完整显示 · 保留留白** keeps
  the entire image within it. Circle, pill and diamond clips share composition
  with Canvas and Skia; labels and border styles remain independently editable.
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

Files must be nonempty and at most **8 MiB**. Decoded images above **16,777,216
pixels** are rejected. Normalization applies EXIF orientation and resizes without
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

## Squash merge order

This feature starts from layout PR #23 at `1fbeaa083c0a0089d9c2b2eefcf63bf21f01bc86`.
The intended sequence is **#22 → #23 → node-image PR**. Do not merge automatically.
Squash changes commit ancestry: after #22 merges, rebase only #23's independent
commits onto new main using its old A base `eb28307`; then change its PR base to
main and rerun the relevant checks. After #23 merges, rebase only the image
commits (after old B base `1fbeaa0`) onto new main, then retarget the image PR.
Preserve the old bases even if merged branches are deleted. Inspect the remaining
diff before updating the PR branch; use force-with-lease when updating a rewritten
branch. Merely changing the PR base is insufficient after squash.

[Light preview](visuals/node-images/light.png) · [Dark preview](visuals/node-images/dark.png).
The previews use a simple two-color raster fixture to make cropping visible; no
literary portrait or biological identity is claimed. Rare glyphs, native screen
readers, other engines/platforms and original-file archival remain outside this
feature. Roll back this PR to remove uploads/image styles/resources; the earlier
appearance/layout features remain. Existing image projects then require removing
`assets`, `image` and `imageFit` before import by an older version.

## Actual verification · 2026-11-09

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
