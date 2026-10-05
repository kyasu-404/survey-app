import { expect, test } from "@playwright/test";
import ExcelJS from "exceljs";
import { openSurveyApp } from "./fixtures/surveyApp";

const organizations = [
  { id: "40000000-0000-4000-8000-000000000001", organization_type: "school", number: "12", alias: "ГБОУ", email: "one@example.test", token: "50000000-0000-4000-8000-000000000001" },
  { id: "40000000-0000-4000-8000-000000000002", organization_type: "school", number: "34", alias: "ГБОУ", email: "two@example.test", token: "50000000-0000-4000-8000-000000000002" },
];
const elements = [{ type: "organization", name: "org", title: "Организация", isRequired: true }, { type: "text", name: "answer", title: "Ответ", isRequired: true }];

for (const width of [1440, 320]) {
  test(`personal links generation and XLSX at ${width}px`, async ({ page }, testInfo) => {
    await page.setViewportSize({ width, height: 950 });
    const { pageErrors } = await openSurveyApp(page, { elements });
    let enabled = false;
    await page.route("**/rest/v1/rpc/*form_personal_links", route => {
      if (route.request().url().includes("set_form_personal_links")) enabled = route.request().postDataJSON().p_enabled;
      return route.fulfill({ json: { available: true, canManage: true, enabled, links: enabled ? organizations : [] } });
    });
    await page.locator(".dashboard-share-button").first().click();
    const dialog = page.getByRole("dialog");
    const toggle = dialog.getByRole("switch", { name: "Персональные ссылки" });
    await expect(toggle).toBeEnabled();
    await toggle.click();
    await expect(toggle).toBeChecked();
    await expect(dialog.getByText(/Ссылок 2/)).toBeVisible();
    const [download] = await Promise.all([page.waitForEvent("download"), dialog.getByRole("button", { name: "Скачать XLSX" }).click()]);
    expect(download.suggestedFilename()).toMatch(/персональные-ссылки.*\.xlsx$/);
    const workbook = new ExcelJS.Workbook();
    await workbook.xlsx.readFile((await download.path())!);
    const sheet = workbook.worksheets[0];
    expect(sheet.rowCount).toBe(3);
    expect(sheet.getRow(1).values).toEqual([, "Тип ОУ", "Организация", "Номер", "Email", "Персональная ссылка"]);
    expect(sheet.getCell("B2").text).toBe("ГБОУ 12");
    expect(sheet.getCell("D2").text).toBe("one@example.test");
    expect(sheet.getCell("E2").text).toContain(`#personal=${organizations[0].token}`);
    expect(sheet.getCell("E3").text).toContain(`#personal=${organizations[1].token}`);
    await page.screenshot({ path: testInfo.outputPath("personal-links.png") });
    expect(await dialog.evaluate(element => element.scrollWidth <= element.clientWidth)).toBe(true);
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
    await dialog.getByRole("button", { name: "Закрыть окно поделиться" }).click();
    await page.locator(".dashboard-share-button").first().click();
    await expect(page.getByRole("switch", { name: "Персональные ссылки" })).toBeChecked();
    expect(pageErrors).toEqual([]);
  });
}

test("personal forms lock organization, isolate drafts, submit and reopen the saved response", async ({ page }, testInfo) => {
  const { formId, form, pageErrors } = await openSurveyApp(page, { elements });
  Object.assign(form, { allow_response_editing: true });
  const saved = new Map<string, { response_id: string; response_data: Record<string, unknown>; response_editable: boolean }>();
  await page.route("**/rest/v1/rpc/*personal_form*", route => {
    const body = route.request().postDataJSON();
    const organization = organizations.find(org => org.token === body.p_token);
    if (!organization) return route.fulfill({ status: 403, json: { message: "Персональная ссылка недействительна" } });
    if (route.request().url().endsWith("get_personal_form_context")) return route.fulfill({ json: organization });
    if (route.request().url().endsWith("get_personal_form_response_status")) return route.fulfill({ json: saved.has(body.p_token) ? [saved.get(body.p_token)] : [] });
    expect(body.p_data.org).toBe(organization.id);
    expect(body.p_browser_id).toBeUndefined();
    const response = { response_id: "response-1", response_data: body.p_data, response_editable: true };
    saved.set(body.p_token, response);
    return route.fulfill({ json: [{ status: "submitted", ...response }] });
  });
  await page.goto(`/form/${formId}#personal=${organizations[0].token}`);
  await expect(page.getByText("ГБОУ 12", { exact: true })).toBeVisible();
  await expect(page.getByRole("combobox", { name: "Организация" })).toBeDisabled();
  await page.getByRole("textbox", { name: "Ответ" }).fill("Черновик первой организации");
  await page.getByRole("textbox", { name: "Ответ" }).press("Tab");
  await page.goto(`/form/${formId}#personal=${organizations[1].token}`);
  await expect(page.getByText("ГБОУ 34", { exact: true })).toBeVisible();
  await expect(page.getByRole("textbox", { name: "Ответ" })).toHaveValue("");
  await page.goto(`/form/${formId}#personal=${organizations[0].token}`);
  await expect(page.getByRole("textbox", { name: "Ответ" })).toHaveValue("Черновик первой организации");
  await page.screenshot({ path: testInfo.outputPath("personal-form.png") });
  await page.getByRole("button", { name: "Отправить", exact: true }).click();
  await expect.poll(() => saved.size).toBe(1);
  await page.reload();
  await expect(page.getByText(/Вы уже отправляли ответ/)).toBeVisible();
  await page.getByRole("button", { name: "Редактировать", exact: true }).click();
  await expect(page.getByRole("combobox", { name: "Организация" })).toBeDisabled();
  await page.getByRole("textbox", { name: "Ответ" }).fill("Исправленный ответ");
  await page.getByRole("button", { name: "Сохранить изменения", exact: true }).click();
  await expect.poll(() => saved.get(organizations[0].token)?.response_data.answer).toBe("Исправленный ответ");
  await page.goto(`/form/${formId}#personal=${organizations[1].token}`);
  await expect(page.getByRole("textbox", { name: "Ответ" })).toBeVisible();
  await page.goto(`/form/${formId}#personal=invalid`);
  await expect(page.getByText(/Персональная ссылка недействительна/)).toBeVisible();
  await expect(page.getByRole("button", { name: "Отправить", exact: true })).toHaveCount(0);
  expect(pageErrors).toEqual([]);
});

test("personal forms keep organization bound in dynamic entries through conditions, triggers, reload and editing", async ({ page }) => {
  const organization = organizations[0];
  const { formId, form, pageErrors } = await openSurveyApp(page, { elements: [{
    type: "paneldynamic", name: "entries", valueName: "records", title: "Записи",
    panelCount: 1, panelAddText: "Добавить запись", templateElements: [
      { type: "organization", name: "org", valueName: "institution", title: "Организация", isRequired: true,
        resetValueIf: "{panel.answer} = 'Сбросить'", setValueExpression: "iif({panel.answer} = 'Заменить', 'wrong', 'initial')" },
      { type: "text", name: "answer", title: "Ответ", isRequired: true },
    ],
  }] });
  Object.assign(form, { allow_response_editing: true });
  Object.assign(form.schema, { triggers: [
    { type: "setvalue", expression: "{records[0].answer} = 'Сбросить'", setToName: "records[0].institution", setValue: "wrong" },
    { type: "copyvalue", expression: "{records[1].answer} = 'Заменить'", setToName: "records[1].institution", fromName: "records[0].answer" },
    { type: "runexpression", expression: "{records[1].answer} = 'Заменить'", setToName: "records[0].institution", runExpression: "'wrong'" },
  ] });
  let saved: { response_id: string; response_data: Record<string, unknown>; response_editable: boolean } | undefined;
  let submissions = 0;
  await page.route("**/rest/v1/rpc/*personal_form*", route => {
    const body = route.request().postDataJSON();
    expect(body.p_token).toBe(organization.token);
    if (route.request().url().endsWith("get_personal_form_context")) return route.fulfill({ json: organization });
    if (route.request().url().endsWith("get_personal_form_response_status")) return route.fulfill({ json: saved ? [saved] : [] });
    expect(body.p_data.institution).toBeUndefined();
    expect(body.p_data.records).toEqual([
      { institution: organization.id, answer: "Сбросить" },
      { institution: organization.id, answer: "Заменить" },
    ]);
    submissions += 1;
    saved = { response_id: "response-nested", response_data: body.p_data, response_editable: true };
    return route.fulfill({ json: [{ status: "submitted", ...saved }] });
  });
  await page.goto(`/form/${formId}#personal=${organization.token}`);
  const orgFields = page.getByRole("combobox", { name: "Организация" });
  const answers = page.getByRole("textbox", { name: "Ответ" });
  await expect(orgFields).toHaveCount(1);
  await expect(orgFields.first()).toBeDisabled();
  await answers.first().fill("Сбросить");
  await page.getByRole("button", { name: "Добавить запись", exact: true }).click();
  await expect(orgFields).toHaveCount(2);
  await expect(orgFields.nth(1)).toBeDisabled();
  await answers.nth(1).fill("Заменить");
  await answers.nth(1).press("Tab");
  await page.reload();
  await expect(orgFields).toHaveCount(2);
  await expect(page.getByText("ГБОУ 12", { exact: true })).toHaveCount(2);
  await page.getByRole("button", { name: "Отправить", exact: true }).click();
  await expect.poll(() => submissions).toBe(1);
  await page.reload();
  await page.getByRole("button", { name: "Редактировать", exact: true }).click();
  await expect(orgFields).toHaveCount(2);
  await expect(orgFields.first()).toBeDisabled();
  await expect(orgFields.nth(1)).toBeDisabled();
  await expect(answers.first()).toHaveValue("Сбросить");
  await expect(answers.nth(1)).toHaveValue("Заменить");
  await page.getByRole("button", { name: "Сохранить изменения", exact: true }).click();
  await expect.poll(() => submissions).toBe(2);
  expect(pageErrors).toEqual([]);
});
