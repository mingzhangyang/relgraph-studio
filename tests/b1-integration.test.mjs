import { test } from 'vitest';
import assert from 'node:assert/strict';
import literature from '../examples/honglou-provisional.relgraph.json' with {type:'json'};
import biology from '../examples/biology-signaling-synthetic.json' with {type:'json'};
import {loadDocument,parseDocument} from '../src/director/load.mjs';
import {layoutGraph} from '../src/director/layout.ts';
import {directorFrameAt,frameCount} from '../src/director/state.ts';
import {createCanvasRenderer} from '../src/render/canvas.mjs';
import {visibleStory} from '../src/relgraph.mjs';

const fiction={schemaVersion:'0.1',meta:{title:'A fictional story'},timeline:{unit:'chapter',total:10},
  characters:[{id:'a',name:'A',importance:4,position:{x:0,y:0},bio:{summary:'A',fate:'SECRET FATE',quotes:[{text:'LATE BIO',at:9},{text:'EARLY BIO',at:1}]}},
    {id:'b',name:'Future B',importance:3,position:{x:300,y:100},firstAppearance:5,bio:{summary:'B'}}],
  relations:[{id:'bond',source:'a',target:'b',type:'family',strength:2,chapters:{from:5},evidence:[{text:'LATE EVIDENCE',at:9}]}],
  presentation:[{id:'first',title:'First',durationSec:2,chapterAt:1,camera:{focusNodeId:'b'},highlight:{characterIds:['b'],relationIds:['bond']},openBioId:'b'},
    {id:'second',title:'Second',durationSec:2,chapterAt:5,camera:{fitIds:['a','b']},highlight:{characterIds:['a','b'],relationIds:['bond']}}]};

test('both documents use the same validated graph and frame pipeline',()=>{
 for(const source of [literature,biology]){
  const result=loadDocument(source);assert.equal(result.valid,true,JSON.stringify(result.errors));
  assert.ok(result.graph.nodes.length);assert.ok(result.graph.scenes.length);
  const layout=layoutGraph(result.graph);const last=frameCount(result.graph)-1;
  for(const frame of [0,Math.floor(last/2),last]){
   const state=directorFrameAt(result.graph,layout,frame);assert.ok(state.playback.scene.title);assert.ok(Number.isFinite(state.cameraResolved.scale));
   assert.deepEqual(state,directorFrameAt(result.graph,layout,frame));
  }
 }
});

test('invalid JSON and malformed source data return actionable separate diagnostics',()=>{
 assert.equal(parseDocument('{oops').errors[0].code,'JSON');
 for(const input of [null,[],{}, {format:'wrong'}, {schemaVersion:'99'}, {schemaVersion:'0.1',meta:{title:'X'},characters:[{id:'a'}],relations:[]}] ){
  const result=loadDocument(input);assert.equal(result.valid,false);
  assert.ok(result.errors.length);for(const error of result.errors){assert.ok(error.path);assert.ok(error.message);assert.ok(error.fix);}
 }
 const doc=structuredClone(fiction);doc.relations[0].target='missing';
 const result=loadDocument(doc);assert.equal(result.valid,false);assert.ok(result.errors.some(e=>e.id==='bond'&&e.path.includes('target')));
 const missing=structuredClone(fiction);delete missing.presentation[0].chapterAt;
 assert.ok(loadDocument(missing).errors.some(e=>e.code==='INITIAL_DOMAIN_TIME'&&e.id==='first'));
});

test('future nodes, evidence, biography and scene references stay out of frame state',()=>{
 const source=structuredClone(fiction);source.presentation[0].title='Future B is revealed';source.presentation[0].narration='Future B appears';
 const {graph,detailAt}=loadDocument(source),layout=layoutGraph(graph),early=directorFrameAt(graph,layout,0);
 assert.deepEqual(early.view.nodes.map(n=>n.id),['a']);assert.equal(early.view.edges.length,0);
 assert.equal(early.camera.focusNodeId,undefined);assert.deepEqual(early.highlight.nodeIds,[]);assert.equal(early.overlay,null);
 assert.equal(early.playback.scene.redacted,true);assert.equal(early.playback.scene.narration,undefined);
 assert.equal(JSON.stringify(early).includes('Future B'),false);assert.equal(JSON.stringify(early.playback.scene).includes('bond'),false);
 assert.equal(detailAt('b',1),undefined);assert.equal(detailAt('a',1).fate,undefined);assert.deepEqual(detailAt('a',1).quotes.map(q=>q.text),['EARLY BIO']);
 assert.equal(JSON.stringify(visibleStory(fiction,5)).includes('LATE EVIDENCE'),false);
 const later=directorFrameAt(graph,layout,48);assert.ok(later.view.nodes.some(n=>n.id==='b'));assert.ok(later.view.edges.some(e=>e.id==='bond'));
});

test('biology stage projections preserve process role semantics and stable generated ids',()=>{
 const doc=structuredClone(biology);doc.entities.push({id:'extra',name:'Extra input',kind:'protein',position:{x:260,y:250}});
 doc.entities[0].color='#aabbcc';doc.entities[0].importance=4;doc.processes[0].position={x:555,y:270};
 doc.processes[0].reactants.push({entityId:'extra',stoichiometry:2});
 const result=loadDocument(doc);assert.equal(result.valid,true,JSON.stringify(result.errors));const {graph}=result;
 assert.equal(new Set(graph.nodes.map(n=>n.id)).size,graph.nodes.length);assert.equal(new Set(graph.edges.map(e=>e.id)).size,graph.edges.length);
 const process='bio:process:phosphorylation-test';
 assert.equal(graph.nodes.find(n=>n.id==='kinase-k').color,'#aabbcc');assert.equal(graph.nodes.find(n=>n.id==='kinase-k').importance,4);
 assert.deepEqual(graph.nodes.find(n=>n.id===process).position,{x:555,y:270});
 assert.ok(graph.edges.some(e=>e.kind==='consumption'&&e.source==='extra'&&e.target===process&&e.label==='2'));
 assert.ok(graph.edges.some(e=>e.kind==='production'&&e.source===process&&e.target==='substrate-sp'));
 assert.ok(graph.edges.some(e=>e.kind==='catalyst'&&e.source==='kinase-k'&&e.target===process));
 const layout=layoutGraph(graph),before=directorFrameAt(graph,layout,0),reaction=directorFrameAt(graph,layout,120),after=directorFrameAt(graph,layout,220);
 assert.deepEqual(layout.get(process),{x:555,y:270});
 assert.ok(!before.view.nodes.some(n=>n.id===process));assert.ok(reaction.view.nodes.some(n=>n.id===process));
 assert.ok(!reaction.view.nodes.some(n=>n.id==='substrate-sp'));assert.ok(after.view.nodes.some(n=>n.id==='substrate-sp'));assert.ok(!after.view.nodes.some(n=>n.id==='substrate-s'));
});

test('invalid biological display properties produce diagnostics',()=>{
 const doc=structuredClone(biology);doc.entities[0].color='broken';doc.entities[0].importance=7;doc.processes[0].position=null;
 const {errors}=loadDocument(doc);assert.ok(errors.some(e=>e.code==='COLOR'&&e.id==='kinase-k'));assert.ok(errors.some(e=>e.code==='IMPORTANCE'));assert.ok(errors.some(e=>e.code==='POSITION'&&e.id==='phosphorylation-test'));
});

test('authored coordinates stay fixed and random access reproduces camera and captions',()=>{
 const {graph}=loadDocument(literature),layout=layoutGraph(graph),before=structuredClone(graph);
 for(const node of graph.nodes.filter(n=>n.position))assert.deepEqual(layout.get(node.id),node.position);
 const a=directorFrameAt(graph,layout,210);directorFrameAt(graph,layout,0);directorFrameAt(graph,layout,700);
 assert.deepEqual(directorFrameAt(graph,layout,210),a);assert.equal(a.playback.scene.title,graph.scenes[1].title);assert.deepEqual(graph,before);
 assert.notDeepEqual(directorFrameAt(graph,layout,168).cameraResolved,a.cameraResolved);
 for(const id of a.highlight.nodeIds){const p=layout.get(id),c=a.cameraResolved;assert.ok(Math.abs((p.x-c.x)*c.scale)<540);assert.ok(Math.abs((p.y-c.y)*c.scale)<195);}
});

function recordingCanvas(){
 let commands=[];const record=(...args)=>commands.push(args);
 const gradient={addColorStop:(...args)=>record('colorStop',...args)};
 const ctx=new Proxy({}, {get(target,key){if(key==='measureText')return text=>({width:String(text).length*8});if(key==='createLinearGradient'||key==='createRadialGradient')return (...args)=>{record(key,...args);return gradient;};if(!(key in target))return (...args)=>record(key,...args);return target[key];},set(target,key,value){target[key]=value;record('set',key,value===gradient?'gradient':value);return true;}});
 return {canvas:{getContext:()=>ctx},take(){const out=commands;commands=[];return out;}};
}
test('Canvas draw commands are identical for repeat and random-access frames',()=>{
 for(const source of [literature,biology]){
  const {graph}=loadDocument(source),layout=layoutGraph(graph),rec=recordingCanvas();
  const render=createCanvasRenderer(rec.canvas,graph,layout);render.renderFrame(100);const first=rec.take();
  render.renderFrame(0);rec.take();render.renderFrame(200);rec.take();render.renderFrame(100);const second=rec.take();
  assert.deepEqual(second,first);assert.ok(first.some(command=>command[0]==='fillText'));
 }
});
