import { studioImports, studioSource } from './helpers/studio-source.mjs';
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
 const document={documentElement:root,fonts:{ready:Promise.resolve(),load:async()=>[{}]},getElementById(id){if(!nodes.has(id))nodes.set(id,new FakeElement(document));return nodes.get(id);},createElement(){return new FakeElement(document);}};
 const mediaListeners=[],lightQuery={matches:false,addEventListener:(name,callback)=>mediaListeners.push(callback)};
 const blockedStorage={getItem(){throw new Error('blocked');},setItem(){throw new Error('blocked');}};
 const themes=[];
 const env={...studioImports,document,window:{addEventListener(){}},Element:FakeElement,HTMLElement:FakeElement,HTMLCanvasElement:FakeElement,HTMLButtonElement:FakeElement,HTMLInputElement:FakeElement,HTMLLabelElement:FakeElement,structuredClone,
  matchMedia:()=>lightQuery,localStorage:blockedStorage,
  fetch:async()=>({ok:true,text:async()=>JSON.stringify(literature)}),
  parseDocument:text=>loadDocument(JSON.parse(text)),layoutGraph,frameCount:()=>48,
  createCanvasRenderer:(_canvas,graph,layout,{theme})=>{
    themes.push(theme);
    return {renderFrameWithList:()=>({
      state:{playback:{index:0,progress:0,totalSec:2,domainAt:null,scene:{title:'S'}},view:{nodes:[],edges:[]},overlay:null},
      list:{a11y:{scene:{title:'S',narration:''},nodes:[],relations:[],detail:null}}
    })};
  },
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
