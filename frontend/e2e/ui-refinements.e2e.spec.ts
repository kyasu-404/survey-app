import { expect, test } from '@playwright/test';
import { openSurveyApp } from './fixtures/surveyApp';

for (const width of [1440, 390]) {
  test(`foreign form copies directly and list pages fill the viewport at ${width}px`, async ({ page }, testInfo) => {
    await page.setViewportSize({ width, height: 950 });
    const { form, pageErrors } = await openSurveyApp(page);
    form.author_id = '10000000-0000-4000-8000-000000000002';
    await page.route('**/rest/v1/rpc/list_forms_keyset?*', route => route.fulfill({ json: [form] }));
    const copies: Array<Record<string, unknown>> = [];
    await page.route('**/rest/v1/forms?*', route => {
      if (route.request().method() === 'POST') {
        const copy = route.request().postDataJSON(); copies.push(copy);
        return route.fulfill({ json: copy });
      }
      return route.fulfill({ json: form });
    });
    await page.reload();
    const duplicate = page.getByRole('button', { name: `Дублировать форму ${form.title}` });
    await expect(duplicate).toBeVisible();
    await expect(page.getByRole('button', { name: /^Действия формы/ })).toHaveCount(0);
    await duplicate.click();
    await expect(page.getByText('Форма скопирована', { exact: true })).toBeVisible();
    expect(copies).toHaveLength(1);
    expect(copies[0].author_id).toBe('10000000-0000-4000-8000-000000000001');
    await expect(page).toHaveURL(/dashboard/);
    for (const path of ['/dashboard/all', '/templates']) {
      await page.goto(path);
      await expect(page.locator(path.includes('templates') ? '.templates-page' : '.dashboard-layout-transition')).toBeVisible();
      expect(await page.evaluate(() => ({ width: document.documentElement.getBoundingClientRect().width, viewport: innerWidth, overflow: document.documentElement.scrollWidth > innerWidth }))).toEqual({ width, viewport: width, overflow: false });
      await page.screenshot({ path: testInfo.outputPath(path.includes('templates') ? 'templates.png' : 'forms.png') });
    }
    expect(pageErrors).toEqual([]);
  });
}

test('ONLYOFFICE distinguishes successful, failed and pending checks in both themes', async ({ page }, testInfo) => {
  const { pageErrors } = await openSurveyApp(page);
  await page.route('**/functions/v1/form-admin', route => route.fulfill({ json: { retentionHours: 168, lastRun: null } }));
  await page.route('**/functions/v1/mail-admin', route => route.fulfill({ json: { settings: null } }));
  await page.route('**/api/office/settings', route => route.fulfill({ json: { enabled: true, public_url: 'https://docs.test', internal_url: '', storage_url_override: '', jwt_header: 'Authorization', jwt_prefix: 'Bearer ', max_file_mb: 25, max_table_rows: 1000, has_secret: true } }));
  await page.route('**/api/office/settings/test', route => route.fulfill({ json: { checks: [{ label: 'Document Server', ok: true, detail: 'Сервис отвечает' }, { label: 'JWT', ok: false, detail: 'Тест ошибки' }, { label: 'Callback', ok: null, detail: 'Ещё не проверен' }] } }));
  await page.goto('/settings');
  await page.getByRole('tab', { name: 'ONLYOFFICE', exact: true }).click();
  await page.getByRole('button', { name: 'Проверить подключение', exact: true }).click();
  const success = page.getByLabel('Успешно', { exact: true });
  await expect(success).toHaveText('✓');
  await expect(success).toHaveCSS('color', 'rgb(21, 128, 61)');
  await expect(page.getByLabel('Ошибка', { exact: true })).toHaveCSS('color', 'rgb(185, 28, 28)');
  await expect(page.getByLabel('Не проверено', { exact: true })).toHaveText('○');
  await page.screenshot({ path: testInfo.outputPath('office-checks.png'), fullPage: true });
  await page.evaluate(() => document.documentElement.dataset.theme = 'graphite');
  await expect(success).toHaveCSS('color', 'rgb(74, 222, 128)');
  await expect(page.getByLabel('Ошибка', { exact: true })).toHaveCSS('color', 'rgb(248, 113, 113)');
  expect(pageErrors).toEqual([]);
});
