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

`source` must be a complete, valid existing literary or biology document; the abbreviated example above illustrates the envelope only. No domain schema is changed. Plain source JSON remains supported. Project exports preserve the original source/evidence, with resolved coordinates in `config.layout.positions`. The old “导出含坐标 JSON” command remains a separate, explicit source-coordinate export. A project is an authoring artifact containing the full source, not a spoiler-redacted public sharing format.

The property panel lists only the current safe projection. Click a node/edge on Canvas or use **当前安全可见对象**. Choose object/category/global scope, open advanced styles, and edit. Each control names its origin; **↺** clears that field, **清除当前范围样式** clears the layer. Global → category → object is a sparse cascade: changing a global value affects all inheriting objects. Three coordinated presets tune density and emphasis without replacing domain encodings. Colors are six-digit hex; dimensions are 720p design pixels and scale by 1.5 at 1080p. Fonts use the existing offline Noto subsets, regular or semibold. Labels wrap to two lines and truncate deterministically; crowded labels may be omitted in pixels while remaining in the accessible transcript.

Display labels/descriptions are stored under `config.text`, separate from source names, facts and provenance. They are **not automatically verified**; restore original copy with **恢复原文**. Biological captions and direction remain authoritative; biological endpoint overrides are rejected because these markers encode consumption, activation, inhibition and catalysis. Other appearance overrides never alter `directed`, roles, evidence, strength or polarity. There is no automatic legend assigning semantic meaning to a custom color.

**保存项目 JSON** persists configuration and all resolved coordinates. Reimport it or use:

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
