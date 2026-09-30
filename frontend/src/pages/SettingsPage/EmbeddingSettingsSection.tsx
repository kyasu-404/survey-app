import { useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { EMBEDDING_QUERY_KEY, getEmbeddingSettings, normalizeEmbeddingOrigin, saveEmbeddingSettings } from "../../entities/site-settings/api";
import { useToast } from "../../app/providers/ToastProvider";
import { getErrorMessage } from "../../shared/lib/error";

export function EmbeddingSettingsSection() {
  const queryClient=useQueryClient(); const {showToast}=useToast();
  const query=useQuery({queryKey:EMBEDDING_QUERY_KEY,queryFn:getEmbeddingSettings,staleTime:60_000});
  const [draft,setDraft]=useState<string[]|null>(null),[newSite,setNewSite]=useState<string|null>(null);
  const [error,setError]=useState<string|null>(null),[busy,setBusy]=useState(false);
  const origins=draft??query.data?.allowed_origins??[];
  const add=()=>{
    try { const origin=normalizeEmbeddingOrigin(newSite??""); if(origins.includes(origin))throw new Error("Этот сайт уже добавлен");
      if(origins.length>=50)throw new Error("Можно добавить не более 50 сайтов"); setDraft([...origins,origin]);setNewSite(null);setError(null);
    } catch(cause){setError(getErrorMessage(cause,"Не удалось добавить сайт"));}
  };
  const save=async()=>{
    if(busy)return;setBusy(true);setError(null);
    try {const next=await saveEmbeddingSettings(origins);queryClient.setQueryData(EMBEDDING_QUERY_KEY,next);setDraft(null);showToast("Разрешённые сайты сохранены","success");}
    catch(cause){setError(getErrorMessage(cause,"Не удалось сохранить сайты"));}finally{setBusy(false);}
  };
  return <section className="settings-area" aria-labelledby="embedding-heading">
    <div className="settings-area-heading"><div><h2 id="embedding-heading">Встраивание форм</h2><span>Управление сайтами, на которых разрешено отображать формы через iframe.</span></div></div>
    {query.isPending?<p role="status">Загрузка сайтов…</p>:query.error?<div role="alert"><p>{getErrorMessage(query.error,"Не удалось загрузить сайты")}</p><button type="button" className="app-button" onClick={()=>void query.refetch()}>Повторить</button></div>:<div className="settings-section">
      <h3>Разрешённые сайты</h3>
      <p>Укажите полный адрес: https://example.ru. Каждый поддомен добавляется отдельно. Пути страниц и символ * не поддерживаются.</p>
      <ul className="embedding-sites">{origins.map(origin=><li key={origin}><span>{origin}</span><button type="button" className="app-button" disabled={busy} aria-label={`Удалить ${origin}`} onClick={()=>setDraft(origins.filter(item=>item!==origin))}>Удалить</button></li>)}</ul>
      {origins.length===0&&<p>Список пуст — встраивание форм запрещено. По прямым ссылкам формы доступны как обычно.</p>}
      {newSite!==null?<form className="embedding-add-site" onSubmit={event=>{event.preventDefault();add();}}>
        <label className="mail-field"><span>Адрес сайта</span><input autoFocus value={newSite} maxLength={300} placeholder="https://example.ru" onChange={event=>setNewSite(event.target.value)} disabled={busy}/></label>
        <button type="submit" className="app-button" disabled={busy}>Добавить</button><button type="button" className="app-button" disabled={busy} onClick={()=>{setNewSite(null);setError(null);}}>Отмена</button>
      </form>:<button type="button" className="app-button" disabled={busy||origins.length>=50} onClick={()=>setNewSite("")}>+ Добавить сайт</button>}
      {error&&<p className="settings-form-error" role="alert">{error}</p>}
      <div className="settings-save-row"><span>{draft?"Есть несохранённые изменения":"Изменения применяются после сохранения при следующем открытии формы."}</span><button type="button" className="button-primary" disabled={busy||draft===null||newSite!==null} onClick={()=>void save()}>{busy?"Сохранение…":"Сохранить сайты"}</button></div>
    </div>}
  </section>;
}
