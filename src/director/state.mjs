import {frameStateAt} from '../graph/core.mjs';

const clamp=(n,min=0,max=1)=>Math.max(min,Math.min(max,n));
const ease=t=>{const x=clamp(t);return x*x*(3-2*x);};
const mix=(a,b,t)=>a+(b-a)*t;

function cameraFor(view, spec, positions, highlight) {
  const visible=new Set(view.nodes.map(node=>node.id));
  const requested=spec.focusNodeId?[spec.focusNodeId]:(spec.fitIds||[]);
  const selected=requested.filter(id=>visible.has(id));
  const ids=selected.length?selected:view.nodes.map(node=>node.id);
  const points=ids.map(id=>positions.get(id)).filter(Boolean);
  if (!points.length) return {x:0,y:0,scale:1};
  const minX=Math.min(...points.map(p=>p.x)),maxX=Math.max(...points.map(p=>p.x));
  const minY=Math.min(...points.map(p=>p.y)),maxY=Math.max(...points.map(p=>p.y));
  // Graph area is between the fixed title and subtitle bands of a 1280x720 frame.
  // Single-node shots include context instead of zooming into a microscopic point.
  const width=Math.max(selected.length===1?700:280,maxX-minX+250);
  const height=Math.max(selected.length===1?450:220,maxY-minY+180);
  const x=(minX+maxX)/2,y=(minY+maxY)/2;
  let scale=Math.min(1100/width,390/height)*(spec.zoom||1);
  // A focus shot should not clip other explicitly highlighted nodes. Preserve
  // its center and reduce zoom only as much as the safe area requires.
  if(spec.focusNodeId&&selected.length){
    const focused=(highlight?.nodeIds||[]).filter(id=>visible.has(id)).map(id=>positions.get(id)).filter(Boolean);
    if(focused.length){
      const dx=Math.max(...focused.map(p=>Math.abs(p.x-x))),dy=Math.max(...focused.map(p=>Math.abs(p.y-y)));
      scale=Math.min(scale,1100/(2*dx+160),390/(2*dy+140));
    }
  }
  return {x,y,scale:clamp(scale,0.15,1.6)};
}

/** All transition values come from the requested frame, never previous draws. */
export function directorFrameAt(graph,positions,frame,fps=24) {
  const state=frameStateAt(graph,frame,fps);
  const {playback,view}=state;
  const target=cameraFor(view,state.camera,positions,state.highlight);
  let camera=target,transition=1,previousHighlight={nodeIds:[],edgeIds:[],groupId:null};
  if (playback.index>0) {
    // Restrict even the previous target to the current view: backward domain
    // jumps cannot aim a camera at a now-hidden future object.
    const previousFrame=Math.max(0,Math.ceil(playback.startSec*fps)-1);
    const previous=frameStateAt(graph,previousFrame,fps);
    const nodeIds=new Set(view.nodes.map(node=>node.id)),edgeIds=new Set(view.edges.map(edge=>edge.id)),groupIds=new Set(view.groups.map(group=>group.id));
    previousHighlight={nodeIds:previous.highlight.nodeIds.filter(id=>nodeIds.has(id)),edgeIds:previous.highlight.edgeIds.filter(id=>edgeIds.has(id)),groupId:groupIds.has(previous.highlight.groupId)?previous.highlight.groupId:null};
    const previousView={...previous.view,nodes:previous.view.nodes.filter(node=>nodeIds.has(node.id)),edges:previous.view.edges.filter(edge=>edgeIds.has(edge.id)),groups:previous.view.groups.filter(group=>groupIds.has(group.id))};
    const from=cameraFor(previousView,previous.camera,positions,previousHighlight);
    const duration=Math.min((playback.scene?.transitionMs??1200)/1000,playback.scene.durationSec);
    transition=duration<=0?1:ease(playback.elapsedSec/duration);
    camera={x:mix(from.x,target.x,transition),y:mix(from.y,target.y,transition),scale:mix(from.scale,target.scale,transition)};
  }
  return {...state,cameraResolved:camera,transition,previousHighlight};
}

export function frameCount(graph,fps=24) {
  return Math.max(1,Math.ceil(graph.scenes.reduce((sum,scene)=>sum+scene.durationSec,0)*fps-1e-9));
}
