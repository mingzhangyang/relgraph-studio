/**
 * How a node's importance (0–5) sets the size of its glyph and of its words.
 * One table, read by the glyph geometry, the words a shape holds and the
 * label beside a node, so the hierarchy reads the same in every channel:
 * principals are visibly larger and speak loudest.
 */
export interface ImportanceStep {
  /** Glyph radius at camera scale 1, in 720p reference pixels. */
  readonly radius: number;
  /** Half height of a time span's bar. */
  readonly bar: number;
  /** Size of the label set beside the glyph. */
  readonly label: number;
  /** Size of the words a shape holds. */
  readonly inside: number;
  /** Weight of both. */
  readonly weight: number;
  /** Lit from behind, and set in solid colour when its shape holds words. */
  readonly principal: boolean;
}

const step = (
  radius: number,
  bar: number,
  label: number,
  inside: number,
  weight: number,
  principal = false,
): ImportanceStep => Object.freeze({ radius, bar, label, inside, weight, principal });

/**
 * The steps, from the top: 5 and above, 4, 3, 1–2, and unrated (below 1 or
 * absent). Minor nodes are labelled smaller than unrated ones, whose label
 * keeps the base size.
 */
export const IMPORTANCE_SCALE = Object.freeze({
  principal: step(20, 12, 19, 17, 600, true),
  major: step(16.5, 12, 17, 16, 600),
  notable: step(13.5, 10, 16, 15, 500),
  minor: step(11, 10, 14, 15, 500),
  unrated: step(11, 10, 16, 15, 500),
});

/** The step of an importance; anything that is not a number from 1 up is unrated. */
export function importanceStep(importance: number | undefined): ImportanceStep {
  const level = importance ?? 0;
  return level >= 5
    ? IMPORTANCE_SCALE.principal
    : level >= 4
      ? IMPORTANCE_SCALE.major
      : level >= 3
        ? IMPORTANCE_SCALE.notable
        : level >= 1
          ? IMPORTANCE_SCALE.minor
          : IMPORTANCE_SCALE.unrated;
}
