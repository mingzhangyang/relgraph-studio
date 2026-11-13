/**
 * The names a project may store for its layout (`ProjectConfig.layout`), and
 * the spacing and relaxation budget every automatic drawing starts from. They
 * live beside the project types so that the project, its validator, the
 * studio, the engines and the strategies all read one list without importing
 * one another.
 */

export const LAYOUT_ENGINES = [
  'force',
  'layered',
  'flow',
  'tree',
  'mindmap',
  'timeline',
  'radial',
  'circle',
  'grid',
] as const;
export type LayoutEngine = (typeof LAYOUT_ENGINES)[number];
/**
 * The spacing and relaxation budget every automatic drawing starts from: the
 * player's drawing of a document without coordinates, `relgraph layout`, and
 * the layout panel's defaults. One constant, so that asking the panel to
 * rearrange a freshly loaded document reproduces what is already on screen.
 */
export const LAYOUT_DEFAULTS: Readonly<{ spacing: number; iterations: number }> = Object.freeze({
  spacing: 150,
  iterations: 300,
});

/**
 * Every strategy a project may store: `manual` keeps coordinates as they
 * are, `auto` chooses an engine, and each engine can be asked for by name.
 * The project type, its validator and the studio's menu all read this list.
 */
export const LAYOUT_TYPES = ['manual', 'auto', ...LAYOUT_ENGINES] as const;
export type LayoutType = (typeof LAYOUT_TYPES)[number];
/** What a strategy may do with the coordinates that already exist. */
export const LAYOUT_MODES = ['preserve', 'missing', 'rearrange'] as const;
export type LayoutMode = (typeof LAYOUT_MODES)[number];
