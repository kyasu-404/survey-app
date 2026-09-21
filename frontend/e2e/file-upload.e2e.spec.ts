import { expect, test, type Page } from "@playwright/test";
import { openSurveyApp } from "./fixtures/surveyApp";

const png = Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+aX1sAAAAASUVORK5CYII=", "base64");
const file = (name: string) => ({ name, mimeType: "image/png", buffer: png });

async function chooseFiles(page: Page, names: string[]) {
  const chooser = page.waitForEvent("filechooser");
  await page.locator(".sd-file label[for]").click();
  await (await chooser).setFiles(names.map(file));
}

test("public file upload recovers from failed deletion and upload without refreshing", async ({ page }) => {
  const { formId, pageErrors } = await openSurveyApp(page, { responseCount: 0, elements: [
    { type: "file", name: "attachment", title: "Загрузите файл", needConfirmRemoveFile: false },
  ] });
  const uploads: string[] = [];
  let failUpload = false;
  let releaseDeletion!: () => void;
  const deletionGate = new Promise<void>(resolve => { releaseDeletion = resolve; });
  let deletionStarted = false;
  await page.route("**/functions/v1/form-admin", async route => {
    const payload = route.request().postDataJSON();
    if (payload.action === "reserve-upload") return route.fulfill({ json: { path: `public/${payload.formId}/${crypto.randomUUID()}${payload.extension}` } });
    expect(route.request().postDataJSON().action).toBe("delete-upload");
    deletionStarted = true;
    await deletionGate;
    await route.fulfill({ status: 503, json: { error: "Storage temporarily unavailable" } });
  });
  await page.route("**/storage/v1/object/**", async route => {
    const path = new URL(route.request().url()).pathname;
    if (path.includes("/object/sign/")) {
      if (route.request().method() === "POST") return route.fulfill({ json: { signedURL: `${path.replace("/storage/v1", "")}?token=test` } });
      return route.fulfill({ contentType: "image/png", body: png });
    }
    expect(path).toContain(`/object/survey-files/public/${formId}/`);
    if (failUpload) return route.fulfill({ status: 503, json: { message: "Upload unavailable", statusCode: "503" } });
    uploads.push(path);
    return route.fulfill({ json: { Key: path.split("/object/")[1] } });
  });
  await page.goto(`/form/${formId}`);
  const choose = page.locator(".sd-file label[for]");
  const preview = page.locator(".sd-file img");
  await expect(choose).toBeVisible();
  await chooseFiles(page, ["first.png"]);
  await expect(preview).toBeVisible();
  await expect(preview).toHaveAttribute("src", /^data:image\/png;base64,/);

  // Replacing a file must finish while deletion of the old object is still pending.
  await chooseFiles(page, ["second.png"]);
  await expect.poll(() => deletionStarted).toBe(true);
  await expect.poll(() => uploads.length).toBe(2);
  await expect(choose).toBeVisible();
  releaseDeletion();
  await expect(preview).toHaveAttribute("src", /^data:image\/png;base64,/);

  failUpload = true;
  await chooseFiles(page, ["failed.png"]);
  await expect(page.locator(".sd-question__erbox")).toContainText("Не удалось загрузить файл");
  await expect(choose).toBeVisible();
  failUpload = false;
  await chooseFiles(page, ["retry.png"]);
  await expect.poll(() => uploads.length).toBe(3);
  await expect(preview).toHaveAttribute("src", /^data:image\/png;base64,/);
  await expect(choose).toBeVisible();
  // File bodies are deliberately excluded from local drafts; the input must recover.
  await page.reload();
  await expect(choose).toBeVisible();
  await chooseFiles(page, ["after-reload.png"]);
  await expect(preview).toHaveAttribute("src", /^data:image\/png;base64,/);
  expect(pageErrors).toEqual([]);
});

test("removing one of several public files preserves the other attachment", async ({ page }) => {
  const { formId, pageErrors } = await openSurveyApp(page, { responseCount: 0, pages: [
    { name: "intro", elements: [{ type: "text", name: "name", title: "Имя" }] },
    { name: "files", elements: [{ type: "file", name: "attachments", title: "Файлы", ...{ allowMultiple: true, needConfirmRemoveFile: false } }] },
  ] });
  const uploads: string[] = [];
  const deleted: string[] = [];
  await page.route("**/functions/v1/form-admin", async route => {
    const payload = route.request().postDataJSON();
    if (payload.action === "reserve-upload") return route.fulfill({ json: { path: `public/${payload.formId}/${crypto.randomUUID()}${payload.extension}` } });
    const body = route.request().postDataJSON();
    expect(body.action).toBe("delete-upload");
    deleted.push(body.path);
    return route.fulfill({ json: { success: true } });
  });
  await page.route("**/storage/v1/object/**", async route => {
    const path = new URL(route.request().url()).pathname;
    if (path.includes("/object/sign/")) {
      if (route.request().method() === "POST") return route.fulfill({ json: { signedURL: `${path.replace("/storage/v1", "")}?token=test` } });
      return route.fulfill({ contentType: "image/png", body: png });
    }
    uploads.push(path.split("/object/survey-files/")[1]);
    return route.fulfill({ json: { Key: path.split("/object/")[1] } });
  });
  await page.goto(`/form/${formId}`);
  await page.getByRole("button", { name: "Далее", exact: true }).click();
  await chooseFiles(page, ["remove.png", "keep.png"]);
  await expect(page.locator(".sd-file img")).toHaveCount(2);
  await page.locator(".sd-file__preview-item").filter({ hasText: "remove.png" }).locator(".sd-context-btn").click();
  await expect.poll(() => deleted).toEqual([uploads[0]]);
  await expect(page.locator(".sd-file img")).toHaveCount(1);
  await expect(page.locator(".sd-file")).toContainText("keep.png");
  await page.reload();
  await expect(page.locator(".sd-file label[for]")).toBeVisible();
  expect(pageErrors).toEqual([]);
});

test("anonymous file previews and downloads work when private Storage denies reads", async ({ page }) => {
  const { formId, pageErrors } = await openSurveyApp(page, { responseCount: 0, pages: [
    { name: "files", elements: [{ type: "file", name: "attachments", title: "Файлы", ...{ allowMultiple: true, needConfirmRemoveFile: false } }] },
    { name: "next", elements: [{ type: "text", name: "comment", title: "Комментарий" }] },
  ] });
  await page.evaluate(() => localStorage.clear());
  const uploads: string[] = [];
  const readRequests: string[] = [];
  const deleted: string[] = [];
  await page.route("**/storage/v1/object/**", async route => {
    const path = new URL(route.request().url()).pathname;
    if (path.includes("/object/sign/")) {
      readRequests.push(path);
      return route.fulfill({ status: 400, json: { message: "Object not found", statusCode: "404" } });
    }
    expect(path).toContain(`/object/survey-files/public/${formId}/`);
    uploads.push(path.split("/object/survey-files/")[1]);
    return route.fulfill({ json: { Key: path.split("/object/")[1] } });
  });
  await page.route("**/functions/v1/form-admin", async route => {
    const payload = route.request().postDataJSON();
    if (payload.action === "reserve-upload") return route.fulfill({ json: { path: `public/${payload.formId}/${crypto.randomUUID()}${payload.extension}` } });
    deleted.push(route.request().postDataJSON().path);
    return route.fulfill({ json: { success: true } });
  });
  const pdf = { name: "report.pdf", mimeType: "application/pdf", buffer: Buffer.from("%PDF-1.4\npreview test\n") };
  const docx = { name: "answer.docx", mimeType: "application/vnd.openxmlformats-officedocument.wordprocessingml.document", buffer: Buffer.from([0x50, 0x4b, 3, 4, 0, 255]) };
  await page.goto(`/form/${formId}`);
  const chooser = page.waitForEvent("filechooser");
  await page.locator(".sd-file label[for]").click();
  await (await chooser).setFiles([pdf, docx]);
  await expect(page.locator(".sd-file__preview-item")).toHaveCount(2);
  await expect(page.locator(".sd-file")).toContainText(pdf.name);
  await expect(page.locator(".sd-file")).toContainText(docx.name);

  const downloadPromise = page.waitForEvent("download");
  await page.getByRole("link", { name: docx.name, exact: true }).click();
  const download = await downloadPromise;
  expect(download.suggestedFilename()).toBe(docx.name);
  const stream = await download.createReadStream();
  const chunks = [];
  for await (const chunk of stream!) chunks.push(chunk);
  expect(Buffer.concat(chunks)).toEqual(docx.buffer);

  await chooseFiles(page, ["photo.png"]);
  await expect(page.locator(".sd-file__preview-item")).toHaveCount(3);
  await expect(page.locator(".sd-file img")).toHaveAttribute("src", /^data:image\/png;base64,/);
  await page.getByRole("button", { name: "Далее", exact: true }).click();
  await page.getByRole("button", { name: "Назад", exact: true }).click();
  await expect(page.locator(".sd-file__preview-item")).toHaveCount(3);
  await page.locator(".sd-file__preview-item").filter({ hasText: pdf.name }).locator(".sd-context-btn").click();
  await expect(page.locator(".sd-file__preview-item")).toHaveCount(2);
  await expect.poll(() => deleted).toEqual([uploads[0]]);

  let submitted: Record<string, unknown> | undefined;
  await page.route("**/rest/v1/rpc/submit_form_response", async route => {
    submitted = route.request().postDataJSON().p_data;
    return route.fulfill({ json: { status: "submitted", response_id: "response-test", response_data: submitted, response_editable: false } });
  });
  await page.getByRole("button", { name: "Далее", exact: true }).click();
  await page.getByRole("button", { name: "Отправить", exact: true }).click();
  await expect.poll(() => submitted).toEqual({ attachments: [
    { name: docx.name, type: docx.mimeType, content: uploads[1] },
    { name: "photo.png", type: "image/png", content: uploads[2] },
  ] });
  expect(readRequests).toEqual([]);
  expect(pageErrors).toEqual([]);
});
