import { formClosedDescription, type AutomationEvent } from "../../entities/automation/model";
import { formatDateTimeLocalValue } from "../../shared/lib/dateTime";
import { Icon, type IconName } from "../../shared/ui/Icon";

export type RuleScenario = {
  name: string;
  event: AutomationEvent;
  subject: string;
  body: string;
  threshold?: number;
  periodDays?: number;
};

const scenarios: { title: string; description: string; icon: IconName; draft: RuleScenario | null; scope?: "form" | "global" }[] = [
  {
    title: "Сообщать о новых ответах",
    description: "Отправлять письмо со ссылкой при поступлении нового ответа.",
    icon: "notifications",
    draft: {
      name: "Новые ответы",
      event: "response_received",
      subject: "{{form_title}} — новый ответ",
      body: "Получен новый ответ на форму «{{form_title}}».\nОткрыть ответ: {{response_link}}",
    },
  },
  {
    title: "Сообщать о достижении количества ответов",
    description: "Например, когда собрано 50 ответов.",
    icon: "table_chart",
    draft: {
      name: "Порог ответов",
      event: "response_count",
      subject: "{{form_title}} — достигнут порог ответов",
      body: "В форме «{{form_title}}» достигнут порог.\nВсего ответов: {{answer_count}}.\nОткрыть ответы: {{form_link}}",
      threshold: 50,
    },
  },
  {
    title: "Отправлять сводку по расписанию",
    description: "Например, каждую пятницу в 09:00 по местному времени.",
    icon: "schedule",
    scope: "form",
    draft: {
      name: "Сводка по расписанию",
      event: "recurring",
      subject: "{{form_title}} — сводка по ответам",
      body: "Сводка по форме «{{form_title}}».\nВсего ответов: {{answer_count}}.\nОткрыть ответы: {{form_link}}",
      periodDays: 7,
    },
  },
  {
    title: "Сообщать о завершении сбора ответов",
    description: formClosedDescription,
    icon: "check_circle",
    scope: "global",
    draft: {
      name: "Завершение сбора ответов",
      event: "form_closed",
      subject: "{{form_title}} — сбор ответов завершён",
      body: "Сбор ответов по форме «{{form_title}}» завершён.\nВсего ответов: {{answer_count}}.\nОткрыть ответы: {{form_link}}",
    },
  },
  {
    title: "Настроить своё правило",
    description: "Выбрать событие, условия, получателей и содержание письма вручную.",
    icon: "settings",
    draft: null,
  },
];

export function nextFridayMorning(now = new Date()) {
  const start = new Date(now);
  start.setDate(start.getDate() + (5 - start.getDay() + 7) % 7);
  start.setHours(9, 0, 0, 0);
  if (start <= now) start.setDate(start.getDate() + 7);
  return formatDateTimeLocalValue(start.toISOString());
}

export function RuleScenarios({ scope, onChoose }: { scope: "form" | "global"; onChoose: (draft: RuleScenario | null) => void }) {
  return <ul className="rule-scenarios">
    {scenarios.filter(scenario => !scenario.scope || scenario.scope === scope).map(({ title, description, icon, draft }) => <li key={title}>
      <button type="button" className="rule-scenario" aria-label={title} aria-description={description} onClick={() => onChoose(draft)}>
        <Icon name={icon} size={18} />
        <span><strong>{title}</strong><small>{description}</small></span>
        <Icon name="chevron_right" size={18} />
      </button>
    </li>)}
  </ul>;
}
