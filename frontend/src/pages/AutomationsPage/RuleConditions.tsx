import { type AutomationField, type Condition, type ConditionOperation, type ConditionValue } from "../../entities/automation/model";
import { Icon } from "../../shared/ui/Icon";
import { RuleFieldErrorMessage, ruleErrorAttributes, type RuleFieldError } from "./RuleValidation";

const operations: Record<ConditionOperation, string> = {
  eq: "Равно",
  gt: "Больше",
  lt: "Меньше",
  contains: "Содержит фразу",
  any_of: "Один из вариантов",
  all_of: "Все указанные варианты",
};

const multiValueFields = new Set(["checkbox", "tagbox", "imagepicker", "ranking"]);

export function fieldKey(path?: string[]) {
  return path?.length ? JSON.stringify(path) : "";
}

export function trimConditionValue(value: ConditionValue) {
  return typeof value === "string" ? value.trim() : value;
}

function conditionValueKey(value: ConditionValue) {
  return String(trimConditionValue(value));
}

function isMultiple(op: ConditionOperation) {
  return op === "any_of" || op === "all_of";
}

function choicesFor(field: AutomationField | undefined) {
  if (!Array.isArray(field?.choices)) return [];
  return field.choices.flatMap((choice) => {
    if (choice === null) return [];
    const value = typeof choice === "object" ? choice.value : choice;
    if (!["string", "number", "boolean"].includes(typeof value) || value === "") return [];
    const text = typeof choice === "object" ? choice.text : undefined;
    const label = typeof text === "string" ? text.trim() : text?.ru?.trim() || text?.default?.trim();
    return [{ value: String(value), label: label || String(value) }];
  });
}

type ConditionError = { field: "question" | "value"; message: string };
export type RuleConditionField = `condition-${number}-${ConditionError["field"]}`;

export function conditionError(condition: Condition, fields: AutomationField[]): ConditionError | null {
  const field = fields.find(item => fieldKey(item.path) === fieldKey(condition.path));
  const { op, value } = condition;
  if (!field) return {
    field: "question",
    message: condition.path.length ? "Этот вопрос больше недоступен. Выберите другой." : "Выберите вопрос для условия.",
  };
  if (op === "gt" || op === "lt") {
    return /^[+-]?\d{1,30}([.,]\d{1,30})?$/.test(String(value))
      ? null : { field: "value", message: "Введите число для сравнения." };
  }
  const multiple = isMultiple(op);
  if (value === "") return {
    field: "value",
    message: Array.isArray(field.choices) ? "Выберите вариант ответа." : "Введите значение для сравнения.",
  };
  const values = Array.isArray(value) ? value : [value];
  if (multiple && (!values.length || values.length > 50 || values.some(item => String(item).length > 1000))) {
    return { field: "value", message: "Выберите от 1 до 50 вариантов длиной до 1000 символов каждый." };
  }
  const options = choicesFor(field);
  if ((multiple || op === "eq") && Array.isArray(field.choices) &&
    values.some(item => !options.some(option => option.value === String(item)))) {
    return { field: "value", message: "Уберите удалённые варианты или выберите актуальные." };
  }
  return null;
}

type Props = {
  fields: AutomationField[];
  conditions: Condition[];
  mode: "all" | "any";
  errorFor: (field: RuleConditionField) => RuleFieldError | undefined;
  onMode: (mode: "all" | "any") => void;
  onConditions: (conditions: Condition[]) => void;
};

export function RuleConditions({ fields, conditions, mode, errorFor, onMode, onConditions }: Props) {
  const update = (index: number, next: Condition) => onConditions(conditions.map((condition, row) => row === index ? next : condition));

  return <>
    {conditions.length > 1 && <label className="activity-field">Как проверять условия
      <select value={mode} onChange={(event) => onMode(event.target.value as "all" | "any")}>
        <option value="all">Все условия (И)</option><option value="any">Любое условие (ИЛИ)</option>
      </select>
    </label>}
    {conditions.map((condition, index) => {
      const currentField = fields.find((field) => fieldKey(field.path) === fieldKey(condition.path));
      const options = choicesFor(currentField);
      const multiple = isMultiple(condition.op);
      const selected = Array.isArray(condition.value) ? condition.value : [];
      const usesChoices = Array.isArray(currentField?.choices) && (multiple || condition.op === "eq");
      const savedOptions = Array.isArray(condition.value) ? condition.value : [condition.value];
      const removed = [...new Set(savedOptions.map(conditionValueKey))]
        .filter(value => value && !options.some(option => option.value === value));
      const questionError = errorFor(`condition-${index}-question`);
      const valueError = errorFor(`condition-${index}-value`);
      return (
        <div key={index} className="activity-condition">
          <div className="activity-condition-controls">
            <label className="activity-field">Вопрос
              <select required value={fieldKey(condition.path)} {...ruleErrorAttributes(questionError)} onChange={(event) => {
                const field = fields.find((item) => fieldKey(item.path) === event.target.value);
                const multiValue = field && multiValueFields.has(field.type);
                update(index, { path: field?.path ?? [], op: multiValue ? "any_of" : "eq", value: multiValue ? [] : "" });
              }}>
                <option value="">Выберите вопрос</option>
                {!currentField && condition.path.length > 0 && <option value={fieldKey(condition.path)} disabled>
                  Вопрос удалён · {condition.path.join(" / ")}
                </option>}
                {fields.map((field) => <option key={fieldKey(field.path)} value={fieldKey(field.path)}>{field.label}</option>)}
              </select>
            </label>
            <label className="activity-field">Сравнение
              <select value={condition.op} onChange={(event) => {
                const op = event.target.value as ConditionOperation;
                update(index, { ...condition, op, value: isMultiple(op) ? [] : "" });
              }}>
                {Object.entries(operations).map(([id, label]) => <option key={id} value={id}>{label}</option>)}
              </select>
            </label>
            <button type="button" className="app-button icon-button" aria-label={"Удалить условие " + (index + 1)}
              onClick={() => onConditions(conditions.filter((_, row) => row !== index))}><Icon name="close" /></button>
          </div>
          <RuleFieldErrorMessage error={questionError} />
          {multiple && usesChoices
            ? <fieldset className="activity-choices" tabIndex={valueError ? -1 : undefined} {...ruleErrorAttributes(valueError)}>
              <legend>Варианты ответа</legend>
              {removed.map(value => <label className="activity-checkbox" key={value}>
                <input type="checkbox" checked onChange={() => update(index, { ...condition, value: selected.filter(item => conditionValueKey(item) !== value) })} />
                Удалённый вариант · {value}
              </label>)}
              {options.map((option, row) => <label className="activity-checkbox" key={row}>
                <input type="checkbox" checked={selected.some(value => conditionValueKey(value) === option.value)} onChange={(event) => update(index, {
                  ...condition, value: event.target.checked ? [...selected, option.value] : selected.filter(value => conditionValueKey(value) !== option.value),
                })} />{option.label}
              </label>)}
            </fieldset>
            : usesChoices
              ? <label className="activity-field">Значение
                <select required value={conditionValueKey(savedOptions[0] ?? "")} {...ruleErrorAttributes(valueError)}
                  onChange={(event) => update(index, { ...condition, value: event.target.value })}>
                  <option value="">Выберите вариант</option>
                  {removed.map(value => <option key={value} value={value} disabled>Удалённый вариант · {value}</option>)}
                  {options.map((option, row) => <option key={row} value={option.value}>{option.label}</option>)}
                </select>
              </label>
              : <label className="activity-field">{multiple ? "Варианты через запятую" : "Значение"}
                <input required maxLength={2000} inputMode={condition.op === "gt" || condition.op === "lt" ? "decimal" : "text"}
                  value={multiple ? selected.join(",") : String(condition.value)} {...ruleErrorAttributes(valueError)}
                  onChange={(event) => update(index, {
                    ...condition, value: multiple ? event.target.value.split(",") : event.target.value,
                  })} />
              </label>}
          <RuleFieldErrorMessage error={valueError} />
        </div>
      );
    })}
    <button type="button" className="app-button" disabled={!fields.length || conditions.length >= 12}
      onClick={() => onConditions([...conditions, { path: [], op: "eq", value: "" }])}><Icon name="add" /> Добавить условие</button>
  </>;
}
