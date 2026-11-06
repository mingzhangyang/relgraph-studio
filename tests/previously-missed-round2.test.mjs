import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {validateVisualGraph,sceneAtSecond,frameStateAt} from '../src/graph/core.mjs';
import {validateRelGraph,visibleStory} from '../src/relgraph.mjs';
import {validateBiologyDocument,adaptBiologyDocument} from '../src/domains/biology.mjs';
import biology from '../examples/biology-signaling-synthetic.json' with {type:'json'};

const graph={
  domain:'literature',
  meta:{title:'Test'},
  nodes:[{id:'person-a',label:'A',kind:'person'}],
  edges:[],groups:[],
  scenes:[{id:'shot',title:'Scene',durationSec:1}]
};

test('visual graph rejects missing required display labels and kinds',()=>{
 const cases=[
  [{...graph,nodes:[{id:'person-a',label:'A'}]},'NODE_KIND','nodes[0].kind'],
  [{...graph,nodes:[{id:'person-a',label:'  ',kind:'person'}]},'LABEL','nodes[0].label'],
  [{...graph,edges:[{id:'link',source:'person-a',target:'person-a'}]},'EDGE_KIND','edges[0].kind'],
  [{...graph,groups:[{id:'group-a',kind:'faction'}]},'GROUP_LABEL','groups[0].label'],
  [{...graph,groups:[{id:'group-a',label:'Group'}]},'GROUP_KIND','groups[0].kind'],
  [{...graph,scenes:[{id:'shot',durationSec:1}]},'SCENE_TITLE','scenes[0].title'],
 ];
 for(const [value,code,path] of cases){
  const errors=validateVisualGraph(value).errors;
  assert.ok(errors.some(error=>error.code===code&&error.path===path&&error.fix),code);
 }
 assert.equal(validateVisualGraph(graph).valid,true);
});

test('biology source validation requires compartment names and scene titles',()=>{
 const doc=structuredClone(biology);
 doc.compartments[0].name='';
 delete doc.presentation[0].title;
 const errors=validateBiologyDocument(doc).errors;
 assert.ok(errors.some(e=>e.code==='COMPARTMENT_NAME'&&e.fix));
 assert.ok(errors.some(e=>e.code==='SCENE_TITLE'&&e.fix));
 assert.throws(()=>adaptBiologyDocument(doc),e=>e.issues?.some(issue=>issue.code==='COMPARTMENT_NAME'));
});

test('302 fractional scenes retain exact frame boundary after cumulative timing',()=>{
 const scenes=Array.from({length:302},(_,i)=>({id:'shot-'+i,title:'Scene '+i,durationSec:.1,domainAt:i}));
 const doc={...graph,scenes};
 assert.equal(sceneAtSecond(doc,30).index,300);
 assert.equal(sceneAtSecond(doc,30).elapsedSec,0);
 const frame=frameStateAt(doc,900,30);
 assert.equal(frame.playback.index,300);
 assert.equal(frame.playback.domainAt,300);
 assert.equal(frame.playback.progress,0);
 assert.equal(sceneAtSecond(doc,30.1).index,301);
});

test('spoiler-safe chapter hides death status and future arc without changing source',()=>{
 const doc={schemaVersion:'0.1',meta:{title:'Story'},characters:[
   {id:'person-a',name:'A',importance:3,status:'deceased',bio:{summary:'A',arc:'Future revelation',fate:'Death in chapter 9'}},
   {id:'person-b',name:'B',importance:2,bio:{summary:'B'}}
  ],relations:[]};
 assert.equal(validateRelGraph(doc).valid,true);
 const before=structuredClone(doc);
 const safe=visibleStory(doc,4,true);
 assert.equal(safe.characters[0].status,'unknown');
 assert.equal(safe.characters[0].bio.arc,undefined);
 assert.equal(safe.characters[0].bio.fate,undefined);
 assert.equal(JSON.stringify(safe).includes('Death in chapter 9'),false);
 assert.equal(visibleStory(doc,4,false).characters[0].status,'deceased');
 assert.deepEqual(doc,before);
});

test('canvas exposes accessible transcript and updated current-scene text',()=>{
 const html=readFileSync(new URL('../demo/standalone.html',import.meta.url),'utf8');
 assert.ok(html.includes('aria-describedby="sceneDescription"'));
 assert.ok(html.includes('id="sceneDescription" role="status" aria-live="polite"'));
 assert.ok(html.includes('id="accessibleGraphTranscript"'));
 assert.ok(html.includes("addList('分镜字幕',SHOTS.map"));
 assert.ok(html.includes("addList('人物与所属群体',data.people.map"));
 assert.ok(html.includes("addList('人物关系',data.relations.map"));
 assert.ok(html.includes("if(shot.id!==announcedSceneId)"));
 assert.ok(html.includes('makeAccessibleTranscript(data);makeShotList();setFrame(0);'));
});
