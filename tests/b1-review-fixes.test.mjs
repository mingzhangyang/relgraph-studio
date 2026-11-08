import { test } from 'vitest';
import { makeStudio } from './helpers/studio-harness.mjs';
import assert from 'node:assert/strict';
import biology from '../examples/biology-signaling-synthetic.json' with {type:'json'};
import {loadDocument} from '../packages/core/src/director/load.ts';
import {layoutGraph} from '../packages/core/src/director/layout.ts';
import {directorFrameAt,frameCount} from '../packages/core/src/director/state.ts';

function graphWith(nodes,scenes){return {domain:'test',meta:{title:'Test'},timeline:{unit:'stage'},nodes,edges:[],groups:[],scenes};}

test('reaction layout assigns missing participants first and keeps generated nodes distinct',()=>{
 const doc=structuredClone(biology);
 delete doc.entities[0].position;delete doc.entities[2].position;
 const {graph}=loadDocument(doc),positions=layoutGraph(graph),reaction=positions.get('bio:process:phosphorylation-test');
 assert.deepEqual(positions.get('substrate-s'),doc.entities[1].position);
 for(const edge of graph.edges){const other=edge.source.startsWith('bio:process:')?edge.target:edge.source;assert.notDeepEqual(reaction,positions.get(other),edge.kind);}
 assert.deepEqual([...positions],[...layoutGraph(graph)]);
 // A centroid that already contains a participant must not hide its arc either.
 const coincident=structuredClone(doc);coincident.entities[0].position={x:0,y:100};coincident.entities[1].position={x:0,y:0};coincident.entities[2].position={x:0,y:0};
 const second=loadDocument(coincident).graph,layout=layoutGraph(second),center=layout.get('bio:process:phosphorylation-test');
 assert.notDeepEqual(center,layout.get('substrate-s'));assert.notDeepEqual(center,layout.get('substrate-sp'));
 assert.deepEqual(layout.get('substrate-s'),{x:0,y:0});
});

test('auto-fit and focus shots include widely separated requested nodes',()=>{
 const nodes=[{id:'a',label:'A',kind:'person',position:{x:0,y:0}},{id:'b',label:'B',kind:'person',position:{x:10000,y:5000}}];
 for(const scene of [{id:'fit',title:'Fit',durationSec:1,camera:{fitIds:['a','b']}},{id:'focus',title:'Focus',durationSec:1,camera:{focusNodeId:'a'},highlight:{nodeIds:['a','b']}}]){
  const graph=graphWith(nodes,[scene]),layout=layoutGraph(graph),camera=directorFrameAt(graph,layout,0).cameraResolved;
  assert.ok(camera.scale>0&&camera.scale<0.15);
  for(const node of nodes){const p=layout.get(node.id);assert.ok(Math.abs((p.x-camera.x)*camera.scale)<=550);assert.ok(Math.abs((p.y-camera.y)*camera.scale)<=195);}
 }
});

test('very large finite coordinates retain finite camera framing and transitions',()=>{
 const nodes=[{id:'a',label:'A',kind:'person',position:{x:1e308,y:0}},{id:'b',label:'B',kind:'person',position:{x:-1e308,y:0}}];
 const graph=graphWith(nodes,[
  {id:'fit',title:'Fit',durationSec:2,camera:{fitIds:['a','b']}},
  {id:'focus',title:'Focus',durationSec:2,camera:{focusNodeId:'a'},highlight:{nodeIds:['a','b']}}
 ]),layout=layoutGraph(graph);
 for(const frame of [0,48,60,80]){
  const camera=directorFrameAt(graph,layout,frame).cameraResolved;
  assert.ok(Number.isFinite(camera.x)&&Number.isFinite(camera.scale)&&camera.scale>0);
  for(const node of nodes)assert.ok(Number.isFinite(node.position.x*camera.scale-camera.x*camera.scale));
 }
});

test('fractional scene boundaries use the preceding shot for camera and highlights',()=>{
 const nodes=['a','b','c'].map((id,i)=>({id,label:id.toUpperCase(),kind:'person',position:{x:i*300,y:0}}));
 const graph=graphWith(nodes,[
  {id:'first',title:'First',durationSec:.1,camera:{focusNodeId:'a'},highlight:{nodeIds:['a']}},
  {id:'second',title:'Second',durationSec:.2,camera:{focusNodeId:'b'},highlight:{nodeIds:['b']}},
  {id:'third',title:'Third',durationSec:1,transitionMs:1000,camera:{focusNodeId:'c'},highlight:{nodeIds:['c']}}
 ]);
 const layout=layoutGraph(graph);
 const boundary=directorFrameAt(graph,layout,9,30),next=directorFrameAt(graph,layout,10,30);
 assert.equal(boundary.playback.index,2);assert.equal(boundary.cameraResolved.x,300);assert.deepEqual(boundary.previousHighlight.nodeIds,['b']);
 assert.ok(next.cameraResolved.x>300&&next.cameraResolved.x<600);assert.deepEqual(next.previousHighlight.nodeIds,['b']);
 assert.deepEqual(directorFrameAt(graph,layout,10,30),next);
});

// Share the real workspace VM harness with the other studio regression suites.
async function studioHarness() {
  const source={schemaVersion:'0.1',meta:{title:'Story'},timeline:{unit:'chapter',total:10},characters:[
  {id:'a',name:'A',importance:4,bio:{summary:'Safe early summary',fate:'SECRET FATE'},position:{x:0,y:0}},
  {id:'b',name:'B',importance:3,bio:{summary:'Future summary'},firstAppearance:5,position:{x:200,y:0}}
 ],relations:[],presentation:[
  {id:'first',title:'First',durationSec:.2,chapterAt:1,openBioId:'a'},
  {id:'second',title:'Secret',durationSec:.2,chapterAt:1,openBioId:'b'},
  {id:'third',title:'Third',durationSec:1,chapterAt:5,openBioId:'b'}
 ]};
  const app = makeStudio({
    fetcher: async () => ({ ok: true, text: async () => JSON.stringify(source) }),
  });
  await app.ready;
  return { document: app.document, window: app.window, tick: app.tick, jobs: app.jobs };
}

test('shot focus survives seeking and playback, and inspection cannot stall the clock',async()=>{
 const {document,window,tick}=await studioHarness(),shots=document.getElementById('shots'),first=shots.children[0],second=shots.children[1];
 second.click();assert.equal(document.activeElement,second);assert.equal(shots.children[1],second);
 window.renderAt(0);assert.equal(document.activeElement,second);assert.equal(shots.children[0],first);
 document.getElementById('play').click();second.focus();
 for(let i=0;i<20;i++){tick(1000+i*1000/60);window.studioFrame();}
 assert.ok(Number(document.getElementById('scrubber').value)>0,'polling must not discard fractional progress');
 assert.equal(document.activeElement,second);assert.equal(shots.children[1],second);
 const snapshot=window.studioFrame();snapshot.view.nodes[0].label='modified by caller';
 assert.notEqual(window.studioFrame().view.nodes[0].label,'modified by caller');
});

test('accessible text includes only the currently visible spoiler-safe biography',async()=>{
 const {document,window}=await studioHarness(),transcript=document.getElementById('transcript'),description=document.getElementById('sceneDescription');
 assert.match(transcript.textContent,/Safe early summary/);assert.match(description.textContent,/Safe early summary/);assert.doesNotMatch(transcript.textContent,/SECRET FATE|Future summary/);
 window.renderAt(5);assert.doesNotMatch(transcript.textContent,/Safe early summary|Future summary|SECRET FATE/);
 window.renderAt(10);assert.match(transcript.textContent,/Future summary/);assert.match(description.textContent,/Future summary/);assert.doesNotMatch(transcript.textContent,/SECRET FATE/);
});
