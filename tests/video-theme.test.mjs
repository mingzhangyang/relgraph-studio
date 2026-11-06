import test from 'node:test';
import assert from 'node:assert/strict';
import literature from '../examples/honglou-provisional.relgraph.json' with {type:'json'};
import {loadDocument} from '../src/director/load.mjs';
import {layoutGraph} from '../src/director/layout.mjs';
import {createCanvasRenderer,VIDEO_THEMES,themeFor} from '../src/render/canvas.mjs';

function recordingCanvas(){
 let commands=[];const record=(...args)=>commands.push(args);
 const gradient={addColorStop:(...args)=>record('colorStop',...args)};
 const ctx=new Proxy({},{get(target,key){if(key==='measureText')return text=>({width:String(text).length*8});if(key==='createLinearGradient'||key==='createRadialGradient')return (...args)=>{record(key,...args);return gradient;};if(!(key in target))return (...args)=>record(key,...args);return target[key];},set(target,key,value){target[key]=value;record('set',key,value===gradient?'gradient':value);return true;}});
 return {canvas:{getContext:()=>ctx},take(){const out=commands;commands=[];return out;}};
}

test('video theme is an explicit, deterministic renderer input',()=>{
 const {graph}=loadDocument(literature),layout=layoutGraph(graph);
 const draw=theme=>{const rec=recordingCanvas(),renderer=createCanvasRenderer(rec.canvas,graph,layout,{theme});renderer.renderFrame(200);return {renderer,commands:rec.take()};};
 const dark=draw('dark'),light=draw('light'),fallback=draw('unknown'),defaulted=draw(undefined);
 assert.equal(dark.renderer.theme,'dark');assert.equal(light.renderer.theme,'light');assert.equal(fallback.renderer.theme,'dark');
 assert.deepEqual(fallback.commands,dark.commands);assert.deepEqual(defaulted.commands,dark.commands);
 assert.notDeepEqual(light.commands,dark.commands);assert.deepEqual(draw('light').commands,light.commands);
 // The light film actually starts from the paper background, not a dark one.
 assert.ok(light.commands.some(([kind,offset,value])=>kind==='colorStop'&&offset===0&&value===VIDEO_THEMES.light.bg[0]));
 assert.ok(!light.commands.some(([,,value])=>VIDEO_THEMES.dark.bg.includes(value)));
});

test('both palettes define every colour the renderer reads',()=>{
 const keys=Object.keys(VIDEO_THEMES.dark).sort();
 assert.deepEqual(Object.keys(VIDEO_THEMES.light).sort(),keys);
 assert.deepEqual(Object.keys(VIDEO_THEMES.light.edge).sort(),Object.keys(VIDEO_THEMES.dark.edge).sort());
 assert.equal(themeFor('nope'),VIDEO_THEMES.dark);
});
