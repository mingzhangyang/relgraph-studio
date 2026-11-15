import manifest from '../../../examples/manifest.json';

/** One shipped example: its button, its file under examples/ and its names. */
export interface StudioExample {
  /** Element id of its button in the data-source card. */
  readonly id: string;
  /** File name under examples/. */
  readonly file: string;
  /** Source name shown once it is loaded. */
  readonly name: string;
  /** Button title and subtitle. */
  readonly title: string;
  readonly subtitle: string;
  /** The button spans both columns of the card. */
  readonly wide?: boolean;
}

/**
 * The shipped examples in button order, from examples/manifest.json, which the
 * page's buttons and the build's copied files also come from. The first entry
 * loads when the workspace opens.
 */
export const STUDIO_EXAMPLES: readonly StudioExample[] = manifest;
