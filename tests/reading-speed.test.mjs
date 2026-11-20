// Caption reading-speed warnings (ADR 004, D1): a shot whose title and
// narration take longer to read than the caption is fully shown.
import { test } from 'vitest';
import assert from 'node:assert/strict';
import bookshop from '../examples/bookshop-systems-synthetic.graph.json' with { type: 'json' };
import { loadDocument } from '../packages/core/src/director/load.ts';
import {
  READING_RATE,
  readingSeconds,
  slowCaptions,
} from '../packages/core/src/director/reading-speed.ts';
import { ENGLISH_DIAGNOSTICS } from '../apps/studio/src/diagnostic-text.ts';

test('reading time counts CJK characters and other letters and digits, not spaces or punctuation', () => {
  assert.equal(readingSeconds('李白，杜甫。'), 4 / READING_RATE.cjk);
  assert.equal(readingSeconds('Li Bai met Du Fu.'), 12 / READING_RATE.other);
  assert.equal(readingSeconds('公元 744 年'), 3 / READING_RATE.cjk + 3 / READING_RATE.other);
  assert.equal(readingSeconds('  … — '), 0);
});

test('a caption is shown for its shot minus its fades; the last shot does not fade out', () => {
  const text = '字'.repeat(45); // 5 s at 9 per second
  const shot = (durationSec) => ({ title: text, durationSec });
  // 5.5 s shot: 4.9 s shown between fades; as the last shot, 5.2 s.
  assert.deepEqual(
    slowCaptions([shot(5.5), shot(5.5)]).map((slow) => slow.index),
    [0],
  );
  const [{ reading }] = slowCaptions([shot(5.5), shot(9)]);
  assert.equal(reading.needed, 5);
  assert.ok(Math.abs(reading.shown - 4.9) < 1e-9);
  assert.equal(reading.suggestedSec, 6, 'half seconds, with room for both fades');
  // Very short shots cap each fade at half the shot.
  assert.equal(slowCaptions([{ title: '甲', durationSec: 0.2 }, shot(9)])[0].reading.shown, 0);
});

test('authored shots warn with a path, id and suggested duration; derived storyboards never do', () => {
  const doc = {
    format: 'relgraph.graph/1',
    edges: [{ source: '甲', target: '乙' }],
    presentation: [
      { id: 'ok', title: '甲与乙', durationSec: 4 },
      { id: 'dense', title: '甲与乙', narration: '字'.repeat(60), durationSec: 4 },
    ],
  };
  const loaded = loadDocument(doc);
  assert.equal(loaded.valid, true);
  const warnings = loaded.warnings.filter((entry) => entry.code === 'CAPTION_READING_SPEED');
  assert.equal(warnings.length, 1);
  const [warning] = warnings;
  assert.equal(warning.level, 'warning');
  assert.equal(warning.path, '$.presentation[1]');
  assert.equal(warning.id, 'dense');
  // 63 characters at 9 per second; the last shot is shown 4 s minus its 0.3 s fade-in.
  assert.equal(warning.message, '分镜标题和旁白约需 7.0 秒读完，完整显示只有 3.7 秒。');
  assert.equal(warning.fix, '把 durationSec 延长到至少 8 秒，或缩短标题和旁白。');
  const english = ENGLISH_DIAGNOSTICS.studio.CAPTION_READING_SPEED;
  assert.equal(
    english.message(warning.params),
    "The shot's title and narration take about 7.0 s to read, but are fully shown for only 3.7 s.",
  );
  assert.equal(
    english.fix(warning.params),
    'Raise durationSec to at least 8 s, or shorten the title and narration.',
  );

  // The same document without a presentation derives its shots: no warning.
  const derived = loadDocument({ ...doc, presentation: undefined });
  assert.equal(
    derived.warnings.some((entry) => entry.code === 'CAPTION_READING_SPEED'),
    false,
  );
  assert.equal(
    loadDocument(bookshop).warnings.some((entry) => entry.code === 'CAPTION_READING_SPEED'),
    false,
  );
});
