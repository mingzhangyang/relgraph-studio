import type { EdgeStroke } from '@relgraph/core';

/**
 * Video palettes. A theme is an explicit renderer input, so a frame stays a
 * pure function of (graph, layout, frame, theme). Data-authored node and
 * group colours are used as-is in both palettes.
 */
export const VIDEO_THEMES = Object.freeze({
  dark: Object.freeze({
    name: 'dark',
    bg: ['#101b2a', '#152638', '#111d2d'],
    warm: 'rgba(150,112,76,.14)',
    warmEnd: 'rgba(17,29,45,0)',
    grid: 'rgba(226,218,191,.085)',
    fallbackNode: '#8aaeb1',
    // Categorical tones, validated as a set for this surface (lightness band,
    // chroma floor, adjacent colour-vision separation, 3:1 contrast). Shape,
    // dash, direct labels and the legend carry identity alongside the hue.
    tones: ['#5593d2', '#dd6a4a', '#35a583', '#b8881a', '#d2668f', '#69a343', '#9480dc', '#c47f4c'],
    // How much of a node's colour is mixed into its body.
    nodeTint: 0.3,
    hullFill: '1c',
    groupStroke: '70',
    groupLabel: 'e6',
    legendPlate: '#111d2dcc',
    legendText: '#aebdc3',
    edge: { highlight: '#f0c99b', physical: '#8aaab5', special: '#d3b783', plain: '#9ebac0' },
    nodeFill: '#14212f',
    labelHalo: '#0f1a27',
    labelActive: '#f2eee4',
    labelMuted: '#b7c5c9',
    edgeLabelBox: '#14212fe8',
    edgeLabelText: '#d5c7ad',
    card: '#14212ff2',
    cardStroke: '#a78d6e',
    cardTitle: '#e6c89e',
    cardText: '#c6cfcf',
    band: 'rgba(12,20,32,.82)',
    bandRule: 'rgba(224,192,154,.24)',
    kicker: '#cfae84',
    title: '#f1e6d2',
    meta: '#97adb5',
    sceneLabel: '#d5b17f',
    sceneTitle: '#f4eee3',
    narration: '#b9c6c9',
    track: 'rgba(173,189,197,.22)',
    progress: '#d9b382',
  }),
  light: Object.freeze({
    name: 'light',
    bg: ['#f8f4ec', '#f3ede1', '#eee6d6'],
    warm: 'rgba(222,184,130,.17)',
    warmEnd: 'rgba(243,237,225,0)',
    grid: 'rgba(120,98,66,.13)',
    fallbackNode: '#5f8a8f',
    tones: ['#2f6fb0', '#d2553a', '#23906c', '#b87d0c', '#c4577f', '#4d8a2c', '#7a5fc0', '#a8643c'],
    nodeTint: 0.24,
    hullFill: '14',
    groupStroke: '78',
    groupLabel: 'f0',
    legendPlate: '#f6f1e6d9',
    legendText: '#5c6973',
    edge: { highlight: '#b5722c', physical: '#5d8696', special: '#a57e3c', plain: '#8197a0' },
    nodeFill: '#fffdf8',
    labelHalo: '#f8f3ea',
    labelActive: '#1d2733',
    labelMuted: '#6d7c86',
    edgeLabelBox: '#fffaf0ee',
    edgeLabelText: '#7a5a33',
    card: '#fffbf4f5',
    cardStroke: '#c9a77c',
    cardTitle: '#8a5a22',
    cardText: '#3d4a54',
    band: 'rgba(251,248,241,.94)',
    bandRule: 'rgba(160,120,70,.32)',
    kicker: '#a0672a',
    title: '#1f2a36',
    meta: '#5c6973',
    sceneLabel: '#a0672a',
    sceneTitle: '#1a2430',
    narration: '#4a5862',
    track: 'rgba(60,70,80,.14)',
    progress: '#b9803f',
  }),
});
export type ThemeName = keyof typeof VIDEO_THEMES;
export type VideoTheme = (typeof VIDEO_THEMES)[ThemeName];
// Own-property check: names such as 'constructor' or '__proto__' must not
// resolve to Object.prototype members instead of falling back to dark.
const isThemeName = (name: string): name is ThemeName => Object.hasOwn(VIDEO_THEMES, name);
export const themeFor = (name: unknown): VideoTheme =>
  typeof name === 'string' && isThemeName(name) ? VIDEO_THEMES[name] : VIDEO_THEMES.dark;

/** Resolve a domain style's semantic edge stroke to this palette. */
export function edgePaint(theme: VideoTheme, stroke: EdgeStroke): string {
  if (stroke === 'physical') return theme.edge.physical;
  if (stroke === 'regulatory') return theme.edge.special;
  return theme.edge.plain;
}

const channels = (hex: string): [number, number, number] => [
  parseInt(hex.slice(1, 3), 16),
  parseInt(hex.slice(3, 5), 16),
  parseInt(hex.slice(5, 7), 16),
];
/** Opaque mix of two #RRGGBB colours; `amount` is the share of `a`. */
export function mixHex(a: string, b: string, amount: number): string {
  const from = channels(a),
    to = channels(b),
    t = Math.min(1, Math.max(0, amount));
  return (
    '#' +
    from
      .map((value, i) =>
        Math.round(value * t + to[i] * (1 - t))
          .toString(16)
          .padStart(2, '0'),
      )
      .join('')
  );
}

/** A categorical tone of this palette, or undefined beyond its fixed slots. */
export const toneOf = (theme: VideoTheme, tone: number | undefined): string | undefined =>
  tone !== undefined && Number.isInteger(tone) && tone >= 0 && tone < theme.tones.length
    ? theme.tones[tone]
    : undefined;
