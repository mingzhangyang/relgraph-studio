/* RelGraph draft v0.1 validation & spoiler-safe projections. No dependencies. */
import schema from '../schema/relationship-graph.schema.json' with { type: 'json' };
export function validateRelGraph(doc){
  const errors=[],warnings=[];
  const issue=(level,layer,code,path,id,message,fix)=>({level,layer,code,path,id:id||"",message,fix});
  const fail=(layer,code,path,id,message,fix)=>errors.push(issue("error",layer,code,path,id,message,fix));
  const warn=(code,path,id,message,fix)=>warnings.push(issue("warning","semantic",code,path,id,message,fix));
  const typeOK=(v,type)=>type==="object"?v!==null&&typeof v==="object"&&!Array.isArray(v):type==="array"?Array.isArray(v):type==="integer"?Number.isInteger(v):type==="number"?typeof v==="number"&&Number.isFinite(v):typeof v===type;
  const scan=(v,rule,path)=>{
    if(rule.$ref){const keys=rule.$ref.split("/").slice(1);let ref=schema;for(const k of keys)ref=ref?.[k];if(ref)scan(v,ref,path);else fail("structure","BROKEN_REF",path,"",`Schema reference ${rule.$ref} is invalid`,"修复 Schema。");return;}
    if(rule.type&&!typeOK(v,rule.type)){fail("structure","TYPE",path,"",`Expected ${rule.type}`,"修正字段类型。");return;}
    if(Object.hasOwn(rule,"const")&&v!==rule.const){fail("structure","VERSION",path,"",`Unsupported schemaVersion ${JSON.stringify(v)}; supported: 0.1`,"请使用 0.1 数据，或升级播放器。");}
    if(rule.enum&&!rule.enum.includes(v))fail("structure","ENUM",path,"",`Invalid value ${JSON.stringify(v)}`,"使用规范中的枚举值。");
    if(typeof v==="string"&&rule.pattern&&!new RegExp(rule.pattern).test(v))fail("structure","PATTERN",path,"",`Invalid value ${v}`,"id 使用小写 ASCII、数字与连字符；颜色使用 #RRGGBB。");
    if(typeof v==="number"){if(rule.minimum!==undefined&&v<rule.minimum)fail("structure","MIN",path,"",`Must be >= ${rule.minimum}`,"提高数值。");if(rule.maximum!==undefined&&v>rule.maximum)fail("structure","MAX",path,"",`Must be <= ${rule.maximum}`,"降低数值。");}
    if(Array.isArray(v)){if(rule.minItems!==undefined&&v.length<rule.minItems)fail("structure","ARRAY_SIZE",path,"",`Expected at least ${rule.minItems} item(s)`,"增加必填数组项。");if(rule.items)v.forEach((item,i)=>scan(item,rule.items,`${path}[${i}]`));}
    else if(v!==null&&typeof v==="object"){
      for(const k of rule.required||[])if(!Object.hasOwn(v,k))fail("structure","REQUIRED",`${path}.${k}`,"",`Missing required property ${k}`,"补全必填字段。");
      if(rule.additionalProperties===false)for(const k of Object.keys(v))if(!Object.hasOwn(rule.properties||{},k))fail("structure","UNKNOWN_FIELD",`${path}.${k}`,"",`Unknown property ${k}`,"移到允许的 extra 对象或删除。");
      for(const [k,sub] of Object.entries(rule.properties||{}))if(Object.hasOwn(v,k))scan(v[k],sub,`${path}.${k}`);
    }
  };
  scan(doc,schema,"$");
  if(errors.length)return {valid:false,errors,warnings};
  const collections=[["factions",doc.factions||[]],["characters",doc.characters],["relations",doc.relations],["presentation",doc.presentation||[]]];
  for(const [kind,items] of collections){const seen=new Set();items.forEach((x,i)=>{if(seen.has(x.id))fail("semantic","DUPLICATE_ID",`${kind}[${i}].id`,x.id,`Duplicate id: ${x.id}`,"使用未占用的稳定 id。");seen.add(x.id);});}
  const chars=new Set(doc.characters.map(c=>c.id)), factions=new Set((doc.factions||[]).map(f=>f.id)),rels=new Set(doc.relations.map(r=>r.id));
  const limit=doc.timeline?.total;
  const time=(v,path,who)=>{if(v!==undefined&&(v<1||(limit!==undefined&&v>limit)))fail("semantic","TIME_RANGE",path,who,`Time point ${v} outside [1, ${limit??"∞"}]`,"调整为有效时点。");};
  const degree=Object.fromEntries(doc.characters.map(c=>[c.id,0]));
  doc.characters.forEach((c,i)=>{
    const path=`characters[${i}]`;
    if(c.factionId&&!factions.has(c.factionId))fail("semantic","UNKNOWN_FACTION",`${path}.factionId`,c.id,`Unknown faction ${c.factionId}`,"在 factions 中添加阵营或修改引用。");
    time(c.firstAppearance,`${path}.firstAppearance`,c.id);
    if(Array.from(c.bio.summary).length>120)warn("BIO_LENGTH",`${path}.bio.summary`,c.id,"Biography summary exceeds 120 characters","缩短摘要。");
    (c.bio.quotes||[]).forEach((q,j)=>time(q.at,`${path}.bio.quotes[${j}].at`,c.id));
  });
  const signatures=new Map();
  doc.relations.forEach((r,i)=>{
    const path=`relations[${i}]`;
    if(!chars.has(r.source))fail("semantic","UNKNOWN_SOURCE",`${path}.source`,r.id,`Unknown source ${r.source}`,"改为已有的人物 id。");
    if(!chars.has(r.target))fail("semantic","UNKNOWN_TARGET",`${path}.target`,r.id,`Unknown target ${r.target}`,"改为已有的人物 id。");
    if(r.source===r.target)fail("semantic","SELF_LOOP",path,r.id,"Self-loop forbidden","改写到人物小传。");
    if(r.type==="other"&&!r.label)fail("semantic","OTHER_LABEL",`${path}.label`,r.id,"other requires a label","提供关系短标签。");
    const endpoints=r.directed===true?[r.source,r.target]:[r.source,r.target].sort();
    const signature=JSON.stringify([r.directed===true,...endpoints,r.type,r.label||""]);
    if(signatures.has(signature))fail("semantic","DUPLICATE_RELATION",path,r.id,`Duplicate of ${signatures.get(signature)}`,"合并相同人物对、type、label 的关系。");
    signatures.set(signature,r.id);
    if(chars.has(r.source))degree[r.source]++;
    if(chars.has(r.target))degree[r.target]++;
    time(r.chapters?.from,`${path}.chapters.from`,r.id);
    time(r.chapters?.to,`${path}.chapters.to`,r.id);
    if(r.chapters?.from!==undefined&&r.chapters?.to!==undefined&&r.chapters.from>r.chapters.to)fail("semantic","INVERTED_INTERVAL",`${path}.chapters`,r.id,"chapters.from exceeds chapters.to","修正生效区间。");
    (r.evidence||[]).forEach((q,j)=>time(q.at,`${path}.evidence[${j}].at`,r.id));
  });
  (doc.presentation||[]).forEach((s,i)=>{
    const path=`presentation[${i}]`;
    if(s.durationSec<=0)fail("semantic","DURATION",`${path}.durationSec`,s.id,"durationSec must be positive","设置正数秒数。");
    if(s.transitionMs!==undefined&&s.transitionMs<0)fail("semantic","TRANSITION",`${path}.transitionMs`,s.id,"transitionMs must not be negative","改为非负毫秒数。");
    const c=s.camera||{},h=s.highlight||{};
    if(c.focusNodeId&&c.fitIds?.length)fail("semantic","CAMERA_CONFLICT",`${path}.camera`,s.id,"focusNodeId and fitIds are mutually exclusive","选择一种镜头目标。");
    const testRef=(value,set,path,kind)=>{if(value&&!set.has(value))fail("semantic","UNKNOWN_REF",path,s.id,`Unknown ${kind}: ${value}`,"替换为对应集合中的有效 id。");};
    testRef(c.focusNodeId,chars,`${path}.camera.focusNodeId`,"character");
    (c.fitIds||[]).forEach((x,j)=>testRef(x,chars,`${path}.camera.fitIds[${j}]`,"character"));
    (h.characterIds||[]).forEach((x,j)=>testRef(x,chars,`${path}.highlight.characterIds[${j}]`,"character"));
    (h.relationIds||[]).forEach((x,j)=>testRef(x,rels,`${path}.highlight.relationIds[${j}]`,"relation"));
    testRef(h.factionId,factions,`${path}.highlight.factionId`,"faction");
    testRef(s.openBioId,chars,`${path}.openBioId`,"character");
    time(s.chapterAt,`${path}.chapterAt`,s.id);
  });
  if(doc.characters.filter(c=>c.importance===5).length>2)warn("TOO_MANY_LEADS","$.characters","","More than two importance 5 characters","建议最多两个绝对主角。");
  if(doc.relations.length&&doc.relations.filter(r=>r.strength===5).length/doc.relations.length>.15)warn("TOO_MANY_STRONG","$.relations","","More than 15% of edges have strength 5","只保留最核心的关系。");
  doc.characters.forEach((c,i)=>{if(degree[c.id]===0&&c.status!=="mentioned")warn("ORPHAN",`characters[${i}]`,c.id,"Unconnected character","核实关系或标为仅提及。");});
  if(doc.timeline&&(doc.presentation||[]).some(s=>s.chapterAt!==undefined)&&doc.relations.every(r=>r.chapters===undefined))warn("UNTIMED_EDGES","$.relations","","Timeline scenes exist but no relation has chapters","为随时间变化的关系添加章节区间。");
  if(doc.characters.filter(c=>!c.position).length/doc.characters.length>.5)warn("MISSING_POSITIONS","$.characters","","More than half of characters lack positions","给关键人物预置坐标，避免开场布局跳动。");
  return {valid:errors.length===0,errors,warnings};
}
export function visibleStory(doc,chapter=null,spoilerSafe=true){
  const point=Number.isFinite(chapter)?chapter:null;
  // Quotations without a known chapter remain hidden whenever a chapter is selected.
  // Never change the source document.
  const visibleQuote=q=>point===null||(q.at!==undefined&&q.at<=point);
  const characters=doc.characters
    .filter(c=>point===null||c.firstAppearance===undefined||c.firstAppearance<=point)
    .map(c=>{
      if(!spoilerSafe)return c;
      const bio={...c.bio};
      delete bio.fate;
      // A complete character arc is also a potential future spoiler.
      delete bio.arc;
      if(bio.quotes)bio.quotes=bio.quotes.filter(visibleQuote).map(q=>({...q}));
      // v0.1 has no timestamp for a death event. Do not leak mortality status.
      return {...c,bio,status:c.status==='deceased'?'unknown':c.status};
    });
  const ids=new Set(characters.map(c=>c.id));
  const relations=doc.relations
    .filter(r=>ids.has(r.source)&&ids.has(r.target)&&(point===null||((r.chapters?.from??1)<=point&&(r.chapters?.to??Infinity)>=point)))
    .map(r=>{
      if(!spoilerSafe)return r;
      const safe={...r};
      if(r.evidence)safe.evidence=r.evidence.filter(visibleQuote).map(q=>({...q}));
      return safe;
    });
  const bios=Object.fromEntries(characters.map(c=>[c.id,c.bio]));
  return {characters,relations,bios};
}
export function timelineScenes(doc){
  let startSec=0,chapter=null;
  return (doc.presentation||[]).map(step=>{
    if(step.chapterAt!==undefined)chapter=step.chapterAt;
    const s={...step,startSec,endSec:startSec+step.durationSec,chapter};
    startSec=s.endSec;
    return s;
  });
}
