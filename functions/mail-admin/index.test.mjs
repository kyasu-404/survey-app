import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { buildReminderMail, formatRussianDeadline, getOrganizationMailName } from "./mailContent.mjs";

const source = readFileSync(new URL("./index.ts", import.meta.url), "utf8");

test("builds an individual reminder with a Russian deadline", () => {
  const mail = buildReminderMail({
    organizationName: "ГБОУ № 123",
    formTitle: "Мониторинг сайтов",
    deadlineAt: "2026-08-14T20:59:59.000Z",
    formUrl: "https://forms.example.ru/form/11111111-1111-4111-8111-111111111111",
  });

  assert.equal(formatRussianDeadline("2026-08-14T20:59:59.000Z"), "14 августа 2026 года");
  assert.match(mail.bodyText, /Уважаемые представители ГБОУ № 123!/);
  assert.match(mail.bodyText, /Срок сдачи: 14 августа 2026 года\./);
  assert.match(mail.bodyText, /Открыть форму: https:\/\/forms\.example\.ru\/form\//);
});

test("omits the deadline line when a form has no deadline", () => {
  const mail = buildReminderMail({
    organizationName: getOrganizationMailName({ alias: "ДДТ", number: null }),
    formTitle: "Отчёт",
    deadlineAt: null,
    formUrl: "https://forms.example.ru/form/id",
  });
  assert.doesNotMatch(mail.bodyText, /Срок сдачи/);
  assert.match(mail.bodyText, /представители ДДТ/);
});

test("keeps SMTP credentials server-side and restricts administrative actions", () => {
  assert.match(source, /MAIL_SETTINGS_ENCRYPTION_KEY/);
  assert.match(source, /AES-GCM/);
  const publicSettingsSource = source.match(/function publicSettings[\s\S]*?\n}/)?.[0] ?? "";
  assert.match(publicSettingsSource, /hasPassword: Boolean\(row\.password_encrypted\)/);
  assert.doesNotMatch(publicSettingsSource, /passwordEncrypted:/);
  assert.match(source, /profile\.role !== "admin"/);
  assert.match(source, /form\.author_id !== profile\.id && profile\.role !== "admin"/);
  assert.match(source, /list_missing_form_organizations/);
  assert.match(source, /MAIL_ADMIN_ALLOWED_ORIGINS/);
  assert.doesNotMatch(source, /Access-Control-Allow-Origin": "\*"/);
});
