import { automationEvents, type AutomationRule, type AutomationRun } from "../../entities/automation/model";
import { formatActivityTime } from "../../shared/lib/activityTime";

const countFormat = new Intl.NumberFormat("ru-RU");
const intervalFormats = {
  day: new Intl.NumberFormat("ru-RU", { style: "unit", unit: "day" }),
  hour: new Intl.NumberFormat("ru-RU", { style: "unit", unit: "hour" }),
  minute: new Intl.NumberFormat("ru-RU", { style: "unit", unit: "minute" }),
};

function formatInterval(minutes: number) {
  if (minutes % 1440 === 0) return intervalFormats.day.format(minutes / 1440);
  if (minutes % 60 === 0) return intervalFormats.hour.format(minutes / 60);
  return intervalFormats.minute.format(minutes);
}

export function describeRuleTrigger(rule: AutomationRule) {
  const scope = rule.form_id ? "на эту форму" : "на любую из ваших форм";
  const threshold = rule.threshold === null ? null : countFormat.format(rule.threshold);
  const interval = rule.interval_minutes === null ? null : formatInterval(rule.interval_minutes);

  const event = automationEvents[rule.event_type];

  switch (rule.event_type) {
    case "response_received":
      return `Поступает новый ответ ${scope}`;
    case "response_updated":
      return rule.form_id ? "Изменяется ответ на эту форму" : "Изменяется ответ на одну из ваших форм";
    case "response_count":
      return threshold === null ? event : `Количество ответов достигает ${threshold}`;
    case "matching_count":
      return threshold === null ? event : `Количество ответов по условиям достигает ${threshold}`;
    case "matching_share":
      return threshold === null ? event : `Доля ответов по условиям достигает ${threshold} %`;
    case "inactivity":
      return interval ? `Нет новых ответов (период: ${interval})` : event;
    case "date":
      return rule.scheduled_at ? `В заданное время, ${formatActivityTime(rule.scheduled_at)}` : event;
    case "recurring":
      return interval ? `По расписанию (интервал: ${interval})` : event;
  }
}

export function describeRuleAction({ action_config: action }: AutomationRule) {
  if (action.recipientPath?.length) {
    return action.recipients.length
      ? "Отправить письмо на указанные адреса и на адрес организации из ответа"
      : "Отправить письмо на адрес организации из ответа";
  }
  return action.recipients.length > 1
    ? "Отправить письмо указанным получателям"
    : "Отправить письмо указанному получателю";
}

// These prefixes are saved with each run, so edits to the rule cannot change its history.
const runEvents = new Map([
  ["received", "Новый ответ на форму"],
  ["updated", "Изменён ответ на форму"],
  ["threshold", "Достигнут порог ответов по форме"],
  ["gap", "Период без новых ответов по форме"],
  ["date", "Запуск в заданное время для формы"],
  ["slot", "Запуск по расписанию для формы"],
]);

export function describeRunEvent(run: AutomationRun) {
  const event = runEvents.get(run.event_key?.split(":", 1)[0]) ?? "Сработало правило для формы";
  return `${event} «${run.form_title}»`;
}
