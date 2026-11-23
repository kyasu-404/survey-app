import {act,fireEvent,render,screen,waitFor} from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import {QueryClient,QueryClientProvider} from '@tanstack/react-query';
import {beforeEach,expect,it,vi} from 'vitest';
import OfficeEditorPage from './OfficeEditorPage';
import {officeRequest,downloadOfficeDocument,type OfficeDocument} from '../../entities/office/api';

const navigate=vi.hoisted(()=>vi.fn());
vi.mock('react-router-dom',()=>({useNavigate:()=>navigate,useParams:()=>({formId:'form',documentId:'doc'})}));
vi.mock('../../entities/office/api',()=>({officeRequest:vi.fn(),downloadOfficeDocument:vi.fn()}));
const initial:OfficeDocument={id:'doc',form_id:'form',name:'Макет.docx',file_type:'docx',created_by:'user',updated_at:'2026-10-30',storage_path:'original.docx',size_bytes:100,binding_count:0,last_save_error:null};
let current:OfficeDocument;
beforeEach(()=>{
  vi.resetAllMocks();current={...initial};
  vi.mocked(officeRequest).mockImplementation(async path=>{
    if(path.endsWith('/editor-config'))return {config:{},apiJsUrl:'/api.js',name:initial.name};
    if(path.endsWith('/save'))return {saved:true};
    return {...current};
  });
  vi.mocked(downloadOfficeDocument).mockResolvedValue();
});
async function setup(){
  const client=new QueryClient({defaultOptions:{queries:{retry:false,gcTime:Infinity}}});
  const user=userEvent.setup();
  render(<QueryClientProvider client={client}><OfficeEditorPage/></QueryClientProvider>);
  await screen.findByText(initial.name);
  const frame=screen.getByTitle('Редактор ONLYOFFICE') as HTMLIFrameElement;
  const message=(type:string,data?:unknown)=>fireEvent(window,new MessageEvent('message',{origin:location.origin,source:frame.contentWindow,data:{type,data}}));
  message('office-ready');
  return {client,user,message};
}
it('saves before downloading and invalidates the template list after confirmation',async()=>{
  const {client,user}=await setup();
  client.setQueryData(['office-documents','form'],{documents:[initial]});
  let finish!:(value:unknown)=>void;
  const request=vi.mocked(officeRequest).getMockImplementation()!;
  vi.mocked(officeRequest).mockImplementation((path,options)=>path.endsWith('/save') ? new Promise(resolve=>{finish=resolve;}) : request(path,options));
  await user.click(screen.getByRole('button',{name:'Скачать макет'}));
  expect(downloadOfficeDocument).not.toHaveBeenCalled();
  expect(screen.getByRole('button',{name:'Сохранить'})).toBeDisabled();
  current={...current,storage_path:'saved.docx',binding_count:2};
  await act(async()=>{finish({saved:true});});
  await waitFor(()=>expect(downloadOfficeDocument).toHaveBeenCalledWith({id:'doc',name:initial.name}));
  expect(screen.getByRole('status')).toHaveTextContent('Сохранено в хранилище');
  expect(client.getQueryState(['office-documents','form'])?.isInvalidated).toBe(true);
  expect(client.getQueryData<OfficeDocument>(['office-document','doc'])?.binding_count).toBe(2);
});
it('keeps the editor open after a failed save and clears the timeout after a later persisted callback',async()=>{
  const {client,user,message}=await setup();
  message('office-state',true);message('office-state',false);
  const request=vi.mocked(officeRequest).getMockImplementation()!;
  vi.mocked(officeRequest).mockImplementation((path,options)=>path.endsWith('/save') ? Promise.reject(new Error('Сохранение ещё не подтверждено')) : request(path,options));
  await user.click(screen.getByRole('button',{name:'← К результатам'}));
  expect(await screen.findByRole('alert')).toHaveTextContent('Сохранение ещё не подтверждено');
  expect(navigate).not.toHaveBeenCalled();
  expect(downloadOfficeDocument).not.toHaveBeenCalled();
  act(()=>client.setQueryData(['office-document','doc'],{...current,storage_path:'callback.docx',binding_count:2}));
  await waitFor(()=>expect(screen.queryByRole('alert')).not.toBeInTheDocument());
  expect(screen.getByRole('status')).toHaveTextContent('Сохранено в хранилище');
});
it('warns about edits sent to Document Server until Storage has confirmed saving',async()=>{
  const {user,message}=await setup();
  message('office-state',true);
  expect(screen.getByRole('button',{name:'Сохранить'})).toBeDisabled();
  message('office-state',false);
  const before=new Event('beforeunload',{cancelable:true});
  window.dispatchEvent(before);expect(before.defaultPrevented).toBe(true);
  await user.click(screen.getByRole('button',{name:'Сохранить'}));
  await waitFor(()=>expect(screen.getByRole('status')).toHaveTextContent('Сохранено в хранилище'));
  const after=new Event('beforeunload',{cancelable:true});
  window.dispatchEvent(after);expect(after.defaultPrevented).toBe(false);
});
it('does not leave when another edit arrives while the save is in progress',async()=>{
  const {user,message}=await setup();
  message('office-state',true);message('office-state',false);
  let finish!:(value:unknown)=>void;
  const request=vi.mocked(officeRequest).getMockImplementation()!;
  vi.mocked(officeRequest).mockImplementation((path,options)=>path.endsWith('/save') ? new Promise(resolve=>{finish=resolve;}) : request(path,options));
  await user.click(screen.getByRole('button',{name:'← К результатам'}));
  message('office-state',true);message('office-state',false);
  current={...current,storage_path:'earlier-revision.docx'};
  await act(async()=>{finish({saved:true});});
  expect(await screen.findByRole('alert')).toHaveTextContent('появились новые изменения');
  expect(navigate).not.toHaveBeenCalled();
});
it('returns directly from an unchanged document',async()=>{
  const {user}=await setup();
  await user.click(screen.getByRole('button',{name:'← К результатам'}));
  expect(navigate).toHaveBeenCalledWith('/dashboard/forms/form/responses');
  expect(officeRequest).not.toHaveBeenCalledWith('/documents/doc/save',{method:'POST'});
});
it('returns to results only after saving succeeds',async()=>{
  const {user,message}=await setup();
  message('office-state',true);message('office-state',false);
  await user.click(screen.getByRole('button',{name:'← К результатам'}));
  await waitFor(()=>expect(navigate).toHaveBeenCalledWith('/dashboard/forms/form/responses'));
  expect(officeRequest).toHaveBeenCalledWith('/documents/doc/save',{method:'POST'});
});
it('lets the user leave without saving when save fails',async()=>{
  const {user,message}=await setup();
  message('office-state',true);message('office-state',false);
  const request=vi.mocked(officeRequest).getMockImplementation()!;
  vi.mocked(officeRequest).mockImplementation((path,options)=>path.endsWith('/save') ? Promise.reject(new Error('Сохранение не подтверждено')) : request(path,options));
  await user.click(screen.getByRole('button',{name:'← К результатам'}));
  expect(await screen.findByRole('alert')).toHaveTextContent('Сохранение не подтверждено');
  await user.click(screen.getByRole('button',{name:'Выйти без сохранения'}));
  expect(navigate).toHaveBeenCalledWith('/dashboard/forms/form/responses');
});
it('loads the isolated embedOrigin iframe and enforces its postMessage origin',async()=>{
  const request=vi.mocked(officeRequest).getMockImplementation()!;
  vi.mocked(officeRequest).mockImplementation(async(path,options)=>{
    if(path.endsWith('/editor-config')) return {config:{},apiJsUrl:'https://docs.example/api.js',name:initial.name,embedOrigin:'https://office-embed.example'};
    return request(path,options);
  });
  const client=new QueryClient({defaultOptions:{queries:{retry:false,gcTime:Infinity}}});
  render(<QueryClientProvider client={client}><OfficeEditorPage/></QueryClientProvider>);
  await screen.findByText(initial.name);
  const frame=screen.getByTitle('Редактор ONLYOFFICE') as HTMLIFrameElement;
  expect(frame).toHaveAttribute('src','https://office-embed.example/api/office/editor-frame');
  fireEvent(window,new MessageEvent('message',{origin:location.origin,source:frame.contentWindow,data:{type:'office-ready'}}));
  expect(screen.getByRole('status')).toHaveTextContent('Загрузка редактора…');
  fireEvent(window,new MessageEvent('message',{origin:'https://office-embed.example',source:frame.contentWindow,data:{type:'office-ready'}}));
  expect(screen.getByRole('status')).toHaveTextContent('Сохраните макет');
});
