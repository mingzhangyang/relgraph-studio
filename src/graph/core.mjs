/** Renderer-neutral, deterministic graph contract. Domain facts remain in source documents. */
const slug=/^[a-z0-9]+(?:-[a-z0-9]+)*$/;
const object=v=>v!==null&&typeof v==='object'&&!Array.isArray(v);
const finite=v=>typeof v==='number'&&Number.isFinite(v);
export function validateVisualGraph(graph){
 const errors=[],fail=(code,path,id,message,fix)=>errors.push({level:'error',layer:'graph',code,path,id:id||'',message,fix});
 if(!object(graph)||!object(graph.meta)||!['nodes','edges','groups','scenes'].every(k=>Array.isArray(graph[k]))){fail('STRUCTURE','$','','Expected meta, nodes, edges, groups and scenes','Pass data through a domain adapter.');return {valid:false,errors};}
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
  if(typeof n.label!=='string'||!n.label)fail('LABEL','nodes['+i+'].label',n.id,'Node label required','Provide a display label.');
  if(n.groupId&&!ids.groups.has(n.groupId))fail('GROUP_REF','nodes['+i+'].groupId',n.id,'Missing group','Use an existing group id.');
  if(n.position&&(!finite(n.position.x)||!finite(n.position.y)))fail('POSITION','nodes['+i+'].position',n.id,'Invalid coordinates','Use finite numbers.');
  interval(n.visibility,'nodes['+i+'].visibility',n.id);
 });
 graph.edges.forEach((e,i)=>{if(!object(e)||!e.id)return;
  if(!ids.nodes.has(e.source)||!ids.nodes.has(e.target))fail('EDGE_REF','edges['+i+']',e.id,'Missing source/target','Reference existing node ids.');
  if(e.source===e.target)fail('SELF_LOOP','edges['+i+']',e.id,'Self loop forbidden','Model state transition as a process.');
  interval(e.visibility,'edges['+i+'].visibility',e.id);
 });
 graph.scenes.forEach((s,i)=>{if(!object(s)||!s.id)return;const path='scenes['+i+']';
  if(!finite(s.durationSec)||s.durationSec<=0)fail('DURATION',path+'.durationSec',s.id,'Invalid duration','Use positive seconds.');
  if(s.transitionMs!==undefined&&(!finite(s.transitionMs)||s.transitionMs<0))fail('TRANSITION',path+'.transitionMs',s.id,'Invalid transition','Use nonnegative milliseconds.');
  if(s.domainAt!==undefined&&!finite(s.domainAt))fail('DOMAIN_TIME',path+'.domainAt',s.id,'Invalid domain time','Use finite domain time, separate from playback seconds.');
  if(s.camera?.focusNodeId&&s.camera?.fitIds?.length)fail('CAMERA_CONFLICT',path+'.camera',s.id,'Conflicting camera targets','Choose focusNodeId or fitIds.');
  for(const [v,set,field] of [[s.camera?.focusNodeId,ids.nodes,'camera.focusNodeId'],[s.openDetailNodeId,ids.nodes,'openDetailNodeId'],[s.highlight?.groupId,ids.groups,'highlight.groupId']])if(v&&!set.has(v))fail('SCENE_REF',path+'.'+field,s.id,'Unknown '+v,'Use an existing id.');
  for(const [arr,set,field] of [[s.camera?.fitIds||[],ids.nodes,'camera.fitIds'],[s.highlight?.nodeIds||[],ids.nodes,'highlight.nodeIds'],[s.highlight?.edgeIds||[],ids.edges,'highlight.edgeIds']])arr.forEach((v,j)=>{if(!set.has(v))fail('SCENE_REF',path+'.'+field+'['+j+']',s.id,'Unknown '+v,'Use an existing id.');});
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
 const scenes=graph.scenes,totalSec=scenes.reduce((n,s)=>n+s.durationSec,0);
 if(!scenes.length)return {scene:null,index:-1,elapsedSec:0,progress:0,domainAt:null,totalSec:0,startSec:0};
 const time=Math.max(0,Math.min(finite(second)?second:0,totalSec));
 let start=0,domainAt=null;
 for(let i=0;i<scenes.length;i++){const s=scenes[i];if(s.domainAt!==undefined)domainAt=s.domainAt;const end=start+s.durationSec;
  if(time<end||i===scenes.length-1)return {scene:s,index:i,elapsedSec:time-start,progress:Math.max(0,Math.min(1,(time-start)/s.durationSec)),domainAt,totalSec,startSec:start};
  start=end;
 }
}
export function frameStateAt(graph,frame,fps=24){
 if(!Number.isInteger(frame)||frame<0||!finite(fps)||fps<=0)throw new RangeError('Invalid frame or fps');
 const playback=sceneAtSecond(graph,frame/fps),view=projectVisualGraph(graph,playback.domainAt),s=playback.scene;
 if(!s)return {playback,view,overlay:null,highlight:{nodeIds:[],edgeIds:[],groupId:null},camera:{}};
 const ns=new Set(view.nodes.map(n=>n.id)),es=new Set(view.edges.map(e=>e.id)),gs=new Set(view.groups.map(g=>g.id));
 const only=(xs,set)=>(xs||[]).filter(id=>set.has(id)),camera=s.camera?{...s.camera}:{};
 if(camera.focusNodeId&&!ns.has(camera.focusNodeId))delete camera.focusNodeId;
 if(camera.fitIds)camera.fitIds=only(camera.fitIds,ns);
 return {playback,view,camera,highlight:{nodeIds:only(s.highlight?.nodeIds,ns),edgeIds:only(s.highlight?.edgeIds,es),groupId:gs.has(s.highlight?.groupId)?s.highlight.groupId:null},overlay:s.openDetailNodeId&&ns.has(s.openDetailNodeId)?{nodeId:s.openDetailNodeId}:null};
}
