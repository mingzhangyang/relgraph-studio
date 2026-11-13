#!/usr/bin/env node
// Time frame evaluation and composition on synthetic generic graphs.
//
//   npm run build:packages
//   node scripts/bench-compose.mjs                       # 200, 500, 1500 and 5000 nodes
//   node scripts/bench-compose.mjs --sizes 500,1000 --per-node 4
//   node scripts/bench-compose.mjs --spec landscape-720p
//   node scripts/bench-compose.mjs --baseline output/baseline-render
//
// The graph is tests/helpers/synthetic-graph.mjs: six groups, three node and
// three relation kinds, saved coordinates, one self-relation per 50 nodes,
// and a storyboard with every highlight form. Seven frames across its four
// shots are composed once to warm up and then timed. Text is measured in
// constant time, so real frames, which measure and draw text, are slower.
//
// --baseline names a copy of another build's packages/render/dist (for
// example of `main`, copied into output/): it is timed on the same frames and
// its display lists must equal this build's, byte for byte.
import { performance } from 'node:perf_hooks';
import { pathToFileURL } from 'node:url';
import { resolve } from 'node:path';
import {
  compileTimeline,
  directorFrameAt,
  frameCount,
  GENERIC_LIMITS,
  layoutGraph,
  loadDocument,
  styleForGraph,
} from '@relgraph/core';
import { composeFrame, cameraFitFor, FRAME_SPECS, VIDEO_THEMES } from '@relgraph/render';
import { syntheticGraph } from '../tests/helpers/synthetic-graph.mjs';

const args = process.argv.slice(2);
const option = (name, fallback) => {
  const at = args.indexOf(name);
  return at >= 0 && args[at + 1] ? args[at + 1] : fallback;
};
const sizes = option('--sizes', '200,500,1500,5000').split(',').map(Number);
const perNode = Number(option('--per-node', '2'));
const spec = FRAME_SPECS[option('--spec', 'landscape-1080p')];
if (!spec) throw new Error('Unknown --spec');
const baselineDir = option('--baseline', '');
const baseline = baselineDir
  ? await import(pathToFileURL(resolve(baselineDir, 'compose.js')).href)
  : null;
const measure = (text, font) => [...String(text)].length * font.size * 0.55;
const range = (list) =>
  `${Math.min(...list).toFixed(1)}–${Math.max(...list).toFixed(1)} ms (mean ${(
    list.reduce((sum, x) => sum + x, 0) / list.length
  ).toFixed(1)})`;

console.log(`${spec.name ?? 'frame'} ${spec.width}×${spec.height}, ${process.version}`);
for (const nodes of sizes) {
  const loops = Math.ceil(nodes / 50);
  const relations = Math.min(nodes * perNode, GENERIC_LIMITS.edges) - loops;
  const result = loadDocument(syntheticGraph(nodes, relations, { loops }));
  if (!result.valid) throw new Error(JSON.stringify(result.errors.slice(0, 3)));
  const { graph } = result;
  const positions = layoutGraph(graph);
  const style = styleForGraph(graph);
  const timeline = compileTimeline(graph, spec.fps);
  const total = frameCount(graph, spec.fps);
  const frames = [0.02, 0.15, 0.3, 0.45, 0.6, 0.8, 0.98].map((t) => Math.floor(total * t));
  const fit = cameraFitFor(spec);
  const optionsAt = (frame) => ({
    graph,
    positions,
    frame,
    fps: spec.fps,
    measure,
    frameSpec: spec,
    theme: VIDEO_THEMES.light,
    style,
    detailAt: result.detailAt,
  });
  for (const frame of frames)
    composeFrame(
      directorFrameAt(graph, positions, frame, spec.fps, { fit, timeline }),
      optionsAt(frame),
    );
  const state = [],
    compose = [],
    before = [];
  let identical = 0;
  for (const frame of frames) {
    let start = performance.now();
    const frameState = directorFrameAt(graph, positions, frame, spec.fps, { fit, timeline });
    state.push(performance.now() - start);
    start = performance.now();
    const list = composeFrame(frameState, optionsAt(frame));
    compose.push(performance.now() - start);
    if (baseline) {
      baseline.composeFrame(frameState, optionsAt(frame));
      start = performance.now();
      const old = baseline.composeFrame(frameState, optionsAt(frame));
      before.push(performance.now() - start);
      if (JSON.stringify(old) === JSON.stringify(list)) identical++;
    }
  }
  console.log(
    `${nodes} nodes / ${graph.edges.length} relations: compose ${range(compose)}; state ${range(state)}` +
      (baseline
        ? `; baseline compose ${range(before)}; identical lists ${identical}/${frames.length}`
        : ''),
  );
  if (baseline && identical !== frames.length) process.exitCode = 1;
}
