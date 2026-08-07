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
    timeZone: MOSCOW_TIME_ZONE,
  }).formatToParts(date);
  const part = (type) => parts.find((item) => item.type === type)?.value ?? "";
  const day = part("day");
  const month = part("month");
  const year = part("year");

  return day && month && year ? `${day} ${month} ${year} года` : null;
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
