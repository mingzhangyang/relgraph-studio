// Reference composition: Studio graph panel + external scientific plate + full-film music.
import { spawn } from 'node:child_process';
import { mkdir, mkdtemp, readFile, rename, rm, rmdir, writeFile } from 'node:fs/promises';
import { basename, dirname, join, resolve } from 'node:path';
import { Readable } from 'node:stream';
import { pipeline } from 'node:stream/promises';
import { compileTimeline, filmEvents, layoutGraph, parseDocument } from '@relgraph/core';
import { frameSpecFor } from '@relgraph/render';
import { createHeadlessRenderer } from '@relgraph/render/skia';

const [recipeFile, destination] = process.argv.slice(2);
if (!recipeFile || !destination || process.argv.length !== 4)
  throw new Error('Usage: node scripts/compose-video-shot.mjs recipe.json NEW_OUTPUT_DIRECTORY');
const recipe = JSON.parse(await readFile(recipeFile, 'utf8'));
const asset = (path) => resolve(dirname(recipeFile), path);
const fps = recipe.fps;
if (!Number.isSafeInteger(fps) || fps < 1) throw new Error('Expected a positive integer fps');
const result = parseDocument(await readFile(asset(recipe.document), 'utf8'));
if (!result.valid) throw new Error(JSON.stringify(result.errors));
const { graph, authoredIds } = result;
const timeline = compileTimeline(graph, fps);
const sourceEvents = filmEvents(graph, layoutGraph(graph), fps, { timeline, authoredIds });
const cue = sourceEvents.events.find((e) => e.type === 'shot' && e.id === recipe.shot);
if (!cue || cue.redacted) throw new Error('No visible shot matching ' + recipe.shot);
const shot = timeline.shots[cue.shot];

// This recipe isolates a simple camera.fitIds shot. The full-film CLI retains
// complex camera beats, evidence cards and transitions between adjacent shots.
const focus = new Set(shot.scene.camera?.fitIds);
if (!focus.size || graph.scenes[cue.shot].beats?.length || shot.evidence || shot.overlay)
  throw new Error('This recipe needs a fitIds shot without beats or cards');
const nodes = shot.view.nodes.filter((n) => focus.has(n.id));
const edges = shot.view.edges.filter((e) => focus.has(e.source) && focus.has(e.target));
const groups = new Set(nodes.map((n) => n.groupId));
const panel = {
  ...graph,
  nodes,
  edges,
  groups: shot.view.groups.filter((g) => groups.has(g.id)),
  scenes: [
    {
      ...shot.scene,
      durationSec: cue.frames / fps,
      domainAt: shot.domainAt ?? undefined,
      revealStep: shot.revealStep ?? undefined,
      highlight: { nodeIds: nodes.map((n) => n.id), edgeIds: edges.map((e) => e.id) },
    },
  ],
};
const spec = { ...frameSpecFor('portrait-1080x1440'), fps };
const positions = layoutGraph(panel);
for (const node of panel.nodes) {
  const name = authoredIds?.nodes.get(node.id) ?? node.id;
  const point = recipe.positions?.[name];
  if (point && !node.position) {
    if (!Number.isFinite(point.x) || !Number.isFinite(point.y))
      throw new Error('Invalid position for ' + name);
    positions.set(node.id, point);
  }
}
const renderer = createHeadlessRenderer(panel, positions, {
  theme: 'light',
  frameSpec: spec,
  detailAt: result.detailAt,
});
const events = filmEvents(panel, positions, fps, { authoredIds });
if (events.frameCount !== cue.frames) throw new Error('Panel timing differs from the source shot');

const parent = dirname(resolve(destination));
await mkdir(parent, { recursive: true });
const temp = await mkdtemp(join(parent, '.relgraph-'));
let reserved = false;
try {
  await mkdir(destination);
  reserved = true;
  const offsetSec = cue.frame / fps;
  // Keep each FFmpeg input and its options together.
  // prettier-ignore
  const args = [
    '-v','error','-nostdin','-f','rawvideo','-pix_fmt','rgba','-s','1080x1440','-r',String(fps),'-i','pipe:0',
    '-loop','1','-framerate',String(fps),'-i',asset(recipe.plate),
    '-ss',String(offsetSec),'-i',asset(recipe.music),
    '-filter_complex','[1:v]scale=1080:480:force_original_aspect_ratio=decrease,pad=1080:480:(ow-iw)/2:(oh-ih)/2:color=0xf4efdf,setsar=1[plate];[plate][0:v]vstack=shortest=1,scale=out_color_matrix=bt709,format=yuv420p[v]',
    '-map','[v]','-map','2:a:0','-af','apad','-t',String(cue.frames/fps),
    '-c:v','libx264','-threads','4','-preset','veryfast','-crf','18',
    '-colorspace','bt709','-color_trc','bt709','-color_primaries','bt709',
    '-c:a','aac','-b:a','192k','-movflags','+faststart',join(temp,'shot.mp4'),
  ];
  const encoder = spawn('ffmpeg', args, { stdio: ['pipe', 'inherit', 'inherit'] });
  const done = new Promise((ok, fail) => {
    encoder.once('error', fail);
    encoder.once('close', (code) => (code === 0 ? ok() : fail(new Error('FFmpeg exited ' + code))));
  });
  function* pixels() {
    for (let frame = 0; frame < events.frameCount; frame++) yield renderer.rgbaAt(frame);
  }
  await Promise.all([done, pipeline(Readable.from(pixels()), encoder.stdin)]);
  await writeFile(join(temp, 'events.json'), JSON.stringify(events, null, 2) + '\n');
  await writeFile(
    join(temp, 'shot.json'),
    JSON.stringify(
      {
        sourceShot: cue.id,
        sourceStartFrame: cue.frame,
        sourceStartSec: offsetSec,
        fps,
        frames: cue.frames,
        width: 1080,
        height: 1920,
      },
      null,
      2,
    ) + '\n',
  );
  await rename(temp, destination);
  reserved = false;
  console.log(basename(recipeFile), cue.id, cue.frames + ' frames ->', destination);
} finally {
  await rm(temp, { recursive: true, force: true });
  if (reserved) await rmdir(destination);
}
