import { type AutomationField, type Condition, type ConditionOperation } from "../../entities/automation/model";
import { Icon } from "../../shared/ui/Icon";

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

export function conditionError(condition: Condition, fields: AutomationField[]) {
  const field = fields.find(item => fieldKey(item.path) === fieldKey(condition.path));
  const { op, value } = condition;
  if (!field || value === "") return "Проверьте вопрос и значение каждого условия.";
  if (op === "gt" || op === "lt") {
    return /^[+-]?\d{1,30}([.,]\d{1,30})?$/.test(String(value)) ? null : "Введите число для сравнения.";
  }
  const multiple = isMultiple(op);
  const values = Array.isArray(value) ? value : [value];
  if (multiple && (!values.length || values.length > 50 || values.some(item => String(item).length > 1000))) {
    return "Выберите от 1 до 50 вариантов длиной до 1000 символов каждый.";
  }
  const options = choicesFor(field);
  if ((multiple || op === "eq") && Array.isArray(field.choices) &&
    values.some(item => !options.some(option => option.value === String(item)))) {
    return "Уберите удалённые варианты или выберите актуальные.";
  }
  return null;
}

type Props = {
  fields: AutomationField[];
  conditions: Condition[];
  mode: "all" | "any";
  onMode: (mode: "all" | "any") => void;
  onConditions: (conditions: Condition[]) => void;
};

export function RuleConditions({ fields, conditions, mode, onMode, onConditions }: Props) {
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
      const removed = (multiple ? selected : [condition.value]).map(String).filter(value => value && !options.some(option => option.value === value));
      return (
        <div key={index} className="activity-condition">
          <div className="activity-condition-controls">
            <label className="activity-field">Вопрос
              <select required value={fieldKey(condition.path)} onChange={(event) => {
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
          {multiple && usesChoices
            ? <fieldset className="activity-choices">
              <legend>Варианты ответа</legend>
              {removed.map(value => <label className="activity-checkbox" key={value}>
                <input type="checkbox" checked onChange={() => update(index, { ...condition, value: selected.filter(item => String(item) !== value) })} />
                Удалённый вариант · {value}
              </label>)}
              {options.map((option, row) => <label className="activity-checkbox" key={row}>
                <input type="checkbox" checked={selected.some((value) => String(value) === option.value)} onChange={(event) => update(index, {
                  ...condition, value: event.target.checked ? [...selected, option.value] : selected.filter((value) => String(value) !== option.value),
                })} />{option.label}
              </label>)}
            </fieldset>
            : usesChoices
              ? <label className="activity-field">Значение
                <select required value={String(condition.value)} onChange={(event) => update(index, { ...condition, value: event.target.value })}>
                  <option value="">Выберите вариант</option>
                  {removed.map(value => <option key={value} value={value} disabled>Удалённый вариант · {value}</option>)}
                  {options.map((option, row) => <option key={row} value={option.value}>{option.label}</option>)}
                </select>
              </label>
              : <label className="activity-field">{multiple ? "Варианты через запятую" : "Значение"}
                <input required maxLength={2000} inputMode={condition.op === "gt" || condition.op === "lt" ? "decimal" : "text"}
                  value={multiple ? selected.join(",") : String(condition.value)}
                  onChange={(event) => update(index, {
                    ...condition, value: multiple ? event.target.value.split(",") : event.target.value,
                  })} />
              </label>}
        </div>
      );
    })}
    <button type="button" className="app-button" disabled={!fields.length || conditions.length >= 12}
      onClick={() => onConditions([...conditions, { path: [], op: "eq", value: "" }])}><Icon name="add" /> Добавить условие</button>
  </>;
}
