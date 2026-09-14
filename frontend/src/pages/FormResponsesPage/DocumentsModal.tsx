import {useEffect,useRef,useState} from 'react';
import {useQuery,useQueryClient} from '@tanstack/react-query';
import {useNavigate} from 'react-router-dom';
import {useAuth} from '../../app/providers/AuthProvider';
import {useToast} from '../../app/providers/ToastProvider';
import {officeRequest,downloadOfficeDocument,type OfficeDocument,type OfficeResult} from '../../entities/office/api';
import {getErrorMessage} from '../../shared/lib/error';
import {SectionTabs} from '../../shared/ui/SectionTabs';
import {GenerateDocuments} from './GenerateDocuments';
import {DocumentResults} from './DocumentResults';
import useIcon from '../../img/use.svg';
import editIcon from '../../img/edit.svg';
import downloadIcon from '../../img/Download.svg';
import renameIcon from '../../img/rename.svg';
import copyIcon from '../../img/copy.svg';
import deleteIcon from '../../img/delete.svg';
import '../../entities/office/office.css';
export function DocumentsModal({formId,onClose,selectedResponseIds=[]}:{formId:string;onClose:()=>void;selectedResponseIds?:string[]}){
 const navigate=useNavigate(),queryClient=useQueryClient(),{showToast}=useToast(),{user,profile}=useAuth();
 const dialog=useRef<HTMLDialogElement>(null),file=useRef<HTMLInputElement>(null);
 const [search,setSearch]=useState(''),[name,setName]=useState('Новый макет'),[tab,setTab]=useState<'templates'|'results'>('templates'),[focusResult,setFocusResult]=useState<string>();
 const [mode,setMode]=useState<'create'|'rename'|null>(null),[selected,setSelected]=useState<OfficeDocument|null>(null),[menu,setMenu]=useState<string|null>(null);
 const [format,setFormat]=useState<'xlsx'|'docx'>('xlsx'),[generation,setGeneration]=useState<OfficeDocument|null>(null),[busy,setBusy]=useState(false),[error,setError]=useState('');
 const query=useQuery({queryKey:['office-documents',formId],queryFn:()=>officeRequest<{documents:OfficeDocument[];enabled:boolean;max_file_mb:number;response_count:number}>(`/forms/${formId}/documents`),staleTime:0,refetchOnMount:'always'});
 useEffect(()=>{dialog.current?.showModal();},[]);
 useEffect(()=>{const close=(e:MouseEvent)=>{if(!(e.target as Element).closest('.office-menu-shell'))setMenu(null);};document.addEventListener('click',close);return()=>document.removeEventListener('click',close);},[]);
 useEffect(()=>{if(!menu)return;const frame=requestAnimationFrame(()=>dialog.current?.querySelector('[role="menu"]')?.scrollIntoView({block:'nearest'}));return()=>cancelAnimationFrame(frame);},[menu]);
 async function run(fn:()=>Promise<unknown>){setBusy(true);setError('');setMenu(null);try{await fn();setMode(null);await query.refetch();}catch(e){setError(getErrorMessage(e,'Не удалось выполнить операцию'));}finally{setBusy(false);}}
 async function generated(result:OfficeResult){queryClient.setQueryData<{results:OfficeResult[]}>(['office-results',formId],old=>({results:[result,...(old?.results || []).filter(r=>r.id!==result.id)]}));setGeneration(null);setFocusResult(result.id);setTab('results');showToast('Документы сформированы','success');await queryClient.invalidateQueries({queryKey:['office-results',formId]});}
 return <dialog ref={dialog} className="office-dialog" onCancel={onClose} aria-labelledby="documents-title">
  <header><div><p className="office-eyebrow">Документы формы</p><h2 id="documents-title">Документы</h2></div><button type="button" className="app-button" onClick={onClose} aria-label="Закрыть документы">×</button></header>
  <SectionTabs id="documents" label="Документы формы" tabs={[{value:'templates',label:'Макеты'},{value:'results',label:'Результат'}]} value={tab} onChange={value=>{setTab(value);setMenu(null);}}/>
  <div className="office-tab-panel" role="tabpanel" id="documents-panel-templates" aria-labelledby="documents-tab-templates" hidden={tab!=='templates'}>
   <p className="office-muted">Загрузите XLSX или DOCX и выберите места для ответов. Каждый ответ станет отдельным документом.</p>
   <input aria-label="Поиск документов" placeholder="Поиск макетов…" value={search} onChange={e=>setSearch(e.target.value)}/>
   {(error || query.error) && <p role="alert" className="office-error">{error || getErrorMessage(query.error,'Не удалось загрузить макеты')}</p>}
   {query.data && !query.data.enabled && <p className="office-notice">ONLYOFFICE отключён. Файлы доступны для скачивания и управления.</p>}
   {query.isLoading && <p role="status">Загрузка макетов…</p>}
   {generation && <GenerateDocuments key={generation.id} doc={generation} total={query.data?.response_count ?? 0} selectedIds={selectedResponseIds} onClose={()=>setGeneration(null)} onGenerated={result=>void generated(result)}/>}
   <div className="office-document-list">
    {query.data?.documents.filter(d=>d.name.toLocaleLowerCase().includes(search.toLocaleLowerCase())).map(doc=><article key={doc.id}>
     <div className="office-document-copy"><strong>{doc.name}</strong><span>{doc.author_name || 'Сотрудник'} · {new Date(doc.updated_at).toLocaleString('ru-RU')}</span><span>Полей макета: {doc.binding_count} · {(doc.size_bytes/1024).toLocaleString('ru-RU',{maximumFractionDigits:0})} КБ</span>{doc.last_save_error && <span className="office-error">{doc.last_save_error}</span>}</div>
     <div className="office-document-actions">
      <span className="organizations-row-actions"><button type="button" className="organization-edit-button" disabled={busy || !query.data?.enabled} onClick={()=>navigate(`/forms/${formId}/documents/${doc.id}`)}>Редактировать<img src={editIcon} alt="" aria-hidden="true"/></button></span>
      <button type="button" className="responses-export-button responses-html-button" disabled={busy} onClick={()=>{setGeneration(doc);setSelected(null);setMode(null);setMenu(null);dialog.current?.scrollTo({top:0,behavior:'smooth'});}}>Сформировать документы<img src={useIcon} alt="" aria-hidden="true" className="toolbar-icon"/></button>
      <div className={`office-menu-shell form-menu ${menu===doc.id?'office-menu-open':''}`}><button type="button" className="form-menu-trigger" aria-label={`Действия: ${doc.name}`} aria-expanded={menu===doc.id} onClick={()=>setMenu(menu===doc.id?null:doc.id)}>...</button>
       {menu===doc.id && <div className="form-menu-dropdown" role="menu" aria-label={`Действия: ${doc.name}`} onKeyDown={e=>{if(e.key==='Escape'){e.stopPropagation();setMenu(null);}}}>
        <button type="button" role="menuitem" className="form-menu-item" disabled={busy} onClick={()=>void run(()=>downloadOfficeDocument(doc))}><img src={downloadIcon} alt="" className="form-menu-item-icon"/><span className="form-menu-item-label">Скачать</span></button>
        <button type="button" role="menuitem" className="form-menu-item" disabled={busy} onClick={()=>{setSelected(doc);setName(doc.name.replace(/\.(docx|xlsx)$/i,''));setMode('rename');setMenu(null);}}><img src={renameIcon} alt="" className="form-menu-item-icon"/><span className="form-menu-item-label">Переименовать</span></button>
        <button type="button" role="menuitem" className="form-menu-item" disabled={busy} onClick={()=>void run(()=>officeRequest(`/documents/${doc.id}/copy`,{method:'POST'}))}><img src={copyIcon} alt="" className="form-menu-item-icon"/><span className="form-menu-item-label">Создать копию</span></button>
        {(doc.created_by===user?.id || profile?.role==='admin') && <button type="button" role="menuitem" className="form-menu-item form-menu-item-danger" disabled={busy} onClick={()=>{setSelected(doc);setMode(null);setMenu(null);}}><img src={deleteIcon} alt="" className="form-menu-item-icon"/><span className="form-menu-item-label">Удалить</span></button>}
       </div>}
      </div>
     </div>
    </article>)}
    {query.data?.documents.length===0 && <p className="office-empty">Макетов пока нет. Загрузите файл или создайте новый.</p>}
   </div>
   {selected && !mode && <div className="office-notice"><p>Удалить «{selected.name}»?</p><button type="button" className="app-button danger" disabled={busy} onClick={()=>void run(async()=>{await officeRequest(`/documents/${selected.id}`,{method:'DELETE'});setSelected(null);})}>Удалить документ</button><button type="button" className="app-button" onClick={()=>setSelected(null)}>Отмена</button></div>}
   {mode && <form className="office-create" onSubmit={e=>{e.preventDefault();void run(async()=>{if(mode==='rename' && selected){await officeRequest(`/documents/${selected.id}`,{method:'PATCH',body:JSON.stringify({name})});setSelected(null);}else await officeRequest(`/forms/${formId}/documents`,{method:'POST',body:JSON.stringify({name,file_type:format})});});}}>
    <label>Название документа<input value={name} onChange={e=>setName(e.target.value)} maxLength={195} required autoFocus/></label>
    {mode==='create' && <label>Формат макета<select value={format} onChange={e=>setFormat(e.target.value as 'xlsx'|'docx')}><option value="xlsx">XLSX — таблица Excel</option><option value="docx">DOCX — текстовый документ</option></select></label>}
    <button type="submit" className="button-primary" disabled={busy}>{mode==='rename'?'Сохранить название':'Создать'}</button><button type="button" className="app-button" onClick={()=>{setMode(null);setSelected(null);}}>Отмена</button>
   </form>}
   <footer><button type="button" className="app-button" disabled={busy} onClick={()=>file.current?.click()}>Загрузить XLSX / DOCX</button><button type="button" className="button-primary" disabled={busy} onClick={()=>{setSelected(null);setMode('create');setName('Новый макет');setGeneration(null);}}>+ Новый документ</button></footer>
   <input ref={file} type="file" accept=".docx,.xlsx" hidden onChange={e=>{const selectedFile=e.target.files?.[0];e.target.value='';if(!selectedFile)return;if(!/\.(docx|xlsx)$/i.test(selectedFile.name)||selectedFile.size>(query.data?.max_file_mb??25)*1024*1024){setError(`Выберите XLSX или DOCX до ${query.data?.max_file_mb??25} МБ`);return;}void run(()=>officeRequest(`/forms/${formId}/documents?name=${encodeURIComponent(selectedFile.name)}`,{method:'POST',headers:{'Content-Type':selectedFile.type || 'application/octet-stream'},body:selectedFile}));}}/>
  </div>
  <div className="office-tab-panel" role="tabpanel" id="documents-panel-results" aria-labelledby="documents-tab-results" hidden={tab!=='results'}>{tab==='results' && <DocumentResults formId={formId} focusId={focusResult}/>}</div>
 </dialog>;
}
