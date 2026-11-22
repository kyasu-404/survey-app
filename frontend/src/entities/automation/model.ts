export const automationEvents = {
  response_received: "Новый ответ",
  response_updated: "Изменение ответа",
  response_count: "Количество ответов",
  matching_count: "Количество ответов по условиям",
  matching_share: "Доля ответов по условиям",
  inactivity: "Период без новых ответов",
  date: "Дата и время",
  recurring: "Повтор по расписанию",
} as const;

export type AutomationEvent = keyof typeof automationEvents;
export type ConditionOperation = "eq" | "gt" | "lt" | "contains" | "any_of" | "all_of";
export type ConditionValue = string | number | boolean;
export type Condition = { path: string[]; op: ConditionOperation; value: ConditionValue | ConditionValue[] };
export type EmailAction = {
  recipients: string[];
  recipientPath?: string[];
  subject: string;
  body: string;
  mode: "summary" | "full";
};

export type RuleConfig = {
  form_id: string | null;
  name: string;
  description: string;
  enabled: boolean;
  event_type: AutomationEvent;
  threshold: number | null;
  interval_minutes: number | null;
  scheduled_at: string | null;
  match_mode: "all" | "any";
  conditions: Condition[];
  action_config: EmailAction;
};

export type AutomationRule = RuleConfig & {
  id: string;
  created_at: string;
  form: { title: string } | null;
};

export type AutomationRun = {
  id: string;
  form_id: string;
  form_title: string;
  response_id: string | null;
  status: "pending" | "queued" | "succeeded" | "failed" | "cancelled";
  recipient_count: number;
  sent_count: number;
  failed_count: number;
  last_error: string | null;
  created_at: string;
};

type FieldChoice = string | number | boolean | { value: string | number | boolean; text?: string | Record<string, string> };
export type AutomationField = {
  path: string[];
  label: string;
  type: string;
  choices: FieldChoice[] | null;
  input_type: string | null;
};

export const automationKey = (userId: string) => ["automations", userId] as const;
