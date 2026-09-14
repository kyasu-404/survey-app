import {render,screen,waitFor} from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import {QueryClient,QueryClientProvider} from '@tanstack/react-query';
import {beforeEach,expect,it,vi} from 'vitest';
import {GenerateDocuments} from './GenerateDocuments';
import {generateOfficeDocuments,officeRequest,type OfficeResult,type OfficeDocument} from '../../entities/office/api';
vi.mock('../../entities/office/api',()=>({generateOfficeDocuments:vi.fn(),officeRequest:vi.fn()}));
const doc:OfficeDocument={id:'doc',form_id:'form',name:'Макет.xlsx',file_type:'xlsx',created_by:'user',updated_at:'2026-09-14',size_bytes:1,binding_count:1,last_save_error:null};
const result:OfficeResult={id:"result",form_id:"form",template_id:"doc",name:"Макет.zip",file_type:"xlsx",files:["a.xlsx","b.xlsx"],created_by:"user",created_at:"2026-09-14",size_bytes:20};
const onGenerated=vi.fn();
beforeEach(()=>{vi.resetAllMocks();vi.mocked(officeRequest).mockResolvedValue({questions:[{integrationId:'q',title:'Организация',unsupported:null}]});vi.mocked(generateOfficeDocuments).mockResolvedValue(result);});
function setup(){const user=userEvent.setup();render(<QueryClientProvider client={new QueryClient({defaultOptions:{queries:{retry:false}}})}><GenerateDocuments doc={doc} total={20} selectedIds={['a','b']} onClose={()=>{}} onGenerated={onGenerated}/></QueryClientProvider>);return user;}
it('generates exactly selected response IDs and the selected filename question',async()=>{
 const user=setup();await screen.findByRole('option',{name:'Организация'});await user.selectOptions(screen.getByLabelText('Добавить ответ на вопрос в имя файла'),'q');await user.click(screen.getByRole('button',{name:'Сформировать 2 документов'}));await waitFor(()=>expect(generateOfficeDocuments).toHaveBeenCalledWith(doc,['a','b'],'q'));await waitFor(()=>expect(onGenerated).toHaveBeenCalledWith(result));
});
it('all responses omit a selection and failed generation remains visible',async()=>{
 vi.mocked(generateOfficeDocuments).mockRejectedValue(new Error('Вопрос удалён'));const user=setup();await user.selectOptions(screen.getByLabelText('Ответы'),'all');await user.click(screen.getByRole('button',{name:'Сформировать 20 документов'}));await waitFor(()=>expect(generateOfficeDocuments).toHaveBeenCalledWith(doc,undefined,undefined));expect(await screen.findByRole('alert')).toHaveTextContent('Вопрос удалён');
});
