import {useState} from 'react';
import {useQuery,useQueryClient} from '@tanstack/react-query';
import {officeRequest,type OfficeSettings} from '../../entities/office/api';
import {useToast} from '../../app/providers/ToastProvider';
import {getErrorMessage} from '../../shared/lib/error';
import {InlineSpinner} from '../../shared/ui/InlineSpinner';
import '../../entities/office/office.css';
const defaults:OfficeSettings={enabled:false,public_url:'',internal_url:'',storage_url_override:'',jwt_header:'Authorization',jwt_prefix:'Bearer ',max_file_mb:25,max_table_rows:1000,has_secret:false};
export function OnlyofficeSettingsSection(){
 const queryClient=useQueryClient(),{showToast}=useToast();
 const query=useQuery({queryKey:['onlyoffice-settings'],queryFn:()=>officeRequest<OfficeSettings>('/settings')});
 const [draft,setDraft]=useState<OfficeSettings|null>(null),[secret,setSecret]=useState(''),[error,setError]=useState(''),[busy,setBusy]=useState(false);
 const [checks,setChecks]=useState<Array<{label:string;ok:boolean|null;detail:string}>>([]);
 const value=draft || query.data || defaults;
 const update=<K extends keyof OfficeSettings>(key:K,next:OfficeSettings[K])=>{setDraft({...value,[key]:next});setChecks([]);};
 async function save(){setBusy(true);setError('');try{await officeRequest('/settings',{method:'PUT',body:JSON.stringify({...value,jwt_secret:secret})});await query.refetch();await queryClient.invalidateQueries({queryKey:['office-status']});setDraft(null);setSecret('');showToast('Настройки ONLYOFFICE сохранены','success');}catch(e){setError(getErrorMessage(e,'Не удалось сохранить настройки'));}finally{setBusy(false);}}
 async function test(){setBusy(true);setError('');setChecks([]);try{const r=await officeRequest<{checks:typeof checks}>('/settings/test',{method:'POST'});setChecks(r.checks);}catch(e){setError(getErrorMessage(e,'Не удалось проверить подключение'));}finally{setBusy(false);}}
 return <section className="settings-area" aria-labelledby="office-settings-title">
  <div className="settings-area-heading"><div><p>Макеты документов</p><h2 id="office-settings-title">ONLYOFFICE</h2><span>Макеты XLSX и DOCX для отдельного документа на каждый ответ.</span></div>
   <label className={`smtp-enable-control ${value.enabled?'active':''}`}><input type="checkbox" checked={value.enabled} disabled={query.isLoading || busy} onChange={e=>update('enabled',e.target.checked)}/><span className="smtp-enable-track" aria-hidden="true"><span/></span>Коннектор включён</label>
  </div>
  {(error || query.error) && <p role="alert" className="settings-form-error">{error || getErrorMessage(query.error,'Office API недоступен')}</p>}
  <section className="settings-section" aria-labelledby="office-connection-title">
   <div className="settings-section-heading"><div><h2 id="office-connection-title">Подключение</h2><p>Адрес редактора и параметры JWT вашего Document Server.</p></div><span className={`settings-credential-badge ${value.has_secret?'saved':'missing'}`}>{value.has_secret?'Секрет сохранён':'Нужен секрет'}</span></div>
   <div className="settings-fields-grid">
    <label className="settings-field settings-field-wide"><span>Публичный адрес Document Server</span><input type="url" value={value.public_url} placeholder="https://docs.example.ru" onChange={e=>update('public_url',e.target.value)}/></label>
    <label className="settings-field settings-field-wide"><span>JWT Secret</span><input aria-label="JWT Secret" type="password" autoComplete="new-password" value={secret} placeholder={value.has_secret?'Секрет сохранён':'Секрет Document Server'} onChange={e=>setSecret(e.target.value)}/><small>Оставьте пустым, чтобы сохранить существующий секрет.</small></label>
    <label className="settings-field"><span>JWT Header</span><input value={value.jwt_header} onChange={e=>update('jwt_header',e.target.value)}/></label>
    <label className="settings-field"><span>JWT Prefix (включая пробел)</span><input value={value.jwt_prefix} onChange={e=>update('jwt_prefix',e.target.value)}/></label>
   </div>
  </section>
  <section className="settings-section" aria-labelledby="office-network-title"><div className="settings-section-heading"><div><h2 id="office-network-title">Сеть и файлы</h2><p>Внутренние адреса нужны, если серверы обращаются друг к другу по отдельной сети.</p></div></div>
   <div className="settings-fields-grid">
    <label className="settings-field settings-field-wide"><span>Внутренний адрес Document Server</span><input type="url" value={value.internal_url} placeholder="Необязательно" onChange={e=>update('internal_url',e.target.value)}/></label>
    <label className="settings-field settings-field-wide"><span>Адрес приложения для Document Server</span><input type="url" value={value.storage_url_override} placeholder="По умолчанию — адрес приложения" onChange={e=>update('storage_url_override',e.target.value)}/></label>
    <label className="settings-field"><span>Максимальный размер макета, МБ</span><input type="number" min="1" max="100" value={value.max_file_mb} onChange={e=>update('max_file_mb',Number(e.target.value))}/></label>
   </div>
  </section>
  <div className="settings-save-row"><button type="button" className="button-primary settings-save-button" disabled={busy || query.isLoading || (!draft && !secret)} onClick={()=>void save()}>{busy && <InlineSpinner/>}Сохранить настройки</button></div>
  <section className="settings-section settings-test-section"><div className="settings-section-heading"><div><h2>Проверка подключения</h2><p>Проверка редактора, JWT и доступа Document Server к макету.</p></div></div><button type="button" className="app-button" disabled={busy || !!draft || !!secret || !value.has_secret} onClick={()=>void test()}>{busy && <InlineSpinner/>}Проверить подключение</button>
   {checks.length>0 && <ul className="office-checks">{checks.map(c=><li key={c.label}><strong>{c.ok===null?'○':c.ok?'✓':'✕'} {c.label}</strong>{c.detail && <span>{c.detail}</span>}</li>)}</ul>}
  </section>
 </section>;
}
