import type { VisualGraph } from '../../types/visual-graph.js';

export type LayoutPoint = { x: number; y: number };

export interface SeededLayoutOptions {
  /** Unsigned 32-bit seed; the same input and seed always produce the same coordinates. */
  seed?: number;
  /** Bounded, fixed count of relaxation steps. */
  iterations?: number;
}

const hash = (value: string, seed: number): number => {
  let state = (2166136261 ^ seed) >>> 0;
  for (let i = 0; i < value.length; i++) {
    state = Math.imul(state ^ value.charCodeAt(i), 16777619) >>> 0;
  }
  return state / 0x100000000;
};
/**
 * Round authoring coordinates consistently across the CLI and the studio.
 * Rounding must never convert valid finite world coordinates into Infinity.
 */
export function roundPositionCoordinate(value: number): number {
  if (!Number.isFinite(value)) throw new RangeError('Layout coordinate must be finite');
  return Math.abs(value) > Number.MAX_VALUE / 100
    ? value
    : Math.round(value * 100) / 100;
}
const compareIds = (a: { id: string }, b: { id: string }): number =>
  a.id < b.id ? -1 : a.id > b.id ? 1 : 0;

/**
 * Prepare positions for authoring, not playback. Supplied positions never move;
 * only missing coordinates participate in seeded, bounded force relaxation.
 * Node and edge order are normalized so JSON array order cannot affect the result.
 */
export function layoutMissingNodes(
  graph: Pick<VisualGraph, 'nodes' | 'edges'>,
  { seed = 0, iterations = 160 }: SeededLayoutOptions = {},
): Map<string, LayoutPoint> {
  if (!Number.isInteger(seed) || seed < 0 || seed > 0xffffffff)
    throw new RangeError('Layout seed must be an unsigned 32-bit integer');
  if (!Number.isInteger(iterations) || iterations < 0 || iterations > 2000)
    throw new RangeError('Layout iterations must be between 0 and 2000');

  const nodes = [...graph.nodes].sort(compareIds);
  const positions = new Map<string, LayoutPoint>();
  for (const node of nodes) {
    if (node.position) positions.set(node.id, { ...node.position });
  }
  const missing = nodes.filter((node) => !positions.has(node.id));
  if (!missing.length) return positions;

  const original = [...positions.values()];
  const center = original.length
    ? {
        x: original.reduce((sum, p) => sum + p.x / original.length, 0),
        y: original.reduce((sum, p) => sum + p.y / original.length, 0),
      }
    : { x: 0, y: 0 };
  const ids = new Set(nodes.map((node) => node.id));
  const edges = graph.edges
    .filter((edge) => ids.has(edge.source) && ids.has(edge.target) && edge.source !== edge.target)
    .sort((a, b) => {
      const left = a.source + '\0' + a.target + '\0' + a.id;
      const right = b.source + '\0' + b.target + '\0' + b.id;
      return left < right ? -1 : left > right ? 1 : 0;
    });
  const movable = new Set(missing.map((node) => node.id));
  for (const [index, node] of missing.entries()) {
    const adjacent = edges
      .filter((edge) => edge.source === node.id || edge.target === node.id)
      .map((edge) => positions.get(edge.source === node.id ? edge.target : edge.source))
      .filter((point): point is LayoutPoint => point !== undefined);
    const anchor = adjacent.length
      ? {
          x: adjacent.reduce((sum, p) => sum + p.x / adjacent.length, 0),
          y: adjacent.reduce((sum, p) => sum + p.y / adjacent.length, 0),
        }
      : center;
    const angle = hash(node.id + ':angle', seed) * Math.PI * 2;
    const radius = adjacent.length ? 32 : 145 * Math.sqrt(index + 1);
    positions.set(node.id, {
      x: anchor.x + Math.cos(angle) * radius,
      y: anchor.y + Math.sin(angle) * radius,
    });
  }

  for (let step = 0; step < iterations; step++) {
    const forces = new Map(missing.map((node) => [node.id, { x: 0, y: 0 }]));
    // Only visit pairs that contain a movable node. In the common case of
    // 10,000 authored positions and one missing node this is O(N), not O(N^2).
    // Iterate first IDs in sorted order to keep seeded results deterministic.
    const repel = (aId: string, bId: string): void => {
      const pa = positions.get(aId), pb = positions.get(bId);
      if (!pa || !pb) return;
      let dx = pa.x - pb.x, dy = pa.y - pb.y;
      if (dx === 0 && dy === 0) {
        const angle = hash(aId + ':' + bId, seed) * Math.PI * 2;
        dx = Math.cos(angle);
        dy = Math.sin(angle);
      }
      const distance = Math.hypot(dx, dy);
      if (!(distance > 0) || !Number.isFinite(distance) || distance >= 112) return;
      const push = ((112 - distance) * 0.085) / distance;
      if (!Number.isFinite(push)) return;
      const fa = forces.get(aId), fb = forces.get(bId);
      if (fa) { fa.x += dx * push; fa.y += dy * push; }
      if (fb) { fb.x -= dx * push; fb.y -= dy * push; }
    };
    for (let i = 0; i < nodes.length; i++) {
      const a = nodes[i];
      if (movable.has(a.id)) {
        for (let j = i + 1; j < nodes.length; j++) repel(a.id, nodes[j].id);
      } else {
        // A fixed node only interacts with later movable nodes.
        for (const b of missing) if (b.id > a.id) repel(a.id, b.id);
      }
    }
    for (const edge of edges) {
      const from = positions.get(edge.source), to = positions.get(edge.target);
      if (!from || !to) continue;
      const dx = to.x - from.x, dy = to.y - from.y;
      const distance = Math.hypot(dx, dy);
      // Subtraction/hypot can overflow even if every authored point is finite.
      // Skipping such a spring is better than poisoning every mobile force with NaN.
      if (!(distance > 0) || !Number.isFinite(distance)) continue;
      const pull = ((distance - 160) / distance) * 0.022;
      if (!Number.isFinite(pull)) continue;
      const fa = forces.get(edge.source), fb = forces.get(edge.target);
      if (fa) { fa.x += dx * pull; fa.y += dy * pull; }
      if (fb) { fb.x -= dx * pull; fb.y -= dy * pull; }
    }
    const maxMove = 10 - (step / Math.max(1, iterations)) * 7;
    for (const node of missing) {
      const p = positions.get(node.id), f = forces.get(node.id);
      if (!p || !f) continue;
      const length = Math.hypot(f.x, f.y);
      if (!Number.isFinite(length)) continue;
      const factor = length > maxMove ? maxMove / length : 1;
      const x = p.x + f.x * factor, y = p.y + f.y * factor;
      if (Number.isFinite(x) && Number.isFinite(y)) {
        p.x = x;
        p.y = y;
      }
    }
  }

  // Quantization and collision resolution are deterministic and never alter
  // supplied positions, even when two authored nodes themselves overlap.
  const occupied = original.map((p) => ({ ...p }));
  for (const node of missing) {
    const point = positions.get(node.id);
    if (!point) continue;
    const angle = hash(node.id + ':collision', seed) * Math.PI * 2;
    let chosen: LayoutPoint = { x: roundPositionCoordinate(point.x), y: roundPositionCoordinate(point.y) };
    for (let attempt = 0; attempt < 5000; attempt++) {
      if (
        Number.isFinite(chosen.x) &&
        Number.isFinite(chosen.y) &&
        occupied.every((other) => Math.hypot(chosen.x - other.x, chosen.y - other.y) >= 64)
      )
        break;
      const offset = angle + attempt * 2.399963229728653;
      // At huge coordinates a 72-unit offset is smaller than one ULP.
      // Scale by the local float spacing, otherwise every candidate collides.
      const spacing = Math.max(
        72,
        Math.abs(point.x) * Number.EPSILON * 4,
        Math.abs(point.y) * Number.EPSILON * 4,
      );
      const radius = spacing * Math.sqrt(attempt + 1);
      const offsetX = Math.cos(offset) * radius, offsetY = Math.sin(offset) * radius;
      const candidateX = point.x + offsetX, candidateY = point.y + offsetY;
      // Near ±Number.MAX_VALUE even adding a finite offset can overflow.
      // Reflect an overflowing step inward while keeping the source anchor.
      chosen = {
        x: roundPositionCoordinate(
          Number.isFinite(candidateX) ? candidateX : point.x - offsetX,
        ),
        y: roundPositionCoordinate(
          Number.isFinite(candidateY) ? candidateY : point.y - offsetY,
        ),
      };
      if (attempt === 4999) throw new RangeError('Unable to place node ' + node.id);
    }
    positions.set(node.id, chosen);
    occupied.push(chosen);
  }
  return positions;
}
