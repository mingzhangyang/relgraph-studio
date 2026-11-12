# Network appearance projects

A Studio project is a local JSON envelope, accepted by Studio and `relgraph validate/render`:

```json
{
  "format": "relgraph.studio/1",
  "source": { "schemaVersion": "0.1" },
  "config": {
    "preset": "editorial",
    "nodes": {
      "defaults": { "fontSize": 16 },
      "categories": { "character": { "borderWidth": 2 } },
      "objects": { "example-id": { "fill": "#123456" } }
    },
    "text": { "nodes": { "example-id": { "label": "显示文案" } } }
  }
}
```

`source` must be a complete, valid existing literary or biology document; the abbreviated example above illustrates the envelope only. No domain schema is changed. Plain source JSON remains supported. Project exports preserve the original source/evidence, with resolved coordinates in `config.layout.positions`. The **仅导出坐标 JSON** command remains a separate, explicit source-coordinate export. A project is an authoring artifact containing the full source, not a spoiler-redacted public sharing format.

The property panel lists only the current safe projection. Click a node/edge on Canvas or use **当前安全可见对象**. Choose object/category/global scope, open advanced styles, and edit. Each control names its origin; **↺** clears that field, **清除当前范围样式** clears the layer. Document-wide undo/redo and downloads live in the **single document toolbar above the film**, not inside the object inspector. Global → category → object is a sparse cascade: changing a global value affects all inheriting objects. Three coordinated presets tune density and emphasis without replacing domain encodings. Colors are six-digit hex; dimensions are 720p design pixels and scale by 1.5 at 1080p. Fonts use the existing offline Noto subsets, regular or semibold. Labels wrap to two lines and truncate deterministically; crowded labels may be omitted in pixels while remaining in the accessible transcript.

Style field ranges, choices and six-digit hexadecimal color requirements come from the **same `APPEARANCE_FIELD_RULES` contract** used by `validateProjectConfig`; the property view does not independently hard-code bounds. Numbers show min/max and permit decimal values when core accepts them. Invalid values appear with an in-field message, an accessible `aria-describedby` reference and `aria-invalid`, without committing to history. Uncommitted drafts—including partial number input and invalid hex—survive focus loss, frame redraw and object/scope changes. The text hex input has a paired native color picker, while retaining a blank-to-inherit option. **↺** clears a draft and an existing override; when nothing was overridden it is a no-op and does not create a false unsaved state. Complete project download continues to reject pending invalid drafts; fixing/resetting a field clears its inline error.

Display labels/descriptions are stored under `config.text`, separate from source names, facts and provenance. They are **not automatically verified**; restore original copy with **恢复原文**. Biological captions and direction remain authoritative; biological endpoint overrides are rejected because these markers encode consumption, activation, inhibition and catalysis. Other appearance overrides never alter `directed`, roles, evidence, strength or polarity. There is no automatic legend assigning semantic meaning to a custom color.

**保存完整项目** initiates a `.studio.json` download with configuration, display copy and all resolved coordinates; verify the file was actually saved by the browser. **仅导出坐标 JSON** initiates a source-only `.positioned.json` download, deliberately excluding style/copy and **not** resetting the unsaved-project indicator. Both are next to undo/redo and the dirty-status indicator above the preview. The toolbar also reports download errors and validation blocks where the action occurred. Shortcuts: `Ctrl/⌘+Z` undo, `Ctrl+Y` or `Ctrl/⌘+Shift+Z` redo, and `Ctrl/⌘+S` to request a complete-project download. Undo inside focused inputs is left to the browser; a pending invalid/unsubmitted field blocks complete export. Reimport a saved project or use:

```bash
npm run build:packages
npm run relgraph -- validate path/to/story.studio.json
npm run relgraph -- render path/to/story.studio.json --frames output/custom/%05d.png --from 48 --to 48
```

Explicit export `--theme light|dark` and `--frame-spec landscape-720p|landscape-1080p` remain reproducible renderer inputs. Projects do not change source timelines. Invalid configuration produces `PROJECT_CONFIG` diagnostics, never partial application. Current ranges: radius 8–48, border 0–8, line width .5–8, font 9–32, weight 400/600, curve −160–160. Clear a field to inherit. Node and edge scopes are separate. History is per document, bounded to 100 commits, in memory until saved.

The pure core resolves styles/configuration; the shared composer resolves text, geometry and selection paths. Canvas and Skia consume the same display list. The property view keeps controls mounted, reconciles safe object options only on change, and clears withdrawn selection/copy on rewind. The coordinator retains the existing async load serial guard.

This work precedes formal B2-2 production. #21 is merged; use the [source report](../datasets/honglou-chengjia-opening/VERIFICATION.md) and [75-second handoff](../datasets/honglou-chengjia-opening/B2-2-HANDOFF.md) for editorial review. Its three-second timeline remains QA only. No formal film, audio synchronization or subtitle track is created here.

## Visual review

Captured on the same Chromium 153 / Linux x64, before baseline update. The default increases label size/weight and line separation, reduces glowing node centers and makes parallel paths stable by ID. Space remains reserved for captions and shot detail; no label is placed into another node's reserved box. Biology retains process diamonds, molecule pills, role captions and marker semantics. Dense authored positions can still require layout/manual adjustment; automatic label omission takes precedence over text collisions.

| Sample | Main | Candidate |
| --- | --- | --- |
| Literature · light | [Before](visuals/network/literature-light-before.png) | [After](visuals/network/literature-light-after.png) |
| Literature · dark | [Before](visuals/network/literature-dark-before.png) | [After](visuals/network/literature-dark-after.png) |
| Biology · light | [Before](visuals/network/biology-light-before.png) | [After](visuals/network/biology-light-after.png) |
| Biology · dark | [Before](visuals/network/biology-dark-before.png) | [After](visuals/network/biology-dark-after.png) |

## Layout strategy and reproducible editing

Open **布局策略 · 预览后应用** beneath the source card. The initial choice is manual/preserve. Select (details in [generic graphs](GENERIC-GRAPH.md#layout-strategies)):

- **自动 · 按结构选择**: picks one of the strategies below from the graph: a grid without relations, layered or flow for mostly directed acyclic graphs, radial for forests, force otherwise.
- **力导向 · 聚类**: ID-sorted, seeded Fruchterman–Reingold relaxation from a radial start with group cohesion and landscape fitting, at most 0–2000 steps, spacing 64–400. Locked and preserved nodes are fixed anchors. No simulation runs while playing.
- **分层 · 自上而下** and **流向 · 从左到右**: stable component packing; directed strongly connected components share a level, followed by topological depth. Components with only undirected links use graph distance from their best-connected node. Barycentre sweeps reduce crossings and keep groups as bands. No relationship label or `family` kind is interpreted as a parent/child generation. This is not a genealogy algorithm.
- **放射 · 以核心为圆心**: rings around the graph centre, each subtree in a wedge sized by its leaves; seed-controlled rotation.
- **环形**: one ring with groups contiguous and neighbours drawn together, seed-controlled rotation and circumference-based spacing.
- **网格 · 保持顺序**: a matrix per group in the order the nodes were written.
- **手动**: retain the existing drag/keyboard position tools.

Coordinate modes are explicit: **保留现有坐标** returns the current resolved positions; **只填补缺失坐标** preserves authored/saved coordinates and fills missing positions; **重排未锁定节点** moves every unlocked node. A fallback preview coordinate is not an authored coordinate. Locks preserve the exact current coordinate in all strategies and in manual edits. Only safe currently projected nodes are listed for locking; imported lock IDs for future nodes remain saved but do not appear early.

**预览布局** changes the temporary picture only. **取消预览** restores it; **应用布局** stores settings and coordinates as one undoable commit. Changing parameters, seeking, playback, theme, saving or loading another document cancels an uncommitted preview. The solver is synchronous, bounded and DOM-free; a request serial also guards application. There is no old async result that can replace a new document. Very large graphs may block the UI during calculation; worker offloading is a future optimization.

Manual numeric coordinate edits, complete drags, reset and lock changes enter the same per-document history. A cancelled drag restores its prior point. A locked node cannot be dragged or moved by a typed coordinate. Undo/redo restores coordinates, locks, style and copy together. The configuration stores:

```json
{
  "layout": {
    "type": "layered",
    "mode": "rearrange",
    "seed": 42,
    "spacing": 160,
    "iterations": 160,
    "locked": ["example-id"],
    "positions": { "example-id": { "x": 120, "y": 180 } }
  }
}
```

Reimport uses the saved coordinates directly. Merely loading or playing never reruns a selected algorithm. `computeLayout` is the exported pure core entry for programmatic authoring. Coordinates produced by strategies are quantized to .01 world units (including normalization of negative zero); authored/locked precision remains intact. All original domain formats, reaction nodes, directed roles and source evidence are retained.

## Node images

Use **节点图片 · 仅当前节点** for local PNG/JPEG/WebP upload, shape clipping,
cover/contain, removal and inherited-image reset. Saved projects embed normalized
pixels alongside sparse `image`/`imageFit` references; the original domain source
stays unchanged. See [image limits, export and current main-branch delivery](NODE-IMAGES.md).
