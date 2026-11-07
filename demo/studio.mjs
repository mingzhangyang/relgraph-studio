import {parseDocument} from '../src/director/load.ts';
import {layoutGraph} from '../src/director/layout.ts';
import {frameCount} from '../src/director/state.ts';
import {createCanvasRenderer} from '../src/render/canvas.mjs';

const FPS=24;
const $=id=>document.getElementById(id);
const canvas=$('stage'),play=$('play'),restart=$('restart'),scrubber=$('scrubber'),shots=$('shots'),strip=$('sceneStrip');
let graph=null,renderer=null,frame=0,totalFrames=1,playing=false,animationId=null,lastTick=null,position=0,announcedScene=-1,requestSerial=0;
let currentFrameState=null,currentDetailAt=()=>undefined,currentLayout=null,emptyMessage='';
// Workspace and video share one theme. Without a saved choice it follows the OS.
const THEME_KEY='relgraph-theme',lightQuery=globalThis.matchMedia?.('(prefers-color-scheme: light)');
const EMPTY_STAGE={dark:{bg:'#101b2a',kicker:'#cfae84',text:'#c4d0d1'},light:{bg:'#f6f1e8',kicker:'#a0672a',text:'#3f4c57'}};
function savedTheme(){try{const value=globalThis.localStorage?.getItem(THEME_KEY);return value==='light'||value==='dark'?value:null;}catch{return null;}}
// The in-memory pin decides whether OS changes are followed, so a choice
// still sticks for this page when storage is unavailable or setItem fails.
let pinnedTheme=savedTheme(),theme=pinnedTheme||(lightQuery?.matches?'light':'dark');
const setStatus=(text,state)=>{$('status').textContent=text;$('status').setAttribute('data-state',state);};
const stamp=seconds=>{const t=Math.max(0,seconds),minutes=Math.floor(t/60),s=(t%60).toFixed(2).padStart(5,'0');return `${String(minutes).padStart(2,'0')}:${s}`;};
function setPlaying(next){
  if(animationId!==null)cancelAnimationFrame(animationId);animationId=null;
  playing=Boolean(next&&renderer);lastTick=null;position=frame;
  play.textContent=playing?'❚❚':'▶';play.setAttribute('aria-label',playing?'暂停':'播放');play.className='icon-button play'+(playing?' is-playing':'');
  if(playing)setStatus('播放中','playing');else if(renderer)setStatus('就绪','ready');
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
    const container=$(name);container.replaceChildren();container.className='';
    if(!entries.length)continue;
    const heading=document.createElement('h3');heading.textContent=`${name==='errors'?'错误':'警告'} · ${entries.length}`;container.append(heading);
    for(const entry of entries){
      const item=document.createElement('div');item.className=`diagnostic-item ${name==='warnings'?'warning':'error'}`;
      const title=document.createElement('strong');title.textContent=`${entry.code||'提示'}${entry.id?' · '+entry.id:''}`;
      const path=document.createElement('code');path.textContent=entry.path||'$';
      const message=document.createElement('p');message.textContent=entry.message||'数据无效';
      const fix=document.createElement('p');fix.className='fix';fix.textContent='建议：'+(entry.fix||'检查数据并重试。');
      item.append(title,path,message,fix);container.append(item);
    }
  }
  const errorCount=(result.errors||[]).length,total=errorCount+(result.warnings||[]).length,count=$('diagCount');
  count.hidden=!total;count.textContent=String(total);count.setAttribute('data-level',errorCount?'error':'warning');
  if(!total){$('warnings').textContent='未发现校验问题。';$('warnings').className='ok';}
}
function buildShots(){
  shots.replaceChildren();strip.replaceChildren();let start=0;
  graph.scenes.forEach((scene,index)=>{
    const button=document.createElement('button');button.type='button';button.className='shot';
    button.setAttribute('aria-label',`跳转至分镜 ${index+1}`);
    const top=document.createElement('small'),number=document.createElement('span');number.className='shot-index';number.textContent=String(index+1).padStart(2,'0');top.append(number,` ${stamp(start)} · ${scene.durationSec}s`);
    const progress=document.createElement('span');progress.className='shot-progress';progress.setAttribute('aria-hidden','true');
    const title=document.createElement('strong');title.textContent=`分镜 ${index+1}`;
    button.append(progress,top,title);const target=Math.min(totalFrames-1,Math.ceil(start*FPS-1e-9));
    button.addEventListener('click',()=>{setPlaying(false);setFrame(target);});shots.append(button);
    const segment=document.createElement('span');segment.className='segment';segment.setAttribute('style',`flex-grow:${scene.durationSec}`);strip.append(segment);start+=scene.durationSec;
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
  for(const [index,segment] of [...strip.children].entries())segment.className='segment'+(index===activeIndex?' active':index<activeIndex?' done':'');
}
function updateShotProgress(p){
  for(const [index,button] of [...shots.children].entries())button.children[0].setAttribute('style',`transform:scaleX(${index===p.index?p.progress:0})`);
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
  scrubber.value=String(frame);scrubber.setAttribute('style',`--fill:${totalFrames>1?frame/(totalFrames-1)*100:0}%`);scrubber.setAttribute('aria-valuetext',`${stamp(frame/FPS)}，分镜 ${p.index+1}`);$('frameNumber').textContent=`FRAME ${frame}`;
  $('time').textContent=`${stamp(frame/FPS)} / ${stamp(p.totalSec)}`;
  $('currentShot').textContent=p.scene.title+(p.scene.narration?'\n'+p.scene.narration:'');
  $('domainTime').textContent=p.domainAt===null?'领域时间：未指定':`领域时间：${state.view.timeline?.unit||'时点'} ${p.domainAt}`;
  $('nodeCount').textContent=String(state.view.nodes.length);$('edgeCount').textContent=String(state.view.edges.length);
  if(p.index!==announcedScene){announcedScene=p.index;renderShots(p.index,p.scene.title);updateTranscript(state);}
  updateShotProgress(p);
  return state;
}
function paintEmptyStage(message){
  const ctx=canvas.getContext('2d'),colors=EMPTY_STAGE[theme];emptyMessage=message;
  ctx.fillStyle=colors.bg;ctx.fillRect(0,0,canvas.width,canvas.height);ctx.textAlign='center';
  ctx.fillStyle=colors.kicker;ctx.font='600 13px system-ui';ctx.fillText('RELGRAPH  /  DIRECTOR STUDIO',640,330);
  ctx.fillStyle=colors.text;ctx.font='22px system-ui';ctx.fillText(message,640,372);ctx.textAlign='left';
}
function clearStudio(){
  setPlaying(false);graph=null;renderer=null;currentLayout=null;currentFrameState=null;currentDetailAt=()=>undefined;frame=0;position=0;totalFrames=1;announcedScene=-1;
  play.disabled=true;restart.disabled=true;scrubber.disabled=true;scrubber.max='0';scrubber.value='0';scrubber.setAttribute('style','--fill:0%');shots.replaceChildren();strip.replaceChildren();
  paintEmptyStage('请选择示例或导入有效的 JSON 数据');
  $('currentShot').textContent='—';$('domainTime').textContent='领域时间：—';$('nodeCount').textContent='0';$('edgeCount').textContent='0';$('sceneCount').textContent='0';$('sourceNote').textContent='—';$('transcript').replaceChildren();$('sceneDescription').textContent='没有已加载的有效数据。';$('time').textContent='00:00.00 / 00:00.00';$('frameNumber').textContent='FRAME 0';
}
function applyResult(result,name){
  clearStudio();renderDiagnostics(result);$('sourceName').textContent=name;
  if(!result.valid){setStatus('数据校验失败','error');paintEmptyStage('数据校验失败 · 请查看右侧校验提示');return;}
  graph=result.graph;currentDetailAt=result.detailAt||(()=>undefined);currentLayout=layoutGraph(graph);renderer=createCanvasRenderer(canvas,graph,currentLayout,{fps:FPS,detailAt:currentDetailAt,theme});
  totalFrames=frameCount(graph,FPS);scrubber.max=String(totalFrames-1);scrubber.disabled=false;play.disabled=false;restart.disabled=false;
  buildShots();
  $('sceneCount').textContent=String(graph.scenes.length);$('sourceNote').textContent=graph.meta.sourceNote||graph.meta.description||'此数据未提供来源说明。';
  setStatus('就绪','ready');setFrame(0);
}
async function loadExample(path,name){
  const serial=++requestSerial;setPlaying(false);setStatus('正在加载…','loading');
  try{const response=await fetch(path);if(!response.ok)throw new Error(`HTTP ${response.status}`);const text=await response.text();if(serial===requestSerial)applyResult(parseDocument(text),name);}
  catch(error){if(serial===requestSerial)applyResult({valid:false,errors:[{code:'LOAD',path:'$',message:`无法读取示例：${error.message}`,fix:'从仓库根目录运行 npm run dev 或 npm run preview 后重新打开工作台。'}],warnings:[]},name);}
}
const markSource=id=>{for(const button of ['exampleLiterature','exampleBiology'])$(button).setAttribute('aria-pressed',String(button===id));};
$('exampleLiterature').addEventListener('click',()=>markSource('exampleLiterature')||loadExample('../examples/honglou-provisional.relgraph.json','红楼梦 · 未经原著核实的技术演示'));
$('exampleBiology').addEventListener('click',()=>markSource('exampleBiology')||loadExample('../examples/biology-signaling-synthetic.json','生物信号 · 虚构合成示例'));
async function loadFile(file){
  if(!file)return;const serial=++requestSerial;setPlaying(false);markSource(null);
  try{const text=await file.text();if(serial===requestSerial)applyResult(parseDocument(text),file.name);}
  catch(error){if(serial===requestSerial)applyResult({valid:false,errors:[{code:'FILE',path:'$',message:`无法读取文件：${error.message}`,fix:'请选择可读取的 JSON 文件。'}],warnings:[]},file.name);}
}
$('fileInput').addEventListener('change',async event=>{await loadFile(event.target.files?.[0]);event.target.value='';});
const dropzone=$('dropzone');
dropzone.addEventListener('dragover',event=>{event.preventDefault();dropzone.className='dropzone dragging';});
dropzone.addEventListener('dragleave',()=>dropzone.className='dropzone');
dropzone.addEventListener('drop',event=>{event.preventDefault();dropzone.className='dropzone';loadFile(event.dataTransfer?.files?.[0]);});
play.addEventListener('click',()=>{if(!playing&&frame>=totalFrames-1)setFrame(0);setPlaying(!playing);});
restart.addEventListener('click',()=>{setPlaying(false);setFrame(0);});
scrubber.addEventListener('input',()=>{setPlaying(false);setFrame(Number(scrubber.value));});
window.addEventListener('keydown',event=>{if(event.altKey||event.ctrlKey||event.metaKey||event.isComposing||event.repeat)return;const target=event.target;if(target instanceof Element&&target.closest('button,input,textarea,select,summary,[contenteditable],[role="button"]'))return;if(event.code==='Space'){event.preventDefault();play.click();}else if(event.code==='ArrowRight'){setPlaying(false);setFrame(frame+FPS);}else if(event.code==='ArrowLeft'){setPlaying(false);setFrame(frame-FPS);}});
function applyTheme(next,persist){
  theme=next==='light'?'light':'dark';
  if(persist){pinnedTheme=theme;try{globalThis.localStorage?.setItem(THEME_KEY,theme);}catch{}document.documentElement?.setAttribute('data-theme',theme);}
  const toggle=$('themeToggle'),other=theme==='light'?'深色':'浅色';
  toggle.setAttribute('aria-label',`切换到${other}模式`);toggle.lastElementChild&&(toggle.lastElementChild.textContent=theme==='light'?'浅色':'深色');
  // The theme is a renderer input: rebuild it and redraw the same frame
  // without disturbing the fractional playback position.
  if(renderer){renderer=createCanvasRenderer(canvas,graph,currentLayout,{fps:FPS,detailAt:currentDetailAt,theme});setFrame(frame,false);}
  else paintEmptyStage(emptyMessage);
}
$('themeToggle').addEventListener('click',()=>applyTheme(theme==='light'?'dark':'light',true));
lightQuery?.addEventListener?.('change',event=>{if(!pinnedTheme)applyTheme(event.matches?'light':'dark',false);});
// Headless frame export and independent frame inspection; no recording or animation state.
window.renderAt=f=>{if(!renderer||!Number.isInteger(f)||f<0||f>=totalFrames)return false;setPlaying(false);setFrame(f);return true;};
window.studioFrame=()=>currentFrameState?structuredClone(currentFrameState):null;
applyTheme(theme,false);clearStudio();await document.fonts.ready;markSource('exampleLiterature');await loadExample('../examples/honglou-provisional.relgraph.json','红楼梦 · 未经原著核实的技术演示');
