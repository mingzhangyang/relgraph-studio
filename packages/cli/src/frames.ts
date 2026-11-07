/** `%d` or `%05d` in a frame pattern, as FFmpeg's image2 muxer writes them. */
export const FRAME_PATTERN = /%(0?\d*)d/;

/** True when `pattern` holds exactly one frame-number placeholder. */
export const isFramePattern = (pattern: string): boolean =>
  (pattern.match(/%0?\d*d/g) ?? []).length === 1;

/** The file name of `frame` under `pattern`, e.g. `out/%05d.png` → `out/00042.png`. */
export const frameFile = (pattern: string, frame: number): string =>
  pattern.replace(FRAME_PATTERN, (_, width: string) =>
    String(frame).padStart(Number(width || 0), '0'),
  );
