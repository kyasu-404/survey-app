import { ModalHeading } from "../../shared/ui/ModalHeading";
import { useEffect, useId, useRef, useState, type FormEvent } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { createAuthCacheGuard } from "../../app/providers/authCache";
import { getAutomationFields, saveAutomationRule, type AutomationForm } from "../../entities/automation/api";
import { automationEvents, formClosedDescription, type AutomationEvent, type AutomationRule, type Condition, type EmailAction, type RuleConfig } from "../../entities/automation/model";
import { getFormOrganizations } from "../../entities/organization/api";
import { getOrganizationDisplayName, ORGANIZATION_QUESTION_TYPE } from "../../entities/organization/model";
import { formatDateTimeLocalValue } from "../../shared/lib/dateTime";
import { getErrorMessage } from "../../shared/lib/error";
import { useModalSurface } from "../../shared/ui/useModalSurface";
import { RuleEmailPreview, RuleEmailTemplate } from "./RuleEmail";
import { nextFridayMorning, RuleScenarios, type RuleScenario } from "./RuleScenarios";
import { RuleFieldErrorMessage, ruleErrorAttributes } from "./RuleValidation";
import "./ruleEditor.css";
import { conditionError, fieldKey, RuleConditions, trimConditionValue, type RuleConditionField } from "./RuleConditions";

const periods = { 1: "минуты", 60: "часы", 1440: "дни" };

const earliestSchedule = "2000-01-01T00:00:00Z";
const latestSchedule = "2200-01-01T00:00:00Z";
const emailPattern = /^[\p{L}\p{N}.!#$%&'*+/=?^_{|}~-]+@[\p{L}\p{N}](?:[\p{L}\p{N}-]*[\p{L}\p{N}])?(?:\.[\p{L}\p{N}](?:[\p{L}\p{N}-]*[\p{L}\p{N}])?)+$/u;

function validAddress(address: string) {
  return Array.from(address).length <= 254 && emailPattern.test(address) && !/(^\.|\.\.|\.$)/.test(address.split("@")[0]);
}

const steps = ["Основное", "Событие", "Письмо", "Предпросмотр"];

function displayPeriod(minutes?: number | null) {
  const value = minutes ?? 1440;
  return value % 1440 === 0 ? 1440 : value % 60 === 0 ? 60 : 1;
}

function requiresConditions(event: AutomationEvent) {
  return event === "matching_count" || event === "matching_share";
}

type Props = { userId: string; form: AutomationForm | null; rule: AutomationRule | null; onClose: () => void; onSaved: (id: string) => void };

type RuleField = "name" | "threshold" | "period" | "schedule" | "conditions" | "recipients" | "recipientPath" | "subject" | "body" | "mode" | RuleConditionField;

export function RuleEditor({ userId, form, rule, onClose, onSaved }: Props) {
  const queryClient = useQueryClient();
  const dialog = useModalSurface();
  const [name, setName] = useState(rule?.name ?? "");
  const [description, setDescription] = useState(rule?.description ?? "");
  const [enabled, setEnabled] = useState(rule?.enabled ?? true);
  const [event, setEvent] = useState<AutomationEvent>(rule?.event_type ?? "response_received");
  const formId = form?.id ?? null;
  const [step, setStep] = useState(rule ? 0 : -1);
  const choosingScenario = step < 0;
  const errorId = useId();
  const stepHeading = useRef<HTMLHeadingElement>(null);
  useEffect(() => { stepHeading.current?.focus(); }, [step]);
  const [threshold, setThreshold] = useState(String(rule?.threshold ?? 10));
  const [periodUnit, setPeriodUnit] = useState(displayPeriod(rule?.interval_minutes));
  const [period, setPeriod] = useState(String((rule?.interval_minutes ?? 1440) / displayPeriod(rule?.interval_minutes)));
  const originalSchedule = formatDateTimeLocalValue(rule?.scheduled_at ?? null);
  const [scheduledAt, setScheduledAt] = useState(() => originalSchedule ||
    formatDateTimeLocalValue(new Date(Date.now() + 60_000).toISOString()));
  const [matchMode, setMatchMode] = useState(rule?.match_mode ?? "all");
  const [conditions, setConditions] = useState<Condition[]>(rule?.conditions ?? []);
  const [conditionsOpen, setConditionsOpen] = useState(() => Boolean(rule && (rule.conditions.length || requiresConditions(rule.event_type))));
  const backdropPressed = useRef(false);
  const [recipients, setRecipients] = useState(rule?.action_config.recipients.join(", ") ?? "");
  const [recipientPath, setRecipientPath] = useState(rule?.action_config.recipientPath ?? []);
  const [subject, setSubject] = useState(rule?.action_config.subject ?? "{{form_title}} — уведомление");
  const [body, setBody] = useState(rule?.action_config.body ?? "Событие по форме «{{form_title}}».\nВсего ответов: {{answer_count}}.");
  const [mode, setMode] = useState<EmailAction["mode"]>(rule?.action_config.mode ?? "summary");
  const [validationError, setValidationError] = useState<{ field: RuleField; message: string } | null>(null);
  useEffect(() => {
    if (validationError) dialog.current?.querySelector<HTMLElement>('[aria-invalid="true"]')?.focus();
  }, [dialog, validationError]);

  function errorFor(field: RuleField) {
    return validationError?.field === field ? { id: errorId, message: validationError.message } : undefined;
  }

  function invalid(field: RuleField, message: string) {
    setValidationError({ field, message });
  }

  function chooseScenario(draft: RuleScenario | null) {
    if (draft) {
      setName(draft.name);
      setEvent(draft.event);
      setSubject(draft.subject);
      setBody(draft.body);
      if (draft.threshold !== undefined) setThreshold(String(draft.threshold));
      if (draft.periodDays !== undefined) {
        setPeriod(String(draft.periodDays));
        setPeriodUnit(1440);
        setScheduledAt(nextFridayMorning());
      }
    }
    changeStep(0);
  }

  const questions = useQuery({
    queryKey: ["automation-fields", userId, formId],
    queryFn: ({ signal }) => getAutomationFields(formId!, signal),
    enabled: Boolean(formId),
  });
  const fields = questions.data ?? [];
  const organizationFields = fields.filter(field => field.type === ORGANIZATION_QUESTION_TYPE);
  const recipientFields = organizationFields.filter(field => field.path.length === 1);
  const usesOrganization = conditions.some(condition =>
    organizationFields.some(field => fieldKey(field.path) === fieldKey(condition.path)));
  const organizations = useQuery({
    queryKey: ["automation-organizations", userId, formId],
    queryFn: ({ signal }) => getFormOrganizations(formId!, signal),
    enabled: Boolean(formId) && step === 1 && usesOrganization,
  });
  const organizationChoices = organizations.data?.map(org => ({ value: org.id, text: getOrganizationDisplayName(org) })) ?? [];
  const conditionFields = fields.map(field => field.type === ORGANIZATION_QUESTION_TYPE
    ? { ...field, choices: organizationChoices } : field);
  const requiredFieldsUnavailable = Boolean(formId) && (
    (step === 1 && conditions.length > 0 && (questions.isPending || (usesOrganization && !organizations.isSuccess))) ||
    (step === 2 && recipientPath.length > 0 && !questions.isSuccess)
  );
  const needsThreshold = ["response_count", "matching_count", "matching_share"].includes(event);
  const needsInterval = event === "inactivity" || event === "recurring";
  const needsDate = event === "date" || event === "recurring";
  const formClosed = event === "form_closed";
  const emailMode = formClosed ? "summary" : mode;
  const needsConditions = Boolean(formId) && requiresConditions(event);
  const save = useMutation({
    mutationFn: (config: RuleConfig) => saveAutomationRule(rule?.id ?? null, config),
    onMutate: () => createAuthCacheGuard(queryClient),
  });

  const addresses = [...new Set(recipients.toLowerCase().split(/[\s,;]+/).filter(Boolean))];
  const recipientLimit = recipientPath.length ? 49 : 50;
  const minimumMinutes = event === "recurring" ? 15 : 1;
  const minimumPeriod = Math.ceil(minimumMinutes / periodUnit);
  const maximumPeriod = Math.floor(525600 / periodUnit);
  const schedule = scheduledAt === originalSchedule && rule?.scheduled_at ? rule.scheduled_at : scheduledAt;
  const cleanConditions = conditions.map((condition) => ({
    ...condition,
    value: Array.isArray(condition.value)
      ? condition.value.map(trimConditionValue).filter((value) => value !== "")
      : trimConditionValue(condition.value),
  }));

  function changeStep(next: number) {
    setStep(next);
    setValidationError(null);
    save.reset();
  }

  function onSubmit(submission: FormEvent<HTMLFormElement>) {
    submission.preventDefault();
    if (choosingScenario || save.isPending || requiredFieldsUnavailable) return;
    if (step === 0 && !name.trim()) {
      invalid("name", "Укажите название правила.");
      return;
    }
    if (step === 1) {
      const count = Number(threshold);
      if (needsThreshold && (!Number.isFinite(count) || (event === "matching_share"
        ? count < 0.01 || count > 100 : !Number.isInteger(count) || count < 1 || count > 100000))) {
        invalid("threshold", event === "matching_share"
          ? "Укажите долю ответов от 0,01 до 100 %."
          : "Укажите целое число ответов от 1 до 100 000.");
        return;
      }
      const minutes = Number(period) * periodUnit;
      if (needsInterval && (!Number.isInteger(Number(period)) || minutes < minimumMinutes || minutes > 525600)) {
        invalid("period", `Введите целое число от ${minimumPeriod} до ${maximumPeriod} в выбранных единицах времени.`);
        return;
      }
      const time = Date.parse(schedule);
      if (needsDate && !(time >= Date.parse(earliestSchedule) && time <= Date.parse(latestSchedule))) {
        invalid("schedule", "Укажите дату и время запуска с 2000 по 2200 год.");
        return;
      }
      if (questions.isError && conditions.length) {
        setConditionsOpen(true);
        return;
      }
      if (needsConditions && !conditions.length) {
        setConditionsOpen(true);
        invalid("conditions", "Добавьте хотя бы одно условие.");
        return;
      }
      for (const [index, condition] of cleanConditions.entries()) {
        const error = conditionError(condition, conditionFields);
        if (error) {
          setConditionsOpen(true);
          invalid(`condition-${index}-${error.field}`, error.message);
          return;
        }
      }
    }
    if (step === 2) {
      if (!addresses.length && !recipientPath.length) {
        invalid("recipients", recipientFields.length
          ? "Укажите получателя письма: введите адрес или выберите получателя из ответа."
          : "Укажите получателя письма. Введите хотя бы один адрес электронной почты.");
        return;
      }
      if (addresses.length > recipientLimit) {
        invalid("recipients", `Укажите не более ${recipientLimit} адресов электронной почты.`);
        return;
      }
      if (addresses.some(address => !validAddress(address))) {
        invalid("recipients", "Проверьте формат адресов. Пример: name@example.ru.");
        return;
      }
      if (recipientPath.length && !recipientFields.some((field) => fieldKey(field.path) === fieldKey(recipientPath))) {
        invalid("recipientPath", "Выберите вопрос со справочником организаций вне повторяющихся панелей или уберите получателя из ответа.");
        return;
      }
      if (recipientPath.length && mode !== "summary") {
        invalid("mode", "Для получателя из ответа выберите краткое письмо.");
        return;
      }
      if (!subject.trim()) {
        invalid("subject", "Введите тему письма.");
        return;
      }
      if (!body.trim()) {
        invalid("body", "Введите текст письма.");
        return;
      }
    }
    if (step < steps.length - 1) {
      changeStep(step + 1);
      return;
    }
    const scheduledIso = !needsDate ? null : schedule === rule?.scheduled_at ? schedule : new Date(schedule).toISOString();
    save.mutate({
      form_id: formId || null, name, description, enabled, event_type: event, match_mode: matchMode, conditions: cleanConditions,
      threshold: needsThreshold ? Number(threshold) : null, interval_minutes: needsInterval ? Number(period) * periodUnit : null,
      scheduled_at: scheduledIso,
      action_config: { recipients: addresses, recipientPath: recipientPath.length ? recipientPath : undefined, subject, body, mode: emailMode },
    }, { onSuccess: (id, _, isCurrentAuth) => { if (isCurrentAuth?.()) onSaved(id); } });
  }

  const saveError = getErrorMessage(save.error, "Не удалось сохранить правило");
  const genericSaveError = saveError === "Не удалось сохранить правило";

  return (
    <dialog ref={dialog} className="card modal-card activity-rule-dialog" aria-labelledby="rule-editor-heading"
      onCancel={(cancel) => { cancel.preventDefault(); if (!save.isPending) onClose(); }}
      onPointerDown={event => {
        const rect = event.currentTarget.getBoundingClientRect();
        backdropPressed.current = event.target === dialog.current &&
          (event.clientX < rect.left || event.clientX > rect.right || event.clientY < rect.top || event.clientY > rect.bottom);
      }}
      onClick={(click) => {
        if (!backdropPressed.current || click.target !== dialog.current || save.isPending) return;
        const rect = click.currentTarget.getBoundingClientRect();
        if (click.clientX < rect.left || click.clientX > rect.right || click.clientY < rect.top || click.clientY > rect.bottom) onClose();
      }}>
      <form noValidate onSubmit={onSubmit} onChange={() => { setValidationError(null); if (save.isError) save.reset(); }} className={"activity-rule-editor" + (choosingScenario ? " rule-editor-scenario" : "")}>
        <ModalHeading className="activity-heading" onClose={onClose} disabled={save.isPending}>
          <h2 id="rule-editor-heading">{rule ? "Редактировать правило" : "Новое правило"}</h2>
        </ModalHeading>

        {!choosingScenario && <ol className="rule-steps" aria-label="Этапы настройки">
          {steps.map((label, index) => <li key={label} aria-current={index === step ? "step" : undefined}>
            <span>{index + 1}</span> {label}
          </li>)}
        </ol>}

        <div className="activity-editor-body" key={step}>
          <h3 className="rule-step-heading" tabIndex={-1} ref={stepHeading}>{choosingScenario ? "Что вы хотите автоматизировать?" : steps[step]}</h3>
          {choosingScenario && <RuleScenarios scope={formId ? "form" : "global"} onChoose={chooseScenario} />}
          {step === 0 && <div className="rule-step-fields">
            <div>
              <label className="activity-field">Название
                <input required maxLength={120} value={name} placeholder="Оповещение о новом ответе"
                  {...ruleErrorAttributes(errorFor("name"))} onChange={(change) => setName(change.target.value)} />
              </label>
              <RuleFieldErrorMessage error={errorFor("name")} />
            </div>
            <label className="activity-field">Описание <small>Необязательно</small>
              <textarea maxLength={1000} rows={2} value={description} onChange={(change) => setDescription(change.target.value)} />
            </label>
            <div className="rule-scope"><strong>Область действия</strong>
              <p>{form ? form.title : "Все мои формы"}</p>
              <small>{form ? "Для условий и получателей доступны вопросы этой формы." : "Правило охватывает ваши существующие и новые формы."}</small>
            </div>
            <label className="activity-checkbox">
              <input type="checkbox" checked={enabled} onChange={(change) => setEnabled(change.target.checked)} /> Правило включено
            </label>
          </div>}
          {step === 1 && <div className="rule-step-fields">
            <label className="activity-field">Когда срабатывает правило
              <select value={event} onChange={(change) => {
                const next = change.target.value as AutomationEvent;
                setEvent(next);
                if (requiresConditions(next)) setConditionsOpen(true);
              }}>
                {Object.entries(automationEvents).filter(([id]) => formId ? id !== "form_closed" : id === rule?.event_type
                  || (id !== "matching_count" && id !== "matching_share")).map(([id, label]) => <option value={id} key={id}>{label}</option>)}
              </select>
            </label>
            {formClosed && <p className="activity-muted">{formClosedDescription}</p>}
            {needsThreshold && <>
              <div>
                <label className="activity-field">{event === "matching_share" ? "Доля ответов, %" : "Количество ответов"}
                  <input type="number" required value={threshold} min={event === "matching_share" ? "0.01" : "1"}
                    max={event === "matching_share" ? "100" : "100000"} step={event === "matching_share" ? "0.01" : "1"}
                    {...ruleErrorAttributes(errorFor("threshold"))} onChange={(change) => setThreshold(change.target.value)} />
                </label>
                <RuleFieldErrorMessage error={errorFor("threshold")} />
              </div>
              <p className="activity-muted">Порог проверяется при изменении ответов и учитывает уже собранные ответы. Срабатывает один раз для каждой формы.</p>
              {conditions.length > 0 && <p className="activity-muted">Первый подсчёт ответов по условиям выполняется в фоне.</p>}
            </>}
            {needsInterval && <div className="activity-editor-grid">
              <div>
                <label className="activity-field">{event === "inactivity" ? "Период тишины" : "Повторять каждые"}
                  <input type="number" min={minimumPeriod} max={maximumPeriod} required value={period}
                    {...ruleErrorAttributes(errorFor("period"))} onChange={(change) => setPeriod(change.target.value)} />
                </label>
                <RuleFieldErrorMessage error={errorFor("period")} />
              </div>
              <label className="activity-field">Единица времени
                <select value={periodUnit} onChange={(change) => setPeriodUnit(Number(change.target.value))}>
                  {Object.entries(periods).map(([id, label]) => <option key={id} value={id}>{label}</option>)}
                </select>
              </label>
            </div>}
            {needsDate && <div>
              <label className="activity-field">{event === "recurring" ? "Первый запуск по местному времени" : "Дата и время запуска по местному времени"}
                <input type="datetime-local" min={formatDateTimeLocalValue(earliestSchedule)} max={formatDateTimeLocalValue(latestSchedule)}
                  required value={scheduledAt} {...ruleErrorAttributes(errorFor("schedule"))} onChange={(change) => setScheduledAt(change.target.value)} />
              </label>
              <RuleFieldErrorMessage error={errorFor("schedule")} />
            </div>}
            {event === "inactivity" && <p className="activity-muted">Период отсчитывается с включения правила или поступления последнего нового ответа.</p>}
            {formId && <details className="activity-variables rule-conditions" open={conditionsOpen}
              onToggle={event => setConditionsOpen(event.currentTarget.open)}>
              <summary {...ruleErrorAttributes(errorFor("conditions"))}>
                {needsConditions ? "Условия" : "Дополнительные условия"}{conditions.length > 0 && ` (${conditions.length})`}
              </summary>
              <div className="rule-step-fields">
                <RuleFieldErrorMessage error={errorFor("conditions")} />
                {!needsConditions && <p className="activity-muted">Без условий учитываются все ответы формы.</p>}
                {questions.isPending && <p className="activity-muted">Загрузка вопросов…</p>}
                {questions.isError && <div className="activity-error" role="alert">
                  Не удалось загрузить вопросы. <button type="button" className="app-button" onClick={() => void questions.refetch()}>Повторить</button>
                </div>}
                {usesOrganization && organizations.isPending && <p className="activity-muted" role="status">Загрузка справочника организаций…</p>}
                {usesOrganization && organizations.isError && <div className="activity-error" role="alert">
                  Не удалось загрузить организации. <button type="button" className="app-button" onClick={() => void organizations.refetch()}>Повторить</button>
                </div>}
                {usesOrganization && organizations.isSuccess && !organizationChoices.length &&
                  <p className="activity-muted">В справочнике нет доступных организаций для этой формы.</p>}
                {questions.isSuccess && (conditionFields.length || conditions.length ? <RuleConditions fields={conditionFields} conditions={conditions} mode={matchMode}
                  errorFor={errorFor} onMode={setMatchMode} onConditions={next => { setConditions(next); setValidationError(null); }} /> : <p className="activity-muted">В форме пока нет вопросов для условий.</p>)}
                {["date", "recurring", "inactivity"].includes(event) && conditions.length > 0 &&
                  <p className="activity-muted">Для письма используется последний ответ, который подходит под условия.</p>}
              </div>
            </details>}
          </div>}
          {step === 2 && <div className="rule-step-fields">
            <p className="rule-action"><strong>Действие</strong> Отправить письмо</p>
            <div>
              <label className="activity-field">Адреса получателей
                <textarea rows={2} placeholder="name@example.ru, office@example.ru" value={recipients}
                  {...ruleErrorAttributes(errorFor("recipients"))} onChange={(change) => setRecipients(change.target.value)} />
                <small>Перечислите адреса через запятую или с новой строки.</small>
              </label>
              <RuleFieldErrorMessage error={errorFor("recipients")} />
            </div>
            {formId && (recipientFields.length > 0 || recipientPath.length > 0) && <label className="activity-field">Получатель из ответа
              <select value={fieldKey(recipientPath)} disabled={!questions.isSuccess}
                {...ruleErrorAttributes(errorFor("recipientPath"))} onChange={change => {
                const path = recipientFields.find(field => fieldKey(field.path) === change.target.value)?.path ?? [];
                setRecipientPath(path);
                if (path.length) setMode("summary");
              }}>
                <option value="">Не использовать</option>
                {recipientPath.length > 0 && !recipientFields.some((field) => fieldKey(field.path) === fieldKey(recipientPath)) &&
                  <option value={fieldKey(recipientPath)} disabled>
                    {questions.isSuccess ? "Недоступный вопрос" : "Сохранённый вопрос"} · {recipientPath.join(" / ")}
                  </option>}
                {recipientFields.map((field) => <option key={fieldKey(field.path)} value={fieldKey(field.path)}>{field.label}</option>)}
              </select>
            </label>}
            <RuleFieldErrorMessage error={errorFor("recipientPath")} />
            {formId && questions.isPending && <p className="activity-muted" role="status">Загрузка вопросов для выбора получателя…</p>}
            {formId && questions.isError && <p className="activity-muted" role="alert">
              Не удалось загрузить вопросы для выбора получателя. <button type="button" className="app-button"
                onClick={() => void questions.refetch()}>Повторить</button>
            </p>}
            {recipientPath.length > 0 && <p className="activity-muted">Организации из ответа можно отправить только краткое письмо.</p>}
            <RuleEmailTemplate subject={subject} body={body} hasThreshold={needsThreshold} includeResponse={!formClosed}
              subjectError={errorFor("subject")} bodyError={errorFor("body")}
              onSubject={next => { setSubject(next); setValidationError(null); }}
              onBody={next => { setBody(next); setValidationError(null); }} />
            {!formClosed && <label className="activity-field">Содержание
              <select value={mode} {...ruleErrorAttributes(errorFor("mode"))}
                onChange={(change) => setMode(change.target.value as EmailAction["mode"])}>
                <option value="summary">Краткое письмо со ссылкой</option>
                <option value="full" disabled={Boolean(recipientPath.length)}>Полный ответ со ссылкой</option>
              </select>
            </label>}
            <RuleFieldErrorMessage error={errorFor("mode")} />
          </div>}
          {step === 3 && <RuleEmailPreview subject={subject} body={body} mode={emailMode} formTitle={form?.title} recipients={addresses}
            recipientField={recipientFields.find((field) => fieldKey(field.path) === fieldKey(recipientPath))?.label}
            hasThreshold={needsThreshold} includeResponse={!formClosed} />}
        </div>
        {save.isError && <p className="activity-error activity-dialog-error" role="alert">
          {genericSaveError ? saveError + ". Повторите попытку. Введённые данные остались в редакторе." : saveError}
        </p>}
        <footer className="activity-actions activity-dialog-actions">
          <button type="button" className="app-button" onClick={onClose} disabled={save.isPending}>Отмена</button>
          {step > 0 && <button type="button" className="app-button" disabled={save.isPending} onClick={() => changeStep(step - 1)}>Назад</button>}
          {!choosingScenario && <button type="submit" className="button-primary" disabled={save.isPending || requiredFieldsUnavailable}>
            {step < steps.length - 1 ? "Далее" : save.isPending ? "Сохранение…" : "Сохранить правило"}
          </button>}
        </footer>
      </form>
    </dialog>
  );
}
