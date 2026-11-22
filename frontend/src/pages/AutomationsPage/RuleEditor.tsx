import { useEffect, useRef, useState, type FormEvent } from "react";
import { useMutation, useQuery } from "@tanstack/react-query";
import { getAutomationFields, saveAutomationRule, type AutomationForm } from "../../entities/automation/api";
import { automationEvents, type AutomationEvent, type AutomationRule, type Condition, type ConditionValue, type EmailAction, type RuleConfig } from "../../entities/automation/model";
import { formatDateTimeLocalValue } from "../../shared/lib/dateTime";
import { getErrorMessage } from "../../shared/lib/error";
import { Icon } from "../../shared/ui/Icon";
import { useModalSurface } from "../../shared/ui/useModalSurface";
import { RuleEmailPreview, RuleEmailTemplate } from "./RuleEmail";
import "./ruleEditor.css";
import { fieldKey, RuleConditions } from "./RuleConditions";

const periods = { 1: "минуты", 60: "часы", 1440: "дни" };

const steps = ["Основное", "Событие", "Письмо", "Предпросмотр"];

function trimConditionValue(value: ConditionValue) {
  return typeof value === "string" ? value.trim() : value;
}

function displayPeriod(minutes?: number | null) {
  const value = minutes ?? 1440;
  return value % 1440 === 0 ? 1440 : value % 60 === 0 ? 60 : 1;
}

type Props = { userId: string; form: AutomationForm | null; rule: AutomationRule | null; onClose: () => void; onSaved: (id: string) => void };

export function RuleEditor({ userId, form, rule, onClose, onSaved }: Props) {
  const dialog = useModalSurface();
  const [name, setName] = useState(rule?.name ?? "");
  const [description, setDescription] = useState(rule?.description ?? "");
  const [enabled, setEnabled] = useState(rule?.enabled ?? true);
  const [event, setEvent] = useState<AutomationEvent>(rule?.event_type ?? "response_received");
  const formId = form?.id ?? null;
  const [step, setStep] = useState(0);
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
  const [recipients, setRecipients] = useState(rule?.action_config.recipients.join(", ") ?? "");
  const [recipientPath, setRecipientPath] = useState(rule?.action_config.recipientPath ?? []);
  const [subject, setSubject] = useState(rule?.action_config.subject ?? "{{form_title}} — уведомление");
  const [body, setBody] = useState(rule?.action_config.body ?? "Событие по форме «{{form_title}}».\nВсего ответов: {{answer_count}}.");
  const [mode, setMode] = useState<EmailAction["mode"]>(rule?.action_config.mode ?? "summary");
  const [validationError, setValidationError] = useState<string | null>(null);

  const questions = useQuery({
    queryKey: ["automation-fields", userId, formId],
    queryFn: ({ signal }) => getAutomationFields(formId!, signal),
    enabled: Boolean(formId) && step > 0,
  });
  const fields = questions.data ?? [];
  const recipientFields = fields.filter((field) => ["text", "email", "organization"].includes(field.type));
  const needsThreshold = ["response_count", "matching_count", "matching_share"].includes(event);
  const needsInterval = event === "inactivity" || event === "recurring";
  const needsDate = event === "date" || event === "recurring";
  const save = useMutation({ mutationFn: (config: RuleConfig) => saveAutomationRule(rule?.id ?? null, config), onSuccess: onSaved });

  const addresses = recipients.split(/[\s,;]+/).filter(Boolean);
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
    if (save.isPending) return;
    if (step === 0 && !name.trim()) {
      setValidationError("Укажите название правила.");
      return;
    }
    if (step === 1 && cleanConditions.some(({ path, value }) => value === "" || (Array.isArray(value) && !value.length)
      || !fields.some((field) => fieldKey(field.path) === fieldKey(path)))) {
      setValidationError("Проверьте вопрос и значение каждого условия.");
      return;
    }
    if (step === 2) {
      if (!addresses.length && !recipientPath.length) {
        setValidationError("Укажите получателя письма.");
        return;
      }
      if (addresses.length > 50 || addresses.some((address) => !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(address))) {
        setValidationError("Укажите до 50 корректных адресов электронной почты.");
        return;
      }
      if (recipientPath.length && !recipientFields.some((field) => fieldKey(field.path) === fieldKey(recipientPath))) {
        setValidationError("Проверьте вопрос с адресом получателя.");
        return;
      }
      if (!subject.trim() || !body.trim()) {
        setValidationError("Введите тему и текст письма.");
        return;
      }
    }
    if (step < steps.length - 1) {
      changeStep(step + 1);
      return;
    }
    let schedule: string | null = null;
    if (needsDate) {
      schedule = scheduledAt === originalSchedule && rule?.scheduled_at
        ? rule.scheduled_at : new Date(scheduledAt).toISOString();
    }
    save.mutate({
      form_id: formId || null, name, description, enabled, event_type: event, match_mode: matchMode, conditions: cleanConditions,
      threshold: needsThreshold ? Number(threshold) : null, interval_minutes: needsInterval ? Number(period) * periodUnit : null,
      scheduled_at: schedule,
      action_config: { recipients: addresses, recipientPath: recipientPath.length ? recipientPath : undefined, subject, body, mode },
    });
  }

  return (
    <dialog ref={dialog} className="card modal-card activity-rule-dialog" aria-labelledby="rule-editor-heading"
      onCancel={(cancel) => { cancel.preventDefault(); if (!save.isPending) onClose(); }}
      onClick={(click) => {
        if (click.target !== dialog.current || save.isPending) return;
        const rect = click.currentTarget.getBoundingClientRect();
        if (click.clientX < rect.left || click.clientX > rect.right || click.clientY < rect.top || click.clientY > rect.bottom) onClose();
      }}>
      <form onSubmit={onSubmit} className="activity-rule-editor">
        <header className="activity-heading">
          <h2 id="rule-editor-heading">{rule ? "Редактировать правило" : "Новое правило"}</h2>
          <button type="button" className="app-button icon-button" aria-label="Закрыть" onClick={onClose} disabled={save.isPending}><Icon name="close" /></button>
        </header>

        <ol className="rule-steps" aria-label="Этапы настройки">
          {steps.map((label, index) => <li key={label} aria-current={index === step ? "step" : undefined}>
            <span>{index + 1}</span> {label}
          </li>)}
        </ol>

        <div className="activity-editor-body" key={step}>
          <h3 className="rule-step-heading" tabIndex={-1} ref={stepHeading}>{steps[step]}</h3>
          {step === 0 && <div className="rule-step-fields">
            <label className="activity-field">Название
              <input required maxLength={120} value={name} placeholder="Оповещение о новом ответе" onChange={(change) => setName(change.target.value)} />
            </label>
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
              <select value={event} onChange={(change) => setEvent(change.target.value as AutomationEvent)}>
                {Object.entries(automationEvents).filter(([id]) => formId || id === rule?.event_type
                  || (id !== "matching_count" && id !== "matching_share")).map(([id, label]) => <option value={id} key={id}>{label}</option>)}
              </select>
            </label>
            {needsThreshold && <>
              <label className="activity-field">{event === "matching_share" ? "Доля ответов, %" : "Количество ответов"}
                <input type="number" required value={threshold} min={event === "matching_share" ? "0.01" : "1"}
                  max={event === "matching_share" ? "100" : "100000"} step={event === "matching_share" ? "0.01" : "1"}
                  onChange={(change) => setThreshold(change.target.value)} />
              </label>
              <p className="activity-muted">Порог проверяется при изменении ответов и учитывает уже собранные ответы. Срабатывает один раз для каждой формы.</p>
              {conditions.length > 0 && <p className="activity-muted">Первый подсчёт ответов по условиям выполняется в фоне.</p>}
            </>}
            {needsInterval && <div className="activity-editor-grid">
              <label className="activity-field">{event === "inactivity" ? "Период тишины" : "Повторять каждые"}
                <input type="number" min={1} max={Math.floor(525600 / periodUnit)} required value={period} onChange={(change) => setPeriod(change.target.value)} />
              </label>
              <label className="activity-field">Единица времени
                <select value={periodUnit} onChange={(change) => setPeriodUnit(Number(change.target.value))}>
                  {Object.entries(periods).map(([id, label]) => <option key={id} value={id}>{label}</option>)}
                </select>
              </label>
            </div>}
            {needsDate && <label className="activity-field">{event === "recurring" ? "Первый запуск по местному времени" : "Дата и время запуска по местному времени"}
              <input type="datetime-local" required value={scheduledAt} onChange={(change) => setScheduledAt(change.target.value)} />
            </label>}
            {event === "inactivity" && <p className="activity-muted">Период отсчитывается с включения правила или поступления последнего нового ответа.</p>}
            {formId && <details className="activity-variables rule-conditions" open={conditions.length > 0 || undefined}>
              <summary>Дополнительные условия{conditions.length > 0 && ` (${conditions.length})`}</summary>
              <div className="rule-step-fields">
                <p className="activity-muted">Без условий учитываются все ответы формы.</p>
                {questions.isPending && <p className="activity-muted">Загрузка вопросов…</p>}
                {questions.isError && <div className="activity-error" role="alert">
                  Не удалось загрузить вопросы. <button type="button" className="app-button" onClick={() => void questions.refetch()}>Повторить</button>
                </div>}
                {questions.isSuccess && (fields.length || conditions.length ? <RuleConditions fields={fields} conditions={conditions} mode={matchMode}
                  onMode={setMatchMode} onConditions={setConditions} /> : <p className="activity-muted">В форме пока нет вопросов для условий.</p>)}
                {["date", "recurring", "inactivity"].includes(event) && conditions.length > 0 &&
                  <p className="activity-muted">Для письма используется последний ответ, который подходит под условия.</p>}
              </div>
            </details>}
          </div>}
          {step === 2 && <div className="rule-step-fields">
            <p className="rule-action"><strong>Действие</strong> Отправить письмо</p>
            <label className="activity-field">Адреса получателей
              <textarea rows={2} placeholder="name@example.ru, office@example.ru" value={recipients}
                onChange={(change) => setRecipients(change.target.value)} />
              <small>Перечислите адреса через запятую или с новой строки.</small>
            </label>
            {formId && (recipientFields.length > 0 || recipientPath.length > 0) && <label className="activity-field">Получатель из ответа
              <select value={fieldKey(recipientPath)} onChange={(change) => setRecipientPath(
                recipientFields.find((field) => fieldKey(field.path) === change.target.value)?.path ?? [],
              )}>
                <option value="">Не использовать</option>
                {recipientPath.length > 0 && !recipientFields.some((field) => fieldKey(field.path) === fieldKey(recipientPath)) &&
                  <option value={fieldKey(recipientPath)} disabled>Вопрос удалён · {recipientPath.join(" / ")}</option>}
                {recipientFields.map((field) => <option key={fieldKey(field.path)} value={fieldKey(field.path)}>{field.label}</option>)}
              </select>
            </label>}
            {formId && questions.isPending && <p className="activity-muted" role="status">Загрузка вопросов для выбора получателя…</p>}
            {formId && questions.isError && <p className="activity-muted" role="alert">
              Не удалось загрузить вопросы для выбора получателя. <button type="button" className="app-button"
                onClick={() => void questions.refetch()}>Повторить</button>
            </p>}
            <RuleEmailTemplate subject={subject} body={body} hasThreshold={needsThreshold} onSubject={setSubject} onBody={setBody} />
            <label className="activity-field">Содержание
              <select value={mode} onChange={(change) => setMode(change.target.value as EmailAction["mode"])}>
                <option value="summary">Краткое письмо со ссылкой</option>
                <option value="full">Полный ответ со ссылкой</option>
              </select>
            </label>
          </div>}
          {step === 3 && <RuleEmailPreview subject={subject} body={body} mode={mode} formTitle={form?.title} recipients={addresses}
            recipientField={recipientFields.find((field) => fieldKey(field.path) === fieldKey(recipientPath))?.label}
            hasThreshold={needsThreshold} />}
        </div>
        {(validationError || save.isError) && <p className="activity-error activity-dialog-error" role="alert">
          {validationError ?? getErrorMessage(save.error, "Не удалось сохранить правило.")}
        </p>}
        <footer className="activity-actions activity-dialog-actions">
          <button type="button" className="app-button" onClick={onClose} disabled={save.isPending}>Отмена</button>
          {step > 0 && <button type="button" className="app-button" disabled={save.isPending} onClick={() => changeStep(step - 1)}>Назад</button>}
          <button type="submit" className="button-primary" disabled={save.isPending}>
            {step < steps.length - 1 ? "Далее" : save.isPending ? "Сохранение…" : "Сохранить правило"}
          </button>
        </footer>
      </form>
    </dialog>
  );
}
