/** Experimental biological domain adapter, NOT PSI-MI / SBML / SBGN-ML compliant. */
import {validateVisualGraph} from '../graph/core.ts';
const slug=/^[a-z0-9]+(?:-[a-z0-9]+)*$/;
const object=v=>v!==null&&typeof v==='object'&&!Array.isArray(v);
const finite=v=>typeof v==='number'&&Number.isFinite(v);
const entityKinds=new Set(['protein','protein-state','complex','small-molecule','gene']);
const interactionKinds=new Set(['physical-association','activity-influence','activation','inhibition']);
const processKinds=new Set(['biochemical-reaction','phosphorylation','dephosphorylation','association','dissociation']);
const evidenceStatuses=new Set(['curated','hypothesis','illustrative']);
const modifierKinds=new Set(['catalyst','activator','inhibitor']);
export function validateBiologyDocument(doc){
 const errors=[],fail=(code,path,id,message,fix)=>errors.push({level:'error',layer:'biology',code,path,id:id||'',message,fix});
 if(!object(doc)||doc.format!=='relgraph.bio/0.1-draft'||!object(doc.meta)||typeof doc.meta.title!=='string'||!['entities','interactions','processes','compartments'].every(k=>Array.isArray(doc[k]))||(doc.presentation!==undefined&&!Array.isArray(doc.presentation))){
  fail('STRUCTURE','$','','Missing biological document fields','Use format relgraph.bio/0.1-draft with meta, entities, interactions, processes and compartments arrays.');return {valid:false,errors,warnings:[]};
 }
 const sets={},globalIds=new Set();
 for(const key of ['entities','interactions','processes','compartments','presentation']){
  sets[key]=new Set();
  (doc[key]||[]).forEach((o,i)=>{
   if(!object(o)||typeof o.id!=='string'||!slug.test(o.id)){fail('ID',key+'['+i+'].id',o?.id,'Invalid id','Use lowercase ASCII slugs.');return;}
   if(sets[key].has(o.id))fail('DUPLICATE_ID',key+'['+i+'].id',o.id,'Duplicate id','Use a unique stable id.');
   sets[key].add(o.id);
   if(key!=='presentation'){if(globalIds.has(o.id))fail('CROSS_KIND_ID',key+'['+i+'].id',o.id,'Id used by another biological object','Use unique ids across biological objects.');globalIds.add(o.id);}
  });
 }
 if(!doc.entities.length)fail('EMPTY','entities','','At least one entity required','Add one entity.');
 const reference=(id,path,owner)=>{if(!sets.entities.has(id))fail('UNKNOWN_ENTITY',path,owner,'Unknown entity: '+id,'Use an existing entity id.');};
 const interval=(from,to,path,id)=>{if((from!==undefined&&!finite(from))||(to!==undefined&&!finite(to))||(from!==undefined&&to!==undefined&&from>to))fail('INTERVAL',path,id,'Invalid domain interval','Use finite from <= to.');};
 const evidence=(rec,path)=>{
  if(!evidenceStatuses.has(rec.evidenceStatus))fail('EVIDENCE_STATUS',path+'.evidenceStatus',rec.id,'Missing or invalid evidence status','Use curated, hypothesis or illustrative.');
  if(rec.evidenceStatus==='curated'&&(!Array.isArray(rec.evidence)||!rec.evidence.length))fail('EVIDENCE_REQUIRED',path+'.evidence',rec.id,'Curated claim needs sources','Provide verifiable source records and identifiers.');
  if(rec.evidence!==undefined&&!Array.isArray(rec.evidence))fail('EVIDENCE_REF',path+'.evidence',rec.id,'Expected evidence array','Use an array of source records.');
  (Array.isArray(rec.evidence)?rec.evidence:[]).forEach((ev,i)=>{
   if(!object(ev)||typeof ev.source!=='string'||!ev.source.trim()||typeof ev.recordId!=='string'||!ev.recordId.trim())fail('EVIDENCE_REF',path+'.evidence['+i+']',rec.id,'Evidence requires source and recordId','Use traceable database or article identifiers.');
  });
 };
 doc.compartments.forEach((c,i)=>{
  if(!object(c)||typeof c.name!=='string'||!c.name.trim())
   fail('COMPARTMENT_NAME','compartments['+i+'].name',c?.id,'Compartment name is required','Provide a non-empty compartment name.');
  if(object(c)&&c.color!==undefined&&(typeof c.color!=='string'||!/^#[0-9a-f]{6}$/i.test(c.color)))
   fail('COLOR','compartments['+i+'].color',c.id,'Invalid color','Use a #RRGGBB color.');
 });
 const visual=(o,path)=>{
  if(o.position!==undefined&&(!object(o.position)||!finite(o.position.x)||!finite(o.position.y)))fail('POSITION',path+'.position',o.id,'Invalid position','Use finite coordinates.');
  if(o.color!==undefined&&(typeof o.color!=='string'||!/^#[0-9a-f]{6}$/i.test(o.color)))fail('COLOR',path+'.color',o.id,'Invalid color','Use a #RRGGBB color.');
  if(o.importance!==undefined&&(!finite(o.importance)||o.importance<1||o.importance>5))fail('IMPORTANCE',path+'.importance',o.id,'Invalid node importance','Use a number from 1 to 5.');
 };
 doc.entities.forEach((e,i)=>{
  const path='entities['+i+']';if(!object(e)){fail('ENTITY',path,'','Expected object','Provide an entity.');return;}
  if(!entityKinds.has(e.kind))fail('ENTITY_KIND',path+'.kind',e.id,'Unsupported entity kind','Use protein, protein-state, complex, small-molecule or gene.');
  if(typeof e.name!=='string'||!e.name)fail('ENTITY_NAME',path+'.name',e.id,'Missing name','Provide a display name.');
  if(e.compartmentId&&!sets.compartments.has(e.compartmentId))fail('COMPARTMENT_REF',path+'.compartmentId',e.id,'Missing compartment','Use a defined compartment.');
  visual(e,path);
  interval(e.visibleFrom,e.visibleTo,path+'.visibility',e.id);
 });
 doc.interactions.forEach((r,i)=>{
  const path='interactions['+i+']';if(!object(r)){fail('INTERACTION',path,'','Expected object','Provide an interaction.');return;}
  reference(r.source,path+'.source',r.id);reference(r.target,path+'.target',r.id);
  if(r.source===r.target)fail('SELF_LOOP',path,r.id,'Self loop is not a binary interaction','Represent state changes as processes.');
  if(!interactionKinds.has(r.kind))fail('INTERACTION_KIND',path+'.kind',r.id,'Invalid interaction kind','Distinguish physical association from functional influence.');
  evidence(r,path);interval(r.visibleFrom,r.visibleTo,path+'.visibility',r.id);
 });
 doc.processes.forEach((p,i)=>{
  const path='processes['+i+']';if(!object(p)){fail('PROCESS',path,'','Expected object','Provide a process.');return;}
  if(!processKinds.has(p.kind))fail('PROCESS_KIND',path+'.kind',p.id,'Invalid process kind','Use a supported biochemical process.');
  visual(p,path);
  if(!Array.isArray(p.reactants)||!p.reactants.length||!Array.isArray(p.products)||!p.products.length||(p.modifiers!==undefined&&!Array.isArray(p.modifiers)))fail('PARTICIPANTS',path,p.id,'Process needs reactants and products','Provide input/output participants and optional modifiers.');
  if(p.compartmentId&&!sets.compartments.has(p.compartmentId))fail('COMPARTMENT_REF',path+'.compartmentId',p.id,'Missing compartment','Use a defined compartment.');
  for(const [kind,parts] of [['reactants',p.reactants],['products',p.products],['modifiers',p.modifiers]]){
   const seen=new Set();
   for(const [j,part] of (Array.isArray(parts)?parts:[]).entries()){
    const loc=path+'.'+kind+'['+j+']';if(!object(part)){fail('PARTICIPANT',loc,p.id,'Expected participant','Provide an entityId and optional stoichiometry.');continue;}
    reference(part.entityId,loc+'.entityId',p.id);
    if(seen.has(part.entityId))fail('DUPLICATE_PARTICIPANT',loc,p.id,'Duplicate participant role','Merge participants with stoichiometry.');seen.add(part.entityId);
    if(part.stoichiometry!==undefined&&(!finite(part.stoichiometry)||part.stoichiometry<=0))fail('STOICHIOMETRY',loc+'.stoichiometry',p.id,'Must be positive','Use a positive number.');
    if(kind==='modifiers'&&!modifierKinds.has(part.role))fail('MODIFIER_ROLE',loc+'.role',p.id,'Unsupported modifier role','Use catalyst, activator or inhibitor.');
   }
  }
  evidence(p,path);interval(p.visibleFrom,p.visibleTo,path+'.visibility',p.id);
 });
 (doc.presentation||[]).forEach((scene,i)=>{
   const path='presentation['+i+']';
   if(!object(scene)||!finite(scene.durationSec)||scene.durationSec<=0)fail('DURATION',path+'.durationSec',scene?.id,'Invalid duration','Provide positive seconds.');
   if(!object(scene))return;
   if(typeof scene.title!=='string'||!scene.title.trim())fail('SCENE_TITLE',path+'.title',scene.id,'Scene title is required','Provide a non-empty presentation title.');
   if(object(scene.camera)&&scene.camera.zoom!==undefined&&(!finite(scene.camera.zoom)||scene.camera.zoom<=0))
    fail('CAMERA_ZOOM',path+'.camera.zoom',scene.id,'Camera zoom must be a positive finite number','Provide a finite positive number or omit zoom.');
   for(const [field,keys] of [['camera',['fitIds']],['highlight',['nodeIds','edgeIds']]]){
    const config=scene[field];
    if(config===undefined)continue;
    if(!object(config)){fail('SCENE_OBJECT_TYPE',path+'.'+field,scene.id,field+' must be an object','Supply an object or omit it.');continue;}
    for(const key of keys)if(config[key]!==undefined&&!Array.isArray(config[key]))
     fail('SCENE_LIST_TYPE',path+'.'+field+'.'+key,scene.id,key+' must be an array','Use an array of IDs or omit it.');
   }
  });
 return {valid:errors.length===0,errors,warnings:[]};
}
/** Reactions are explicit nodes with participant arcs, not invented binary PPIs. */
export function adaptBiologyDocument(doc){
 const diagnostics=validateBiologyDocument(doc);
 if(!diagnostics.valid)throw Object.assign(new Error('Invalid biological document'),{issues:diagnostics.errors});
 const windowFor=o=>o.visibleFrom!==undefined||o.visibleTo!==undefined?{from:o.visibleFrom,to:o.visibleTo}:undefined;
 const processAlias=new Map(doc.processes.map(p=>['process-'+p.id,'bio:process:'+p.id]));
 const entityIds=new Set(doc.entities.map(e=>e.id));
 const interactionIds=new Set(doc.interactions.map(r=>r.id));
 const edgeAlias=new Map();
 const nodeRef=id=>entityIds.has(id)?id:(processAlias.get(id)??id);
 const edgeRef=id=>interactionIds.has(id)?id:(edgeAlias.get(id)??id);
 const nodes=doc.entities.map(e=>({id:e.id,label:e.name,kind:e.kind,groupId:e.compartmentId,importance:e.importance,color:e.color,position:e.position?{...e.position}:undefined,visibility:windowFor(e)}));
 const edges=doc.interactions.map(r=>({id:r.id,source:r.source,target:r.target,kind:r.kind,label:r.label||r.kind,directed:r.kind!=='physical-association',visibility:windowFor(r)}));
 for(const p of doc.processes){
  const id='bio:process:'+p.id;
  nodes.push({id,label:p.label||p.kind,kind:'reaction',groupId:p.compartmentId,importance:p.importance,color:p.color,position:p.position?{...p.position}:undefined,visibility:windowFor(p)});
  for(const part of p.reactants){const alias=p.id+'-input-'+part.entityId;const edgeId='bio:arc:input:'+p.id+':'+part.entityId;edgeAlias.set(alias,edgeAlias.has(alias)?null:edgeId);edges.push({id:edgeId,source:part.entityId,target:id,kind:'consumption',directed:true,label:part.stoichiometry===undefined?undefined:String(part.stoichiometry)});}
  for(const part of p.products){const alias=p.id+'-output-'+part.entityId;const edgeId='bio:arc:output:'+p.id+':'+part.entityId;edgeAlias.set(alias,edgeAlias.has(alias)?null:edgeId);edges.push({id:edgeId,source:id,target:part.entityId,kind:'production',directed:true,label:part.stoichiometry===undefined?undefined:String(part.stoichiometry)});}
  for(const part of p.modifiers||[]){const alias=p.id+'-modifier-'+part.entityId;const edgeId='bio:arc:modifier:'+p.id+':'+part.entityId;edgeAlias.set(alias,edgeAlias.has(alias)?null:edgeId);edges.push({id:edgeId,source:part.entityId,target:id,kind:part.role,directed:true});}
 }
 const graph={domain:'biology',meta:{title:doc.meta.title,description:doc.meta.description,sourceNote:doc.meta.sourceNote},timeline:doc.timeline?{...doc.timeline}:undefined,
  groups:doc.compartments.map(c=>({id:c.id,label:c.name,kind:'compartment',color:c.color})),nodes,edges,
  scenes:(doc.presentation||[]).map(s=>({id:s.id,title:s.title,narration:s.narration,durationSec:s.durationSec,transitionMs:s.transitionMs,domainAt:s.domainAt,camera:s.camera?{...s.camera,focusNodeId:s.camera.focusNodeId===undefined?undefined:nodeRef(s.camera.focusNodeId),fitIds:s.camera.fitIds?.map(nodeRef)}:undefined,highlight:s.highlight?{...s.highlight,nodeIds:s.highlight.nodeIds?.map(nodeRef),edgeIds:s.highlight.edgeIds?.map(edgeRef)}:undefined,openDetailNodeId:s.openDetailNodeId===undefined?undefined:nodeRef(s.openDetailNodeId)}))};
 const check=validateVisualGraph(graph);if(!check.valid)throw Object.assign(new Error('Biological projection invalid'),{issues:check.errors});
 return {graph,diagnostics};
}
