import { test } from 'vitest';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { buildCharset, charsetText, FACES, TEXT_SOURCES } from '../scripts/subset-fonts.mjs';
import { FONT_STACKS } from '../packages/render/src/backends/canvas2d.ts';
import { FILM_FONT_FACES, FILM_FONT_FAMILIES } from '../packages/render/src/fonts.ts';

const fontsDir = new URL('../packages/render/fonts/', import.meta.url);
const manifest = JSON.parse(await readFile(new URL('fonts.json', fontsDir), 'utf8'));
const sha256 = (bytes) => createHash('sha256').update(bytes).digest('hex');
const faceKey = ({ name, family, weight, file }) => `${name ?? family}|${weight}|${file}`;

test('the renderer, the subset script and the font manifest list the same faces', () => {
  const rendered = FILM_FONT_FACES.map(faceKey);
  assert.deepEqual(FACES.map(faceKey), rendered);
  assert.deepEqual(manifest.faces.map(faceKey), rendered);
  for (const face of FILM_FONT_FACES) assert.equal(face.name, FILM_FONT_FAMILIES[face.family]);
  assert.deepEqual(
    new Set(FILM_FONT_FACES.map((face) => face.family)),
    new Set(Object.keys(FILM_FONT_FAMILIES)),
    'every family has a face',
  );
});

test('every font stack leads with its vendored family', () => {
  for (const [family, stack] of Object.entries(FONT_STACKS))
    assert.ok(stack.startsWith(`"${FILM_FONT_FAMILIES[family]}", `), `${family}: ${stack}`);
});

test('vendored font files match the manifest and carry the OFL', async () => {
  for (const face of manifest.faces) {
    const bytes = await readFile(new URL(face.file, fontsDir));
    assert.equal(bytes.subarray(0, 4).toString('latin1'), 'wOF2', `${face.file} is WOFF2`);
    assert.equal(bytes.length, face.bytes, face.file);
    assert.equal(sha256(bytes), face.sha256, face.file);
  }
  const license = await readFile(new URL('LICENSE', fontsDir), 'utf8');
  assert.match(license, /SIL OPEN FONT LICENSE Version 1\.1/);
  assert.equal(manifest.license, 'OFL-1.1');
  assert.match(manifest.source.commit, /^[0-9a-f]{40}$/);
});

test('the subset charset covers the examples and renderer text and is current', async () => {
  const chars = await buildCharset();
  const text = await readFile(new URL('charset.txt', fontsDir), 'utf8');
  // A failure here means new text entered an example, a style sheet or the
  // renderer copy: regenerate the fonts with scripts/subset-fonts.mjs.
  assert.equal(text, charsetText(chars));
  assert.equal(manifest.charset.sha256, sha256(text));
  assert.equal(manifest.charset.characters, chars.length);
  const covered = new Set(chars);
  for (const ch of '红楼梦贾宝玉林黛玉薛宝钗王熙凤激酶磷酸化…·→—：，。0123456789AZaz')
    assert.ok(covered.has(ch), ch);
  // GB 2312 level 1 is 3,755 hanzi; with Latin, punctuation and example text
  // the subset stays well under the full fonts' 30k+ characters.
  const hanzi = chars.filter((ch) => /\p{Script=Han}/u.test(ch)).length;
  assert.ok(hanzi >= 3755 && hanzi < 4500, `${hanzi} hanzi`);
});

test('the workspace declares every face with the same family, weight and file', async () => {
  const css = await readFile(new URL('../demo/studio.css', import.meta.url), 'utf8');
  const rules = [...css.matchAll(/@font-face\s*\{([^}]*)\}/g)].map(([, body]) => ({
    family: /font-family:\s*"([^"]+)"/.exec(body)?.[1],
    weight: Number(/font-weight:\s*(\d+)/.exec(body)?.[1]),
    file: /url\("\.\.\/packages\/render\/fonts\/([^"]+)"\)/.exec(body)?.[1],
    display: /font-display:\s*(\w+)/.exec(body)?.[1],
  }));
  assert.deepEqual(
    rules.map(({ family, weight, file }) => `${family}|${weight}|${file}`),
    FILM_FONT_FACES.map(faceKey),
  );
  for (const rule of rules) assert.equal(rule.display, 'block', rule.file);
});

test('coverage.txt lists the glyphs every face has and covers the examples', async () => {
  const text = await readFile(new URL('coverage.txt', fontsDir), 'utf8');
  assert.equal(manifest.coverage.sha256, sha256(text));
  const coverage = new Set(text.replaceAll('\n', ''));
  assert.equal(coverage.size, manifest.coverage.characters);
  // A few requested punctuation marks do not exist in Noto CJK.
  for (const ch of '‣‽⁄') assert.ok(!coverage.has(ch), ch);
  // Everything the shipped examples, style sheets and renderer copy use is drawn.
  const used = new Set();
  for (const path of TEXT_SOURCES)
    for (const ch of await readFile(new URL(`../${path}`, import.meta.url), 'utf8'))
      if (ch.codePointAt(0) >= 0x20 && ch !== '\x7f') used.add(ch);
  assert.deepEqual(
    [...used].filter((ch) => !coverage.has(ch)),
    [],
  );
});
