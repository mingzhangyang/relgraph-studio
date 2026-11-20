import { realpath, stat } from 'node:fs/promises';
import { basename, dirname, join, resolve } from 'node:path';

/**
 * Guards against writing one output over an input or another output
 * (`relgraph events g.json --out g.json`, `render … --events film.mp4`).
 */

/** The real path of `path`, resolving symlinks in every part that exists. */
async function canonical(path: string): Promise<string> {
  const absolute = resolve(path);
  try {
    return await realpath(absolute);
  } catch {
    const parent = dirname(absolute);
    return parent === absolute ? absolute : join(await canonical(parent), basename(absolute));
  }
}

/**
 * Whether two paths name the same file: the same path once symlinks are
 * resolved, or, when both exist, the same file on disk (hard links, or a
 * file system that ignores case).
 */
export async function sameFile(a: string, b: string): Promise<boolean> {
  if (resolve(a) === resolve(b)) return true;
  const [x, y] = await Promise.all([stat(a).catch(() => null), stat(b).catch(() => null)]);
  if (x && y) return x.dev === y.dev && x.ino === y.ino;
  return (await canonical(a)) === (await canonical(b));
}

export interface PathUse {
  /** How the user named it, e.g. `--events`. */
  label: string;
  path: string | undefined;
  /** Written (an output) rather than only read. */
  output: boolean;
}

/**
 * The first two uses that name the same file where at least one writes it,
 * so that it would be overwritten; reading one file twice is no conflict.
 */
export async function conflictingPaths(
  uses: readonly PathUse[],
): Promise<[PathUse & { path: string }, PathUse & { path: string }] | null> {
  const given = uses.filter((use): use is PathUse & { path: string } => use.path !== undefined);
  for (let i = 0; i < given.length; i += 1)
    for (let j = i + 1; j < given.length; j += 1)
      if ((given[i].output || given[j].output) && (await sameFile(given[i].path, given[j].path)))
        return [given[i], given[j]];
  return null;
}

/** The user-facing refusal for a conflict. */
export const conflictMessage = ([a, b]: [PathUse, PathUse]): string =>
  `${a.label} 和 ${b.label} 指向同一个文件（${b.path}），写出时会覆盖它；请换一个输出路径。`;
