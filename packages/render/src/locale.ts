import type { Locale } from '@relgraph/core';

/**
 * Text the renderer itself writes into frames and their accessible text.
 * Domain captions come from domain style sheets; author text is used as is.
 * The small-caps frame furniture (kicker, frame and scene counters) is a
 * typographic element and stays in Latin letters in every locale.
 */
export interface RenderMessages {
  kicker: string;
  frameMeta(frame: number, fps: number): string;
  sceneCounter(index: number, count: number): string;
  domainTime(unit: string | undefined, at: number): string;
  relation(source: string, target: string, directed: boolean, label: string): string;
}

const pad = (n: number, width: number): string => String(n).padStart(width, '0');
const furniture = {
  kicker: 'RELGRAPH  /  DIRECTOR STUDIO',
  frameMeta: (frame: number, fps: number) => `FRAME ${pad(frame, 5)}  ·  ${fps} FPS`,
  sceneCounter: (index: number, count: number) => `SCENE ${pad(index, 2)}  /  ${pad(count, 2)}`,
  domainTime: (unit: string | undefined, at: number) => `${unit || 'TIME'} ${at}`,
};

export const RENDER_MESSAGES: Readonly<Record<Locale, RenderMessages>> = Object.freeze({
  'zh-CN': Object.freeze({
    ...furniture,
    relation: (source: string, target: string, directed: boolean, label: string) =>
      `${source} ${directed ? '→' : '—'} ${target}：${label}`,
  }),
  en: Object.freeze({
    ...furniture,
    relation: (source: string, target: string, directed: boolean, label: string) =>
      `${source} ${directed ? '→' : '—'} ${target}: ${label}`,
  }),
});
