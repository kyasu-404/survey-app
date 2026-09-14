/* global Asc, Api */
(function(){
 'use strict';
 const $=id=>document.getElementById(id),el=(tag,text,cls)=>{const n=document.createElement(tag);if(text!==undefined)n.textContent=text;if(cls)n.className=cls;return n;};
 let context,sources,busy=false,initialized=false;
 const error=e=>{$('error').textContent=e?.message || String(e);$('error').hidden=false;};
 const method=(name,args)=>new Promise(resolve=>Asc.plugin.executeMethod(name,args,resolve));
 function command(fn,data){Asc.scope.data=data;return new Promise((resolve,reject)=>Asc.plugin.callCommand(fn,false,true,r=>r===undefined || r?.error ? reject(new Error(r?.error || 'Редактор не выполнил команду')) : resolve(r)));}
 async function api(path,method='GET'){const r=await fetch(context.apiBaseUrl+path,{method,headers:{Authorization:'Bearer '+context.token},signal:AbortSignal.timeout(90000)}),data=await r.json();if(!r.ok)throw new Error(data.message || 'Не удалось загрузить форму');return data;}
 async function action(fn){if(busy)return;busy=true;$('error').hidden=true;$('status').textContent='Выполняется…';try{await fn();$('status').textContent='Макет проверен. Значения ответов появятся только в выгрузке.';}catch(e){error(e);$('status').textContent='Операция не завершена';}finally{busy=false;}}
 function render(){
  const term=$('search').value.toLocaleLowerCase();$('field-list').replaceChildren();$('question-list').replaceChildren();
  sources.fields.filter(f=>f.label.toLocaleLowerCase().includes(term)).forEach(f=>{const b=el('button',f.label,'field');b.onclick=()=>action(()=>insert('system',f.id,f.label));$('field-list').append(b);});
  let lastPath;
  sources.questions.filter(q=>(q.title+' '+q.name+' '+q.path).toLocaleLowerCase().includes(term)).forEach(q=>{
   if(q.path!==lastPath){$('question-list').append(el('h2',q.path || 'Вопросы'));lastPath=q.path;}
   const b=el('button',undefined,'field question');b.append(el('span',q.title),el('small',q.name));b.disabled=Boolean(q.unsupported);b.title=q.unsupported || 'Вставить поле в выбранное место';b.onclick=()=>action(()=>insert('question',q.integrationId,q.title));$('question-list').append(b);
  });
 }
 async function scan(){
  const items=await command(function(){try{
   if(Asc.scope.data==='xlsx')return Api.GetAllComments().filter(c=>c.GetText().indexOf('survey-')===0).map(c=>({tag:c.GetText(),commentId:c.GetId(),location:c.GetQuoteText()}));
   return Api.GetDocument().GetAllContentControls().map(cc=>({tag:cc.GetTag(),label:cc.GetAlias()})).filter(cc=>cc.tag && cc.tag.indexOf('survey-')===0);
  }catch(e){return {error:'Не удалось проверить поля: '+e.message};}},context.fileType);
  $('bindings').replaceChildren();$('binding-count').textContent='Связанных полей: '+items.length;
  for(const item of items){
   let kind,id;
   if(item.tag){const match=/^survey-(question|system):(.+)$/.exec(item.tag);if(match){kind=match[1];id=match[2];}}
   else {let m=/^_survey_q_([a-f0-9]{32})_[a-f0-9]{32}$/i.exec(item.name);if(m){kind='question';const v=m[1];id=v.slice(0,8)+'-'+v.slice(8,12)+'-'+v.slice(12,16)+'-'+v.slice(16,20)+'-'+v.slice(20);}m=/^_survey_s_(.+)_[a-f0-9]{32}$/i.exec(item.name);if(m){kind='system';id=m[1];}}
   const source=kind==='question'?sources.questions.find(q=>q.integrationId===id):sources.fields.find(f=>f.id===id);
   const box=el('div',undefined,'binding');box.append(el('strong',source?.title || source?.label || item.label || 'Неизвестное поле'));
   if(!source || source.unsupported || item.location?.includes('#REF!'))box.append(el('p','Источник или ячейка удалены. Удалите это поле и вставьте нужный вопрос.','warning'));
   else box.append(el('p',item.location || 'Вопрос связан с макетом'));
   const remove=el('button','Снять связь');remove.onclick=()=>action(async()=>{
    await command(function(){try{if(Asc.scope.data.commentId){const c=Api.GetCommentById(Asc.scope.data.commentId);if(c)c.Delete();}else Api.GetDocument().GetContentControlsByTag(Asc.scope.data.tag).forEach(cc=>cc.SetTag(''));return true;}catch(e){return {error:e.message};}},item);await scan();
   });box.append(remove);$('bindings').append(box);
  }
 }
 async function insert(kind,id,label){
  if(context.fileType==='xlsx'){
   await command(function(){try{
    const d=Asc.scope.data,selection=Api.GetSelection().GetCells(1,1);
    const existing=selection.GetComment();
    if(existing && existing.GetText().indexOf('survey-')!==0)return {error:'В этой ячейке уже есть примечание. Перенесите его перед вставкой поля.'};
    if(existing)existing.SetText(d.tag);else if(!selection.AddComment(d.tag,'Данные формы'))return {error:'Не удалось связать ячейку. Проверьте защиту листа.'};
    selection.SetValue('['+d.label+']');return true;
   }catch(e){return {error:e.message};}},{tag:'survey-'+kind+':'+id,label});
  }else{
   const current=await method('GetCurrentContentControl',[]);if(current)throw new Error('Поставьте курсор вне другого связанного поля.');
   const tag='survey-'+kind+':'+id,temp='survey-insert:'+crypto.randomUUID();
   await method('AddContentControl',[2,{Tag:temp,Alias:label,Lock:3}]);
   await command(function(){try{
    const d=Asc.scope.data,cc=Api.GetDocument().GetContentControlsByTag(d.temp)[0];if(!cc)return {error:'Не удалось вставить поле в выбранное место'};
    let run;for(let i=0;i<cc.GetElementsCount();i++){const r=cc.GetElement(i);if(r.GetClassType()==='run'){run=r.Copy();break;}}
    if(!run)run=Api.CreateRun();run.ClearContent();run.AddText('['+d.label+']');cc.RemoveAllElements();cc.AddElement(run,0);cc.SetTag(d.tag);cc.MoveCursorOutside(true);return true;
   }catch(e){return {error:e.message};}},{temp,tag,label});
  }
  await scan();
 }
 async function init(){if(initialized)return;context=Asc.plugin.info?.options || Asc.plugin.options;if(!context?.token && typeof Asc.plugin.getOptions==='function')context=Asc.plugin.getOptions();if(!context?.token)throw new Error('Откройте макет из Survey-app');if(new URL(context.apiBaseUrl).origin!==location.origin)throw new Error('Недопустимый адрес API');initialized=true;
  sources=await api('/forms/'+context.formId+'/sources');render();$('main').hidden=false;await scan();$('instructions').textContent=context.fileType==='xlsx'?'Выберите ячейку, затем вопрос. В выделенной области заполняется верхняя левая ячейка.':'Поставьте курсор в нужное место и выберите вопрос.';$('status').textContent='Выберите место в макете и вопрос.';
  setInterval(()=>api('/documents/'+context.documentId+'/refresh-token','POST').then(r=>{context.token=r.token;}).catch(error),8*60*1000);
 }
 Asc.plugin.init=()=>init().catch(error);Asc.plugin.button=()=>Asc.plugin.executeCommand('close','');$('search').oninput=render;$('check').onclick=()=>action(async()=>{sources=await api('/forms/'+context.formId+'/sources');render();await scan();});
})();
