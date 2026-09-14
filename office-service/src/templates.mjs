import {XMLParser, XMLBuilder, XMLValidator} from 'fast-xml-parser';
import {zipSync,strToU8,strFromU8} from 'fflate';
import {posix} from 'node:path';
import {validateOffice,DOCX_MIME} from './docx.mjs';
import {requireValue,uuid} from './security.mjs';
export const XLSX_MIME='application/vnd.openxmlformats-officedocument.spreadsheetml.sheet';
export const mimeFor=format=>format==='zip' ? 'application/zip' : format==='xlsx' ? XLSX_MIME : DOCX_MIME;
export const systemFields=[['form_title','Название формы'],['response_id','ID ответа'],['response_date','Дата ответа'],['response_updated_at','Дата последнего изменения']].map(([id,label])=>({id,label}));
const plain=v=>typeof v==='string' ? v.replace(/<[^>]*>/g,'') : v && typeof v==='object' ? plain(v.ru ?? v.default ?? Object.values(v)[0]) : String(v ?? '');
export function templateSources(schema) {
  const result=[];
  function walk(nodes,path=[],repeated=false){for(const [i,q] of (nodes || []).entries()){
    const label=plain(q.title)||q.name||`Страница ${i+1}`;
    if(q.integrationId && !['html','sectiontitle','panel'].includes(q.type))result.push({integrationId:q.integrationId,name:q.name,valueName:q.valueName || q.name,title:label,path:path.join(' / '),type:q.type,inputType:q.inputType,definition:q,unsupported:repeated ? 'Поля внутри повторяющихся панелей пока не поддерживаются' : null});
    walk(q.elements,[...path,label],repeated);walk(q.templateElements,[...path,label],true);walk(q.pages,[...path,label],repeated);
  }}walk(schema.pages || schema.elements);return result;
}
const options={preserveOrder:true,ignoreAttributes:false,attributeNamePrefix:'@_',parseTagValue:false,parseAttributeValue:false,trimValues:false,processEntities:true,htmlEntities:true};
const parser=new XMLParser(options),builder=new XMLBuilder({...options,suppressEmptyNode:true});
const key=n=>Object.keys(n).find(k=>k!==':@');
const children=(nodes,name)=>nodes.filter(n=>key(n)===name);
const attr=(node,name)=>node?.[':@']?.['@_'+name];
const walk=(nodes,fn)=>{for(const n of nodes){fn(n);if(Array.isArray(n[key(n)]))walk(n[key(n)],fn);}};
const find=(nodes,name)=>{let found;walk(nodes,n=>{if(!found && key(n)===name)found=n;});return found;};
const contentText=nodes=>{let result='';walk(nodes,n=>{if(n['#text']!==undefined)result+=n['#text'];});return result;};
function parse(bytes){const xml=strFromU8(bytes);requireValue(!/<!DOCTYPE|<!ENTITY/i.test(xml) && XMLValidator.validate(xml)===true,'Некорректный XML макета');return parser.parse(xml);}
const encode=nodes=>strToU8(builder.build(nodes));
export function tagSource(tag){
  if(tag?.startsWith('survey-question:')){const id=tag.slice(16);return uuid(id) ? {kind:'question',id:id.toLowerCase()} : {error:'Неверный ID вопроса'};}
  if(tag?.startsWith('survey-system:')){const id=tag.slice(14);return systemFields.some(f=>f.id===id) ? {kind:'system',id} : {error:'Неизвестное системное поле'};}
  if(tag?.startsWith('survey-binding:'))return {error:'Старый сводный элемент: удалите его и вставьте вопрос из новой панели'};
  return null;
}
export function nameSource(name){
  let m=/^_survey_q_([a-f0-9]{32})_[a-f0-9]{32}$/i.exec(name || '');
  if(m){const v=m[1].toLowerCase();return tagSource('survey-question:'+`${v.slice(0,8)}-${v.slice(8,12)}-${v.slice(12,16)}-${v.slice(16,20)}-${v.slice(20)}`);}
  m=/^_survey_s_(form_title|response_id|response_date|response_updated_at)_[a-f0-9]{32}$/i.exec(name || '');
  if(m)return {kind:'system',id:m[1]};
  return name?.startsWith('_survey_') ? {error:'Некорректная связь ячейки'} : null;
}
export function blankXlsx(){const ns='http://schemas.openxmlformats.org/spreadsheetml/2006/main',rel='http://schemas.openxmlformats.org/package/2006/relationships';return Buffer.from(zipSync({
 '[Content_Types].xml':strToU8(`<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/><Override PartName="/xl/workbook.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"/><Override PartName="/xl/worksheets/sheet1.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/></Types>`),
 '_rels/.rels':strToU8(`<Relationships xmlns="${rel}"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="xl/workbook.xml"/></Relationships>`),
 'xl/workbook.xml':strToU8(`<workbook xmlns="${ns}" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"><sheets><sheet name="Лист1" sheetId="1" r:id="rId1"/></sheets></workbook>`),
 'xl/_rels/workbook.xml.rels':strToU8(`<Relationships xmlns="${rel}"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="worksheets/sheet1.xml"/></Relationships>`),
 'xl/worksheets/sheet1.xml':strToU8(`<worksheet xmlns="${ns}"><sheetData/></worksheet>`)
},{level:6}));}
export function readTemplate(bytes,format,maxBytes=100*1024*1024){
 const files=validateOffice(bytes,maxBytes,format),parts=new Map(),bindings=[];
 const part=name=>{requireValue(files[name],'Отсутствует часть макета: '+name);if(!parts.has(name))parts.set(name,parse(files[name]));return parts.get(name);};
 if(format==='docx'){
  for(const name of Object.keys(files).filter(n=>/^word\/(document|header\d+|footer\d+|footnotes|endnotes)\.xml$/.test(n))){
   walk(part(name),node=>{if(key(node)!=='w:sdt')return;const pr=children(node['w:sdt'],'w:sdtPr')[0],tag=pr && attr(find(pr['w:sdtPr'],'w:tag'),'w:val'),source=tagSource(tag);if(!source)return;
    const content=children(node['w:sdt'],'w:sdtContent')[0];let nested=false;if(content)walk(content['w:sdtContent'],n=>{if(key(n)==='w:sdt')nested=true;});
    bindings.push({...source,tag,part:name,node,content,error:source.error || (!content || nested ? 'Вложенные поля или некорректный элемент макета' : undefined)});
   });
  }
 }else{
  const workbook=part('xl/workbook.xml'),rels=part('xl/_rels/workbook.xml.rels'),sheets=new Map();
  walk(workbook,n=>{if(key(n)==='sheet'){let target;walk(rels,r=>{if(key(r)==='Relationship' && attr(r,'Id')===attr(n,'r:id') && !attr(r,'TargetMode'))target=attr(r,'Target');});if(target){const path=posix.normalize(target.startsWith('/')?target.slice(1):'xl/'+target);requireValue(path.startsWith('xl/'),'Недопустимый путь листа');sheets.set(attr(n,'name'),path);}}});
  const seen=new Set();
  // Cell notes carry the question ID and naturally follow copied/moved cells.
  for(const [sheetName,path] of sheets){
   const relPath=posix.join(posix.dirname(path),'_rels',posix.basename(path)+'.rels');if(!files[relPath])continue;
   walk(part(relPath),rel=>{if(key(rel)!=='Relationship' || !attr(rel,'Type')?.endsWith('/comments') || attr(rel,'TargetMode'))return;
    const target=attr(rel,'Target'),commentPath=posix.normalize(target.startsWith('/')?target.slice(1):posix.join(posix.dirname(path),target));requireValue(commentPath.startsWith('xl/'),'Недопустимый путь примечаний');
    walk(part(commentPath),comment=>{if(key(comment)!=='comment')return;const text=find(comment.comment,'text'),raw=text ? contentText(text.text).trim() : '',tag=raw.match(/(?:^|\n)(survey-(?:question|system):[^\r\n]+)(?:\r?\n|$)/)?.[1] || raw,source=tagSource(tag);if(!source)return;
     const address=attr(comment,'ref');let cell;walk(part(path),n=>{if(key(n)==='c' && attr(n,'r')===address)cell=n;});
     const position=path+':'+address,duplicate=seen.has(position);seen.add(position);
     bindings.push({...source,tag,part:path,address,node:cell,commentPath,comment,error:source.error || (!cell ? 'Связанная ячейка удалена: '+sheetName+'!'+address : duplicate ? 'В ячейке несколько связей' : undefined)});
    });
   });
  }
  walk(workbook,node=>{if(key(node)!=='definedName')return;const source=nameSource(attr(node,'name'));if(!source)return;
   const ref=contentText(node.definedName).replace(/^=/,''),m=/^(?:'((?:[^']|'')+)'|([^'!]+))!\$?([A-Z]{1,3})\$?([1-9][0-9]*)$/.exec(ref);
   const path=m && sheets.get((m[1]||m[2]).replace(/''/g,"'")),address=m && m[3]+m[4];let cell;
   if(path)walk(part(path),n=>{if(key(n)==='c' && attr(n,'r')===address)cell=n;});
   const position=path+':'+address,duplicate=seen.has(position);seen.add(position);
   bindings.push({...source,name:attr(node,'name'),part:path,address,node:cell,error:source.error || (!cell ? 'Связанная ячейка удалена: '+ref : duplicate ? 'В ячейке несколько разных связей: '+ref : undefined)});
  });
 }
 requireValue(bindings.length<=1000,'В макете более 1000 полей');
 return {format,files,parts,bindings};
}
export function checkTemplate(template,form){
 const questions=new Map(templateSources(form.schema).map(q=>[q.integrationId.toLowerCase(),q]));
 return template.bindings.map(b=>({kind:b.kind,id:b.id,location:b.address ? b.part+'!'+b.address : b.part,label:b.kind==='question' ? questions.get(b.id)?.title : systemFields.find(f=>f.id===b.id)?.label,error:b.error || (b.kind==='question' ? !questions.has(b.id) ? 'Вопрос удалён или относится к другой форме' : questions.get(b.id).unsupported : undefined)}));
}
function display(value,definition,orgs){
 if(value===undefined || value===null)return '';
 if(definition?.type==='signaturepad')return value ? '[Подпись]' : '';
 if(definition?.type==='file')return (Array.isArray(value)?value:[value]).map(v=>v?.name || 'Файл').join('; ');
 if(Array.isArray(value))return value.map(v=>display(v,definition,orgs)).join('; ');
 if(definition?.type==='organization'){const org=orgs.find(o=>o.id===value);return org ? [org.alias,org.number].filter(Boolean).join(' ') : String(value);}
 const choice=(definition?.choices || []).find(c=>String(typeof c==='object'?c.value:c)===String(value));
 if(choice!==undefined)return plain(typeof choice==='object'?choice.text ?? choice.value:choice);
 if(typeof value==='object')return Object.entries(value).map(([k,v])=>`${k}: ${display(v,null,orgs)}`).join('; ');
 return typeof value==='boolean' ? value ? 'Да':'Нет' : String(value);
}
export function responseValues(form,response,organizations=[]){
 const values=new Map();
 for(const q of templateSources(form.schema)){
  const raw=response.data?.[q.valueName];let value=display(raw,q.definition,organizations);
  if((q.inputType==='number'||['number','integer','rating'].includes(q.type)) && typeof raw==='number' && Number.isFinite(raw))value=raw;
  values.set('question:'+q.integrationId.toLowerCase(),value);
 }
 const date=v=>v ? new Date(v).toLocaleString('ru-RU',{timeZone:'Europe/Moscow'}) : '';
 for(const [id,value] of Object.entries({form_title:form.title,response_id:response.id,response_date:date(response.created_at),response_updated_at:date(response.updated_at || response.created_at)}))values.set('system:'+id,value);
 return values;
}
function wordRun(text,format){return {'w:r':[...(format?[structuredClone(format)]:[]),...String(text).replace(/[\x00-\x08\x0b\x0c\x0e-\x1f]/g,'').split(/\r\n|\r|\n/).flatMap((line,i)=>[...(i?[{'w:br':[]}]:[]),{'w:t':[{'#text':line}],':@':{'@_xml:space':'preserve'}}])]};}
export function renderTemplate(template,values){
 // Each response starts from an independent tree; original ZIP bytes never change.
 const parts=structuredClone(template.parts),files={...template.files};
 if(template.format==='docx'){
  for(const nodes of parts.values())walk(nodes,node=>{if(key(node)!=='w:sdt')return;const pr=children(node['w:sdt'],'w:sdtPr')[0],source=pr && tagSource(attr(find(pr['w:sdtPr'],'w:tag'),'w:val'));if(!source || source.error)return;
   const content=children(node['w:sdt'],'w:sdtContent')[0],old=content['w:sdtContent'],run=wordRun(values.get(source.kind+':'+source.id) ?? '',find(old,'w:rPr'));
   const p=children(old,'w:p')[0];content['w:sdtContent']=p ? [{'w:p':[...children(p['w:p'],'w:pPr'),run]}] : [run];
   pr['w:sdtPr']=pr['w:sdtPr'].filter(n=>!['w:tag','w:alias','w:showingPlcHdr','w:dataBinding','w:placeholder'].includes(key(n)));
  });
 }else{
  for(const binding of template.bindings){let cell;walk(parts.get(binding.part),n=>{if(key(n)==='c'&&attr(n,'r')===binding.address)cell=n;});
   const value=values.get(binding.kind+':'+binding.id) ?? '';
   if(typeof value==='number'){cell[':@']['@_t']='n';cell.c=[{v:[{'#text':value}]}];}
   else {requireValue(String(value).length<=32767,'Ответ превышает 32767 символов в ячейке XLSX');cell[':@']['@_t']='inlineStr';cell.c=[{is:[{t:[{'#text':String(value).replace(/[\x00-\x08\x0b\x0c\x0e-\x1f]/g,'')}],':@':{'@_xml:space':'preserve'}}]}];}
  }
  for(const name of Object.keys(files).filter(n=>/^xl\/threadedComments\/[^/]+\.xml$/.test(n))){
   const nodes=parse(files[name]);walk(nodes,n=>{if(Array.isArray(n[key(n)]))n[key(n)]=n[key(n)].filter(c=>key(c)!=='ThreadedComment' && key(c)!=='threadedComment' || !tagSource(contentText(c[key(c)]).trim()));});parts.set(name,nodes);
  }
  for(const binding of template.bindings.filter(b=>b.commentPath)){
   const list=find(parts.get(binding.commentPath),'commentList');if(list)list.commentList=list.commentList.filter(n=>key(n)!=='comment' || attr(n,'ref')!==binding.address);
  }
  const wb=find(parts.get('xl/workbook.xml'),'workbook');
  const names=children(wb.workbook,'definedNames')[0];if(names)names.definedNames=names.definedNames.filter(n=>!nameSource(attr(n,'name')));
  let calc=children(wb.workbook,'calcPr')[0];if(!calc){calc={calcPr:[]};wb.workbook.push(calc);}calc[':@']={...(calc[':@']||{}),'@_fullCalcOnLoad':'1','@_forceFullCalc':'1','@_calcMode':'auto'};
  // Leave formulas and their styles intact; discard cached results so Excel recalculates.
  for(const name of Object.keys(files).filter(n=>/^xl\/worksheets\/[^/]+\.xml$/.test(n))){if(!parts.has(name))parts.set(name,parse(files[name]));walk(parts.get(name),n=>{if(key(n)==='c' && children(n.c,'f').length){n.c=n.c.filter(c=>key(c)!=='v');if(n[':@']?.['@_t']==='e')delete n[':@']['@_t'];}});}
 }
 for(const [name,nodes] of parts)files[name]=encode(nodes);
 return Buffer.from(zipSync(files,{level:6}));
}
export function generateArchive({bytes,format,form,responses,organizations=[],nameQuestionId,name,includeManifest=false}){
 requireValue(responses.length>0 && responses.length<=500,'Выберите от 1 до 500 ответов');
 const template=readTemplate(Buffer.from(bytes),format),checked=checkTemplate(template,form);
 requireValue(checked.length>0,'В макете нет полей. Откройте редактор и вставьте вопросы.');
 const broken=checked.filter(b=>b.error);requireValue(!broken.length,broken.map(b=>(b.label || b.id || 'Поле')+': '+b.error).join('; ').slice(0,1500));
 if(nameQuestionId)requireValue(templateSources(form.schema).some(q=>q.integrationId===nameQuestionId && !q.unsupported),'Вопрос для имени файла удалён');
 const safe=v=>{let text=String(v).normalize('NFC').replace(/[<>:"/\\|?*\x00-\x1f\x7f]/g,'_').replace(/^[. ]+|[. ]+$/g,'');while(Buffer.byteLength(text)>70)text=Array.from(text).slice(0,-1).join('');return text || 'Ответ';};
 const outputs={};let total=0;
 for(const [index,response] of responses.entries()){
  const values=responseValues(form,response,organizations),file=renderTemplate(template,values);total+=file.length;
  requireValue(total<=90*1024*1024,'Результат больше 90 МБ. Выберите меньше ответов.');
  const prefix=nameQuestionId ? values.get('question:'+nameQuestionId.toLowerCase()) : 'Ответ';
  const filename=`${safe(prefix)} — ${safe(name.replace(/\.(docx|xlsx)$/i,''))} — ${String(index+1).padStart(3,'0')}-${response.id}.${format}`;
  outputs[filename]=[file,{level:0}];
 }
 const archive=Buffer.from(zipSync(outputs));return includeManifest ? {bytes:archive,files:Object.keys(outputs)} : archive;
}
