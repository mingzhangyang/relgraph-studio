# Vendored film fonts

These are subsets of [Noto CJK](https://github.com/notofonts/noto-cjk), used by
both renderer backends so that the browser preview and the headless export
measure and draw the same glyphs (ADR 003, D6). They are licensed under the
SIL Open Font License 1.1; see [LICENSE](LICENSE). Noto CJK's reserved font
name is "Source", so the subsets keep their original family names.

| File | Family | Weight | Source file |
|---|---|---|---|
| `NotoSansCJKsc-Regular.subset.woff2` | Noto Sans CJK SC | 400 | `Sans/OTF/SimplifiedChinese/NotoSansCJKsc-Regular.otf` |
| `NotoSansCJKsc-Medium.subset.woff2` | Noto Sans CJK SC | 500 | `Sans/OTF/SimplifiedChinese/NotoSansCJKsc-Medium.otf` |
| `NotoSansCJKsc-Bold.subset.woff2` | Noto Sans CJK SC | 700 | `Sans/OTF/SimplifiedChinese/NotoSansCJKsc-Bold.otf` |
| `NotoSerifCJKsc-SemiBold.subset.woff2` | Noto Serif CJK SC | 600 | `Serif/OTF/SimplifiedChinese/NotoSerifCJKsc-SemiBold.otf` |
| `NotoSansMonoCJKsc-Regular.subset.woff2` | Noto Sans Mono CJK SC | 400 | `Sans/Mono/NotoSansMonoCJKsc-Regular.otf` |

`fonts.json` records the source commit, the source and output SHA-256 of
every face, the tool versions and the charset digest. Golden-frame hashes are
enforced only for the same font digest (see `examples/golden-frames.json`).

## Character set

`charset.txt` (4,835 characters) is the union of:

- every character in the two shipped examples, the domain style sheets and the
  renderer's own text (`packages/render/src/locale.ts`);
- the 3,755 level-1 hanzi of GB 2312 (the usual common-character list), decoded
  from their GB 2312 code points;
- the non-hanzi rows of GB 2312: CJK punctuation, full-width forms, kana,
  Greek, Cyrillic and box drawing;
- printable ASCII and Latin-1, general punctuation, arrows, CJK symbols and
  punctuation, and half- and full-width forms.

Characters outside the subset fall back to the next font in `FONT_STACKS`,
which differs between machines; `relgraph render` warns about them. When an
example or the renderer copy gains new characters, `npm test` fails until the
fonts are regenerated.

## Regenerating

Subsetting uses fontTools with Brotli for WOFF2, pinned in
`scripts/fonts-requirements.txt`. Hinting is removed (`--no-hinting`) so that
outlines rasterize alike under Chromium and skia-canvas, and all OpenType
features and name records are kept.

```bash
python3 -m venv .venv-fonts
.venv-fonts/bin/pip install -r scripts/fonts-requirements.txt
git clone --depth 1 --filter=blob:none --sparse https://github.com/notofonts/noto-cjk
git -C noto-cjk sparse-checkout set --no-cone /Sans/LICENSE \
  /Sans/OTF/SimplifiedChinese/NotoSansCJKsc-Regular.otf \
  /Sans/OTF/SimplifiedChinese/NotoSansCJKsc-Medium.otf \
  /Sans/OTF/SimplifiedChinese/NotoSansCJKsc-Bold.otf \
  /Serif/OTF/SimplifiedChinese/NotoSerifCJKsc-SemiBold.otf \
  /Sans/Mono/NotoSansMonoCJKsc-Regular.otf
npm run subset:fonts -- --source noto-cjk --python .venv-fonts/bin/python
```

The output is byte-for-byte reproducible for the same sources, charset and tool
versions. After regenerating, refresh the golden frames
(`npm run check:export -- --update`) and the local browser baseline.
