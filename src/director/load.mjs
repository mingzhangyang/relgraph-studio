import {adaptLiteratureDocument,literaryDetailsAt} from '../domains/literature.mjs';
import {validateRelGraph} from '../relgraph.mjs';
import {adaptBiologyDocument,validateBiologyDocument} from '../domains/biology.mjs';

const issue=(code,path,message,fix,id='')=>({level:'error',layer:'studio',code,path,id,message,fix});

// Structural diagnostics originate in the source validator, which may not know
// the enclosing record. Recover it without ever displaying the source value.
function withOwner(doc, entry) {
  if (entry.id) return entry;
  const match = String(entry.path).match(/^\$?\.?(characters|relations|factions|entities|interactions|processes|compartments|presentation)\[(\d+)\]/);
  const id = match && doc?.[match[1]]?.[Number(match[2])]?.id;
  return {...entry, id:typeof id === 'string' ? id : ''};
}

/** One entry point for built-in examples and local JSON files. */
export function loadDocument(doc) {
  try {
    let adapted,sourceDiagnostics;
    if (doc && typeof doc === 'object' && !Array.isArray(doc) && Object.hasOwn(doc,'schemaVersion')) {
      sourceDiagnostics=validateRelGraph(doc);
      if(!sourceDiagnostics.valid)return {valid:false,errors:sourceDiagnostics.errors.map(entry=>withOwner(doc,entry)),warnings:(sourceDiagnostics.warnings||[]).map(entry=>withOwner(doc,entry))};
      adapted=adaptLiteratureDocument(doc);
    } else if (doc && typeof doc === 'object' && !Array.isArray(doc) && Object.hasOwn(doc,'format')) {
      sourceDiagnostics=validateBiologyDocument(doc);
      if(!sourceDiagnostics.valid)return {valid:false,errors:sourceDiagnostics.errors.map(entry=>withOwner(doc,entry)),warnings:(sourceDiagnostics.warnings||[]).map(entry=>withOwner(doc,entry))};
      adapted=adaptBiologyDocument(doc);
    } else {
      return {valid:false,errors:[issue('FORMAT','$','无法识别数据格式。','文学数据需要 schemaVersion: "0.1"；生物学数据需要 format: "relgraph.bio/0.1-draft"。')],warnings:[]};
    }
    const {graph,diagnostics}=adapted;
    const errors=[];
    if (!graph.scenes.length) errors.push(issue('NO_SCENES','$.presentation','没有可播放的分镜。','请在 presentation 中至少添加一个分镜。'));
    // An unspecified time normally means unrestricted visibility. Do not allow
    // timed facts to leak before the first explicitly selected domain time.
    const hasTimedFacts=[...graph.nodes,...graph.edges].some(item=>item.visibility && (item.visibility.from!==undefined || item.visibility.to!==undefined));
    if (hasTimedFacts && graph.scenes.length && graph.scenes[0].domainAt===undefined) {
      const field=graph.domain==='literature'?'chapterAt':'domainAt';
      errors.push(issue('INITIAL_DOMAIN_TIME',`$.presentation[0].${field}`,'数据包含时间范围，但首个分镜没有指定领域时间。',`为首个分镜设置 ${field}，以避免提前显示未来对象。`,graph.scenes[0].id));
    }
    const warnings=(diagnostics.warnings||[]).map(entry=>withOwner(doc,entry));
    if (errors.length) return {valid:false,errors,warnings};
    const detailAt=graph.domain==='literature'?(id,at)=>literaryDetailsAt(doc,at,{spoilerSafe:true})[id]:()=>undefined;
    return {valid:true,graph,errors:[],warnings,detailAt};
  } catch (error) {
    const entries=Array.isArray(error?.issues)&&error.issues.length ? error.issues : [issue('INVALID_DATA','$','数据无法转换为图谱。','检查文件格式、字段类型和必填字段后重试。')];
    return {valid:false,errors:entries.map(entry=>withOwner(doc,entry)),warnings:[]};
  }
}

export function parseDocument(text) {
  try { return loadDocument(JSON.parse(text)); }
  catch (error) { return {valid:false,errors:[issue('JSON','$',`JSON 语法错误：${error.message}`,'检查引号、逗号和括号后重试。')],warnings:[]}; }
}
