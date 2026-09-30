const MOSCOW_TIME_ZONE = "Europe/Moscow";

function oneLine(value) {
  return String(value ?? "").replace(/[\r\n\t]+/g, " ").replace(/\s{2,}/g, " ").trim();
}

export function formatRussianDeadline(value) {
  if (!value) return null;
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return null;

  const parts = new Intl.DateTimeFormat("ru-RU", {
    day: "numeric",
    month: "long",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
    hourCycle: "h23",
    timeZone: MOSCOW_TIME_ZONE,
  }).formatToParts(date);
  const part = (type) => parts.find((item) => item.type === type)?.value ?? "";
  const day = part("day");
  const month = part("month");
  const year = part("year");
  const hour = part("hour");
  const minute = part("minute");

  return day && month && year && hour && minute
    ? `${day} ${month} ${year} года, ${hour}:${minute} (МСК)`
    : null;
}

export function getOrganizationMailName(organization) {
  const alias = oneLine(organization?.alias);
  const number = oneLine(organization?.number);
  return number ? `${alias} № ${number}` : alias;
}

export function buildReminderMail({ organizationName, formTitle, deadlineAt, formUrl }) {
  const safeOrganizationName = oneLine(organizationName);
  const safeFormTitle = oneLine(formTitle);
  const deadline = formatRussianDeadline(deadlineAt);
  const deadlineLine = deadline ? `\nСрок сдачи: ${deadline}.` : "";

  return {
    subject: `Напоминание: заполните форму «${safeFormTitle}»`,
    bodyText: [
      `Уважаемые представители ${safeOrganizationName}!`,
      "",
      `Форма «${safeFormTitle}» ещё не заполнена.${deadlineLine}`,
      "",
      `Открыть форму: ${formUrl}`,
    ].join("\n"),
  };
}

export function buildInvitationMail({ organizationName, formTitle, deadlineAt, formUrl }) {
  const title = oneLine(formTitle);
  const deadline = formatRussianDeadline(deadlineAt);
  return {
    subject: `Просим заполнить форму «${title}»`,
    bodyText: [
      "Добрый день!", "",
      `Просим ${oneLine(organizationName)} заполнить форму «${title}».`, "",
      ...(deadline ? [`Срок заполнения: ${deadline}.`, ""] : []),
      "Перейти к форме:", formUrl,
    ].join("\n"),
  };
}

export function buildFormMailJobs({ organizations, form, appBaseUrl, kind, personal, template }) {
  return organizations.map(organization => {
    const recipientName = getOrganizationMailName(organization);
    const url = new URL(`/form/${form.id}`, appBaseUrl);
    if (personal) {
      if (!organization.token) throw new Error("Не найдена персональная ссылка организации");
      // Fragment keeps capabilities out of HTTP access logs and Referer headers.
      url.hash = new URLSearchParams({ personal: organization.token }).toString();
    }
    const content = template ? renderMailTemplate(template, {
      organizationName: recipientName, formTitle: form.title, deadlineAt: form.deadline_at, formUrl: url.toString(),
    }) : (kind === "invitation" ? buildInvitationMail : buildReminderMail)({
      organizationName: recipientName, formTitle: form.title, deadlineAt: form.deadline_at, formUrl: url.toString(),
    });
    return {
      organization_id: organization.id, recipient_email: organization.email.toLowerCase(),
      recipient_name: recipientName, subject: content.subject, body_text: content.bodyText,
    };
  });
}


export function getDefaultMailTemplate(kind) {
  return kind === "invitation" ? {
    subject: "Просим заполнить форму «{Название формы}»",
    bodyText: "Добрый день!\n\nПросим {Организация} заполнить форму «{Название формы}».\n\nСрок заполнения: {Дедлайн}.\n\nПерейти к форме:\n{Ссылка}",
  } : {
    subject: "Напоминание: заполните форму «{Название формы}»",
    bodyText: "Уважаемые представители {Организация}!\n\nФорма «{Название формы}» ещё не заполнена.\nСрок сдачи: {Дедлайн}.\n\nОткрыть форму: {Ссылка}",
  };
}

const variables = new Set(["Организация", "Название формы", "Дедлайн", "Ссылка", "Персональная ссылка"]);
export function validateMailTemplate(template) {
  if (!template || typeof template.subject !== "string" || typeof template.bodyText !== "string") {
    throw new Error("Укажите тему и текст письма");
  }
  const subject = template.subject.trim();
  const bodyText = template.bodyText.replace(/\r\n?/g, "\n").trim();
  if (!subject || subject.length > 500 || /[\r\n\x00-\x1f\x7f]/.test(subject)) {
    throw new Error("Тема должна содержать от 1 до 500 символов в одной строке");
  }
  if (!bodyText || bodyText.length > 20000 || /[\x00-\x08\x0b\x0c\x0e-\x1f\x7f]/.test(bodyText)) {
    throw new Error("Текст письма должен содержать от 1 до 20000 символов");
  }
  for (const match of `${subject}\n${bodyText}`.matchAll(/\{([^{}]+)\}/g)) {
    if (!variables.has(match[1])) throw new Error(`Неизвестная подстановка: {${match[1]}}`);
  }
  if (!/\{(?:Персональная ссылка|Ссылка)\}/.test(bodyText)) throw new Error("Добавьте в текст письма подстановку {Ссылка}");
  if (subject.includes("{Дедлайн}")) throw new Error("Добавьте {Дедлайн} отдельной строкой в текст письма");
  for (const line of bodyText.split("\n")) {
    if (line.includes("{Дедлайн}") && /\{(?:Организация|Название формы|Персональная ссылка|Ссылка)\}/.test(line)) {
      throw new Error("Разместите строку с {Дедлайн} отдельно от остальных подстановок");
    }
  }
  return { subject, bodyText };
}

export function renderMailTemplate(template, { organizationName, formTitle, deadlineAt, formUrl }) {
  const deadline = formatRussianDeadline(deadlineAt);
  const values = { "Организация": oneLine(organizationName), "Название формы": oneLine(formTitle),
    "Дедлайн": deadline ?? "", "Ссылка": formUrl, "Персональная ссылка": formUrl };
  // Replace once: braces in directory values or titles are literal, not nested templates.
  const render = value => value.replace(/\{([^{}]+)\}/g, (match, key) => values[key] ?? match);
  const subject = render(template.subject);
  const bodyText = render(template.bodyText.split("\n").filter(line => deadline || !line.includes("{Дедлайн}")).join("\n")).replace(/\n{3,}/g, "\n\n").trim();
  if (subject.length > 500 || bodyText.length > 20000) throw new Error("После подстановки данных письмо слишком длинное: сократите тему или текст");
  return { subject, bodyText };
}

export function selectMailRecipients(organizations, organizationIds) {
  // Requests from an older open client retain their original all-recipient behavior.
  if (organizationIds === undefined) return organizations;
  if (!Array.isArray(organizationIds) || organizationIds.length === 0 || organizationIds.length > 5000
    || organizationIds.some(id => typeof id !== "string" || !/^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(id))) {
    throw new Error("Выберите от 1 до 5000 организаций");
  }
  const ids = new Set(organizationIds);
  if (ids.size !== organizationIds.length) throw new Error("Список организаций содержит повторы");
  const selected = organizations.filter(organization => ids.has(organization.id));
  if (selected.length !== ids.size) throw new Error("Список получателей изменился. Обновите список и проверьте выбор организаций");
  return selected;
}
