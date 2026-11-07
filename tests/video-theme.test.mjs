import { studioSource } from './helpers/studio-source.mjs';
import { test } from 'vitest';
import assert from 'node:assert/strict';
import literature from '../examples/honglou-provisional.relgraph.json' with {type:'json'};
import {loadDocument} from '../packages/core/src/director/load.ts';
import {layoutGraph} from '../packages/core/src/director/layout.ts';
import {createCanvasRenderer,VIDEO_THEMES,themeFor} from '../packages/render/src/canvas.ts';

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

test('inherited property names fall back to the dark palette instead of throwing',()=>{
 for(const name of ['constructor','toString','__proto__','hasOwnProperty','valueOf'])assert.equal(themeFor(name),VIDEO_THEMES.dark,name);
 const {graph}=loadDocument(literature),rec=recordingCanvas();
 const renderer=createCanvasRenderer(rec.canvas,graph,layoutGraph(graph),{theme:'constructor'});
 assert.equal(renderer.theme,'dark');assert.doesNotThrow(()=>renderer.renderFrame(0));
});

// Minimal DOM for running demo/studio.mjs without a browser.
class FakeElement {
 constructor(document){this.document=document;this.children=[];this.attributes={};this.listeners={};this._text='';this.className='';this.value='';this.disabled=false;}
 append(...nodes){this.children.push(...nodes);}
 replaceChildren(...nodes){this.children=[...nodes];this._text='';}
 set textContent(value){this._text=String(value);this.children=[];}
 get textContent(){return this._text+this.children.map(child=>child.textContent).join('');}
 get lastElementChild(){return this.children.at(-1);}
 setAttribute(name,value){this.attributes[name]=String(value);}
 removeAttribute(name){delete this.attributes[name];}
 addEventListener(name,callback){(this.listeners[name]??=[]).push(callback);}
 click(){for(const callback of this.listeners.click||[])callback({target:this});}
 getContext(){return {fillRect(){},fillText(){}};}
}

test('a theme picked in the workspace stays pinned when storage is unavailable',async()=>{
 const nodes=new Map(),root=new FakeElement(null);
 const document={documentElement:root,fonts:{ready:Promise.resolve()},getElementById(id){if(!nodes.has(id))nodes.set(id,new FakeElement(document));return nodes.get(id);},createElement(){return new FakeElement(document);}};
 const mediaListeners=[],lightQuery={matches:false,addEventListener:(name,callback)=>mediaListeners.push(callback)};
 const blockedStorage={getItem(){throw new Error('blocked');},setItem(){throw new Error('blocked');}};
 const themes=[];
 const env={document,window:{addEventListener(){}},Element:FakeElement,HTMLElement:FakeElement,HTMLCanvasElement:FakeElement,HTMLButtonElement:FakeElement,HTMLInputElement:FakeElement,HTMLLabelElement:FakeElement,structuredClone,
  matchMedia:()=>lightQuery,localStorage:blockedStorage,
  fetch:async()=>({ok:true,text:async()=>JSON.stringify(literature)}),
  parseDocument:text=>loadDocument(JSON.parse(text)),layoutGraph,frameCount:()=>48,
  createCanvasRenderer:(_canvas,graph,layout,{theme})=>{themes.push(theme);return {renderFrame:()=>({playback:{index:0,progress:0,totalSec:2,domainAt:null,scene:{title:'S'}},view:{nodes:[],edges:[]},overlay:null})};},
  requestAnimationFrame:()=>0,cancelAnimationFrame(){}};
 const {runInNewContext}=await import('node:vm');
 const script=studioSource();
 await runInNewContext(`(async()=>{${script}\n})()`,env);
 assert.equal(themes.at(-1),'dark','starts from the OS preference');
 document.getElementById('themeToggle').click();
 assert.equal(themes.at(-1),'light');assert.equal(root.attributes['data-theme'],'light');
 // The OS switches to light and back to dark: the pinned choice must hold.
 for(const matches of [true,false])for(const callback of mediaListeners)callback({matches});
 assert.equal(themes.at(-1),'light','OS changes must not override a pinned theme');
});
