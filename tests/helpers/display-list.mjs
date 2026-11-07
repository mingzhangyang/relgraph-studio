// Helpers for asserting on display lists instead of recorded Canvas calls.
import { walkDisplayItems } from '../../packages/render/src/display-list.ts';

/** Text width proportional to font size, so geometry scales with the frame. */
export const measure = (text, font) => [...String(text)].length * font.size * 0.55;

/** A canvas whose context only measures text; enough for displayListAt. */
export function measuringCanvas() {
  const ctx = {
    font: '',
    measureText(text) {
      const size = Number(/(\d+(?:\.\d+)?)px/.exec(this.font)?.[1] ?? 10);
      return { width: measure(text, { size }) };
    },
  };
  return { getContext: () => ctx, width: 0, height: 0 };
}

export const drawables = (list) => [...walkDisplayItems(list.items)];
export const texts = (list) =>
  drawables(list)
    .filter((item) => item.type === 'text')
    .map((item) => item.text);
export const paths = (list) => drawables(list).filter((item) => item.type === 'path');
/** Everything a viewer could read from the frame: drawn text and its accessible text. */
export const readable = (list) => JSON.stringify({ texts: texts(list), a11y: list.a11y });
