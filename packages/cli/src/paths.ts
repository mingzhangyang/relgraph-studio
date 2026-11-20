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
 * A path as a file system that ignores case and Unicode normalization sees
 * it (Windows, and macOS by default): `Film.mp4` and `film.mp4`, or a
 * precomposed and a decomposed `é`, are one name there.
 */
export const foldedPath = (path: string): string => path.normalize('NFC').toLowerCase();

/**
 * Whether two identities may be one file. When both exist, the file system
 * decides: the same device and inode (hard links, symlinks, case it
 * ignores), else the same real path. When either does not exist yet there is
 * no inode to ask, so names that differ only in case or normalization count
 * as the same: on a case-insensitive file system they are, and writing one
 * would replace the other. This refuses such pairs on case-sensitive file
 * systems too, where they would be two files; outputs are easily renamed,
 * data lost to an alias is not.
 */
export function sameIdentity(a: FileIdentity, b: FileIdentity): boolean {
  if (a.path === b.path) return true;
  if (a.inode !== null && b.inode !== null) return a.inode === b.inode;
  return foldedPath(a.path) === foldedPath(b.path);
}

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
  const [x, y] = [resolve(a.path ?? ''), resolve(b.path ?? '')];
  if (x === y)
    return `${a.label} 和 ${b.label} 指向同一个文件（${b.path}），写出时会覆盖它；请换一个输出路径。`;
  const caseOnly = foldedPath(x) === foldedPath(y);
  return (
    `${a.label}（${a.path}）和 ${b.label}（${b.path}）` +
    (caseOnly
      ? '只差大小写，在不区分大小写的文件系统（Windows、macOS 默认）上是同一个文件，'
      : '是同一个文件，') +
    '写出时会覆盖它；请换一个输出路径。'
  );
};
