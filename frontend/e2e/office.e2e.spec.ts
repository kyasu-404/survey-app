import {test,expect} from '@playwright/test';
import {openSurveyApp} from './fixtures/surveyApp';
test('disabled connector hides the documents toolbar button',async({page})=>{
 const {formId}=await openSurveyApp(page);
 await page.route('**/api/office/status',route=>route.fulfill({json:{enabled:false}}));
 await page.goto(`/dashboard/forms/${formId}/responses`);
 await expect(page.getByRole('button',{name:'Отчёт',exact:true})).toBeVisible();
 await expect(page.getByRole('button',{name:'Документы',exact:true})).toHaveCount(0);
});
test('template actions and persistent results, with notification above the dialog',async({page})=>{
 const {formId}=await openSurveyApp(page);
 const documents:Array<Record<string,unknown>>=[],results:Array<Record<string,unknown>>=[];
 await page.route('**/api/office/**',async route=>{
  const req=route.request(),url=new URL(req.url());
  if(url.pathname.endsWith('/status'))return route.fulfill({json:{enabled:true}});
  if(url.pathname.endsWith('/results'))return route.fulfill({json:{results}});
  if(url.pathname.endsWith('/sources'))return route.fulfill({json:{questions:[]}});
  if(url.pathname.endsWith('/generate')){const result={id:'50000000-0000-4000-8000-000000000001',form_id:formId,template_id:documents[0].id,name:'Отчёт.zip',file_type:'xlsx',files:Array.from({length:20},(_,i)=>`${i+1}.xlsx`),created_by:documents[0].created_by,created_at:'2026-09-14T12:00:00Z',size_bytes:1024};results.push(result);return route.fulfill({status:201,json:result});}
  if(url.pathname.endsWith('/download') || url.pathname.includes('/files/'))return route.fulfill({contentType:'application/octet-stream',body:'test-file'});
  if(url.pathname.endsWith('/documents')){
   if(req.method()==='GET')return route.fulfill({json:{documents,enabled:true,max_file_mb:25,response_count:20}});
   const doc={id:'40000000-0000-4000-8000-000000000001',form_id:formId,name:req.postDataJSON().name+'.xlsx',file_type:'xlsx',created_by:'10000000-0000-4000-8000-000000000001',updated_at:'2026-09-14T12:00:00Z',binding_count:1,size_bytes:1024};documents.push(doc);return route.fulfill({json:doc});
  }
  if(req.method()==='PATCH'){documents[0].name=req.postDataJSON().name+'.xlsx';return route.fulfill({json:documents[0]});}
  if(req.method()==='DELETE'){documents.splice(0);return route.fulfill({json:{ok:true}});}
  return route.fulfill({status:404,json:{message:'Unexpected request'}});
 });
 await page.goto(`/dashboard/forms/${formId}/responses`);
 const button=page.getByRole('button',{name:'Документы',exact:true});
 await expect(button).toBeVisible();
 expect(await button.evaluate(el=>el.nextElementSibling?.textContent)).toContain('Отчёт');
 await button.click();await expect(page.getByRole('dialog')).toBeVisible();
 await page.getByRole('button',{name:'+ Новый документ'}).click();await page.getByLabel('Название документа').fill('Справка');await page.getByRole('button',{name:'Создать',exact:true}).click();
 await expect(page.getByText('Справка.xlsx',{exact:true})).toBeVisible();await expect(page.getByRole('button',{name:'Редактировать',exact:true})).toBeEnabled();
 const menu=()=>page.getByRole('button',{name:/Действия:/});
 await menu().click();const download=page.waitForEvent('download');await page.getByRole('menuitem',{name:'Скачать',exact:true}).click();expect((await download).suggestedFilename()).toBe('Справка.xlsx');
 await menu().click();await page.getByRole('menuitem',{name:'Переименовать'}).click();await page.getByLabel('Название документа').fill('Отчёт');await page.getByRole('button',{name:'Сохранить название'}).click();await expect(page.getByText('Отчёт.xlsx',{exact:true})).toBeVisible();
 await page.getByRole('button',{name:'Сформировать документы',exact:true}).click();await page.getByRole('button',{name:'Сформировать 20 документов',exact:true}).click();
 await expect(page.getByRole('tab',{name:'Результат',exact:true})).toHaveAttribute('aria-selected','true');await expect(page.getByText('Документы сформированы',{exact:true})).toBeVisible();
 expect(await page.locator('.toast-container').evaluate(el=>el.matches(':popover-open'))).toBe(true);
 await expect(page.getByRole('button',{name:/^Скачать \d+\.xlsx$/})).toHaveCount(20);
 const zip=page.waitForEvent('download');await page.getByRole('button',{name:'Скачать ZIP'}).click();expect((await zip).suggestedFilename()).toBe('Отчёт.zip');
 await page.getByRole('button',{name:'Закрыть документы'}).click();await button.click();await page.getByRole('tab',{name:'Результат'}).click();await expect(page.getByRole('button',{name:/^Скачать \d+\.xlsx$/})).toHaveCount(20);
 await page.getByRole('tab',{name:'Макеты'}).click();await menu().click();await page.getByRole('menuitem',{name:'Удалить',exact:true}).click();await page.getByRole('button',{name:'Удалить документ'}).click();await expect(page.getByText('Макетов пока нет. Загрузите файл или создайте новый.')).toBeVisible();
});
