/**
 * Whether a shot leaves time to read its caption (ADR 004, D1). A warning
 * only: shot durations stay authored.
 */
import { CAPTION_FADE_SEC } from './timeline.js';
import type { VisualScene } from '../../types/visual-graph.js';

/**
 * Comfortable reading rates for captions, in counted characters per second.
 * 9 for Chinese, Japanese and Korean characters follows common subtitle
 * guidance for adult viewers; 17 for letters and digits of other scripts is
 * a little below the usual 20 for Latin subtitles, because those also count
 * spaces and punctuation, which are not counted here. A film viewer reads
 * while watching the graph move, so these are upper limits, not targets.
 */
export const READING_RATE = Object.freeze({ cjk: 9, other: 17 });

const CJK = /[\p{Script=Han}\p{Script=Hiragana}\p{Script=Katakana}\p{Script=Hangul}]/u;
const COUNTED = /[\p{L}\p{N}]/u;

/** Seconds a viewer needs to read `text` at `READING_RATE`. */
export function readingSeconds(text: string): number {
  let cjk = 0,
    other = 0;
  for (const ch of text) {
    if (CJK.test(ch)) cjk += 1;
    else if (COUNTED.test(ch)) other += 1;
  }
  return cjk / READING_RATE.cjk + other / READING_RATE.other;
}

export interface CaptionReading {
  /** Seconds needed to read the title and narration. */
  needed: number;
  /** Seconds the caption is fully shown: the shot without its fades. */
  shown: number;
  /** The shortest `durationSec`, in half seconds, that would leave enough time. */
  suggestedSec: number;
}

/**
 * Reading time against display time for each shot whose caption is shown
 * for less time than it takes to read. The caption fades in and out over
 * `CAPTION_FADE_SEC` (at most half the shot); the last shot does not fade out.
 */
export function slowCaptions(
  scenes: readonly Pick<VisualScene, 'title' | 'narration' | 'durationSec'>[],
): { index: number; reading: CaptionReading }[] {
  return scenes.flatMap((scene, index) => {
    const needed = readingSeconds(`${scene.title}${scene.narration ?? ''}`);
    const fade = Math.min(CAPTION_FADE_SEC, scene.durationSec / 2);
    const fades = index === scenes.length - 1 ? fade : 2 * fade;
    const shown = scene.durationSec - fades;
    if (needed <= shown) return [];
    const suggestedSec = Math.ceil((needed + 2 * CAPTION_FADE_SEC) * 2) / 2;
    return [{ index, reading: { needed, shown, suggestedSec } }];
  });
}
