import { ModalHeading } from "../../shared/ui/ModalHeading";
import { useRef, useState, type FormEvent } from "react";
import { useMutation } from "@tanstack/react-query";
import { safeAnnouncementUrl } from "../../entities/announcement/AnnouncementContent";
import { formatDateTimeLocalValue } from "../../shared/lib/dateTime";
import { getErrorMessage } from "../../shared/lib/error";
import { InlineSpinner } from "../../shared/ui/InlineSpinner";
import { SectionTabs } from "../../shared/ui/SectionTabs";
import { useModalSurface } from "../../shared/ui/useModalSurface";
import { AnnouncementPreview } from "./AnnouncementPreview";
import { MessageEditor } from "./MessageEditor";
import { AnnouncementConflictError, audienceLabels, displayLabels, saveAnnouncement, type AdminAnnouncement, type AnnouncementFields, type AnnouncementStatus, type Publication } from "./api";

const editorTabs = [{ value: "edit", label: "Редактор" }, { value: "preview", label: "Предпросмотр" }] as const;
const saveTexts = { draft: "Черновик сохранён.", published: "Объявление опубликовано.", scheduled: "Публикация запланирована.", archived: "Изменения сохранены." };

function originalFields(row: AdminAnnouncement | null): AnnouncementFields {
  return {
    title: row?.title ?? "", message: row?.message ?? "",
    audience: row?.audience ?? "all", display_mode: row?.display_mode ?? "feed",
    action_label: row?.action_label ?? null, action_url: row?.action_url ?? null,
    require_acknowledgement: row?.require_acknowledgement ?? false, expires_at: row?.expires_at ?? null,
  };
}
function localDate(date: string, original: string | null) {
  if (formatDateTimeLocalValue(original) === date) return original;
  if (!date) return null;
  const value = new Date(date);
  if (!Number.isFinite(value.getTime())) throw new Error("Проверьте дату и время.");
  return value.toISOString();
}

export function AnnouncementEditor({ row, onClose, onSaved, onSaveError, onReload }: {
  row: AdminAnnouncement | null; onClose: () => void; onSaved: (status: AnnouncementStatus, message: string) => void;
  onSaveError: () => void; onReload: (id: string) => Promise<void>;
}) {
  const dialog = useModalSurface();
  const publishDateInputRef = useRef<HTMLInputElement>(null);
  const expiresInputRef = useRef<HTMLInputElement>(null);
  const [tab, setTab] = useState<"edit" | "preview">("edit");
  const [fields, setFields] = useState(() => originalFields(row));
  const [publication, setPublication] = useState<Publication>(row?.status === "scheduled" ? "schedule" : "keep");
  const [date, setDate] = useState(formatDateTimeLocalValue(row?.publish_at ?? null));
  const [expires, setExpires] = useState(formatDateTimeLocalValue(row?.expires_at ?? null));
  const [linkOpen, setLinkOpen] = useState(Boolean(fields.action_url));
  const [error, setError] = useState("");
  const [hasConflict, setHasConflict] = useState(false);
  const [reloading, setReloading] = useState(false);
  const status = row?.status ?? "draft";
  const canPublish = status === "draft" || status === "scheduled";
  const unchangedSchedule = status === "scheduled" && publication === "schedule" && date === formatDateTimeLocalValue(row?.publish_at ?? null);
  const submitLabel = publication === "publish" ? "Опубликовать" : publication === "schedule" && !unchangedSchedule
    ? "Запланировать" : !row ? "Сохранить черновик" : "Сохранить изменения";

  const save = useMutation({
    mutationFn: async () => {
      const title = fields.title.trim();
      const message = fields.message.trim();
      if (!title || !message) throw new Error("Заполните заголовок и текст объявления.");
      const inputUrl = fields.action_url?.trim();
      const actionUrl = safeAnnouncementUrl(inputUrl);
      const actionLabel = fields.action_label?.trim() || null;
      if ((inputUrl || actionLabel) && !actionUrl) {
        setLinkOpen(true);
        throw new Error("Для кнопки укажите ссылку с http://, https:// или путь приложения, начинающийся с /.");
      }
      if (publishDateInputRef.current?.validity.badInput || expiresInputRef.current?.validity.badInput) {
        throw new Error("Проверьте дату и время.");
      }
      const mode = unchangedSchedule ? "keep" : publication;
      const publishAt = mode === "schedule" ? localDate(date, row?.publish_at ?? null) : null;
      const now = Date.now();
      if (mode === "schedule" && (!publishAt || Date.parse(publishAt) <= now)) {
        throw new Error("Укажите будущую дату публикации.");
      }
      const expiresAt = localDate(expires, row?.expires_at ?? null);
      const effectivePublication = mode === "keep" ? row?.publish_at : publishAt;
      const keptExpiry = Boolean(mode === "keep" && expiresAt === row?.expires_at);
      if (!keptExpiry && expiresAt && Date.parse(expiresAt) <= Math.max(now, Date.parse(effectivePublication ?? "") || now)) {
        throw new Error("Окончание действия должно быть позже текущего времени и даты публикации.");
      }
      try {
        await saveAnnouncement(row, { ...fields, title, message, action_url: actionUrl, action_label: actionLabel, expires_at: expiresAt }, mode, publishAt);
      } catch (cause) {
        onSaveError();
        throw cause;
      }
      let next: AnnouncementStatus = mode === "publish" ? "published" : mode === "schedule" ? "scheduled" : status;
      if (next === "scheduled" && effectivePublication && Date.parse(effectivePublication) <= Date.now()) next = "published";
      if (next === "published" && expiresAt && Date.parse(expiresAt) <= Date.now()) next = "archived";
      return { status: next, message: mode === "keep" && row ? "Изменения сохранены." : saveTexts[next] };
    },
    onSuccess: result => onSaved(result.status, result.message),
    onError: cause => {
      setTab("edit");
      setHasConflict(cause instanceof AnnouncementConflictError);
      setError(getErrorMessage(cause, "Не удалось сохранить объявление."));
    },
  });
  function update<K extends keyof AnnouncementFields>(key: K, value: AnnouncementFields[K]) {
    setFields(previous => ({ ...previous, [key]: value }));
    if (!hasConflict) setError("");
  }
  function submit(event: FormEvent) {
    event.preventDefault();
    if (save.isPending || hasConflict) return;
    setError("");
    save.mutate();
  }

  async function reload() {
    if (!row || reloading) return;
    setReloading(true);
    try {
      await onReload(row.id);
    } catch (cause) {
      setError(getErrorMessage(cause, "Не удалось загрузить актуальное объявление."));
    } finally {
      setReloading(false);
    }
  }

  return <dialog className="card modal-card activity-rule-dialog announcement-editor-dialog" ref={dialog} aria-labelledby="announcement-editor-title"
    onCancel={event => { event.preventDefault(); if (!save.isPending) onClose(); }}>
    <form noValidate onSubmit={submit} onChange={() => { if (!hasConflict) setError(""); }} className="announcement-editor-form">
      <ModalHeading className="activity-heading" onClose={onClose} disabled={save.isPending}>
        <h2 id="announcement-editor-title">{row ? "Редактировать объявление" : "Новое объявление"}</h2>
      </ModalHeading>
      <SectionTabs id="announcement-editor" label="Режим редактора" tabs={editorTabs} value={tab} onChange={setTab} />
      <div className="activity-editor-body" role="tabpanel" id="announcement-editor-panel-edit"
        aria-labelledby="announcement-editor-tab-edit" hidden={tab !== "edit"}>
          <fieldset disabled={save.isPending} className="activity-editor-step">
            <legend>Содержание</legend>
            <label className="activity-field">Заголовок
              <input required maxLength={120} value={fields.title} onChange={event => update("title", event.target.value)} />
            </label>
            <MessageEditor value={fields.message} onChange={value => update("message", value)} />
            <details className="activity-variables" open={linkOpen} onToggle={event => setLinkOpen(event.currentTarget.open)}>
              <summary>Ссылка на дополнительную информацию</summary>
              <div className="activity-editor-grid announcement-link-fields">
                <label className="activity-field">Ссылка
                  <input maxLength={2048} placeholder="https:// или /раздел" value={fields.action_url ?? ""} onChange={event => update("action_url", event.target.value)} />
                </label>
                <label className="activity-field">Текст кнопки
                  <input maxLength={80} placeholder="Подробнее" value={fields.action_label ?? ""} onChange={event => update("action_label", event.target.value)} />
                </label>
              </div>
            </details>
          </fieldset>
          <fieldset disabled={save.isPending} className="activity-editor-step">
            <legend>Кто и где увидит объявление</legend>
            <div className="activity-editor-grid">
              <label className="activity-field">Аудитория
                <select value={fields.audience} onChange={event => update("audience", event.target.value as AnnouncementFields["audience"])}>
                  {Object.entries(audienceLabels).map(([id, label]) => <option key={id} value={id}>{label}</option>)}
                </select>
              </label>
              <label className="activity-field">Способ отображения
                <select value={fields.display_mode} onChange={event => update("display_mode", event.target.value as AnnouncementFields["display_mode"])}>
                  {Object.entries(displayLabels).map(([id, label]) => <option key={id} value={id}>{label}</option>)}
                </select>
              </label>
            </div>
            {fields.display_mode === "modal" && <p className="activity-muted">Используйте окно при входе для особо важных сообщений.</p>}
            <label className="activity-checkbox">
              <input type="checkbox" checked={fields.require_acknowledgement} onChange={event => update("require_acknowledgement", event.target.checked)} />
              Запросить подтверждение ознакомления
            </label>
          </fieldset>
          <fieldset disabled={save.isPending} className="activity-editor-step">
            <legend>Публикация</legend>
            {canPublish ? <label className="activity-field">Состояние публикации
              <select value={publication} onChange={event => setPublication(event.target.value as Publication)}>
                {status === "draft" && <option value="keep">Сохранить как черновик</option>}
                <option value="publish">Опубликовать сразу</option>
                <option value="schedule">Запланировать публикацию</option>
              </select>
            </label> : <p className="activity-muted">{status === "archived"
              ? "Объявление в архиве. Для новой публикации создайте копию."
              : "При сохранении изменений дата публикации и отметки об ознакомлении сохранятся."}</p>}
            <div className="activity-editor-grid">
              {publication === "schedule" && <label className="activity-field">Дата публикации
                <input ref={publishDateInputRef} type="datetime-local" value={date} onChange={event => setDate(event.target.value)} />
              </label>}
              {(status !== "archived" || expires) && <label className="activity-field">Окончание действия (необязательно)
                <input ref={expiresInputRef} type="datetime-local" value={expires} readOnly={status === "archived"} onChange={event => setExpires(event.target.value)} />
              </label>}
            </div>
            {(status !== "archived" || expires) && <small className="activity-muted">Время местное.</small>}
          </fieldset>
      </div>
      <div className="activity-editor-body" role="tabpanel" id="announcement-editor-panel-preview"
        aria-labelledby="announcement-editor-tab-preview" hidden={tab !== "preview"}>
        {tab === "preview" && <AnnouncementPreview fields={fields} />}
      </div>
      <footer className="announcement-editor-footer">
        {error && <p className="activity-error activity-dialog-error" role="alert">{error}</p>}
        <div className="activity-actions activity-dialog-actions">
          <button className="app-button" type="button" onClick={onClose} disabled={save.isPending}>Отмена</button>
          {hasConflict && <button className="app-button" type="button" disabled={reloading} onClick={() => void reload()}>
            Сбросить правки и загрузить актуальную версию
          </button>}
          <button className="button-primary" type="submit" disabled={save.isPending || hasConflict}>{save.isPending && <InlineSpinner />}
            {save.isPending ? "Сохранение…" : submitLabel}</button>
        </div>
      </footer>
    </form>
  </dialog>;
}
