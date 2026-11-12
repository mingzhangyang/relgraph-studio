# 一切关系皆可图 · Generic graphs, derived encoding and layouts

Status: implemented on top of `main` (started at `663d5ec`, reconciled with `0f995b7`). This document describes the
`relgraph.graph/1` source format, how arbitrary kinds are turned into a visual
encoding, the layout strategies, and what changed in how the network is drawn.

## Why

Before this change the studio could only load two curated source formats
(literary `schemaVersion: "0.1"` and `relgraph.bio/0.1-draft`). Everything else
was rejected with `FORMAT`, and the parts that were reusable in principle were
not general in practice:

| Area           | Before                                                                                                                                    | Now                                                                                                                   |
| -------------- | ----------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------- |
| Input          | Two domain formats, lowercase slug ids, every node declared, a storyboard required                                                        | Any nodes and relations; free-text ids; an edge list is enough; storyboard optional                                   |
| Relation kinds | Nine literary kinds all drawn as the same grey line; unknown domains got one neutral style; the legend in the style sheet was never drawn | Kind → hue + dash rhythm, strength → line weight, legend drawn for what is on screen                                  |
| Node kinds     | Three shapes, fixed per domain                                                                                                            | Five shapes assigned per kind; hue by group or kind; size and type scale by importance, weight or degree              |
| Groups         | Axis-aligned dashed ellipses that overlap and ignore member positions; label at a fixed offset                                            | Soft hulls that follow members; the name sits on the outline where it is free                                         |
| Missing layout | A four-column grid to the right of authored nodes                                                                                         | A structure-aware layout chosen from the graph                                                                        |
| Strategies     | `force` (short-range relaxation), `circle` (id order), `layered` (id order, left-aligned rows); none knew about groups or the 2.8:1 stage | `auto`, `force`, `layered`, `flow`, `radial`, `circle`, `grid`: crossing reduction, group cohesion, landscape fitting |
| Self-relations | Forbidden in the kernel                                                                                                                   | Drawn as loops in generic graphs (curated domains still refuse them at source level)                                  |

Measured on the same frames (720p, CLI renders):

| Before                                                        | After                                                       |
| ------------------------------------------------------------- | ----------------------------------------------------------- |
| ![before, light](visuals/generic/literature-light-before.png) | ![after, light](visuals/generic/literature-light-after.png) |
| ![before, dark](visuals/generic/literature-dark-before.png)   | ![after, dark](visuals/generic/literature-dark-after.png)   |

The bundled generic example (`examples/bookshop-systems-synthetic.graph.json`)
contains no coordinates and no storyboard. Its layout, colours, shapes,
hierarchy, legend and seven shots are derived:

| Derived film (auto → flow)                                | Derived hub shot, dark                             |
| --------------------------------------------------------- | -------------------------------------------------- |
| ![auto flow](visuals/generic/generic-light-auto-flow.png) | ![hub](visuals/generic/generic-dark-hub.png)       |
| **Force strategy on the same data**                       | **Radial strategy on the same data**               |
| ![force](visuals/generic/generic-light-force.png)         | ![radial](visuals/generic/generic-dark-radial.png) |

## The `relgraph.graph/1` format

The smallest valid document:

```json
{
  "format": "relgraph.graph/1",
  "edges": [
    { "source": "Coffee", "target": "Caffeine", "kind": "contains" },
    { "source": "Caffeine", "target": "Adenosine receptor", "kind": "blocks" }
  ]
}
```

Everything else is optional.

| Field          | Meaning                                                                                                                                                                                                                              |
| -------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `meta`         | `title`, `description`, `sourceNote`. The title defaults to `关系图`.                                                                                                                                                                |
| `directed`     | Default direction of relations (`false`). A kind or a single relation may override it.                                                                                                                                               |
| `nodes[]`      | `id` (required), `label`, `kind`, `group`, `weight` (≥ 0), `color` (`#RRGGBB`), `summary` (detail card text), `position` `{x, y}`, `visibleFrom`, `visibleTo`. A bare string or number is a node with that id.                       |
| `edges[]`      | `source`, `target` (required), `id`, `kind`, `label`, `directed`, `weight` (≥ 0), `visibleFrom`, `visibleTo`. Endpoints that are not declared become nodes labelled by their id. `source === target` is a self-relation.             |
| `groups[]`     | `id` (required), `label`, `kind`, `color`. Groups referenced only by nodes are created.                                                                                                                                              |
| `kinds`        | `nodes.<kind>`: `label`, `color`, `shape` (`circle`, `pill`, `diamond`, `square`, `hexagon`). `edges.<kind>`: `label`, `color`, `line` (`solid`, `dashed`, `dotted`), `head` (`arrow`, `bar`, `hollow-circle`, `none`), `directed`.  |
| `timeline`     | `unit` and optional `total` of the domain time used by `visibleFrom` / `visibleTo`.                                                                                                                                                  |
| `presentation` | Shots, as in the biology format: `id`, `title`, `narration`, `durationSec` (default 4), `transitionMs`, `domainAt`, `camera` (`focusNodeId` \| `fitIds`, `zoom`), `highlight` (`nodeIds`, `edgeIds`, `groupId`), `openDetailNodeId`. |

Rules worth knowing:

- **Ids are free text or numbers.** A lowercase slug is used as is; any other
  id (`"Alice Smith"`, `"贾宝玉"`, `42`) maps to a stable internal id derived
  from its text. The mapping depends only on the set of ids, never on array
  order, so styles and coordinates saved in a `.studio.json` survive edits
  elsewhere in the file. Shots refer to the ids you wrote.
- **Hierarchy.** If any node has a `weight`, weights set the five-step size
  and type scale; otherwise degree does. Relation `weight` becomes line weight.
- **No storyboard?** One is derived from author text only, so no language is
  assumed: the whole graph, each group (two to six groups), the best-connected
  node with its relations and `summary`, and a closing overview. A graph with
  `visibleFrom` / `visibleTo` instead grows one step per domain time (at most
  twelve steps), which keeps the existing spoiler guarantee.
- **Limits.** 5,000 nodes and 20,000 relations; text fields up to 2,000
  characters. Unknown fields are ignored, so exported data can be loaded with
  its extra attributes in place.
- **Diagnostics** use the same shape as the other formats: code, JSON path,
  record id, message and repair.

Coordinate export (`仅导出坐标 JSON`) and `relgraph layout` write back to the
ids you authored and declare nodes that previously existed only as endpoints.

## Derived visual encoding

`styleForGraph(graph)` returns the registered sheet for `literature` and
`biology`, and derives one for every other domain. Channels are allocated once
per document, never per frame, so a reveal cannot repaint what is on screen:

1. **Node hue** belongs to groups when the graph has any (in declaration
   order), otherwise to node kinds. A single kind without groups stays neutral.
2. **Node shape** follows the node kind: circle, pill, diamond, square,
   hexagon, most frequent kind first.
3. **Relation hue** follows the relation kind and takes the palette slots
   after the node hues, so one hue never means two things. From the fourth
   kind on, a dash rhythm is added as a second channel.
4. **Past eight tones nothing is cycled or generated.** Further kinds fold to
   the neutral stroke and keep their rhythm or shape; the legend names them.
5. `kinds` declarations override the automatic choice for their kind.

Literary relation kinds now have curated tones (kinship blue, marriage
cinnabar, romance rouge, friendship malachite, alliance gamboge, mentorship
green, rivalry violet and dashed, service ochre and dotted). Biology keeps its
role encoding and protected endpoint markers unchanged.

### Palette

Each theme carries eight categorical tones for the same eight slots:

| Slot | Light     | Dark      |
| ---- | --------- | --------- |
| 0    | `#2f6fb0` | `#5593d2` |
| 1    | `#d2553a` | `#dd6a4a` |
| 2    | `#23906c` | `#35a583` |
| 3    | `#b87d0c` | `#b8881a` |
| 4    | `#c4577f` | `#d2668f` |
| 5    | `#4d8a2c` | `#69a343` |
| 6    | `#7a5fc0` | `#9480dc` |
| 7    | `#a8643c` | `#c47f4c` |

Both sets were checked against their own stage surface (`#f3ede1`, `#152638`)
for the OKLCH lightness band, the chroma floor, adjacent-pair separation under
simulated protanopia and deuteranopia (worst pair ΔE 8.6 light, 8.8 dark,
target ≥ 8), the normal-vision floor (17.2 / 16.6, floor 15) and 3:1 contrast.
Any two marks can be neighbours in a network, which no eight hues can satisfy
pairwise, so identity never rests on hue alone: shape, dash rhythm, direct
labels and the legend carry it as well.

## Layout strategies

All engines are pure functions of the graph and their options: ids are sorted
before traversal, the only randomness is a seeded hash of node ids, and step
counts are bounded. None of them runs during playback.

| Strategy  | Use it for                    | What it does                                                                                                                                                                |
| --------- | ----------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `auto`    | Anything                      | No relations → `grid`; mostly directed and acyclic → `layered` when broad, `flow` when deep; a forest → `radial`; otherwise `force`.                                        |
| `force`   | Communities, general networks | Fruchterman–Reingold from a radial start, group cohesion, a principal-axis turn and gentle lowering to fit the stage, guaranteed room between nodes. Honours fixed anchors. |
| `layered` | Hierarchies, top to bottom    | Ranks from structure (cycles share a rank), barycentre sweeps against crossings, groups kept as bands, rows pulled under what they connect to.                              |
| `flow`    | Pipelines and processes       | The same, left to right, with more room along the reading direction for labels.                                                                                             |
| `radial`  | Trees and ego networks        | Rings around the graph centre (least eccentricity), each subtree in a wedge sized by its leaves, ring radii grown until siblings have room.                                 |
| `circle`  | Showing who connects to whom  | One ring; groups stay contiguous and neighbours are drawn towards each other.                                                                                               |
| `grid`    | Sets and lists                | A tidy matrix per group. The one strategy that keeps the author's order.                                                                                                    |

A document with **no coordinates at all** is arranged by `auto` when it is
loaded (studio and CLI alike). A partly positioned document keeps the previous
conservative fallback, which never moves or crowds authored nodes. Locks and
the `保留 / 填补 / 重排` policies work with every strategy.

## How the network is drawn

- **Hulls** are the smoothed convex hull of circles around each member. A
  member that is still being revealed pulls the hull out as it arrives, and a
  hull recedes with its members when another part of the graph is in focus.
- **Relations** bow slightly, all relations of a hub turning the same way.
  Arrowheads are swept back, the stroke ends at their notch, and they ride the
  tip while a relation is drawn. A highlighted relation gains weight and a
  soft glow in its own colour; its label is a rounded tag on the line.
- **Nodes** carry a tint of their colour as body, a ring, and a centre pip.
  Size and label type follow one scale. Only nodes that a shot names get a
  focus ring and light; previously every undimmed node glowed.
- **Labels** try the side their relations leave free first. Among the
  positions that stay on stage and cover no glyph or text, the one that
  crosses the fewest relations and cannot be read as a neighbour's name wins.
- **Legend**: bottom left of the stage, only kinds that are visible now, only
  when there is more than one. Kinds captioned on their own edges (biology)
  need no entry.
- **Ground**: the diagonal hatch is replaced by a quiet dot lattice.

Every length still derives from `FrameSpec`; the 1080p composition of all
three examples is exactly the 720p composition scaled by 1.5.

## Compatibility

- Literary and biological documents load exactly as before. Their pixels
  change by design; the golden frames were regenerated (see below).
- `VisualGraph` gains optional `kinds`, `VisualGroup` an optional `tone`,
  `DomainStyle` optional `curvature` and per-kind `tone` / `color`. Existing
  custom style sheets remain valid.
- `ProjectConfig.layout.type` accepts the new strategies; shapes accept
  `square` and `hexagon`. Older projects validate unchanged.
- The kernel no longer rejects `source === target`; the literary and
  biological validators still do.
- `layoutGraph` now returns a structural layout for documents without any
  coordinates. Callers that relied on the four-column grid for such documents
  should store coordinates or choose a strategy explicitly.

## Verification

Run locally on linux-x64, Node 22.23.4, skia-canvas 4.0.0, Chromium 153, after
merging `main` at `0f995b7` (Prettier pass #36 and the EGFR–MAPK example #37):

- `npm test`: 336 tests in 32 files, including `tests/generic-graph.test.mjs`
  and `tests/layout-engines.test.mjs`, and 102 golden frames (three examples,
  two themes) against the native renderer.
- `npm run typecheck`, `npm run check:types`, `npm run lint`,
  `npm run format:check`.
- `npm run check:export -- --update`, then `npm run check:export`: golden
  hashes, H.264 exports of all three examples with matching frame counts, and
  decoded-frame PSNR against PNG renders.
- `npm run check:browser`: 67 checks in real Chromium, including the generic
  example and all seven strategies with pixel-identical repeats.

No GitHub Actions workflow was added, dispatched or rerun.
