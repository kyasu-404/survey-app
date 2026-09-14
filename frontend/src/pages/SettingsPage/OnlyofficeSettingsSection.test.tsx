import {render,screen,fireEvent,waitFor} from '@testing-library/react';
import {QueryClient,QueryClientProvider} from '@tanstack/react-query';
import {beforeEach,expect,it,vi} from 'vitest';
import {OnlyofficeSettingsSection} from './OnlyofficeSettingsSection';
const request=vi.hoisted(()=>vi.fn());
vi.mock('../../app/providers/ToastProvider',()=>({useToast:()=>({showToast:vi.fn()})}));
vi.mock('../../entities/office/api',()=>({officeRequest:request}));
beforeEach(()=>{request.mockReset();request.mockResolvedValue({enabled:true,public_url:'https://docs.test',internal_url:'',storage_url_override:'',jwt_header:'AuthorizationJwt',jwt_prefix:'Bearer ',max_file_mb:25,max_table_rows:1000,has_secret:true});});
it('keeps stored JWT secret out of the form and preserves it on save',async()=>{
  render(<QueryClientProvider client={new QueryClient({defaultOptions:{queries:{retry:false}}})}><OnlyofficeSettingsSection/></QueryClientProvider>);
  await screen.findByDisplayValue('https://docs.test');expect(screen.getByLabelText('JWT Secret')).toHaveValue('');
  fireEvent.change(screen.getByLabelText('Публичный адрес Document Server'),{target:{value:'https://new-docs.test'}});
  expect(screen.getByRole('button',{name:'Проверить подключение'})).toBeDisabled();
  fireEvent.click(screen.getByRole('button',{name:'Сохранить настройки'}));
  await waitFor(()=>expect(request).toHaveBeenCalledWith('/settings',expect.objectContaining({method:'PUT',body:expect.stringContaining('"jwt_secret":""')})));
});
