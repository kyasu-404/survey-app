import { useEffect, useRef, useState } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import { officeRequest, downloadOfficeDocument, type OfficeDocument, type EditorConfiguration } from '../../entities/office/api';
import { getErrorMessage } from '../../shared/lib/error';
import '../../entities/office/office.css';
export default function OfficeEditorPage() {
  const {formId,documentId}=useParams();
  const navigate=useNavigate();
  const [dirty,setDirty]=useState(false),[saving,setSaving]=useState(false);
  const frame=useRef<HTMLIFrameElement>(null);
  const [error,setError]=useState(''),[ready,setReady]=useState(false),[frameReady,setFrameReady]=useState(false);
  const config=useQuery({queryKey:['office-editor-config',documentId],queryFn:()=>officeRequest<EditorConfiguration>(`/documents/${documentId}/editor-config`),staleTime:Infinity,refetchOnWindowFocus:false,retry:false,gcTime:0});
  const doc=useQuery({queryKey:['office-document',documentId],queryFn:()=>officeRequest<OfficeDocument>(`/documents/${documentId}`),refetchInterval:15000,retry:false});
  useEffect(()=>{
    const receive=(event:MessageEvent)=>{
      if(event.origin!==location.origin || event.source!==frame.current?.contentWindow)return;
      if(event.data?.type==='office-frame-ready')setFrameReady(true);
      if(event.data?.type==='office-state')setDirty(Boolean(event.data.data));
      if(event.data?.type==='office-ready'){setReady(true);setError('');}
      if(event.data?.type==='office-error')setError(String(event.data.data || 'Ошибка ONLYOFFICE'));
    };
    window.addEventListener('message',receive);
    return ()=>window.removeEventListener('message',receive);
  },[]);
  useEffect(()=>{
    if(!config.data || !frameReady || ready)return;
    frame.current?.contentWindow?.postMessage({type:'office-config',data:config.data},location.origin);
    const timeout=setTimeout(()=>setError(current=>current || 'Редактор долго загружается. Проверьте доступность ONLYOFFICE.'),60000);
    return ()=>clearTimeout(timeout);
  },[config.data,frameReady,ready]);
  useEffect(()=>{if(ready)setError('');},[ready]);
  useEffect(()=>{
    const warn=(event:BeforeUnloadEvent)=>{if(dirty){event.preventDefault();event.returnValue='';}};
    window.addEventListener('beforeunload',warn);
    return ()=>window.removeEventListener('beforeunload',warn);
  },[dirty]);
  const saveAndLeave=async()=>{
    if(dirty){setError('Изменения передаются в ONLYOFFICE. Подождите несколько секунд и повторите.');return;}
    if(!ready){navigate(`/dashboard/forms/${formId}/responses`);return;}
    setSaving(true);setError('');
    try {await officeRequest(`/documents/${documentId}/save`,{method:'POST'});navigate(`/dashboard/forms/${formId}/responses`);}
    catch(e){setError(getErrorMessage(e,'Не удалось сохранить документ'));}
    finally{setSaving(false);}
  };
  const message=error || (config.error ? getErrorMessage(config.error,'Редактор недоступен') : '') || doc.data?.last_save_error;
  return <div className="office-editor-page">
    <header><button type="button" className="app-button" disabled={saving} onClick={()=>void saveAndLeave()}>{saving ? "Сохранение…" : "← К результатам"}</button><div><strong>{config.data?.name || doc.data?.name || 'Документ'}</strong><span>{ready ? 'Сохранение в хранилище — кнопкой «Сохранить» в редакторе и при закрытии документа' : 'Загрузка редактора…'}</span></div><button type="button" className="app-button" onClick={()=>void downloadOfficeDocument({id:documentId!,name:doc.data?.name || 'Документ.docx'}).catch(e=>setError(getErrorMessage(e,'Не удалось скачать макет')))}>Скачать макет</button></header>
    {message && <div className="office-editor-error" role="alert">{message} <button type="button" className="app-button" onClick={()=>location.reload()}>Открыть заново</button></div>}
    <iframe ref={frame} title="Редактор ONLYOFFICE" src="/api/office/editor-frame" allow="clipboard-read; clipboard-write; fullscreen"/>
  </div>;
}
