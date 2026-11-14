/**
 * Line rhythms, in 720p reference pixels: the one definition read by the
 * derived style sheets, the domain sheets and the composer's authored dashes.
 * A leaf module, so that domain sheets, which `style.ts` imports, can read it.
 */

/** The line rhythms an author may ask for by name. */
export const LINE_STYLES = ['solid', 'dashed', 'dotted'] as const;
export type LineStyle = (typeof LINE_STYLES)[number];

/** The dash pattern of each named rhythm; solid has none. */
export const LINE_DASH: {
  readonly solid: undefined;
  readonly dashed: readonly number[];
  readonly dotted: readonly number[];
} = Object.freeze({
  solid: undefined,
  dashed: Object.freeze([7, 5]),
  dotted: Object.freeze([2, 4]),
});
