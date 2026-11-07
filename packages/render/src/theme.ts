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
    warm: 'rgba(150,112,76,.16)',
    warmEnd: 'rgba(17,29,45,0)',
    hatch: 'rgba(226,218,191,.035)',
    fallbackNode: '#8aaeb1',
    groupStroke: '40',
    groupLabel: 'b0',
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
    warm: 'rgba(214,170,112,.22)',
    warmEnd: 'rgba(243,237,225,0)',
    hatch: 'rgba(120,98,66,.05)',
    fallbackNode: '#5f8a8f',
    groupStroke: '60',
    groupLabel: 'e0',
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
