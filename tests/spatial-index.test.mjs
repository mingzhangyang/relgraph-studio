// The spatial indexes only narrow candidates: every answer must equal the
// answer of a scan over all items, including for rectangles outside the
// region, of negative size or with coordinates that are not finite.
import { test } from 'vitest';
import assert from 'node:assert/strict';
import { PointIndex, RectIndex } from '../packages/render/src/spatial.ts';
import { rectsIntersect } from '../packages/render/src/node-geometry.ts';

function random(seed) {
  let state = seed >>> 0;
  return () => (state = (Math.imul(state, 1664525) + 1013904223) >>> 0) / 2 ** 32;
}
const REGION = { x: 10, y: 20, w: 600, h: 300 };
const ODD = [NaN, Infinity, -Infinity];

function rectFrom(next) {
  const pick = next();
  // Mostly ordinary boxes in and around the region; some on its edges,
  // far outside, huge, empty, inverted or not finite.
  const box = {
    x: -200 + next() * 1000,
    y: -200 + next() * 700,
    w: next() * 80,
    h: next() * 40,
  };
  if (pick < 0.05) box.x = REGION.x + REGION.w;
  else if (pick < 0.1) box.w = 0;
  else if (pick < 0.13) box.w = -next() * 50;
  else if (pick < 0.16) box.h = -next() * 50;
  else if (pick < 0.2) box.x = ODD[Math.floor(next() * 3)];
  else if (pick < 0.23) box.w = ODD[Math.floor(next() * 3)];
  else if (pick < 0.27) Object.assign(box, { x: -5000, w: 20000 });
  else if (pick < 0.3) box.y = 1e6;
  return box;
}

test('RectIndex answers exactly as a scan over every rectangle', () => {
  const next = random(11);
  for (let round = 0; round < 20; round++) {
    const cost = { rectTests: 0, pointTests: 0 };
    const index = new RectIndex(REGION, 24 + round * 7, cost);
    const stored = [];
    for (let i = 0; i < 300; i++) {
      const box = rectFrom(next);
      stored.push(box);
      index.add(box);
    }
    for (let q = 0; q < 400; q++) {
      const query = rectFrom(next);
      const expected = stored.filter((box) => rectsIntersect(query, box));
      const visited = [];
      index.someIntersecting(query, (hit) => {
        visited.push(hit);
        return false;
      });
      // Each intersecting rectangle once, and nothing else.
      assert.equal(visited.length, expected.length, JSON.stringify(query));
      assert.deepEqual(new Set(visited), new Set(expected));
      assert.equal(index.someIntersecting(query), expected.length > 0);
    }
    assert.ok(cost.rectTests > 0);
  }
});

test('RectIndex stops when the visitor says so', () => {
  const index = new RectIndex(REGION, 50);
  for (let i = 0; i < 10; i++) index.add({ x: 100, y: 100, w: 10, h: 10 });
  let calls = 0;
  const stopped = index.someIntersecting({ x: 95, y: 95, w: 20, h: 20 }, () => ++calls >= 3);
  assert.equal(stopped, true);
  assert.equal(calls, 3);
  // Equal rectangles are separate entries and are each visited.
  calls = 0;
  index.someIntersecting({ x: 95, y: 95, w: 20, h: 20 }, () => (calls++, false));
  assert.equal(calls, 10);
});

test('PointIndex answers exactly as a scan over every point', () => {
  const next = random(5);
  for (let round = 0; round < 20; round++) {
    const index = new PointIndex(16 + round * 9);
    const points = [];
    for (let i = 0; i < 300; i++) {
      const pick = next();
      const point = {
        id: `p${i % 280}`,
        x: pick < 0.05 ? ODD[Math.floor(next() * 3)] : -300 + next() * 1200,
        y: pick > 0.95 ? ODD[Math.floor(next() * 3)] : -300 + next() * 900,
      };
      points.push(point);
      index.add(point.id, point.x, point.y);
    }
    for (let q = 0; q < 400; q++) {
      const x = next() < 0.03 ? NaN : -100 + next() * 800,
        y = -100 + next() * 600,
        pick = next(),
        limit = pick < 0.03 ? ODD[Math.floor(next() * 3)] : pick < 0.05 ? 0 : next() * 300,
        except = `p${Math.floor(next() * 300)}`;
      const expected = points.some(
        (point) => point.id !== except && Math.hypot(x - point.x, y - point.y) < limit,
      );
      assert.equal(index.anyCloser(x, y, limit, except), expected, `${x},${y} < ${limit}`);
    }
  }
});
