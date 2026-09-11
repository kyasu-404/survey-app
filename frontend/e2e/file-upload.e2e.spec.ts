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
