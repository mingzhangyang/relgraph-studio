# 唐代诗人见面网络 · Tang poets who met

Two `relgraph.graph/1` documents built from [mingzhangyang/tangshi](https://github.com/mingzhangyang/tangshi) (`network/`). An edge is drawn only when two poets are shown to have **met in person**. Gifts and letters sent from afar (寄赠), remembrances (怀、忆) and readings of someone's collection (读集) do not count.

| File                             | Poets | Edges | Shots | Length |
| -------------------------------- | ----: | ----: | ----: | -----: |
| `唐代诗人见面网络_30.graph.json` |    30 |    60 |    11 |  ~78 s |
| `唐代诗人见面网络_50.graph.json` |    50 |    97 |    12 |  ~85 s |

```bash
npm run build:packages
npm run relgraph -- render datasets/tang-poets-met/唐代诗人见面网络_30.graph.json --out output/tang-30.mp4
```

- **Edge kinds:** 题目直证 (the poem title records a farewell, outing, stay or banquet together), 正文自述 (the poem text recalls travelling together), 同场唱和 (same-occasion poems; meeting inferred) and 史传记载 (official histories, original title notes or scholarly chronologies; each has `sources` with URLs).
- **Time:** every node and edge has `visibleFrom` in years CE, so the film grows from 730 to 895. The years are approximate dates of the evidence poems, used for ordering only.
- **Layout:** positions are precomputed (x is roughly time, y is a lane), so the player does not lay the graph out. Adjust them in the studio if needed.
- **Groups:** 盛唐, 大历前后, 元和前后, 晚唐. **Node kinds:** 诗人 and 诗僧 (monk poets).
- Extra fields (`evidence`, `workIds`, `year`, `place`, `sources`, `note`, `birth`, `death`, `works`) are ignored by the loader and kept for checking.

Do not edit these files here: regenerate them with `python3 network/build_met_network.py` in the tangshi repository and copy them over. The evidence table, method and excluded pairs are documented in that repository's `network/README.md`.

**Fonts:** both files are listed in `TEXT_SOURCES` of `scripts/subset-fonts.mjs`, so every character they use is in the vendored fonts and `relgraph render` draws them without fallback. Editing the files changes the required charset: `npm test` then fails until the fonts are regenerated.

**Data licences:** poem titles and texts come from chinese-poetry (MIT) and birth/death years from OpenQTS (CC BY-SA 4.0). CBDB counts appear only in the tangshi evidence table, not in these files.
