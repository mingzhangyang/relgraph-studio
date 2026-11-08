import { makeStudio } from './helpers/studio-harness.mjs';
import { test } from 'vitest';
import assert from 'node:assert/strict';
import literature from '../examples/honglou-provisional.relgraph.json' with {type:'json'};
import {loadDocument} from '../packages/core/src/director/load.ts';
import {layoutGraph} from '../packages/core/src/director/layout.ts';
import {createCanvasRenderer,VIDEO_THEMES,themeFor} from '../packages/render/src/canvas.ts';
import {measuringCanvas} from './helpers/display-list.mjs';


test('video theme is an explicit, deterministic renderer input',()=>{
 const {graph}=loadDocument(literature),layout=layoutGraph(graph);
 const draw=theme=>{const renderer=createCanvasRenderer(measuringCanvas(),graph,layout,{theme});return {renderer,list:renderer.displayListAt(200)};};
 const dark=draw('dark'),light=draw('light'),fallback=draw('unknown'),defaulted=draw(undefined);
 assert.equal(dark.renderer.theme,'dark');assert.equal(light.renderer.theme,'light');assert.equal(fallback.renderer.theme,'dark');
 assert.deepEqual(fallback.list,dark.list);assert.deepEqual(defaulted.list,dark.list);
 assert.notDeepEqual(light.list,dark.list);assert.deepEqual(draw('light').list,light.list);
 // The light film actually starts from the paper background, not a dark one.
 const background=light.list.items[0].fill;
 assert.equal(background.type,'linear');assert.deepEqual(background.stops.map(s=>s.color),VIDEO_THEMES.light.bg);
 assert.ok(!JSON.stringify(light.list).match(new RegExp(VIDEO_THEMES.dark.bg.join('|'))));
});

test('both palettes define every colour the renderer reads',()=>{
 const keys=Object.keys(VIDEO_THEMES.dark).sort();
 assert.deepEqual(Object.keys(VIDEO_THEMES.light).sort(),keys);
 assert.deepEqual(Object.keys(VIDEO_THEMES.light.edge).sort(),Object.keys(VIDEO_THEMES.dark.edge).sort());
 assert.equal(themeFor('nope'),VIDEO_THEMES.dark);
});

test('inherited property names fall back to the dark palette instead of throwing',()=>{
 for(const name of ['constructor','toString','__proto__','hasOwnProperty','valueOf'])assert.equal(themeFor(name),VIDEO_THEMES.dark,name);
 const {graph}=loadDocument(literature);
 const renderer=createCanvasRenderer(measuringCanvas(),graph,layoutGraph(graph),{theme:'constructor'});
 assert.equal(renderer.theme,'dark');assert.doesNotThrow(()=>renderer.displayListAt(0));
});


test('a theme picked in the workspace stays pinned when storage is unavailable', async () => {
  const blockedStorage = {
    getItem() { throw new Error('blocked'); },
    setItem() { throw new Error('blocked'); },
  };
  // Use the shared VM browser harness. Recreating one here caused the old
  // stub to miss HTMLSelectElement and other new controls.
  const app = makeStudio({ storage: blockedStorage });
  await app.ready;
  assert.equal(app.themes.at(-1), 'dark', 'starts from the OS preference');
  await app.node('themeToggle').click();
  assert.equal(app.themes.at(-1), 'light');
  assert.equal(app.document.documentElement.attributes['data-theme'], 'light');
  for (const matches of [true, false]) app.setOSTheme(matches);
  assert.equal(app.themes.at(-1), 'light', 'a pinned choice ignores later OS changes');
});
