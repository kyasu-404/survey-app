export type FormOption = {
  value: string;
  label: string;
};

export const DEFAULT_FORM_TYPE = "anketa";
export const DEFAULT_FORM_REASON = "plan";

export const REGULAR_FORM_TYPE_OPTIONS: FormOption[] = [
  { value: "anketa", label: "Анкетирование" },
  { value: "voting", label: "Голосование" },
  { value: "request", label: "Запрос" },
  { value: "monitoring", label: "Мониторинг" },
  { value: "survey", label: "Опрос" },
  { value: "sample", label: "Проба" },
  { value: "other", label: "Другое" },
];

export const FORM_REASON_OPTIONS: FormOption[] = [
  { value: "request", label: "Запрос" },
  { value: "plan", label: "План работ" },
  { value: "order", label: "Приказ" },
  { value: "directive", label: "Распоряжение" },
  { value: "other", label: "Иное" },
];

const FORM_TYPE_LABELS = {
  template: "Шаблон",
  ...Object.fromEntries(REGULAR_FORM_TYPE_OPTIONS.map((option) => [option.value, option.label])),
} as Record<string, string>;

const FORM_REASON_LABELS = Object.fromEntries(
  FORM_REASON_OPTIONS.map((option) => [option.value, option.label]),
) as Record<string, string>;

export function getFormTypeLabel(formType: string) {
  return FORM_TYPE_LABELS[formType] ?? formType;
}

export function getFormReasonLabel(formReason: string) {
  return FORM_REASON_LABELS[formReason] ?? formReason;
}
