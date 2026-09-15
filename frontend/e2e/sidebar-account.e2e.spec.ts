import {test,expect} from '@playwright/test';
import {openSurveyApp} from './fixtures/surveyApp';
test('user menu supports theme selection, keyboard, outside click and logout',async({page},testInfo)=>{
 await page.setViewportSize({width:1280,height:720});await openSurveyApp(page);
 const trigger=page.locator('.sidebar-account-trigger');await expect(trigger).toHaveText('Тест');await trigger.click();
 const menu=page.getByRole('menu',{name:'Меню пользователя'});await expect(menu.getByRole('menuitem')).toHaveCount(2);await expect(menu).toBeVisible();
 expect(await menu.evaluate(el=>{const r=el.getBoundingClientRect();return r.top>=0&&r.bottom<=innerHeight&&r.left>=0})).toBe(true);
 await page.screenshot({path:testInfo.outputPath('sidebar-account-light.png')});
 await page.getByRole('menuitem',{name:'Тема',exact:true}).click();await page.getByRole('menuitemradio',{name:'Тёмная',exact:true}).click();
 await expect(page.locator('html')).toHaveAttribute('data-theme','graphite');await expect(trigger).toBeFocused();await trigger.click();await page.screenshot({path:testInfo.outputPath('sidebar-account-dark.png')});
 const src=await page.getByRole('menuitem',{name:'Выйти'}).locator('img').getAttribute('src');expect(decodeURIComponent(src!)).toContain('#ffffff');
 await page.keyboard.press('ArrowDown');await expect(page.getByRole('menuitem',{name:'Выйти'})).toBeFocused();await page.keyboard.press('Escape');await expect(menu).toHaveCount(0);
 await trigger.click();await page.getByRole('link',{name:'Мои формы',exact:true}).click();await expect(menu).toHaveCount(0);
 await trigger.click();const logout=page.waitForRequest(r=>r.url().includes('/auth/v1/logout'));await page.getByRole('menuitem',{name:'Выйти',exact:true}).click();await logout;await expect(page).toHaveURL(/\/login$/);
});
