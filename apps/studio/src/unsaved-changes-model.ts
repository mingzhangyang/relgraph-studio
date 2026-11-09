import type { ProjectConfig } from '@relgraph/core';

type Position = { x: number; y: number };

// Sorting keeps an export's position order irrelevant to the savepoint.
function positionsSnapshot(positions: ReadonlyMap<string, Position>): string {
  const entries = [...positions].sort(([left], [right]) =>
    left < right ? -1 : left > right ? 1 : 0,
  );
  return JSON.stringify(entries);
}

/** Full deterministic snapshot, also useful for standalone model tests. */
export function workspaceSnapshot(
  config: ProjectConfig,
  positions: ReadonlyMap<string, Position>,
): string {
  const entries = [...positions].sort(([left], [right]) =>
    left < right ? -1 : left > right ? 1 : 0,
  );
  return JSON.stringify({ config, positions: entries });
}

/**
 * Tracks the last loaded or explicitly exported complete project.
 *
 * ProjectHistory replaces its config object on every accepted edit/undo/redo.
 * Live positions are a mutable Map, so the coordinator must call
 * positionsChanged() after every mutation, before its next redraw.
 * This avoids serializing potentially multi-megabyte assets on each frame.
 */
export class ProjectSavepoint {
  private baselineConfig: string | null = null;
  private baselinePositions: string | null = null;
  private configCache: { source: ProjectConfig; dirty: boolean } | null = null;
  private positionsCache: {
    source: ReadonlyMap<string, Position>;
    revision: number;
    dirty: boolean;
  } | null = null;
  private positionRevision = 0;

  clear(): void {
    this.baselineConfig = null;
    this.baselinePositions = null;
    this.configCache = null;
    this.positionsCache = null;
    this.positionRevision = 0;
  }

  positionsChanged(): void {
    ++this.positionRevision;
  }

  markClean(config: ProjectConfig, positions: ReadonlyMap<string, Position>): void {
    this.baselineConfig = JSON.stringify(config);
    this.baselinePositions = positionsSnapshot(positions);
    this.configCache = { source: config, dirty: false };
    this.positionsCache = { source: positions, revision: this.positionRevision, dirty: false };
  }

  isDirty(config: ProjectConfig, positions: ReadonlyMap<string, Position>): boolean {
    if (this.baselineConfig === null || this.baselinePositions === null) return false;
    if (this.configCache?.source !== config)
      this.configCache = {
        source: config,
        dirty: this.baselineConfig !== JSON.stringify(config),
      };
    if (
      this.positionsCache?.source !== positions ||
      this.positionsCache?.revision !== this.positionRevision
    )
      this.positionsCache = {
        source: positions,
        revision: this.positionRevision,
        dirty: this.baselinePositions !== positionsSnapshot(positions),
      };
    return this.configCache!.dirty || this.positionsCache!.dirty;
  }
}
