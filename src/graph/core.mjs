/** Renderer-neutral, deterministic graph contract. Domain facts remain in source documents. */
// ':' is reserved for internal generated IDs; source-domain IDs must remain plain slugs.
const slug=/^[a-z0-9]+(?:[-:][a-z0-9]+)*$/;
const object=v=>v!==null&&typeof v==='object'&&!Array.isArray(v);
const finite=v=>typeof v==='number'&&Number.isFinite(v);
export function validateVisualGraph(graph){
 const errors=[],fail=(code,path,id,message,fix)=>errors.push({level:'error',layer:'graph',code,path,id:id||'',message,fix});
 if(!object(graph)||!object(graph.meta)||!['nodes','edges','groups','scenes'].every(k=>Array.isArray(graph[k]))){fail('STRUCTURE','$','','Expected meta, nodes, edges, groups and scenes','Pass data through a domain adapter.');return {valid:false,errors};}
 if(typeof graph.domain!=='string'||!graph.domain.trim())fail('GRAPH_DOMAIN','domain','','Graph domain must be a non-empty string','Provide a domain such as literature or biology.');
 if(typeof graph.meta.title!=='string'||!graph.meta.title.trim())fail('GRAPH_TITLE','meta.title','','Graph title must be a non-empty string','Provide a descriptive graph title.');
 const ids={};
 for(const kind of ['nodes','edges','groups','scenes']){
  ids[kind]=new Set();
  graph[kind].forEach((item,i)=>{
   if(!object(item)||typeof item.id!=='string'||!slug.test(item.id)){fail('ID',kind+'['+i+'].id',item?.id,'Invalid stable id','Use lowercase letters, numbers and hyphens.');return;}
   if(ids[kind].has(item.id))fail('DUPLICATE_ID',kind+'['+i+'].id',item.id,'Repeated id','Use a unique stable id in this collection.');
   ids[kind].add(item.id);
  });
 }
 function interval(v,path,id){if(v===undefined)return;if(!object(v)||(v.from!==undefined&&!finite(v.from))||(v.to!==undefined&&!finite(v.to))||(v.from!==undefined&&v.to!==undefined&&v.from>v.to))fail('INTERVAL',path,id,'Invalid visibility interval','Provide finite from <= to, or omit it.');}
 graph.nodes.forEach((n,i)=>{if(!object(n)||!n.id)return;
  if(typeof n.label!=='string'||!n.label.trim())fail('LABEL','nodes['+i+'].label',n.id,'Node label required','Provide a display label.');
  if(typeof n.kind!=='string'||!n.kind.trim())fail('NODE_KIND','nodes['+i+'].kind',n.id,'Node kind is required','Provide a non-empty node kind.');
  if(n.groupId&&!ids.groups.has(n.groupId))fail('GROUP_REF','nodes['+i+'].groupId',n.id,'Missing group','Use an existing group id.');
  if(n.position&&(!finite(n.position.x)||!finite(n.position.y)))fail('POSITION','nodes['+i+'].position',n.id,'Invalid coordinates','Use finite numbers.');
  interval(n.visibility,'nodes['+i+'].visibility',n.id);
 });
 graph.groups.forEach((g,i)=>{if(!object(g)||!g.id)return;
  if(typeof g.label!=='string'||!g.label.trim())fail('GROUP_LABEL','groups['+i+'].label',g.id,'Group label is required','Provide a non-empty group name.');
  if(typeof g.kind!=='string'||!g.kind.trim())fail('GROUP_KIND','groups['+i+'].kind',g.id,'Group kind is required','Provide a non-empty group kind.');
 });
 graph.edges.forEach((e,i)=>{if(!object(e)||!e.id)return;
  if(typeof e.kind!=='string'||!e.kind.trim())fail('EDGE_KIND','edges['+i+'].kind',e.id,'Edge kind is required','Provide a non-empty relationship kind.');
  if(!ids.nodes.has(e.source)||!ids.nodes.has(e.target))fail('EDGE_REF','edges['+i+']',e.id,'Missing source/target','Reference existing node ids.');
  if(e.source===e.target)fail('SELF_LOOP','edges['+i+']',e.id,'Self loop forbidden','Model state transition as a process.');
  interval(e.visibility,'edges['+i+'].visibility',e.id);
 });
 graph.scenes.forEach((s,i)=>{if(!object(s)||!s.id)return;const path='scenes['+i+']';
  if(typeof s.title!=='string'||!s.title.trim())fail('SCENE_TITLE',path+'.title',s.id,'Scene title is required','Provide a non-empty scene title.');
  if(!finite(s.durationSec)||s.durationSec<=0)fail('DURATION',path+'.durationSec',s.id,'Invalid duration','Use positive seconds.');
  if(s.transitionMs!==undefined&&(!finite(s.transitionMs)||s.transitionMs<0))fail('TRANSITION',path+'.transitionMs',s.id,'Invalid transition','Use nonnegative milliseconds.');
  if(s.domainAt!==undefined&&!finite(s.domainAt))fail('DOMAIN_TIME',path+'.domainAt',s.id,'Invalid domain time','Use finite domain time, separate from playback seconds.');
  if(s.camera!==undefined&&!object(s.camera))fail('SCENE_OBJECT_TYPE',path+'.camera',s.id,'camera must be an object','Provide camera object or omit it.');
   if(s.camera?.zoom!==undefined&&(!finite(s.camera.zoom)||s.camera.zoom<=0))fail('CAMERA_ZOOM',path+'.camera.zoom',s.id,'Camera zoom must be a positive finite number','Provide a finite positive number or omit zoom.');
  if(s.highlight!==undefined&&!object(s.highlight))fail('SCENE_OBJECT_TYPE',path+'.highlight',s.id,'highlight must be an object','Provide highlight object or omit it.');
  if(s.camera?.focusNodeId&&Array.isArray(s.camera.fitIds)&&s.camera.fitIds.length)fail('CAMERA_CONFLICT',path+'.camera',s.id,'Conflicting camera targets','Choose focusNodeId or fitIds.');
  for(const [v,set,field] of [[s.camera?.focusNodeId,ids.nodes,'camera.focusNodeId'],[s.openDetailNodeId,ids.nodes,'openDetailNodeId'],[s.highlight?.groupId,ids.groups,'highlight.groupId']])if(v&&!set.has(v))fail('SCENE_REF',path+'.'+field,s.id,'Unknown '+v,'Use an existing id.');
  for(const [arr,set,field] of [[s.camera?.fitIds,ids.nodes,'camera.fitIds'],[s.highlight?.nodeIds,ids.nodes,'highlight.nodeIds'],[s.highlight?.edgeIds,ids.edges,'highlight.edgeIds']]){
    if(arr===undefined)continue;
    if(!Array.isArray(arr)){fail('SCENE_LIST_TYPE',path+'.'+field,s.id,field+' must be an array','Provide an array of valid IDs or omit it.');continue;}
    arr.forEach((v,j)=>{if(!set.has(v))fail('SCENE_REF',path+'.'+field+'['+j+']',s.id,'Unknown '+v,'Use an existing id.');});
  }
 });
 return {valid:errors.length===0,errors};
}
const shown=(v,at)=>at===null||at===undefined||(v.visibility?.from??-Infinity)<=at&&(v.visibility?.to??Infinity)>=at;
/** Hidden groups and edges never leak future plot nodes. Does not mutate source. */
export function projectVisualGraph(graph,domainAt=null){
 const nodes=graph.nodes.filter(n=>shown(n,domainAt)),ids=new Set(nodes.map(n=>n.id));
 const edges=graph.edges.filter(e=>ids.has(e.source)&&ids.has(e.target)&&shown(e,domainAt));
 const used=new Set(nodes.map(n=>n.groupId).filter(Boolean));
 return {domain:graph.domain,meta:{...graph.meta},timeline:graph.timeline?{...graph.timeline}:undefined,nodes,edges,groups:graph.groups.filter(g=>used.has(g.id))};
}
/** Absolute-time scene evaluation; deterministic for any arbitrary video frame. */
export function sceneAtSecond(graph,second){
 const scenes=graph.scenes;
 // Compensated prefix sums prevent cumulative drift across hundreds of decimal scenes.
 let totalSec=0,correction=0;
 const ends=scenes.map(scene=>{
  const adjusted=scene.durationSec-correction;
  const next=totalSec+adjusted;
  correction=(next-totalSec)-adjusted;
  totalSec=next;
  return totalSec;
 });
 if(!scenes.length)return {scene:null,index:-1,elapsedSec:0,progress:0,domainAt:null,totalSec:0,startSec:0};
 const time=Math.max(0,Math.min(finite(second)?second:0,totalSec));
 let start=0,domainAt=null;
 for(let i=0;i<scenes.length;i++){const s=scenes[i];if(s.domainAt!==undefined)domainAt=s.domainAt;const end=ends[i];
  // Decimal arithmetic can represent the 0.3s boundary as 0.30000000000000004.
   const tolerance=8*Number.EPSILON*Math.max(1,Math.abs(time),Math.abs(end));
   if(time<end-tolerance||i===scenes.length-1){
    const elapsedSec=Math.max(0,Math.min(s.durationSec,time-start));
    return {scene:s,index:i,elapsedSec,progress:Math.max(0,Math.min(1,elapsedSec/s.durationSec)),domainAt,totalSec,startSec:start};
   }
  start=end;
 }
}
export function frameStateAt(graph,frame,fps=24){
 if(!Number.isInteger(frame)||frame<0||!finite(fps)||fps<=0)throw new RangeError('Invalid frame or fps');
 const playback=sceneAtSecond(graph,frame/fps),view=projectVisualGraph(graph,playback.domainAt),s=playback.scene;
 if(!s)return {playback,view,overlay:null,highlight:{nodeIds:[],edgeIds:[],groupId:null},camera:{}};
 const ns=new Set(view.nodes.map(n=>n.id)),es=new Set(view.edges.map(e=>e.id)),gs=new Set(view.groups.map(g=>g.id));
 const only=(xs,set)=>(Array.isArray(xs)?xs:[]).filter(id=>set.has(id)),camera=s.camera&&object(s.camera)?{...s.camera}:{};
 if(camera.focusNodeId&&!ns.has(camera.focusNodeId))delete camera.focusNodeId;
 if(camera.fitIds)camera.fitIds=only(camera.fitIds,ns);
 return {playback,view,camera,highlight:{nodeIds:only(s.highlight?.nodeIds,ns),edgeIds:only(s.highlight?.edgeIds,es),groupId:gs.has(s.highlight?.groupId)?s.highlight.groupId:null},overlay:s.openDetailNodeId&&ns.has(s.openDetailNodeId)?{nodeId:s.openDetailNodeId}:null};
}
