import useIcon from '../../img/use.svg';
import {useState} from 'react';
import {useQuery} from '@tanstack/react-query';
import {officeRequest,generateOfficeDocuments,type OfficeDocument,type OfficeJob} from '../../entities/office/api';
import {getErrorMessage} from '../../shared/lib/error';
export function GenerateDocuments({doc,total,selectedIds,onClose,onGenerated}:{doc:OfficeDocument;total:number;selectedIds:string[];onClose:()=>void;onGenerated:(result:OfficeJob)=>void}){
 const [scope,setScope]=useState<'all'|'selected'>(selectedIds.length?'selected':'all'),[nameQuestion,setNameQuestion]=useState(''),[busy,setBusy]=useState(false),[error,setError]=useState('');
 const sources=useQuery({queryKey:['office-template-sources',doc.form_id],queryFn:()=>officeRequest<{questions:{integrationId:string;title:string;unsupported:string|null}[]}>(`/forms/${doc.form_id}/sources`)});
 const count=scope==='all'?total:selectedIds.length;
 return <section className="office-generation" aria-label="Формирование документов">
  <h3>Сформировать документы</h3><p>Макет: <strong>{doc.name}</strong></p>
  <p>Один ответ → один {doc.file_type==='xlsx'?'XLSX':'DOCX'}. Используется последняя сохранённая версия. Готовые файлы появятся во вкладке «Результат». После запуска можно закрыть окно: обработка продолжится.</p>
  <label>Ответы<select disabled={busy} value={scope} onChange={e=>setScope(e.target.value as 'all'|'selected')}><option value="all">Все ответы ({total})</option><option value="selected" disabled={!selectedIds.length}>Выбранные ответы ({selectedIds.length})</option></select></label>
  <label>Добавить ответ на вопрос в имя файла<select disabled={busy} value={nameQuestion} onChange={e=>setNameQuestion(e.target.value)}><option value="">Номер и ID ответа</option>{sources.data?.questions.filter(q=>!q.unsupported).map(q=><option key={q.integrationId} value={q.integrationId}>{q.title}</option>)}</select></label>
  <p className="office-muted">Архив ZIP с {count} отдельными файлами. До 500 ответов за одну выгрузку.</p>
  {error && <p role="alert" className="office-error">{error}</p>}
  <button type="button" className="responses-export-button responses-html-button" disabled={busy || count===0 || count>500} onClick={()=>{setBusy(true);setError('');void generateOfficeDocuments(doc,scope==='selected'?selectedIds:undefined,nameQuestion || undefined).then(onGenerated).catch(e=>setError(getErrorMessage(e,'Не удалось сформировать документы'))).finally(()=>setBusy(false));}}>{busy?'Добавление в очередь…':`Сформировать ${count} документов`}<img src={useIcon} alt="" aria-hidden="true" className="toolbar-icon"/></button>
  <button type="button" className="app-button" disabled={busy} onClick={onClose}>Закрыть</button>
 </section>;
}
