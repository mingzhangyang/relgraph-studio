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
