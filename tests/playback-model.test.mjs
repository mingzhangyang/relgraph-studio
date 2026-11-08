import { test } from 'vitest';
import assert from 'node:assert/strict';
import {
  advancePlayback,
  createPlaybackState,
  formatPlaybackTime,
  seekPlayback,
  setPlaybackRunning,
  shotMarkers,
} from '../apps/studio/src/playback-model.ts';

test('playback state validates film duration and FPS', () => {
  assert.deepEqual(createPlaybackState(25), {
    fps: 24,
    totalFrames: 25,
    frame: 0,
    position: 0,
    playing: false,
    lastTickMs: null,
  });
  for (const total of [0, -1, 2.5, NaN, Infinity, Number.MAX_SAFE_INTEGER + 1])
    assert.throws(() => createPlaybackState(total), RangeError);
  for (const fps of [0, -1, NaN, Infinity])
    assert.throws(() => createPlaybackState(2, fps), RangeError);
});

test('first tick establishes baseline and repaint preserves fractional progress', () => {
  let clock = setPlaybackRunning(createPlaybackState(100), true, true);
  clock = advancePlayback(clock, 1000);
  assert.equal(clock.frame, 0);
  clock = advancePlayback(clock, 1050);
  assert.equal(clock.frame, 1);
  assert.ok(Math.abs(clock.position - 1.2) < 1e-10);
  clock = seekPlayback(clock, clock.frame, true);
  assert.ok(Math.abs(clock.position - 1.2) < 1e-10);
  clock = advancePlayback(clock, 1100);
  assert.equal(clock.frame, 2);
  assert.ok(Math.abs(clock.position - 2.4) < 1e-10);
});

test('regressing and duplicate ticks never double-count elapsed time', () => {
  let clock = setPlaybackRunning(createPlaybackState(100), true, true);
  clock = advancePlayback(clock, 1000);
  clock = advancePlayback(clock, 1050);
  assert.equal(clock.frame, 1);
  const beforeRegression = clock;
  clock = advancePlayback(clock, 1010);
  assert.equal(clock, beforeRegression, 'regressing tick must not move the clock baseline');
  assert.equal(advancePlayback(clock, 1050), clock, 'duplicate timestamp has no effect');
  clock = advancePlayback(clock, 1100);
  assert.equal(clock.frame, 2, '100 ms of actual elapsed time is 2.4 frames at 24 FPS');
  assert.ok(Math.abs(clock.position - 2.4) < 1e-10);
  assert.equal(clock.lastTickMs, 1100);
  const advanced = clock;
  clock = advancePlayback(clock, 1070);
  assert.equal(clock, advanced, 'a second regression must not shift the baseline');
  clock = advancePlayback(clock, 1150);
  assert.equal(clock.frame, 3);
  assert.ok(Math.abs(clock.position - 3.6) < 1e-10);
});

test('pausing, scrubbing and resuming produce deterministic frame state', () => {
  let clock = setPlaybackRunning(seekPlayback(createPlaybackState(100), 20), true, true);
  clock = advancePlayback(clock, 1000);
  clock = advancePlayback(clock, 1020);
  assert.equal(clock.frame, 20);
  assert.equal(advancePlayback(clock, NaN), clock);
  assert.equal(advancePlayback(clock, Infinity), clock);
  clock = advancePlayback(clock, 1010);
  assert.equal(clock.frame, 20);
  clock = setPlaybackRunning(clock, false, true);
  assert.equal(clock.position, 20);
  assert.equal(clock.lastTickMs, null);
  assert.equal(advancePlayback(clock, 6000), clock);
  clock = seekPlayback(clock, 37.8);
  assert.deepEqual([clock.frame, clock.position], [37, 37]);
  clock = setPlaybackRunning(clock, true, true);
  clock = advancePlayback(clock, 6000);
  assert.equal(clock.frame, 37);
  clock = advancePlayback(clock, 7000);
  assert.equal(clock.frame, 61);
  assert.equal(setPlaybackRunning(clock, true, false).playing, false);
});

test('playback stops at final frame, including a one-frame film', () => {
  let clock = setPlaybackRunning(createPlaybackState(49), true, true);
  clock = advancePlayback(clock, 20);
  clock = advancePlayback(clock, 2020);
  assert.deepEqual([clock.frame, clock.position, clock.playing, clock.lastTickMs], [
    48, 48, false, null,
  ]);
  assert.equal(advancePlayback(clock, 9999), clock);
  clock = advancePlayback(setPlaybackRunning(createPlaybackState(1), true, true), 0);
  assert.equal(clock.playing, false);
  assert.equal(clock.frame, 0);
});

test('seek clamps frame bounds and refuses non-finite inputs', () => {
  const clock = createPlaybackState(24);
  assert.equal(seekPlayback(clock, -1).frame, 0);
  assert.equal(seekPlayback(clock, 1000).frame, 23);
  assert.equal(seekPlayback(clock, 4.99).frame, 4);
  for (const bad of [NaN, Infinity, -Infinity]) assert.equal(seekPlayback(clock, bad), clock);
});

test('shot-start markers retain fractional shot boundary semantics', () => {
  const markers = shotMarkers(
    [{ durationSec: 0.5 }, { durationSec: 1 / 3 }, { durationSec: 2 }],
    68,
    24,
  );
  assert.deepEqual(markers.map((m) => m.targetFrame), [0, 12, 20]);
  assert.deepEqual(markers.map((m) => m.startSec), [0, 0.5, 0.5 + 1 / 3]);
  assert.equal(
    shotMarkers([{ durationSec: 99 }, { durationSec: 1 }], 10, 24)[1].targetFrame,
    9,
  );
});

test('time label formatting retains existing workspace presentation', () => {
  assert.equal(formatPlaybackTime(0), '00:00.00');
  assert.equal(formatPlaybackTime(61.5), '01:01.50');
  assert.equal(formatPlaybackTime(-3), '00:00.00');
});
