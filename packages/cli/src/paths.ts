import { lstat, readlink, realpath, stat } from 'node:fs/promises';
import { basename, dirname, join, resolve } from 'node:path';

/**
 * Guards against writing one output over an input or another output
 * (`relgraph events g.json --out g.json`, `render … --events film.mp4`,
 * `render --frames %d.png` where `0.png` links to the document).
 */

/**
 * The real path of `path`: symlinks resolved in every part that exists,
 * including a final symlink whose target does not exist yet (writing
 * through it creates that target).
 */
async function canonical(path: string, depth = 0): Promise<string> {
  const absolute = resolve(path);
  try {
    return await realpath(absolute);
  } catch {
    if (depth < 40) {
      const link = await lstat(absolute).catch(() => null);
      if (link?.isSymbolicLink())
        return canonical(resolve(dirname(absolute), await readlink(absolute)), depth + 1);
    }
    const parent = dirname(absolute);
    return parent === absolute
      ? absolute
      : join(await canonical(parent, depth), basename(absolute));
  }
}

/** What identifies a file: its real path, and its device and inode when it exists. */
export interface FileIdentity {
  path: string;
  inode: string | null;
}

export async function fileIdentity(path: string): Promise<FileIdentity> {
  const [real, info] = await Promise.all([canonical(path), stat(path).catch(() => null)]);
  return { path: real, inode: info ? `${info.dev}:${info.ino}` : null };
}

/**
 * Whether two identities are one file: the same real path, or the same file
 * on disk (hard links, symlinks, a file system that ignores case).
 */
export const sameIdentity = (a: FileIdentity, b: FileIdentity): boolean =>
  a.path === b.path || (a.inode !== null && a.inode === b.inode);

/** Whether two paths name the same file; see `sameIdentity`. */
export async function sameFile(a: string, b: string): Promise<boolean> {
  if (resolve(a) === resolve(b)) return true;
  const [x, y] = await Promise.all([fileIdentity(a), fileIdentity(b)]);
  return sameIdentity(x, y);
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

/** The user-facing refusal for a conflict, naming both paths when they differ. */
export const conflictMessage = ([a, b]: [PathUse, PathUse]): string => {
  const same = resolve(a.path ?? '') === resolve(b.path ?? '');
  return same
    ? `${a.label} 和 ${b.label} 指向同一个文件（${b.path}），写出时会覆盖它；请换一个输出路径。`
    : `${a.label}（${a.path}）和 ${b.label}（${b.path}）是同一个文件，写出时会覆盖它；请换一个输出路径。`;
};
