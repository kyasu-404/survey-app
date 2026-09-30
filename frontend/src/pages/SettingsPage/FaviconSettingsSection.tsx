import { useEffect, useRef, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { FAVICON_ACCEPT,FAVICON_QUERY_KEY,getAppFavicon,resetAppFavicon,uploadAppFavicon,validateFaviconFile } from "../../entities/site-settings/api";
import { useToast } from "../../app/providers/ToastProvider";
import { getErrorMessage } from "../../shared/lib/error";
import defaultFavicon from "../../img/favicon.png";
export function FaviconSettingsSection() {
  const {showToast}=useToast();const cache=useQueryClient();const selection=useRef(0);
  const query=useQuery({queryKey:FAVICON_QUERY_KEY,queryFn:getAppFavicon,staleTime:60_000});
  const [file,setFile]=useState<File|null>(null),[preview,setPreview]=useState<string|null>(null),[error,setError]=useState<string|null>(null),[busy,setBusy]=useState(false);
  useEffect(()=>{if(!file)return;const url=URL.createObjectURL(file);setPreview(url);return()=>URL.revokeObjectURL(url);},[file]);
  const choose=async(next?:File)=>{
    const version=++selection.current;setFile(null);setPreview(null);setError(null);if(!next)return;
    try{await validateFaviconFile(next);if(version===selection.current)setFile(next);}catch(cause){if(version===selection.current)setError(getErrorMessage(cause,"Не удалось выбрать favicon"));}
  };
  const save=async(reset=false)=>{
    if(busy||!reset&&!file)return;setBusy(true);setError(null);
    try{const value=reset?await resetAppFavicon():await uploadAppFavicon(file!);cache.setQueryData(FAVICON_QUERY_KEY,value);setFile(null);setPreview(null);showToast(reset?"Восстановлен стандартный favicon":"Favicon обновлён","success");}
    catch(cause){setError(getErrorMessage(cause,"Не удалось сохранить favicon"));}finally{setBusy(false);}
  };
  return <section className="settings-area" aria-labelledby="favicon-heading">
    <div className="settings-area-heading"><div><h2 id="favicon-heading">Favicon</h2><span>Иконка вкладки браузера на всех страницах, включая публичные формы.</span></div></div>
    <div className="settings-section settings-branding-content">
      <div className="settings-branding-preview"><span>Предпросмотр</span><div className="favicon-preview"><img src={preview??query.data?.url??defaultFavicon} alt="Предпросмотр favicon" width={48} height={48}/></div></div>
      <div className="settings-branding-controls"><strong>{file?.name??(query.data?.path?"Пользовательский favicon":"Стандартный favicon")}</strong>
        <p>PNG, SVG или ICO, до 1 МБ. Квадрат от 16 до 512 px; кадры ICO — до 256 px. Рекомендуется 32 × 32 или 48 × 48 px. SVG — без скриптов, стилей и внешних ссылок.</p>
        <div className="settings-branding-actions"><label className="app-button settings-logo-file-button"><input type="file" accept={FAVICON_ACCEPT} aria-label="Выбрать favicon" disabled={busy||query.isPending||!!query.error} onChange={event=>{void choose(event.target.files?.[0]);event.target.value="";}}/>Выбрать favicon</label>
          <button type="button" className="button-primary" disabled={!file||busy} onClick={()=>void save()}>{busy?"Сохранение…":"Сохранить favicon"}</button>
          <button type="button" className="app-button" disabled={busy||!query.data?.path&&!file} onClick={()=>void save(true)}>Вернуть стандартный favicon</button>
        </div>
        {(error||query.error)&&<p className="settings-form-error" role="alert">{error??getErrorMessage(query.error,"Не удалось загрузить favicon")}</p>}
      </div>
    </div>
  </section>;
}
