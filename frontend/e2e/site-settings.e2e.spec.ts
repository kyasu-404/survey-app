import { expect,test } from "@playwright/test";
import { readFileSync } from "node:fs";
import { openSurveyApp } from "./fixtures/surveyApp";

for(const width of [1440,390,320]) {
 test(`iframe sites and favicon settings at ${width}px`,async({page},testInfo)=>{
  await page.setViewportSize({width,height:950});const {pageErrors}=await openSurveyApp(page);
  let origins:string[]=[];let icon:{path:string|null;mime:string|null;updatedAt:string|null}={path:null,mime:null,updatedAt:null};
  let uploads=0,resets=0;
  await page.route("**/rest/v1/form_embedding_settings?*",route=>route.fulfill({json:{allowed_origins:origins,updated_at:"now"}}));
  await page.route("**/rest/v1/rpc/set_form_embedding_origins",route=>{origins=route.request().postDataJSON().p_origins;return route.fulfill({json:{allowed_origins:origins,updated_at:"now"}});});
  await page.route("**/rest/v1/rpc/get_app_favicon",route=>route.fulfill({json:icon}));
  await page.route("**/rest/v1/app_branding?*",route=>route.fulfill({json:{sidebar_logo_path:null,updated_at:null}}));
  await page.route("**/functions/v1/mail-admin",route=>route.fulfill({json:{settings:null}}));
  await page.route("**/functions/v1/form-admin",route=>route.fulfill({json:{retentionHours:168,lastRun:null}}));
  await page.route("**/storage/v1/object/public/app-favicons/*",route=>route.fulfill({contentType:"image/png",body:readFileSync('src/img/favicon.png')}));
  await page.route("**/functions/v1/app-settings",route=>{
   const body=route.request().postDataJSON();
   if(body.action==="upload-favicon") {uploads++;expect(body.fileName).toBe("icon.png");expect(Buffer.from(body.base64,"base64").subarray(0,4)).toEqual(Buffer.from([137,80,78,71]));icon={path:"favicon-11111111-1111-4111-8111-111111111111.png",mime:"image/png",updatedAt:"now"};}
   else {expect(body.action).toBe("reset-favicon");resets++;icon={path:null,mime:null,updatedAt:"now"};}
   return route.fulfill({json:icon});
  });
  await page.goto('/settings');await page.getByRole('tab',{name:'iframe',exact:true}).click();
  await expect(page.getByText(/Список пуст — встраивание форм запрещено/)).toBeVisible();
  await page.getByRole('button',{name:'+ Добавить сайт'}).click();
  await page.getByLabel('Адрес сайта').fill('https://example.ru/path');await page.getByRole('button',{name:'Добавить',exact:true}).click();
  await expect(page.getByRole('alert')).toContainText('без пути');
  await page.getByLabel('Адрес сайта').fill('https://PORTAL.example.ru/');await page.getByRole('button',{name:'Добавить',exact:true}).click();
  expect(origins).toEqual([]);await page.getByRole('button',{name:'Сохранить сайты'}).click();
  await expect.poll(()=>origins).toEqual(['https://portal.example.ru']);
  await page.screenshot({path:testInfo.outputPath('iframe.png')});
  await page.reload();await page.getByRole('tab',{name:'iframe',exact:true}).click();
  await expect(page.getByText('https://portal.example.ru',{exact:true})).toBeVisible();
  await page.getByRole('button',{name:'Удалить https://portal.example.ru'}).click();await page.getByRole('button',{name:'Сохранить сайты'}).click();
  await expect.poll(()=>origins).toEqual([]);
  await page.getByRole('tab',{name:'Оформление',exact:true}).click();
  const input=page.getByLabel('Выбрать favicon');
  await input.setInputFiles({name:'bad.jpg',mimeType:'image/jpeg',buffer:Buffer.from('not-an-image')});
  await expect(page.getByText('Поддерживаются только PNG, SVG и ICO',{exact:true})).toBeVisible();
  await input.setInputFiles({name:'unsafe.svg',mimeType:'image/svg+xml',buffer:Buffer.from('<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 32 32"><script>alert(1)</script></svg>')});
  await expect(page.getByText(/SVG не должен содержать/)).toBeVisible();
  expect(uploads).toBe(0);
  await input.setInputFiles({name:'icon.png',mimeType:'image/png',buffer:readFileSync('src/img/favicon.png')});
  await page.getByRole('button',{name:'Сохранить favicon',exact:true}).click();
  await expect.poll(()=>uploads).toBe(1);
  await expect(page.locator('link[rel="icon"]')).toHaveAttribute('href',/app-favicons\/favicon-/);
  await expect(page.getByAltText('Предпросмотр favicon')).toHaveAttribute('src',/app-favicons\/favicon-/);
  await page.screenshot({path:testInfo.outputPath('favicon.png')});
  expect(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth)).toBe(true);
  await page.getByRole('button',{name:'Вернуть стандартный favicon'}).click();await expect.poll(()=>resets).toBe(1);
  await expect(page.locator('link[rel="icon"]')).not.toHaveAttribute('href',/app-favicons/);
  expect(pageErrors).toEqual([]);
 });
}
test('administrator who is not the author cannot see personalized sharing or open coverage',async({page})=>{
 const {form,formId,pageErrors}=await openSurveyApp(page,{responseCount:1,elements:[{type:'organization',name:'org',title:'Организация'}]});
 form.author_id='10000000-0000-4000-8000-000000000002';
 await page.route('**/rest/v1/rpc/list_forms_keyset?*',route=>route.fulfill({json:[form]}));
 await page.reload();await page.locator('.dashboard-share-button').first().click();
 const dialog=page.getByRole('dialog');await expect(dialog.getByRole('tab',{name:'Рассылка',exact:true})).toHaveCount(0);
 await expect(dialog.getByRole('switch',{name:'Персональные ссылки'})).toHaveCount(0);
 await expect(dialog.getByRole('textbox',{name:'Ссылка на форму'})).toBeVisible();
 await dialog.getByRole('button',{name:'Закрыть окно поделиться'}).click();
 await page.goto(`/dashboard/forms/${formId}/responses`);await page.getByRole('button',{name:'Отчёт',exact:true}).click();
 await expect(page.getByRole('tab',{name:'Учёт сдавших'})).toBeDisabled();expect(pageErrors).toEqual([]);
});
