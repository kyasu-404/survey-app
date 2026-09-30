import { expect, test, type Locator } from "@playwright/test";
import { openSurveyApp } from "./fixtures/surveyApp";

async function expectContained(dialog: Locator) {
  const geometry = await dialog.evaluate(el => {
    const panel = el.querySelector<HTMLElement>('.dashboard-share-panel:not([hidden])')!;
    const rect = el.getBoundingClientRect();
    return { dialogOverflow: el.scrollWidth > el.clientWidth, panelOverflow: panel.scrollWidth > panel.clientWidth,
      inViewport: rect.x >= 0 && rect.y >= 0 && rect.right <= innerWidth && rect.bottom <= innerHeight };
  });
  expect(geometry).toEqual({ dialogOverflow: false, panelOverflow: false, inViewport: true });
}
const orgs = [1, 2, 3].map(n => ({ id: `40000000-0000-4000-8000-${String(n).padStart(12, "0")}`, name: `ГБОУ № ${n}`, email: `organization${n}@school.example.test`, organizationType: n === 3 ? "kindergarten" : "school", canSend: true }));
for (const viewport of [{ width: 1440, height: 1000 }, { width: 390, height: 844 }, { width: 320, height: 740 }]) {
  test(`mail selection, editor, preview and delivery fit at ${viewport.width}px`, async ({ page }, testInfo) => {
    await page.setViewportSize(viewport);
    const { pageErrors } = await openSurveyApp(page, { elements: [{ type: "organization", name: "org", title: "Организация" }] });
    await page.route("**/rest/v1/rpc/get_form_personal_links", route => route.fulfill({ json: { available: true, canManage: true, enabled: true, links: [] } }));
    const requests: Record<string, unknown>[] = [];
    let queued = false;
    await page.route("**/functions/v1/mail-admin", async route => {
      const payload = route.request().postDataJSON(); requests.push(payload);
      if (payload.action === "prepare-mail") return route.fulfill({ json: { personal: true, smtpEnabled: true, template: {
        subject: "Просим заполнить форму «{Название формы}»", bodyText: "Добрый день!\nПросим {Организация} заполнить форму.\nСрок: {Дедлайн}\n{Ссылка}",
      }, recipients: orgs } });
      expect(payload.organizationIds).toEqual([orgs[1].id]);
      expect(payload.template.subject).toBe("Моя тема письма");
      expect(payload.template.bodyText).toBe("Новый текст для {Организация}\n{Ссылка}");
      if (payload.action === "preview-mail") return route.fulfill({ json: { personal: true, recipientCount: 1,
        message: { organizationId: orgs[1].id, name: orgs[1].name, email: orgs[1].email, subject: payload.template.subject,
          bodyText: "Новый текст для ГБОУ № 2\nhttps://forms.example.test/form/20000000-0000-4000-8000-000000000001#personal=50000000-0000-4000-8000-000000000002" } } });
      expect(payload.action).toBe("queue-invitations"); queued = true;
      return route.fulfill({ status: 202, json: { batchId: "batch-1", queuedCount: 1 } });
    });
    await page.route("**/rest/v1/mail_batches?*", route => route.fulfill({ json: queued ? [{ id: "batch-1", kind: "invitation", total_count: 1, created_at: "2026-09-29T18:00:00Z" }] : [] }));
    await page.route("**/rest/v1/mail_queue?*", route => route.fulfill({ json: [{ id: "job-1", batch_id: "batch-1", recipient_name: `ОченьДлинноеНазваниеОрганизации${"безпробелов".repeat(12)}`, recipient_email: "verylongemailaddress@school.example.test", status: "sent", sent_at: "2026-09-29T18:01:00Z" }] }));
    await page.locator(".dashboard-share-button").first().click();
    const dialog = page.getByRole("dialog");
    if (viewport.width > 600) expect((await dialog.boundingBox())!.width).toBeGreaterThan(900);
    await dialog.getByRole("button", { name: "Подготовить рассылку" }).click();
    await expect(dialog.getByText("Выбрано: 3 из 3")).toBeVisible();
    await dialog.getByRole("button", { name: "Снять выбор" }).click();
    await dialog.getByLabel("Поиск организации или email").fill("organization2@");
    await dialog.getByRole("button", { name: "Выбрать найденные" }).click();
    await expect(dialog.getByText("Выбрано: 1 из 3")).toBeVisible();
    await expectContained(dialog);
    await page.screenshot({ path: testInfo.outputPath("recipients.png") });
    await dialog.getByRole("button", { name: "К тексту письма" }).click();
    await dialog.getByLabel("Тема письма", { exact: true }).fill("Моя тема письма");
    await dialog.getByRole("textbox", { name: "Текст письма", exact: true }).fill("Новый текст для {Организация}\n");
    await dialog.getByRole("button", { name: "{Ссылка}", exact: true }).click();
    await expect(dialog.getByRole("textbox", { name: "Текст письма", exact: true })).toHaveValue("Новый текст для {Организация}\n{Ссылка}");
    await dialog.getByRole("tab", { name: "Ссылка", exact: true }).click();
    await dialog.getByRole("tab", { name: "Рассылка", exact: true }).click();
    await expect(dialog.getByLabel("Тема письма", { exact: true })).toHaveValue("Моя тема письма");
    await expectContained(dialog);
    await page.screenshot({ path: testInfo.outputPath("editor.png") });
    await dialog.getByRole("button", { name: "Проверить письмо" }).click();
    await expect(dialog.getByRole("article", { name: "Предпросмотр письма" })).toContainText("#personal=");
    expect(queued).toBe(false);
    await expectContained(dialog);
    await page.screenshot({ path: testInfo.outputPath("preview.png") });
    await dialog.getByRole("button", { name: "Отправить письма (1)" }).click();
    await expect(dialog.getByText("Отправлено", { exact: true })).toBeVisible();
    await expectContained(dialog);
    await page.screenshot({ path: testInfo.outputPath("delivery.png") });
    expect(requests.filter(request => request.action === "queue-invitations")).toHaveLength(1);
    expect(pageErrors).toEqual([]);
  });
}

for (const personal of [true, false]) {
  test(`submission tracking opens reminder editor with personal=${personal}`, async ({ page }) => {
    await page.setViewportSize({ width: 390, height: 844 });
    const { formId, pageErrors } = await openSurveyApp(page, { responseCount: 1, responseData: [{ org: orgs[0].id }], elements: [{ type: "organization", name: "org", title: "Организация" }] });
    await page.route("**/rest/v1/education_organizations?*", route => route.fulfill({ json: orgs.map((org, index) => ({ id: org.id, alias: "ГБОУ", number: String(index + 1), organization_type: org.organizationType, email: org.email, is_archived: false })) }));
    let queued = false;
    await page.route("**/functions/v1/mail-admin", route => {
      const payload = route.request().postDataJSON();
      if (payload.action === "prepare-mail") {
        expect(payload.kind).toBe("reminder");
        return route.fulfill({ json: { personal, smtpEnabled: true, template: { subject: "Напоминание", bodyText: "{Организация}\n{Ссылка}" }, recipients: orgs.slice(1) } });
      }
      expect(payload.organizationIds).toEqual(orgs.slice(1).map(org => org.id));
      expect(payload.personal).toBe(personal);
      if (payload.action === "preview-mail") return route.fulfill({ json: { personal, recipientCount: 2, message: { organizationId: orgs[1].id, name: orgs[1].name, email: orgs[1].email, subject: "Напоминание", bodyText: "Ссылка: https://forms.test/form/id" + (personal ? "#personal=token" : "") } } });
      expect(payload.action).toBe("queue-reminders"); queued = true;
      return route.fulfill({ status: 202, json: { batchId: "batch", queuedCount: 2 } });
    });
    await page.goto(`/dashboard/forms/${formId}/responses`);
    await page.getByRole("button", { name: "Отчёт", exact: true }).click();
    const report = page.getByRole("dialog", { name: "Отчёт по ответам" });
    await report.getByRole("tab", { name: "Учёт сдавших" }).click();
    await report.getByRole("button", { name: "Отправить напоминание" }).click();
    const dialog = page.getByRole("dialog", { name: "Подготовить напоминания" });
    await expect(dialog.getByText("Выбрано: 2 из 2")).toBeVisible();
    await expect(dialog.getByText(/В списке только организации, которые ещё не сдали форму/)).toBeVisible();
    await expect(dialog.getByRole("checkbox", { name: /ГБОУ № 1/ })).toHaveCount(0);
    await dialog.getByRole("button", { name: "К тексту письма" }).click();
    await dialog.getByRole("button", { name: "Проверить письмо" }).click();
    await expect(dialog.getByRole("article")).toContainText(personal ? "#personal=token" : "https://forms.test/form/id");
    await expectContained(dialog);
    expect(queued).toBe(false);
    await dialog.getByRole("button", { name: "Отправить письма (2)" }).click();
    await expect(dialog.getByRole("status")).toHaveText("Поставлено в очередь писем: 2.");
    await dialog.getByRole("button", { name: "Закрыть напоминания" }).click();
    await expect(report).toBeVisible();
    expect(pageErrors).toEqual([]);
  });
}
