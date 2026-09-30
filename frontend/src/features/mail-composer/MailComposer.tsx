import { useEffect, useRef, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { prepareFormMail, previewFormMail, queueFormInvitations, queueFormReminders } from "../../entities/mail/api";
import type { FormMailDraft, FormMailKind, MailPreview, MailTemplate } from "../../entities/mail/types";
import { getOrganizationTypeLabel } from "../../entities/organization/model";
import type { OrganizationType } from "../../entities/organization/types";
import { getErrorMessage } from "../../shared/lib/error";
import { MailDeliveryPanel } from "../../pages/FormResponsesPage/MailDeliveryPanel";

const steps = ["Получатели", "Письмо", "Проверка"];
const variables = ["Организация", "Название формы", "Дедлайн", "Ссылка"];

export function MailComposer({ formId, kind, onBusyChange }: {
  formId: string; kind: FormMailKind; onBusyChange?: (busy: boolean) => void;
}) {
  const root = useRef<HTMLElement>(null);
  const queryClient = useQueryClient();
  const query = useQuery({ queryKey: ["mail-composition", formId, kind], queryFn: () => prepareFormMail(formId, kind),
    retry: false, refetchOnWindowFocus: false, refetchOnReconnect: false, refetchOnMount: "always" });
  const [step, setStep] = useState(0);
  const [mode, setMode] = useState<"compose" | "history">("compose");
  useEffect(() => {
    const panel = root.current?.closest<HTMLElement>(".dashboard-share-panel");
    if (panel) panel.scrollTop = 0;
  }, [step, mode]);
  const [chosenIds, setChosenIds] = useState<string[] | null>(null);
  const [template, setTemplate] = useState<MailTemplate | null>(null);
  const [search, setSearch] = useState("");
  const [type, setType] = useState("");
  const [preview, setPreview] = useState<MailPreview | null>(null);
  const [busy, setBusy] = useState(false);
  const busyRef = useRef(false);
  const [error, setError] = useState<string | null>(null);
  const [result, setResult] = useState<{ batchId: string | null; queuedCount: number } | null>(null);
  const editor = useRef<HTMLInputElement | HTMLTextAreaElement | null>(null);
  const data = query.data;
  const recipients = data?.recipients ?? [];
  const selection = new Set(chosenIds ?? recipients.filter(org => org.canSend).map(org => org.id));
  const selected = recipients.filter(org => org.canSend && selection.has(org.id));
  const text = template ?? data?.template ?? { subject: "", bodyText: "" };
  const filtered = recipients.filter(org => (!type || org.organizationType === type)
    && `${org.name} ${org.email}`.toLocaleLowerCase("ru").includes(search.toLocaleLowerCase("ru").trim()));
  const visible = filtered.filter(org => org.canSend);
  const draft: FormMailDraft = { organizationIds: selected.map(org => org.id), template: text, personal: data?.personal ?? false };
  const run = async (action: () => Promise<void>) => {
    if (busyRef.current) return;
    busyRef.current = true; setBusy(true); onBusyChange?.(true); setError(null);
    try { await action(); }
    catch (cause) { setError(getErrorMessage(cause, "Не удалось подготовить рассылку")); }
    finally { busyRef.current = false; setBusy(false); onBusyChange?.(false); }
  };
  const review = (organizationId?: string) => run(async () => {
    const next = await previewFormMail(formId, kind, draft, organizationId);
    setPreview(next); setStep(2);
  });
  const send = () => run(async () => {
    const next = await (kind === "invitation" ? queueFormInvitations : queueFormReminders)(formId, draft);
    setResult(next); setMode("history"); setStep(0); setPreview(null);
    await queryClient.invalidateQueries({ queryKey: ["form-mail-activity", formId] });
    await queryClient.invalidateQueries({ queryKey: ["form-personal-links", formId] });
  });
  const refresh = () => run(async () => {
    const previous = new Set(selected.map(org => org.id));
    const next = await query.refetch({ throwOnError: true });
    setChosenIds(next.data?.recipients.filter(org => org.canSend && previous.has(org.id)).map(org => org.id) ?? []);
    setStep(0); setPreview(null);
  });
  const changeStep = (next: number) => { setStep(next); setError(null); setPreview(null); };
  const insertVariable = (name: string) => {
    const field = editor.current?.tagName === "INPUT" ? "subject" : "bodyText";
    const element = editor.current;
    const start = element?.selectionStart ?? text[field].length;
    const end = element?.selectionEnd ?? start;
    const token = `{${name}}`;
    setTemplate({ ...text, [field]: text[field].slice(0, start) + token + text[field].slice(end) });
    requestAnimationFrame(() => { element?.focus(); element?.setSelectionRange(start + token.length, start + token.length); });
  };

  return <section ref={root} className="mail-composer" aria-label={kind === "invitation" ? "Рассылка приглашений" : "Рассылка напоминаний"}>
    <div className="mail-composer-heading">
      <h3>{kind === "invitation" ? "Приглашения организациям" : "Напоминания несдавшим"}</h3>
      <button type="button" className="app-button" disabled={busy} onClick={() => { setMode(mode === "history" ? "compose" : "history"); setError(null); }}>
        {mode === "history" ? "Подготовить письмо" : "История отправок"}
      </button>
    </div>
    {result && <p role="status">{result.queuedCount ? `Поставлено в очередь писем: ${result.queuedCount}.` : "Нет организаций для отправки."}</p>}
    {mode === "history" ? <MailDeliveryPanel formId={formId} preferredBatchId={result?.batchId ?? null} onClose={() => setMode("compose")} /> : <>
      <ol className="mail-composer-steps" aria-label="Подготовка рассылки">
        {steps.map((label, index) => <li key={label} aria-current={step === index ? "step" : undefined}><span>{index + 1}</span>{label}</li>)}
      </ol>
      {query.isPending ? <p role="status">Загрузка получателей…</p> : query.error ? <div role="alert">
        <p>{getErrorMessage(query.error, "Не удалось загрузить получателей")}</p>
        <button type="button" className="app-button" disabled={busy} onClick={() => void refresh()}>Повторить</button>
      </div> : data && <>
        <p className="mail-composer-note">{kind === "reminder" ? "В списке только организации, которые ещё не сдали форму. " : "Получатели из справочника выбранных в форме типов ОУ. "}
          {data.personal ? "Каждой организации придёт её персональная ссылка." : "В письме будет общая ссылка на форму."}</p>
        {!data.smtpEnabled && <p role="alert">SMTP-коннектор выключен. Письмо можно подготовить; для отправки включите коннектор в настройках.</p>}
        <fieldset className="mail-composer-fields" disabled={busy}>
          {step === 0 && <>
            <div className="mail-recipient-filters">
              <label className="mail-field"><span>Поиск организации или email</span><input value={search} onChange={event => setSearch(event.target.value)} type="search" /></label>
              <label className="mail-field"><span>Тип ОУ</span><select value={type} onChange={event => setType(event.target.value)}>
                <option value="">Все типы</option>
                {[...new Set(recipients.map(org => org.organizationType))].map(value => <option key={value} value={value}>{getOrganizationTypeLabel(value as OrganizationType)}</option>)}
              </select></label>
            </div>
            <div className="mail-selection-actions">
              <strong aria-live="polite">Выбрано: {selected.length} из {recipients.length}</strong>
              <button type="button" className="app-button" disabled={!visible.length} onClick={() => setChosenIds([...new Set([...selection, ...visible.map(org => org.id)])])}>Выбрать найденные</button>
              <button type="button" className="app-button" disabled={!selected.length} onClick={() => setChosenIds([])}>Снять выбор</button>
              <button type="button" className="app-button" onClick={() => void refresh()}>Обновить список</button>
            </div>
            <div className="mail-recipient-list" role="group" aria-label="Получатели">
              {filtered.length === 0 && <p>{recipients.length ? "Ничего не найдено. Измените поиск или тип ОУ." : "Нет организаций для рассылки."}</p>}
              {filtered.map(org => <label key={org.id} className={`mail-recipient${!org.canSend ? " mail-recipient-disabled" : ""}`}>
                <input type="checkbox" checked={org.canSend && selection.has(org.id)} disabled={!org.canSend} onChange={event => {
                  const next = new Set(selection); if (event.target.checked) next.add(org.id); else next.delete(org.id); setChosenIds([...next]);
                }} />
                <span><strong>{org.name}</strong><small>{org.email || "Email не указан"}{!org.canSend && " · исправьте email в справочнике ОУ"}</small></span>
                <small>{getOrganizationTypeLabel(org.organizationType as OrganizationType, true)}</small>
              </label>)}
            </div>
          </>}
          {step === 1 && <>
            <label className="mail-field"><span>Тема письма</span><input value={text.subject} maxLength={500} onFocus={event => { editor.current = event.currentTarget; }} onChange={event => setTemplate({ ...text, subject: event.target.value })} /></label>
            <div className="mail-variable-buttons" role="group" aria-label="Подстановки в письмо"><span>Вставить:</span>{variables.map(name => <button type="button" className="app-button" key={name} onMouseDown={event => event.preventDefault()} onClick={() => insertVariable(name)}>{`{${name}}`}</button>)}</div>
            <label className="mail-field"><span>Текст письма</span><textarea rows={9} maxLength={20000} value={text.bodyText} onFocus={event => { editor.current = event.currentTarget; }} onChange={event => setTemplate({ ...text, bodyText: event.target.value })} /></label>
            <p className="mail-composer-note">Обычный текст, без форматирования. Подстановки заменятся данными формы и получателя. Строка с {"{Дедлайн}"} исчезнет, если срок не задан. Сохраните {"{Ссылка}"} в тексте письма.</p>
            <button type="button" className="app-button" onClick={() => setTemplate(data.template)}>Вернуть стандартный текст</button>
          </>}
          {step === 2 && preview && <>
            <p><strong>Будет отправлено писем: {preview.recipientCount}</strong>. У каждой организации свой адрес и отдельное письмо.</p>
            <label className="mail-field"><span>Показать письмо для</span><select value={preview.message.organizationId} onChange={event => void review(event.target.value)}>
              {selected.map(org => <option key={org.id} value={org.id}>{org.name} · {org.email}</option>)}
            </select></label>
            <article className="mail-message-preview" aria-label="Предпросмотр письма">
              <p><span>Кому: </span>{preview.message.name} &lt;{preview.message.email}&gt;</p>
              <h4>{preview.message.subject}</h4><p className="mail-message-body">{preview.message.bodyText}</p>
            </article>
          </>}
        </fieldset>
        {error && <div role="alert" className="mail-composer-error"><p>{error}</p><button type="button" className="app-button" disabled={busy} onClick={() => void refresh()}>Обновить получателей</button></div>}
        <div className="mail-composer-footer">
          {step > 0 && <button type="button" className="app-button" disabled={busy} onClick={() => changeStep(step - 1)}>Назад</button>}
          <span>{selected.length} получателей</span>
          {step === 0 && <button type="button" className="button-primary" disabled={busy || selected.length === 0} onClick={() => changeStep(1)}>К тексту письма</button>}
          {step === 1 && <button type="button" className="button-primary" disabled={busy || !text.subject.trim() || !text.bodyText.trim() || selected.length === 0} onClick={() => void review()}>{busy ? "Подготовка…" : "Проверить письмо"}</button>}
          {step === 2 && <button type="button" className="button-primary" disabled={busy || !preview || !data.smtpEnabled} onClick={() => void send()}>{busy ? "Отправка…" : `Отправить письма (${selected.length})`}</button>}
        </div>
      </>}
    </>}
  </section>;
}
