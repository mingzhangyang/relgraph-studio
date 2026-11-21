import type { FontRef, TextMeasurer } from '../display-list.js';

/** One line of at most `maxWidth`, ending in an ellipsis when cut. */
export function fitText(
  measure: TextMeasurer,
  text: unknown,
  font: FontRef,
  maxWidth: number,
): string {
  const s = String(text || '');
  if (measure(s, font) <= maxWidth) return s;
  let result = '';
  for (const ch of s) {
    if (measure(result + ch + '…', font) > maxWidth) break;
    result += ch;
  }
  return result + '…';
}

/** At most `maxLines` lines of at most `maxWidth`; the last ends in an ellipsis when cut. */
export function wrapText(
  measure: TextMeasurer,
  text: unknown,
  font: FontRef,
  maxWidth: number,
  maxLines: number,
): string[] {
  const lines = [];
  let line = '';
  for (const ch of String(text || '')) {
    if (ch === '\n' || (line && measure(line + ch, font) > maxWidth)) {
      lines.push(line);
      line = ch === '\n' ? '' : ch;
      if (lines.length === maxLines) break;
    } else line += ch;
  }
  if (lines.length < maxLines && line) lines.push(line);
  if (lines.join('').length < String(text || '').replaceAll('\n', '').length && lines.length)
    lines[lines.length - 1] = fitText(measure, lines.at(-1) + '…', font, maxWidth);
  return lines;
}

/**
 * A domain caption followed by the edge's own label when that adds
 * information; a stoichiometry of 1 adds none.
 */
export const captionWithLabel = (caption: string, label: string | undefined): string =>
  label && !/^1$/.test(label) ? `${caption} · ${label}` : caption;

const CLOSING = /^[，。、；：？！）」』》〉】〕…’”,.;:?!)\]}%]$/u;
const OPENING = /^[（「『《〈【〔‘“([{]$/u;
const CJK =
  /[\p{Script=Han}\p{Script=Hiragana}\p{Script=Katakana}\p{Script=Hangul}\u3000-\u303f\uff00-\uffef]/u;

/**
 * Every character of `text` in lines of at most `maxWidth`, never cut: a
 * line breaks at a space between words, before or after any CJK character or
 * at a newline; a word wider than a line breaks between its characters.
 * Spaces at a break are dropped; nothing else is.
 */
export function wrapAllText(
  measure: TextMeasurer,
  text: string,
  font: FontRef,
  maxWidth: number,
): string[] {
  const lines: string[] = [];
  for (const paragraph of text.split('\n')) {
    // Words, single CJK characters and runs of spaces.
    const tokens = paragraph.match(/\s+|[^\s]/gu) ?? [];
    const merged: string[] = [];
    for (const token of tokens) {
      const last = merged.at(-1);
      const space = (s: string): boolean => /\s/u.test(s);
      const joins = (s: string): boolean => !space(s) && !CJK.test(s);
      if (
        last !== undefined &&
        !space(token) &&
        !space(last) &&
        // Latin words stay whole; closing punctuation never starts a line and
        // opening punctuation never ends one.
        ((joins(token) && joins(last.at(-1)!)) || CLOSING.test(token) || OPENING.test(last.at(-1)!))
      )
        merged[merged.length - 1] += token;
      else merged.push(token);
    }
    let line = '';
    for (const token of merged) {
      const space = /^\s+$/u.test(token);
      if (measure(line + token, font) <= maxWidth || (!line && space)) {
        line += token;
        continue;
      }
      if (space) {
        lines.push(line.trimEnd());
        line = '';
        continue;
      }
      if (line.trim()) lines.push(line.trimEnd());
      line = '';
      // A word longer than a line breaks between characters.
      for (const ch of token) {
        if (line && measure(line + ch, font) > maxWidth) {
          lines.push(line);
          line = '';
        }
        line += ch;
      }
    }
    lines.push(line.trimEnd());
  }
  return lines;
}
