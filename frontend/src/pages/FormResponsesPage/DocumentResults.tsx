import { Icon } from "../../shared/ui/Icon";
import {AnimatedDetails} from "../../shared/ui/AnimatedDetails";
import {useState} from 'react';
import {useAuth} from '../../app/providers/AuthProvider';
import {officeRequest,downloadOfficeResult} from '../../entities/office/api';
import {isOfficeJobActive,useOfficeResults} from '../../entities/office/results';
import {getErrorMessage} from '../../shared/lib/error';
export function DocumentResults({formId,focusId}:{formId:string;focusId?:string}){
 const {user,profile}=useAuth(),[error,setError]=useState(''),[busy,setBusy]=useState(false);
 const query=useOfficeResults(formId);
 async function run(fn:()=>Promise<unknown>){setBusy(true);setError('');try{await fn();}catch(e){setError(getErrorMessage(e,'Не удалось выполнить действие'));}finally{setBusy(false);}}
 return <div className="office-result-list">
  {error && <p role="alert" className="office-error">{error}</p>}
  {query.error && <div className="office-notice" role="alert">
   <p className="office-error">{getErrorMessage(query.error,'Не удалось загрузить результаты')}</p>
   <button type="button" className="app-button" disabled={query.isFetching} onClick={()=>void query.refetch()}>Повторить загрузку</button>
  </div>}
  {query.isLoading && <p role="status">Загрузка результатов…</p>}
  {query.data?.jobs.map(job=><div className="office-notice" key={job.id} role={job.state==='failed'?'alert':'status'}>
   <strong>{job.name}</strong>
   <p>{job.state==='running'?'Документы формируются…':job.state==='failed'?job.error || 'Не удалось сформировать документы. Запустите формирование снова.':'Задание ожидает обработки…'}</p>
   {isOfficeJobActive(job) && <><progress className="office-job-progress" aria-label={`Формирование ${job.name}`}/><span>Можно закрыть окно. Результат сохранится здесь.</span></>}
  </div>)}
  {query.isSuccess && query.data.results.length===0 && query.data.jobs.length===0 && <p className="office-empty">Результатов пока нет. Сформируйте документы из макета.</p>}
  {query.data?.results.map((result,index)=><AnimatedDetails className="office-result-batch" key={result.id} open={focusId?result.id===focusId:index===0} summary={<><strong>{result.name}</strong><span>{result.files.length} файлов · {new Date(result.created_at).toLocaleString('ru-RU')} · {result.author_name || 'Сотрудник'}</span></>}>
   <div className="office-result-toolbar"><button type="button" className="responses-export-button" disabled={busy} onClick={()=>void run(()=>downloadOfficeResult(result))}>Скачать ZIP<Icon name="download" size={18} className="toolbar-icon" /></button>
    {(result.created_by===user?.id || profile?.role==='admin') && <button type="button" className="app-button danger" disabled={busy} onClick={()=>{if(window.confirm('Удалить этот результат и все сформированные файлы?'))void run(async()=>{await officeRequest(`/results/${result.id}`,{method:'DELETE'});await query.refetch();});}}>Удалить результат</button>}
   </div>
   <ul className="office-result-files">{result.files.map((name,fileIndex)=><li key={name}><span>{name}</span><button type="button" className="app-button" aria-label={`Скачать ${name}`} disabled={busy} onClick={()=>void run(()=>downloadOfficeResult(result,fileIndex))}>Скачать<Icon name="download" size={18} className="toolbar-icon" /></button></li>)}</ul>
  </AnimatedDetails>)}
 </div>;
}
