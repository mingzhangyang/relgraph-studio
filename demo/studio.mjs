import {parseDocument} from '../src/director/load.mjs';
import {layoutGraph} from '../src/director/layout.mjs';
import {frameCount} from '../src/director/state.mjs';
import {createCanvasRenderer} from '../src/render/canvas.mjs';

const FPS=24;
const $=id=>document.getElementById(id);
const canvas=$('stage'),play=$('play'),restart=$('restart'),scrubber=$('scrubber'),shots=$('shots');
let graph=null,renderer=null,frame=0,totalFrames=1,playing=false,animationId=null,lastTick=null,position=0,announcedScene=-1,requestSerial=0;
let currentFrameState=null,currentDetailAt=()=>undefined;
const stamp=seconds=>{const t=Math.max(0,seconds),minutes=Math.floor(t/60),s=(t%60).toFixed(2).padStart(5,'0');return `${String(minutes).padStart(2,'0')}:${s}`;};
function setPlaying(next){
  if(animationId!==null)cancelAnimationFrame(animationId);animationId=null;
  playing=Boolean(next&&renderer);lastTick=null;position=frame;
  play.textContent=playing?'Ⅱ':'▶';play.setAttribute('aria-label',playing?'暂停':'播放');
  $('status').textContent=playing?'播放中':renderer?'就绪':'等待有效数据';
  if(playing)animationId=requestAnimationFrame(tick);
}
function tick(now){
  animationId=null;if(!playing)return;
  if(lastTick!==null)position+=Math.max(0,now-lastTick)*FPS/1000;
  lastTick=now;setFrame(Math.floor(position),false);
  if(position>=totalFrames-1){setPlaying(false);return;}
  if(playing)animationId=requestAnimationFrame(tick);
}
function renderDiagnostics(result){
  for(const [name,entries] of [['errors',result.errors||[]],['warnings',result.warnings||[]]]){
    const container=$(name);container.replaceChildren();
    if(!entries.length)continue;
    const heading=document.createElement('h3');heading.textContent=`${name==='errors'?'错误':'警告'} · ${entries.length}`;container.append(heading);
    for(const entry of entries){
      const item=document.createElement('div');item.className=`diagnostic-item ${name==='warnings'?'warning':''}`;
      const title=document.createElement('strong');title.textContent=`${entry.code||'提示'}${entry.id?' · '+entry.id:''}`;
      const path=document.createElement('code');path.textContent=entry.path||'$';
      const message=document.createElement('p');message.textContent=entry.message||'数据无效';
      const fix=document.createElement('p');fix.textContent='建议：'+(entry.fix||'检查数据并重试。');
      item.append(title,path,message,fix);container.append(item);
    }
  }
  if(!(result.errors||[]).length&&!(result.warnings||[]).length){$('warnings').textContent='未发现校验问题。';$('warnings').className='muted';}else $('warnings').className='';
}
function buildShots(){
  shots.replaceChildren();let start=0;
  graph.scenes.forEach((scene,index)=>{
    const button=document.createElement('button');button.type='button';button.className='shot';
    button.setAttribute('aria-label',`跳转至分镜 ${index+1}`);
    const top=document.createElement('small');top.textContent=`${String(index+1).padStart(2,'0')}  ·  ${stamp(start)}`;
    const title=document.createElement('strong');title.textContent=`分镜 ${index+1}`;
    button.append(top,title);const target=Math.min(totalFrames-1,Math.ceil(start*FPS-1e-9));
    button.addEventListener('click',()=>{setPlaying(false);setFrame(target);});shots.append(button);start+=scene.durationSec;
  });
}
function renderShots(activeIndex,activeTitle){
  // Update existing buttons so focus survives both seeking and playback.
  for(const [index,button] of [...shots.children].entries()){
    const active=index===activeIndex;
    button.className='shot'+(active?' active':'');
    if(active)button.setAttribute('aria-current','step');else button.removeAttribute('aria-current');
    // Scene order need not match chapter/stage order: reveal only this title.
    button.lastElementChild.textContent=active?activeTitle:`分镜 ${index+1}`;
  }
}
function updateTranscript(state){
  const {view,playback}=state,transcript=$('transcript');transcript.replaceChildren();
  const intro=document.createElement('p');intro.textContent=`${playback.scene.title}。${playback.scene.narration||''}`;transcript.append(intro);
  const names=new Map(view.nodes.map(node=>[node.id,node.label]));
  const detailNode=state.overlay&&view.nodes.find(node=>node.id===state.overlay.nodeId);
  const detail=detailNode?currentDetailAt(detailNode.id,playback.domainAt):undefined;
  const detailText=detail?.summary?`${detailNode.label}：${detail.summary}`:'';
  if(detailText){const heading=document.createElement('strong');heading.textContent='当前人物简介';const summary=document.createElement('p');summary.textContent=detailText;transcript.append(heading,summary);}
  const add=(title,values)=>{const heading=document.createElement('strong');heading.textContent=title;const list=document.createElement('ul');for(const value of values){const li=document.createElement('li');li.textContent=value;list.append(li);}transcript.append(heading,list);};
  add('当前可见节点',view.nodes.map(node=>node.label));
  add('当前可见关系',view.edges.map(edge=>`${names.get(edge.source)} ${edge.directed?'→':'—'} ${names.get(edge.target)}：${edge.label||edge.kind} (${edge.kind})`));
  $('sceneDescription').textContent=`${playback.scene.title}。${playback.scene.narration||''} 当前 ${view.nodes.length} 个节点，${view.edges.length} 条关系。${detailText}`;
}
function setFrame(next,updatePosition=true){
  if(!renderer)return;
  frame=Math.max(0,Math.min(totalFrames-1,Math.floor(next)));if(updatePosition)position=frame;
  const state=renderer.renderFrame(frame),p=state.playback;currentFrameState=state;
  scrubber.value=String(frame);$('frameNumber').textContent=`FRAME ${frame}`;
  $('time').textContent=`${stamp(frame/FPS)} / ${stamp(p.totalSec)}`;
  $('currentShot').textContent=p.scene.title+(p.scene.narration?'\n'+p.scene.narration:'');
  $('domainTime').textContent=p.domainAt===null?'领域时间：未指定':`领域时间：${state.view.timeline?.unit||'时点'} ${p.domainAt}`;
  $('nodeCount').textContent=String(state.view.nodes.length);$('edgeCount').textContent=String(state.view.edges.length);
  if(p.index!==announcedScene){announcedScene=p.index;renderShots(p.index,p.scene.title);updateTranscript(state);}
  return state;
}
function clearStudio(){
  setPlaying(false);graph=null;renderer=null;currentFrameState=null;currentDetailAt=()=>undefined;frame=0;position=0;totalFrames=1;announcedScene=-1;
  play.disabled=true;restart.disabled=true;scrubber.disabled=true;scrubber.max='0';scrubber.value='0';shots.replaceChildren();
  const ctx=canvas.getContext('2d');ctx.fillStyle='#0a1420';ctx.fillRect(0,0,canvas.width,canvas.height);ctx.fillStyle='#c4d0d1';ctx.font='20px system-ui';ctx.fillText('请选择有效的 JSON 数据',64,100);
  $('currentShot').textContent='—';$('domainTime').textContent='领域时间：—';$('nodeCount').textContent='0';$('edgeCount').textContent='0';$('sceneCount').textContent='0';$('sourceNote').textContent='—';$('transcript').replaceChildren();$('sceneDescription').textContent='没有已加载的有效数据。';$('time').textContent='00:00.00 / 00:00.00';$('frameNumber').textContent='FRAME 0';
}
function applyResult(result,name){
  clearStudio();renderDiagnostics(result);$('sourceName').textContent=name;
  if(!result.valid){$('status').textContent='数据校验失败';return;}
  graph=result.graph;currentDetailAt=result.detailAt||(()=>undefined);renderer=createCanvasRenderer(canvas,graph,layoutGraph(graph),{fps:FPS,detailAt:currentDetailAt});
  totalFrames=frameCount(graph,FPS);scrubber.max=String(totalFrames-1);scrubber.disabled=false;play.disabled=false;restart.disabled=false;
  buildShots();
  $('sceneCount').textContent=String(graph.scenes.length);$('sourceNote').textContent=graph.meta.sourceNote||graph.meta.description||'此数据未提供来源说明。';
  $('status').textContent='就绪';setFrame(0);
}
async function loadExample(path,name){
  const serial=++requestSerial;setPlaying(false);$('status').textContent='正在加载…';
  try{const response=await fetch(path);if(!response.ok)throw new Error(`HTTP ${response.status}`);const text=await response.text();if(serial===requestSerial)applyResult(parseDocument(text),name);}
  catch(error){if(serial===requestSerial)applyResult({valid:false,errors:[{code:'LOAD',path:'$',message:`无法读取示例：${error.message}`,fix:'从仓库根目录运行本地服务器后重新打开工作台。'}],warnings:[]},name);}
}
$('exampleLiterature').addEventListener('click',()=>loadExample('../examples/honglou-provisional.relgraph.json','红楼梦 · 未经原著核实的技术演示'));
$('exampleBiology').addEventListener('click',()=>loadExample('../examples/biology-signaling-synthetic.json','生物信号 · 虚构合成示例'));
$('fileInput').addEventListener('change',async event=>{
  const file=event.target.files?.[0];if(!file)return;const serial=++requestSerial;setPlaying(false);
  try{const text=await file.text();if(serial===requestSerial)applyResult(parseDocument(text),file.name);}
  catch(error){if(serial===requestSerial)applyResult({valid:false,errors:[{code:'FILE',path:'$',message:`无法读取文件：${error.message}`,fix:'请选择可读取的 JSON 文件。'}],warnings:[]},file.name);}
  event.target.value='';
});
play.addEventListener('click',()=>{if(!playing&&frame>=totalFrames-1)setFrame(0);setPlaying(!playing);});
restart.addEventListener('click',()=>{setPlaying(false);setFrame(0);});
scrubber.addEventListener('input',()=>{setPlaying(false);setFrame(Number(scrubber.value));});
window.addEventListener('keydown',event=>{if(event.altKey||event.ctrlKey||event.metaKey||event.isComposing||event.repeat)return;const target=event.target;if(target instanceof Element&&target.closest('button,input,textarea,select,[contenteditable],[role="button"]'))return;if(event.code==='Space'){event.preventDefault();play.click();}else if(event.code==='ArrowRight'){setPlaying(false);setFrame(frame+FPS);}else if(event.code==='ArrowLeft'){setPlaying(false);setFrame(frame-FPS);}});
// Headless frame export and independent frame inspection; no recording or animation state.
window.renderAt=f=>{if(!renderer||!Number.isInteger(f)||f<0||f>=totalFrames)return false;setPlaying(false);setFrame(f);return true;};
window.studioFrame=()=>currentFrameState?structuredClone(currentFrameState):null;
clearStudio();await document.fonts.ready;await loadExample('../examples/honglou-provisional.relgraph.json','红楼梦 · 未经原著核实的技术演示');
