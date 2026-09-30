import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { buildFormMailJobs, buildInvitationMail, buildReminderMail, formatRussianDeadline, getOrganizationMailName } from "./mailContent.mjs";

const source = readFileSync(new URL("./index.ts", import.meta.url), "utf8");

test("builds an individual reminder with a Russian deadline", () => {
  const mail = buildReminderMail({
    organizationName: "ГБОУ № 123",
    formTitle: "Мониторинг сайтов",
    deadlineAt: "2026-09-10T15:00:00.000Z",
    formUrl: "https://forms.example.ru/form/11111111-1111-4111-8111-111111111111",
  });

  assert.match(mail.bodyText, /Уважаемые представители ГБОУ № 123!/);
  assert.match(mail.bodyText, /Срок сдачи: 10 сентября 2026 года, 18:00 \(МСК\)\./);
  assert.match(mail.bodyText, /Открыть форму: https:\/\/forms\.example\.ru\/form\//);
});

test("formats deadline minutes and midnight in Moscow regardless of the source offset", () => {
  assert.equal(formatRussianDeadline("2026-08-14T20:59:59.000Z"), "14 августа 2026 года, 23:59 (МСК)");
  assert.equal(formatRussianDeadline("2026-08-14T21:00:00.000Z"), "15 августа 2026 года, 00:00 (МСК)");
  assert.equal(formatRussianDeadline("2026-09-10T18:00:00+03:00"), "10 сентября 2026 года, 18:00 (МСК)");
  assert.equal(formatRussianDeadline("not-a-date"), null);
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
  assert.match(source, /form\.author_id !== profile\.id/);
  assert.match(source, /prepare_form_mail_recipients/);
  assert.match(source, /MAIL_ADMIN_ALLOWED_ORIGINS/);
  assert.match(source, /rpc\("enqueue_form_mail_batch"/);
  assert.doesNotMatch(source, /const \{ data: activeJob/);
  assert.doesNotMatch(source, /configured \|\| req\.headers\.get\("Origin"\)/);
  assert.doesNotMatch(source, /Access-Control-Allow-Origin": "\*"/);
});

for (const deadlineAt of [null, "2026-10-10T15:00:00.000Z"]) {
  test(`invitation includes organization and optional deadline: ${deadlineAt}`, () => {
    const mail = buildInvitationMail({ organizationName: "Школа № 12", formTitle: "Отчёт", deadlineAt, formUrl: "https://forms.test/form/id#personal=token" });
    assert.equal(mail.subject, "Просим заполнить форму «Отчёт»");
    assert.ok(mail.bodyText.includes("Просим Школа № 12 заполнить форму «Отчёт»."));
    assert.equal(mail.bodyText.includes("Срок заполнения:"), Boolean(deadlineAt));
    assert.ok(mail.bodyText.endsWith("Перейти к форме:\nhttps://forms.test/form/id#personal=token"));
  });
}

test("invitations and reminders use the same per-organization links; disabled mode uses the common URL", () => {
  const organizations = [{ id: "one", alias: "Школа", number: "1", email: "ONE@school.test", token: "token-1" },
    { id: "two", alias: "Школа", number: "2", email: "two@school.test", token: "token-2" }];
  for (const kind of ["invitation", "reminder"]) {
    const args = { organizations, form: { id: "form", title: "Форма", deadline_at: null }, appBaseUrl: "https://forms.test", kind };
    const jobs = buildFormMailJobs({ ...args, personal: true });
    assert.equal(jobs.length, 2);
    assert.ok(jobs[0].body_text.includes("https://forms.test/form/form#personal=token-1"));
    assert.ok(jobs[1].body_text.includes("https://forms.test/form/form#personal=token-2"));
    assert.equal(jobs[0].recipient_email, "one@school.test");
    const common = buildFormMailJobs({ ...args, personal: false });
    assert.ok(common.every(job => !job.body_text.includes("#personal=")));
    assert.throws(() => buildFormMailJobs({ ...args, organizations: [{ ...organizations[0], token: null }], personal: true }));
  }
});

const { getDefaultMailTemplate, validateMailTemplate, renderMailTemplate, selectMailRecipients } = await import("./mailContent.mjs");
const orgs = [1, 2, 3].map(number => ({ id: `40000000-0000-4000-8000-${String(number).padStart(12, "0")}`, alias: "ГБОУ", number: String(number), email: `org${number}@school.test`, token: `token-${number}` }));

test("only selected eligible organizations get their own personalized custom message", () => {
  const selected = selectMailRecipients(orgs, [orgs[1].id]);
  const template = validateMailTemplate({ subject: "Для {Организация}: {Название формы}", bodyText: "Новый текст\nСрок: {Дедлайн}\n{Ссылка}" });
  const jobs = buildFormMailJobs({ organizations: selected, form: { id: "form", title: "Отчёт", deadline_at: null }, appBaseUrl: "https://forms.test", kind: "invitation", personal: true, template });
  assert.equal(jobs.length, 1);
  assert.equal(jobs[0].subject, "Для ГБОУ № 2: Отчёт");
  assert.equal(jobs[0].body_text, "Новый текст\nhttps://forms.test/form/form#personal=token-2");
  assert.equal(jobs[0].recipient_email, orgs[1].email);
});

test("validates selection including stale or foreign recipients and does not silently expand it", () => {
  for (const ids of [null, [], ["bad-id"], [orgs[0].id, orgs[0].id], ["40000000-0000-4000-8000-999999999999"], Array(5001).fill(orgs[0].id)]) {
    assert.throws(() => selectMailRecipients(orgs, ids));
  }
  assert.deepEqual(selectMailRecipients(orgs, undefined), orgs);
  assert.throws(() => selectMailRecipients(orgs.slice(1), [orgs[0].id]), /Список получателей изменился/);
  assert.deepEqual(selectMailRecipients(orgs, [orgs[0].id]), [orgs[0]]);
});

test("rejects invalid content and preserves a link when deadline is missing", () => {
  const good = getDefaultMailTemplate("invitation");
  for (const template of [null, { ...good, subject: "" }, { ...good, subject: "Header\r\nBcc: injected" }, { ...good, subject: "a".repeat(501) }, { ...good, bodyText: "No link" }, { ...good, bodyText: "{Ссылка} {Несуществующее поле}" }, { ...good, bodyText: "{Дедлайн} {Ссылка}" }, { ...good, bodyText: "a".repeat(20001) }, { ...good, subject: "Срок: {Дедлайн}" }]) {
    assert.throws(() => validateMailTemplate(template));
  }
  const content = renderMailTemplate(validateMailTemplate(good), { organizationName: "{Ссылка}", formTitle: "Отчёт", deadlineAt: null, formUrl: "https://forms.test" });
  assert.ok(content.bodyText.includes("Просим {Ссылка}"));
  assert.ok(!content.bodyText.includes("Дедлайн"));
  assert.throws(() => renderMailTemplate(good, { organizationName: "a".repeat(20000), formTitle: "Отчёт", formUrl: "https://forms.test" }), /слишком длинное/);
});

for (const kind of ["invitation", "reminder"]) {
  test(`default ${kind} template matches existing content with and without deadline`, () => {
    for (const deadlineAt of [null, "2026-10-10T15:00:00Z"]) {
      const args = { organizationName: "Школа № 1", formTitle: "Отчёт", deadlineAt, formUrl: "https://forms.test/form/id" };
      assert.deepEqual(renderMailTemplate(validateMailTemplate(getDefaultMailTemplate(kind)), args), (kind === "invitation" ? buildInvitationMail : buildReminderMail)(args));
    }
  });
}
