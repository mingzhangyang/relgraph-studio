# 唐代诗人交往网络 · Tang poet acquaintance network

Two `relgraph.graph/1` documents built from [mingzhangyang/tangshi](https://github.com/mingzhangyang/tangshi) (`network/`). An edge links two contemporary poets when a poem, an official history, an original title note or a scholarly chronology shows that they **knew each other or interacted**. A physical meeting is not required, and a line does not claim that the two met. Living in the same era, being named together by a third person, or a one-way mention or letter is not enough on its own. The file names keep the historical "见面网络" (poets who met) for existing references; the content and `meta.title` say 交往网络.

| File                             | Poets | Edges | Shots | Length | `visibleFrom` |
| -------------------------------- | ----: | ----: | ----: | -----: | ------------: |
| `唐代诗人见面网络_30.graph.json` |    30 |    61 |    11 |  ~78 s |       730–845 |
| `唐代诗人见面网络_50.graph.json` |    50 |   106 |    12 |  ~85 s |       724–895 |

```bash
npm run build:packages
npm run relgraph -- render datasets/tang-poets-met/唐代诗人见面网络_30.graph.json --out output/tang-30.mp4
```

- **Edge kinds:**

  | Kind     | Line   | Evidence                                                                                      |
  | -------- | ------ | --------------------------------------------------------------------------------------------- |
  | 当面交往 | solid  | A title, poem text or title note records an outing, farewell, stay, visit or banquet together |
  | 诗文往来 | dashed | Addressed poetic exchange or correspondence; not proof of a meeting                           |
  | 官场联系 | dashed | Documented colleagues, patronage or appointments                                              |
  | 史料交往 | dashed | Contact recorded in histories, title notes or chronologies                                    |
  | 交往推定 | dotted | Inferred from same-occasion poems or indirect evidence; needs checking                        |

  Edges whose basis lies outside the repository carry `sources` with URLs.

- **Time:** `visibleFrom` is in CE years; the storyboard's closing overview is at year 900. The years are approximate dates of the evidence, used for ordering only.
- **Layout:** positions are precomputed, with x roughly time and y a lane. The generator rejects a layout in which a straight relation passes within 55 units of an unrelated poet, two poets are too close for their names, or two poets whose mean relationship years differ by 20 years or more appear in reverse order. Both files report `meta.layoutQuality.status: "ok"`, with 0 near-passes, 0 crowded pairs and 0 chronological inversions. Relations are drawn slightly bowed, so check the film as well.
- **Groups:** 盛唐, 大历前后, 元和前后, 晚唐. **Node kinds:** 诗人 and 诗僧 (monk poets).
- Extra fields (`evidence`, `evidenceTitles`, `workIds`, `year`, `place`, `sources`, `note`, `birth`, `death`, `works`, `meta.layoutQuality`) are ignored by the loader and kept for checking.

Do not edit these files here. Regenerate them with `python3 network/build_met_network.py` in the tangshi repository, copy them over and run `npx prettier --write datasets/tang-poets-met/`. The evidence table, method and excluded pairs are documented in that repository's `network/README.md`.

**Fonts:** both files are listed in `TEXT_SOURCES` of `scripts/subset-fonts.mjs`, so every character they use is in the vendored fonts and `relgraph render` draws them without fallback. If a regenerated file needs new characters, `npm test` fails until the fonts are regenerated.

**Data licences:** poem titles and texts come from chinese-poetry (MIT) and birth/death years from OpenQTS (CC BY-SA 4.0). CBDB counts appear only in the tangshi evidence table, not in these files.
