#!/usr/bin/env node
// Regenerate the vendored film fonts in packages/render/fonts/ (ADR 003, D6).
//
// The film uses Noto Sans CJK SC, Noto Serif CJK SC and Noto Sans Mono CJK SC
// from https://github.com/notofonts/noto-cjk (SIL Open Font License 1.1). The
// full fonts are 16–25 MB each, so only the characters a film needs are kept:
//
//   - every character of the shipped examples, the domain style sheets and the
//     renderer's own text (packages/render/src/locale.ts);
//   - the 3,755 level-1 hanzi of GB 2312, the usual "common characters" list,
//     decoded from their GB 2312 code points so no external list is needed;
//   - the non-hanzi rows of GB 2312 (CJK punctuation, full-width forms, kana,
//     Greek, Cyrillic, box drawing);
//   - printable ASCII and Latin-1, general punctuation, CJK symbols and
//     punctuation, and half-/full-width forms.
//
// Subsetting uses fontTools (pinned in scripts/fonts-requirements.txt):
//
//   python3 -m venv .venv-fonts && .venv-fonts/bin/pip install -r scripts/fonts-requirements.txt
//   git clone --depth 1 --filter=blob:none --sparse https://github.com/notofonts/noto-cjk
//   git -C noto-cjk sparse-checkout set --no-cone /Sans/LICENSE \
//     /Sans/OTF/SimplifiedChinese/NotoSansCJKsc-Regular.otf \
//     /Sans/OTF/SimplifiedChinese/NotoSansCJKsc-Medium.otf \
//     /Sans/OTF/SimplifiedChinese/NotoSansCJKsc-Bold.otf \
//     /Serif/OTF/SimplifiedChinese/NotoSerifCJKsc-SemiBold.otf \
//     /Sans/Mono/NotoSansMonoCJKsc-Regular.otf
//   node scripts/subset-fonts.mjs --source noto-cjk --python .venv-fonts/bin/python
//
//   node scripts/subset-fonts.mjs --check   # only verify that charset.txt is current
//   node scripts/subset-fonts.mjs --coverage-only --python .venv-fonts/bin/python
//                                           # recompute coverage.txt from the committed fonts
//
// charset.txt is what was requested; coverage.txt is what every output face
// really contains (the sources lack a few requested punctuation marks).
//
// Output is deterministic for the same sources, charset and tool versions:
// fontTools keeps the source timestamps and Brotli compression is stable.
import { execFile } from 'node:child_process';
import { createHash } from 'node:crypto';
import { copyFile, mkdir, readFile, stat, writeFile } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { promisify } from 'node:util';

const run = promisify(execFile);
const root = fileURLToPath(new URL('..', import.meta.url));
const fontsDir = join(root, 'packages/render/fonts');

/** Faces the renderer requests; weights match each source's OS/2 weight class. */
export const FACES = [
  {
    family: 'Noto Sans CJK SC',
    weight: 400,
    source: 'Sans/OTF/SimplifiedChinese/NotoSansCJKsc-Regular.otf',
  },
  {
    family: 'Noto Sans CJK SC',
    weight: 500,
    source: 'Sans/OTF/SimplifiedChinese/NotoSansCJKsc-Medium.otf',
  },
  {
    family: 'Noto Sans CJK SC',
    weight: 700,
    source: 'Sans/OTF/SimplifiedChinese/NotoSansCJKsc-Bold.otf',
  },
  {
    family: 'Noto Serif CJK SC',
    weight: 600,
    source: 'Serif/OTF/SimplifiedChinese/NotoSerifCJKsc-SemiBold.otf',
  },
  {
    family: 'Noto Sans Mono CJK SC',
    weight: 400,
    source: 'Sans/Mono/NotoSansMonoCJKsc-Regular.otf',
  },
].map((face) => ({
  ...face,
  file: face.source
    .split('/')
    .at(-1)
    .replace(/\.otf$/, '.subset.woff2'),
}));

/** Repository files whose characters must all be covered. */
export const TEXT_SOURCES = [
  'examples/honglou-provisional.relgraph.json',
  'examples/biology-signaling-synthetic.json',
  'examples/biology-egfr-mapk.json',
  'packages/core/src/domains/biology.style.ts',
  'packages/core/src/domains/literature.style.ts',
  'packages/render/src/locale.ts',
];

const RANGES = [
  [0x20, 0x7e], // ASCII
  [0xa0, 0xff], // Latin-1 supplement
  [0x2010, 0x2027], // dashes, quotes, bullets, ellipsis
  [0x2030, 0x205e], // per-mille, primes, other punctuation
  [0x2190, 0x2199], // arrows
  [0x3000, 0x303f], // CJK symbols and punctuation
  [0xff01, 0xff5e], // full-width ASCII forms
  [0xff61, 0xff9f], // half-width punctuation and katakana
  [0xffe0, 0xffe6], // full-width signs
];

/** GB 2312 rows decoded through the WHATWG GB18030 decoder. */
function gb2312(rowFirst, rowLast, lastCell = 0xfe) {
  const decoder = new TextDecoder('gb18030', { fatal: false });
  let out = '';
  for (let row = rowFirst; row <= rowLast; row += 1)
    for (let cell = 0xa1; cell <= 0xfe; cell += 1) {
      if (row === rowLast && cell > lastCell) break;
      const ch = decoder.decode(Uint8Array.of(row, cell));
      // Unassigned cells decode to U+FFFD or to private-use code points.
      const cp = ch.codePointAt(0);
      if ([...ch].length === 1 && cp !== 0xfffd && !(cp >= 0xe000 && cp <= 0xf8ff)) out += ch;
    }
  return out;
}

/** Characters every subset must contain, sorted by code point. */
export async function buildCharset() {
  const chars = new Set();
  for (const [first, last] of RANGES)
    for (let cp = first; cp <= last; cp += 1) chars.add(String.fromCodePoint(cp));
  for (const ch of gb2312(0xa1, 0xa9)) chars.add(ch); // symbols, kana, Greek, Cyrillic…
  for (const ch of gb2312(0xb0, 0xd7, 0xf9)) chars.add(ch); // level-1 hanzi
  for (const path of TEXT_SOURCES)
    for (const ch of await readFile(join(root, path), 'utf8')) {
      const cp = ch.codePointAt(0);
      if (cp >= 0x20 && cp !== 0x7f) chars.add(ch);
    }
  return [...chars].sort((a, b) => a.codePointAt(0) - b.codePointAt(0));
}

/** charset.txt holds 64 characters per line so diffs stay readable. */
export function charsetText(chars) {
  const lines = [];
  for (let i = 0; i < chars.length; i += 64) lines.push(chars.slice(i, i + 64).join(''));
  return lines.join('\n') + '\n';
}

const sha256 = (bytes) => createHash('sha256').update(bytes).digest('hex');

function option(name) {
  const index = process.argv.indexOf(name);
  return index === -1 ? undefined : process.argv[index + 1];
}

/** fontTools and Brotli versions, which must match scripts/fonts-requirements.txt. */
async function checkTools(python) {
  const { stdout: versions } = await run(python, [
    '-I',
    '-c',
    'import fontTools, brotli; print(fontTools.version); print(brotli.version)',
  ]);
  const [fonttools, brotli] = versions.trim().split('\n');
  const required = Object.fromEntries(
    (await readFile(join(root, 'scripts/fonts-requirements.txt'), 'utf8'))
      .split('\n')
      .filter((line) => line.includes('=='))
      .map((line) => line.trim().split('==')),
  );
  if (fonttools !== required.fonttools || brotli !== required.brotli)
    throw new Error(
      `Need fonttools ${required.fonttools} and brotli ${required.brotli}; found ${fonttools} and ${brotli}.`,
    );
  return { fonttools, brotli };
}

// Prints the code points that every given font maps to a glyph.
const COVERAGE_PY = `
import json, sys
from fontTools.ttLib import TTFont
maps = [set(TTFont(path).getBestCmap()) for path in sys.argv[1:]]
print(json.dumps(sorted(set.intersection(*maps))))
`;

/**
 * Write coverage.txt: the characters every vendored face actually has a glyph
 * for. It is smaller than charset.txt because the sources lack some requested
 * punctuation (e.g. U+203D ‽, U+2044 ⁄); the renderer warns from this list.
 */
async function writeCoverage(python) {
  const paths = FACES.map((face) => join(fontsDir, face.file));
  const { stdout } = await run(python, ['-I', '-c', COVERAGE_PY, ...paths], {
    maxBuffer: 16 * 1024 * 1024,
  });
  const chars = JSON.parse(stdout)
    .filter((cp) => cp >= 0x20)
    .map((cp) => String.fromCodePoint(cp));
  const text = charsetText(chars);
  await writeFile(join(fontsDir, 'coverage.txt'), text);
  return { file: 'coverage.txt', characters: chars.length, sha256: sha256(text) };
}

async function main() {
  const chars = await buildCharset();
  const text = charsetText(chars);
  const charsetPath = join(fontsDir, 'charset.txt');
  if (process.argv.includes('--check')) {
    const current = await readFile(charsetPath, 'utf8').catch(() => '');
    if (current !== text) {
      console.error('packages/render/fonts/charset.txt is out of date; regenerate the fonts.');
      process.exitCode = 1;
    } else console.log(`charset.txt is current (${chars.length} characters).`);
    return;
  }
  if (process.argv.includes('--coverage-only')) {
    // Recompute coverage.txt from the committed fonts; no sources needed.
    const python = option('--python') ?? 'python3';
    await checkTools(python);
    const manifestPath = join(fontsDir, 'fonts.json');
    const manifest = JSON.parse(await readFile(manifestPath, 'utf8'));
    const { faces, ...head } = manifest;
    const coverage = await writeCoverage(python);
    await writeFile(manifestPath, JSON.stringify({ ...head, coverage, faces }, null, 2) + '\n');
    console.log(`coverage.txt: ${coverage.characters} characters in every face.`);
    return;
  }
  const source = option('--source');
  if (!source)
    throw new Error('Pass --source <noto-cjk checkout> (see the header of this script).');
  const sourceDir = resolve(source);
  const python = option('--python') ?? 'python3';
  const tools = await checkTools(python);
  let commit = option('--source-commit');
  if (!commit) commit = (await run('git', ['-C', sourceDir, 'rev-parse', 'HEAD'])).stdout.trim();

  await mkdir(fontsDir, { recursive: true });
  await writeFile(charsetPath, text);
  const faces = [];
  for (const face of FACES) {
    const input = join(sourceDir, face.source);
    const output = join(fontsDir, face.file);
    await run(
      python,
      [
        '-m',
        'fontTools.subset',
        input,
        `--text-file=${charsetPath}`,
        `--output-file=${output}`,
        '--flavor=woff2',
        // Keep every OpenType feature and every name record: shaping matches
        // the full font and the copyright and licence names stay embedded.
        '--layout-features=*',
        '--name-IDs=*',
        '--name-legacy',
        '--name-languages=*',
        '--notdef-outline',
        // Unhinted outlines rasterize the same way in Chromium and skia-canvas
        // whatever hinting each applies, and are about a fifth smaller.
        '--no-hinting',
        '--desubroutinize',
      ],
      { maxBuffer: 64 * 1024 * 1024 },
    );
    const bytes = await readFile(output);
    faces.push({
      family: face.family,
      weight: face.weight,
      style: 'normal',
      file: face.file,
      bytes: bytes.length,
      sha256: sha256(bytes),
      source: { path: face.source, sha256: sha256(await readFile(input)) },
    });
    console.log(`${face.file}: ${(bytes.length / 1024).toFixed(0)} KiB`);
  }
  // Sans and Serif ship the same OFL text; keep one copy.
  await copyFile(join(sourceDir, 'Sans/LICENSE'), join(fontsDir, 'LICENSE'));
  const manifest = {
    note: 'Generated by scripts/subset-fonts.mjs; do not edit by hand.',
    source: { repository: 'https://github.com/notofonts/noto-cjk', commit },
    license: 'OFL-1.1',
    tools,
    charset: { file: 'charset.txt', characters: chars.length, sha256: sha256(text) },
    coverage: await writeCoverage(python),
    faces,
  };
  await writeFile(join(fontsDir, 'fonts.json'), JSON.stringify(manifest, null, 2) + '\n');
  const total = (await Promise.all(faces.map((f) => stat(join(fontsDir, f.file))))).reduce(
    (sum, s) => sum + s.size,
    0,
  );
  console.log(
    `${chars.length} characters requested, ${manifest.coverage.characters} in every face, ${(total / 1024 / 1024).toFixed(2)} MiB in total.`,
  );
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) await main();
