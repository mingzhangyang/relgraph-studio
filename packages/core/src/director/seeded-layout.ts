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
const rounded = (value: number): number => Math.round(value * 100) / 100;
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
    for (let i = 0; i < nodes.length; i++) {
      const a = nodes[i], pa = positions.get(a.id);
      if (!pa) continue;
      for (let j = i + 1; j < nodes.length; j++) {
        const b = nodes[j], pb = positions.get(b.id);
        if (!pb || (!movable.has(a.id) && !movable.has(b.id))) continue;
        let dx = pa.x - pb.x, dy = pa.y - pb.y;
        if (dx === 0 && dy === 0) {
          const angle = hash(a.id + ':' + b.id, seed) * Math.PI * 2;
          dx = Math.cos(angle);
          dy = Math.sin(angle);
        }
        const distance = Math.hypot(dx, dy);
        if (distance >= 112) continue;
        const push = ((112 - distance) * 0.085) / distance;
        const fa = forces.get(a.id), fb = forces.get(b.id);
        if (fa) { fa.x += dx * push; fa.y += dy * push; }
        if (fb) { fb.x -= dx * push; fb.y -= dy * push; }
      }
    }
    for (const edge of edges) {
      const from = positions.get(edge.source), to = positions.get(edge.target);
      if (!from || !to) continue;
      const dx = to.x - from.x, dy = to.y - from.y;
      const distance = Math.max(1, Math.hypot(dx, dy));
      const pull = ((distance - 160) * 0.022) / distance;
      const fa = forces.get(edge.source), fb = forces.get(edge.target);
      if (fa) { fa.x += dx * pull; fa.y += dy * pull; }
      if (fb) { fb.x -= dx * pull; fb.y -= dy * pull; }
    }
    const maxMove = 10 - (step / Math.max(1, iterations)) * 7;
    for (const node of missing) {
      const p = positions.get(node.id), f = forces.get(node.id);
      if (!p || !f) continue;
      const length = Math.hypot(f.x, f.y);
      const factor = length > maxMove ? maxMove / length : 1;
      p.x += f.x * factor;
      p.y += f.y * factor;
    }
  }

  // Quantization and collision resolution are deterministic and never alter
  // supplied positions, even when two authored nodes themselves overlap.
  const occupied = original.map((p) => ({ ...p }));
  for (const node of missing) {
    const point = positions.get(node.id);
    if (!point) continue;
    const angle = hash(node.id + ':collision', seed) * Math.PI * 2;
    let chosen: LayoutPoint = { x: rounded(point.x), y: rounded(point.y) };
    for (let attempt = 0; attempt < 5000; attempt++) {
      if (
        Number.isFinite(chosen.x) &&
        Number.isFinite(chosen.y) &&
        occupied.every((other) => Math.hypot(chosen.x - other.x, chosen.y - other.y) >= 64)
      )
        break;
      const offset = angle + attempt * 2.399963229728653;
      const radius = 72 * Math.sqrt(attempt + 1);
      chosen = {
        x: rounded(point.x + Math.cos(offset) * radius),
        y: rounded(point.y + Math.sin(offset) * radius),
      };
      if (attempt === 4999) throw new RangeError('Unable to place node ' + node.id);
    }
    positions.set(node.id, chosen);
    occupied.push(chosen);
  }
  return positions;
}
