import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import biology from '../examples/biology-signaling-synthetic.json' with {type:'json'};
import {loadDocument} from '../src/director/load.mjs';
import {layoutGraph} from '../src/director/layout.mjs';
import {directorFrameAt} from '../src/director/state.mjs';
import {shotAttention} from '../src/render/canvas.mjs';

const css=readFileSync(new URL('../demo/studio.css',import.meta.url),'utf8');
function tokens(block){return Object.fromEntries([...block.matchAll(/--([\w-]+):\s*([^;]+);/g)].map(m=>[m[1],m[2].trim()]));}
function lightBlocks(){
 const media=css.match(/:root:not\(\[data-theme="dark"\]\)\s*\{([^}]*)\}/)[1];
 const pinned=css.match(/:root\[data-theme="light"\]\s*\{([^}]*)\}/)[1];
 return [tokens(media),tokens(pinned)];
}
const luminance=hex=>{const [r,g,b]=[1,3,5].map(i=>parseInt(hex.slice(i,i+2),16)/255).map(c=>c<=.03928?c/12.92:((c+.055)/1.055)**2.4);return .2126*r+.7152*g+.0722*b;};
const contrast=(a,b)=>{const [x,y]=[luminance(a),luminance(b)].sort((m,n)=>n-m);return (x+.05)/(y+.05);};
const over=(rgba,base)=>{const [r,g,b,a]=rgba.match(/[\d.]+/g).map(Number);return '#'+[r,g,b].map((c,i)=>Math.round(c*a+parseInt(base.slice(1+2*i,3+2*i),16)*(1-a)).toString(16).padStart(2,'0')).join('');};

test('both light-theme token blocks are identical',()=>{
 const [media,pinned]=lightBlocks();assert.deepEqual(pinned,media);
});

test('light-theme text meets 4.5:1 on every surface it is drawn on',()=>{
 const [t]=lightBlocks(),surfaces=['bg','bg-raised','surface','surface-2'];
 const pairs=[...['text','text-2','muted','gold','gold-strong','warn','error'].flatMap(fg=>surfaces.map(bg=>[fg,t[bg]]) ),
  ['ok',t.surface],['warn',over(t['warn-soft'],t.surface)],['error',over(t['error-soft'],t.surface)],
  ['gold-strong',over(t['gold-soft'],t.surface)],['on-gold',t.gold]];
 for(const [fg,bg] of pairs){const ratio=contrast(t[fg],bg);assert.ok(ratio>=4.5,`${fg} on ${bg}: ${ratio.toFixed(2)}`);}
});

test('ungrouped nodes stay dimmed when individual nodes are highlighted',()=>{
 const doc=structuredClone(biology);
 doc.entities.push({id:'loose-a',name:'Loose A',kind:'protein',compartmentId:null,position:{x:700,y:200}},
  {id:'loose-b',name:'Loose B',kind:'protein',compartmentId:null,position:{x:800,y:200}});
 doc.presentation.push({id:'loose-focus',title:'Loose focus',durationSec:2,domainAt:1,highlight:{nodeIds:['loose-a']}});
 const result=loadDocument(doc);assert.equal(result.valid,true,JSON.stringify(result.errors));
 const {graph}=result;assert.equal(graph.nodes.find(n=>n.id==='loose-b').groupId,null);
 const frame=Math.round(doc.presentation.slice(0,-1).reduce((sum,s)=>sum+s.durationSec,0)*24)+24;
 const state=directorFrameAt(graph,layoutGraph(graph),frame);
 assert.deepEqual(state.highlight,{nodeIds:['loose-a'],edgeIds:[],groupId:null});
 const node=id=>state.view.nodes.find(n=>n.id===id);
 assert.equal(shotAttention(node('loose-a'),state.highlight,state.view),1);
 assert.ok(shotAttention(node('loose-b'),state.highlight,state.view)<1,'unselected ungrouped node must be dimmed');
 // A highlighted group still lights its own members.
 const cytoplasm=state.view.nodes.find(n=>n.groupId==='cytoplasm');
 if(cytoplasm)assert.equal(shotAttention(cytoplasm,{nodeIds:[],edgeIds:[],groupId:'cytoplasm'},state.view),1);
});
