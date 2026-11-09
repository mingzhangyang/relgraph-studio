import type { ProjectConfig } from '@relgraph/core';

type Position = { x: number; y: number };

/**
 * Tracks the last loaded or explicitly exported *complete project*.
 * Positions are included separately so live drags cannot evade the guard
 * before their history commit, and Map insertion order does not matter.
 */
export function workspaceSnapshot(
  config: ProjectConfig,
  positions: ReadonlyMap<string, Position>,
): string {
  const entries = [...positions].sort(([left], [right]) =>
    left < right ? -1 : left > right ? 1 : 0,
  );
  return JSON.stringify({ config, positions: entries });
}

export class ProjectSavepoint {
  private baseline: string | null = null;

  clear(): void {
    this.baseline = null;
  }

  markClean(config: ProjectConfig, positions: ReadonlyMap<string, Position>): void {
    this.baseline = workspaceSnapshot(config, positions);
  }

  isDirty(config: ProjectConfig, positions: ReadonlyMap<string, Position>): boolean {
    return this.baseline !== null && this.baseline !== workspaceSnapshot(config, positions);
  }
}
