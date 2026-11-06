import {directorFrameAt} from '../director/state.mjs';

export const VIDEO_WIDTH=1280, VIDEO_HEIGHT=720;
const sans='"Noto Sans CJK SC", "PingFang SC", system-ui, sans-serif';
const serif='"Noto Serif CJK SC", "Songti SC", Georgia, serif';
const clamp=(x,a,b)=>Math.min(b,Math.max(a,x));
const mix=(a,b,t)=>a+(b-a)*t;
const color=(value,fallback='#8aaeb1')=>typeof value==='string'&&/^#[0-9a-f]{6}$/i.test(value)?value:fallback;
const edgeNames={consumption:'输入',production:'产物',catalyst:'催化',activator:'促进',inhibitor:'抑制','physical-association':'物理结合','activity-influence':'功能调控',activation:'激活',inhibition:'抑制'};

function background(ctx) {
  const g=ctx.createLinearGradient(0,0,VIDEO_WIDTH,VIDEO_HEIGHT);
  g.addColorStop(0,'#090f19');g.addColorStop(.5,'#0c1924');g.addColorStop(1,'#0a111c');
  ctx.fillStyle=g;ctx.fillRect(0,0,VIDEO_WIDTH,VIDEO_HEIGHT);
  const warm=ctx.createRadialGradient(850,400,15,850,400,700);
  warm.addColorStop(0,'rgba(123,93,67,.14)');warm.addColorStop(1,'rgba(11,17,28,0)');
  ctx.fillStyle=warm;ctx.fillRect(0,0,VIDEO_WIDTH,VIDEO_HEIGHT);
  ctx.strokeStyle='rgba(226,218,191,.025)';ctx.lineWidth=.6;
  for(let i=0;i<30;i++){const x=i*53-80;ctx.beginPath();ctx.moveTo(x,0);ctx.lineTo(x+230,VIDEO_HEIGHT);ctx.stroke();}
}

function ellipseGlow(ctx,x,y,rx,ry,c,alpha) {
  ctx.save();ctx.translate(x,y);ctx.scale(Math.max(1,rx),Math.max(1,ry));
  const gradient=ctx.createRadialGradient(0,0,0,0,0,1);
  gradient.addColorStop(0,`${c}${Math.round(alpha*255).toString(16).padStart(2,'0')}`);
  gradient.addColorStop(1,`${c}00`);ctx.fillStyle=gradient;
  ctx.beginPath();ctx.arc(0,0,1,0,Math.PI*2);ctx.fill();ctx.restore();
}
function fitText(ctx,text,maxWidth) {
  const s=String(text||'');if(ctx.measureText(s).width<=maxWidth)return s;
  let result='';for(const ch of s){if(ctx.measureText(result+ch+'…').width>maxWidth)break;result+=ch;}return result+'…';
}
function wrapText(ctx,text,maxWidth,maxLines=2) {
  const lines=[];let line='';
  for (const ch of String(text||'')) {
    if(ch==='\n'||(line&&ctx.measureText(line+ch).width>maxWidth)){lines.push(line);line=ch==='\n'?'':ch;if(lines.length===maxLines)break;}
    else line+=ch;
  }
  if(lines.length<maxLines&&line)lines.push(line);
  if(lines.join('').length<String(text||'').replaceAll('\n','').length&&lines.length)lines[lines.length-1]=fitText(ctx,lines.at(-1)+'…',maxWidth);
  return lines;
}
function intersects(a,b){return a.x<b.x+b.w&&a.x+a.w>b.x&&a.y<b.y+b.h&&a.y+a.h>b.y;}
function shotAttention(item,highlight,view) {
  const ids=highlight.nodeIds,edges=highlight.edgeIds,group=highlight.groupId;
  const active=ids.length||edges.length||group;
  if(!active)return 1;
  if(item.source!==undefined) return edges.includes(item.id)||(group&&view.nodes.some(n=>n.id===item.source&&n.groupId===group)&&view.nodes.some(n=>n.id===item.target&&n.groupId===group))?1:.2;
  return ids.includes(item.id)||item.groupId===group||view.edges.some(edge=>edges.includes(edge.id)&&(edge.source===item.id||edge.target===item.id))?1:.24;
}
function radius(node,scale) {return clamp((node.kind==='reaction'?13:node.importance>=5?16:node.importance>=3?13:11)*Math.sqrt(scale),8,19);}

/** The renderer only consumes a VisualGraph, a static layout and an integer frame. */
export function createCanvasRenderer(canvas,graph,positions,{fps=24,detailAt=()=>undefined}={}) {
  const ctx=canvas.getContext('2d',{alpha:false,desynchronized:false});
  canvas.width=VIDEO_WIDTH;canvas.height=VIDEO_HEIGHT;
  function renderFrame(frame) {
    const state=directorFrameAt(graph,positions,frame,fps);
    const {view,playback,cameraResolved:cam,highlight,previousHighlight,transition}=state;
    const point=node=>{const p=positions.get(node.id);return {x:640+(p.x-cam.x)*cam.scale,y:330+(p.y-cam.y)*cam.scale};};
    const points=new Map(view.nodes.map(n=>[n.id,point(n)]));
    const groups=new Map(view.groups.map(g=>[g.id,g]));
    const attention=item=>mix(shotAttention(item,previousHighlight,view),shotAttention(item,highlight,view),transition);
    ctx.setTransform(1,0,0,1,0,0);ctx.globalAlpha=1;ctx.setLineDash([]);ctx.clearRect(0,0,VIDEO_WIDTH,VIDEO_HEIGHT);
    background(ctx);
    ctx.save();ctx.beginPath();ctx.rect(26,108,1228,434);ctx.clip();
    for (const group of view.groups) {
      const members=view.nodes.filter(n=>n.groupId===group.id).map(n=>points.get(n.id));if(!members.length)continue;
      const minX=Math.min(...members.map(p=>p.x)),maxX=Math.max(...members.map(p=>p.x));
      const minY=Math.min(...members.map(p=>p.y)),maxY=Math.max(...members.map(p=>p.y));
      const x=(minX+maxX)/2,y=(minY+maxY)/2,rx=Math.max(95,(maxX-minX)/2+75),ry=Math.max(72,(maxY-minY)/2+65),c=color(group.color);
      ellipseGlow(ctx,x,y,rx*1.35,ry*1.35,c,.11);
      ctx.save();ctx.strokeStyle=c+'38';ctx.lineWidth=1;ctx.setLineDash([4,9]);ctx.beginPath();ctx.ellipse(x,y,rx,ry,0,0,Math.PI*2);ctx.stroke();ctx.setLineDash([]);
      ctx.font=`500 13px ${sans}`;ctx.fillStyle=c+'a0';ctx.fillText(fitText(ctx,group.label,180),x-rx*.6,y-ry*.65);ctx.restore();
    }
    // Parallel and reciprocal links get stable, symmetric curve offsets.
    const pairs=new Map();
    for (const edge of view.edges){const key=[edge.source,edge.target].sort().join('\0');if(!pairs.has(key))pairs.set(key,[]);pairs.get(key).push(edge.id);}
    const edgeLabels=[],edgeObstacles=[];
    for (const edge of view.edges) {
      const a=points.get(edge.source),b=points.get(edge.target),source=view.nodes.find(n=>n.id===edge.source),target=view.nodes.find(n=>n.id===edge.target);if(!a||!b)continue;
      const dx=b.x-a.x,dy=b.y-a.y,len=Math.hypot(dx,dy);if(len<1)continue;
      const ux=dx/len,uy=dy/len,ra=radius(source,cam.scale)+4,rb=radius(target,cam.scale)+5;
      const start={x:a.x+ux*ra,y:a.y+uy*ra},end={x:b.x-ux*rb,y:b.y-uy*rb};
      const key=[edge.source,edge.target].sort().join('\0'),siblings=pairs.get(key),order=siblings.indexOf(edge.id)-(siblings.length-1)/2;
      const sign=edge.source<edge.target?1:-1,offset=order*22*sign;
      const control={x:(start.x+end.x)/2-uy*offset,y:(start.y+end.y)/2+ux*offset};
      for(let t=.1;t<1;t+=.1){const u=1-t,x=u*u*start.x+2*u*t*control.x+t*t*end.x,y=u*u*start.y+2*u*t*control.y+t*t*end.y;edgeObstacles.push({x:x-4,y:y-4,w:8,h:8});}
      const active=attention(edge),special=['catalyst','activator','inhibitor','activity-influence','activation','inhibition'].includes(edge.kind);
      ctx.save();ctx.globalAlpha=active*(highlight.edgeIds.includes(edge.id)?.95:.68);ctx.lineWidth=highlight.edgeIds.includes(edge.id)?2.6:1.6;
      ctx.strokeStyle=highlight.edgeIds.includes(edge.id)?'#f0c99b':edge.kind==='physical-association'?'#8aaab5':special?'#d3b783':'#9ebac0';
      if(special)ctx.setLineDash(edge.kind==='catalyst'?[2,5]:[7,5]);
      ctx.beginPath();ctx.moveTo(start.x,start.y);ctx.quadraticCurveTo(control.x,control.y,end.x,end.y);ctx.stroke();ctx.setLineDash([]);
      if(edge.directed){
        const angle=Math.atan2(end.y-control.y,end.x-control.x),size=8;ctx.fillStyle=ctx.strokeStyle;
        if(edge.kind==='catalyst'){
          // A hollow catalyst marker is distinct from a reaction flow arrow.
          ctx.fillStyle='#101a25';ctx.beginPath();ctx.arc(end.x,end.y,4,0,Math.PI*2);ctx.fill();ctx.stroke();
        }else if(edge.kind==='inhibitor'||edge.kind==='inhibition'){
          ctx.beginPath();ctx.moveTo(end.x-5*Math.sin(angle),end.y+5*Math.cos(angle));ctx.lineTo(end.x+5*Math.sin(angle),end.y-5*Math.cos(angle));ctx.stroke();
        }else{
          ctx.beginPath();ctx.moveTo(end.x,end.y);ctx.lineTo(end.x-size*Math.cos(angle-.45),end.y-size*Math.sin(angle-.45));ctx.lineTo(end.x-size*Math.cos(angle+.45),end.y-size*Math.sin(angle+.45));ctx.closePath();ctx.fill();
        }
      }
      ctx.restore();
      const label=edgeNames[edge.kind] || (highlight.edgeIds.includes(edge.id)?edge.label:'');
      if(label)edgeLabels.push({text:edge.label&&edgeNames[edge.kind]&&!/^1$/.test(edge.label)?`${label} · ${edge.label}`:label,x:.25*start.x+.5*control.x+.25*end.x,y:.25*start.y+.5*control.y+.25*end.y,alpha:active});
    }
    const occupied=[];
    for (const node of view.nodes) {
      const p=points.get(node.id),r=radius(node,cam.scale),c=color(node.color||groups.get(node.groupId)?.color),alpha=attention(node);
      occupied.push({x:p.x-r-4,y:p.y-r-4,w:r*2+8,h:r*2+8});
      ctx.save();ctx.globalAlpha=alpha;
      if(alpha>.8)ellipseGlow(ctx,p.x,p.y,45,45,c,.18);
      ctx.fillStyle='#101a25';ctx.strokeStyle=c;ctx.lineWidth=1.8;
      ctx.beginPath();
      if(node.kind==='reaction'){ctx.moveTo(p.x,p.y-r-3);ctx.lineTo(p.x+r+3,p.y);ctx.lineTo(p.x,p.y+r+3);ctx.lineTo(p.x-r-3,p.y);ctx.closePath();}
      else if(['protein','protein-state','complex','small-molecule','gene'].includes(node.kind)){ctx.roundRect(p.x-r-4,p.y-r*.75,r*2+8,r*1.5,r*.65);}
      else ctx.arc(p.x,p.y,r+3,0,Math.PI*2);
      ctx.fill();ctx.stroke();
      ctx.fillStyle=c;ctx.beginPath();ctx.arc(p.x,p.y,node.kind==='reaction'?3.5:Math.max(3,r*.48),0,Math.PI*2);ctx.fill();ctx.restore();
    }
    // Deterministic screen-space label placement: prioritize selected and major nodes.
    const nodeLabelObstacles=[...occupied,...edgeObstacles];
    const sorted=[...view.nodes].sort((a,b)=>attention(b)-attention(a)||(b.importance||0)-(a.importance||0)||a.id.localeCompare(b.id,'en'));
    for (const node of sorted) {
      const p=points.get(node.id),r=radius(node,cam.scale),active=attention(node);ctx.font=`${active>.8?600:450} ${node.importance>=5?18:15}px ${sans}`;
      const label=fitText(ctx,node.label,200),width=ctx.measureText(label).width,height=21;
      const candidates=[{x:p.x+r+9,y:p.y-10},{x:p.x-r-9-width,y:p.y-10},{x:p.x-width/2,y:p.y-r-25},{x:p.x-width/2,y:p.y+r+6},{x:p.x+r+5,y:p.y-r-24},{x:p.x-r-5-width,y:p.y-r-24},{x:p.x+r+5,y:p.y+r+6},{x:p.x-r-5-width,y:p.y+r+6}].map(c=>({...c,w:width,h:height}));
      const available=(c,obstacles)=>c.x>=30&&c.x+c.w<=1250&&c.y>=112&&c.y+c.h<=540&&!obstacles.some(o=>intersects(c,o));
      // A major or highlighted node should not become anonymous merely because
      // several lines leave it. Text/other nodes still take precedence.
      const box=candidates.find(c=>available(c,nodeLabelObstacles))||((node.importance>=4||highlight.nodeIds.includes(node.id))?candidates.find(c=>available(c,occupied)):undefined);
      if(!box)continue;occupied.push(box);nodeLabelObstacles.push(box);
      ctx.save();ctx.globalAlpha=active;ctx.textBaseline='top';ctx.lineJoin='round';ctx.lineWidth=4;ctx.strokeStyle='#08111a';ctx.strokeText(label,box.x,box.y);ctx.fillStyle=active>.8?'#f2eee4':'#b7c5c9';ctx.fillText(label,box.x,box.y);ctx.restore();
    }
    ctx.font=`11px ${sans}`;
    for(const label of edgeLabels){const text=fitText(ctx,label.text,150),w=ctx.measureText(text).width+10,box={x:label.x-w/2,y:label.y-18,w,h:17};if(box.x<30||box.x+w>1250||box.y<112||box.y+17>540||occupied.some(o=>intersects(box,o)))continue;occupied.push(box);ctx.save();ctx.globalAlpha=label.alpha;ctx.fillStyle='#101a25e8';ctx.fillRect(box.x,box.y,w,17);ctx.fillStyle='#d5c7ad';ctx.textBaseline='middle';ctx.fillText(text,box.x+5,box.y+9);ctx.restore();}
    ctx.restore();
    if(state.overlay){
      const node=view.nodes.find(n=>n.id===state.overlay.nodeId),detail=detailAt(state.overlay.nodeId,playback.domainAt);
      if(node&&detail?.summary){ctx.save();ctx.fillStyle='#101a26f2';ctx.strokeStyle='#a78d6e';ctx.lineWidth=1;ctx.beginPath();ctx.roundRect(850,135,350,190,12);ctx.fill();ctx.stroke();ctx.textBaseline='alphabetic';ctx.fillStyle='#e6c89e';ctx.font=`600 20px ${serif}`;ctx.fillText(fitText(ctx,node.label,300),875,172);ctx.fillStyle='#c0c9c9';ctx.font=`15px ${sans}`;wrapText(ctx,detail.summary,300,5).forEach((line,i)=>ctx.fillText(line,875,203+i*22));ctx.restore();}
    }
    // Fixed frame-safe title and subtitle bands keep graph labels out of overlays.
    ctx.fillStyle='rgba(7,12,20,.9)';ctx.fillRect(0,0,VIDEO_WIDTH,104);ctx.fillRect(0,548,VIDEO_WIDTH,172);
    ctx.strokeStyle='rgba(224,192,154,.22)';ctx.lineWidth=1;ctx.beginPath();ctx.moveTo(62,102);ctx.lineTo(1218,102);ctx.moveTo(62,550);ctx.lineTo(1218,550);ctx.stroke();
    ctx.textAlign='left';ctx.textBaseline='alphabetic';ctx.fillStyle='#cfae84';ctx.font=`600 13px ${sans}`;ctx.fillText('RELGRAPH  /  DIRECTOR STUDIO',64,39);
    ctx.fillStyle='#f1e6d2';ctx.font=`600 27px ${serif}`;ctx.fillText(fitText(ctx,view.meta.title,850),64,78);
    ctx.textAlign='right';ctx.fillStyle='#90a7af';ctx.font='13px ui-monospace, monospace';ctx.fillText(`FRAME ${String(frame).padStart(5,'0')}  ·  ${fps} FPS`,1218,40);
    ctx.fillText(playback.domainAt===null?'':`${view.timeline?.unit||'TIME'} ${playback.domainAt}`,1218,73);ctx.textAlign='left';
    ctx.fillStyle='#d5b17f';ctx.font=`500 13px ${sans}`;ctx.fillText(`SCENE ${String(playback.index+1).padStart(2,'0')}  /  ${String(graph.scenes.length).padStart(2,'0')}`,64,585);
    ctx.fillStyle='#f4eee3';ctx.font=`600 27px ${serif}`;ctx.fillText(fitText(ctx,playback.scene?.title||'',1120),64,625);
    ctx.font=`16px ${sans}`;ctx.fillStyle='#b3c1c4';wrapText(ctx,playback.scene?.narration||'',1120,2).forEach((line,i)=>ctx.fillText(line,64,657+i*21));
    ctx.fillStyle='rgba(173,189,197,.2)';ctx.fillRect(64,704,1152,2);ctx.fillStyle='#d9b382';ctx.fillRect(64,704,1152*clamp((frame/fps)/(playback.totalSec||1),0,1),2);
    return state;
  }
  return {renderFrame};
}
