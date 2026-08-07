import { useEffect, useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { useAuth } from "../../app/providers/AuthProvider";
import { useToast } from "../../app/providers/ToastProvider";
import { getMailBatchActivity, getSmtpSettings, queueTestEmail, saveSmtpSettings } from "../../entities/mail/api";
import { EMPTY_SMTP_SETTINGS, MAIL_STATUS_LABELS, validateSmtpSettings } from "../../entities/mail/model";
import type { SmtpSettings, SmtpSettingsDraft } from "../../entities/mail/types";
import { supabaseClient } from "../../shared/api";
import { getErrorMessage } from "../../shared/lib/error";
import { InlineSpinner } from "../../shared/ui/InlineSpinner";
import { Skeleton } from "../../shared/ui/Skeleton";

function settingsToDraft(settings: SmtpSettings | null): SmtpSettingsDraft {
  return settings ? {
    enabled: settings.enabled,
    host: settings.host,
    port: settings.port,
    sslMode: settings.sslMode,
    username: settings.username,
    password: "",
    fromEmail: settings.fromEmail,
    fromName: settings.fromName,
    replyTo: settings.replyTo,
  } : { ...EMPTY_SMTP_SETTINGS };
}

export default function SettingsPage() {
  const { profile } = useAuth();
  const { showToast } = useToast();
  const settingsQuery = useQuery({
    queryKey: ["smtp-settings"],
    queryFn: getSmtpSettings,
    staleTime: 30_000,
    refetchOnWindowFocus: false,
  });
  const [draft, setDraft] = useState<SmtpSettingsDraft>(EMPTY_SMTP_SETTINGS);
  const [hasStoredPassword, setHasStoredPassword] = useState(false);
  const [isDirty, setIsDirty] = useState(false);
  const [isSaving, setIsSaving] = useState(false);
  const [formError, setFormError] = useState<string | null>(null);
  const [testRecipient, setTestRecipient] = useState(profile?.email ?? "");
  const [testBatchId, setTestBatchId] = useState<string | null>(null);
  const [isQueueingTest, setIsQueueingTest] = useState(false);

  useEffect(() => {
    if (typeof settingsQuery.data === "undefined" || isDirty) return;
    setDraft(settingsToDraft(settingsQuery.data));
    setHasStoredPassword(Boolean(settingsQuery.data?.hasPassword));
  }, [isDirty, settingsQuery.data]);

  useEffect(() => {
    if (!testRecipient && profile?.email) setTestRecipient(profile.email);
  }, [profile?.email, testRecipient]);

  const testActivityQuery = useQuery({
    queryKey: ["mail-batch", testBatchId],
    queryFn: () => getMailBatchActivity(testBatchId!),
    enabled: Boolean(testBatchId),
    refetchInterval: (query) => {
      const job = query.state.data?.jobs[0];
      return job && (job.status === "sent" || job.status === "failed") ? false : 3000;
    },
  });

  useEffect(() => {
    if (!testBatchId) return;
    const channel = supabaseClient
      .channel(`smtp-test:${testBatchId}`)
      .on("postgres_changes", {
        event: "UPDATE",
        schema: "public",
        table: "mail_queue",
        filter: `batch_id=eq.${testBatchId}`,
      }, () => void testActivityQuery.refetch())
      .subscribe();
    return () => { void supabaseClient.removeChannel(channel); };
  }, [testActivityQuery.refetch, testBatchId]);

  const testJob = testActivityQuery.data?.jobs[0] ?? null;
  const testStatusClass = testJob ? `mail-status-${testJob.status}` : "mail-status-queued";
  const canTest = Boolean(settingsQuery.data?.enabled && hasStoredPassword && !isDirty && !isSaving);

  const updateDraft = <Key extends keyof SmtpSettingsDraft>(key: Key, value: SmtpSettingsDraft[Key]) => {
    setDraft((current) => ({ ...current, [key]: value }));
    setIsDirty(true);
    setFormError(null);
  };

  const handleSave = async () => {
    const validationError = validateSmtpSettings(draft, hasStoredPassword);
    if (validationError) {
      setFormError(validationError);
      return;
    }

    setIsSaving(true);
    setFormError(null);
    try {
      const saved = await saveSmtpSettings({
        ...draft,
        host: draft.host.trim(),
        username: draft.username.trim(),
        fromEmail: draft.fromEmail.trim(),
        fromName: draft.fromName.trim(),
        replyTo: draft.replyTo.trim(),
      });
      setDraft(settingsToDraft(saved));
      setHasStoredPassword(saved.hasPassword);
      setIsDirty(false);
      await settingsQuery.refetch();
      showToast("Настройки SMTP сохранены", "success");
    } catch (error) {
      setFormError(getErrorMessage(error, "Не удалось сохранить SMTP-настройки"));
    } finally {
      setIsSaving(false);
    }
  };

  const handleQueueTest = async () => {
    setIsQueueingTest(true);
    setFormError(null);
    try {
      const result = await queueTestEmail(testRecipient.trim());
      setTestBatchId(result.batchId);
      showToast("Тестовое письмо поставлено в очередь", "success");
    } catch (error) {
      setFormError(getErrorMessage(error, "Не удалось отправить тестовое письмо"));
    } finally {
      setIsQueueingTest(false);
    }
  };

  const passwordHint = useMemo(() => {
    if (draft.password) return "Новый пароль будет сохранён в зашифрованном виде.";
    if (hasStoredPassword) return "Пароль сохранён. Оставьте поле пустым, чтобы не менять его.";
    return "Пароль обязателен при первом сохранении.";
  }, [draft.password, hasStoredPassword]);
  const backendError = settingsQuery.error
    ? getErrorMessage(settingsQuery.error, "Не удалось загрузить SMTP-настройки")
    : null;

  return (
    <div className="dashboard-page">
      <div className="card settings-page-card">
        <div className="settings-page-header">
          <div>
            <p>Администрирование</p>
            <h1>Настройки</h1>
            <span>SMTP-коннектор для системных писем и напоминаний организациям.</span>
          </div>
          <label className={`smtp-enable-control ${draft.enabled ? "active" : ""}`}>
            <input
              type="checkbox"
              checked={draft.enabled}
              onChange={(event) => updateDraft("enabled", event.target.checked)}
            />
            <span className="smtp-enable-track" aria-hidden="true"><span /></span>
            Коннектор включён
          </label>
        </div>

        {settingsQuery.isLoading ? (
          <div className="settings-form-skeleton" aria-hidden="true">
            {Array.from({ length: 6 }, (_, index) => <Skeleton key={index} className="settings-field-skeleton" />)}
          </div>
        ) : (
          <>
            {backendError && (
              <div className="settings-backend-warning" role="alert">
                <div>
                  <strong>Почтовый модуль пока недоступен</strong>
                  <p>{backendError}</p>
                </div>
                <button type="button" className="users-page-retry-button" onClick={() => void settingsQuery.refetch()}>
                  Проверить снова
                </button>
              </div>
            )}

            <section className="settings-section" aria-labelledby="smtp-connection-heading">
              <div className="settings-section-heading">
                <div>
                  <h2 id="smtp-connection-heading">Подключение</h2>
                  <p>Для SMTP 465 выберите TLS, для 587 — STARTTLS.</p>
                </div>
                <span className={`settings-credential-badge ${hasStoredPassword ? "saved" : "missing"}`}>
                  {hasStoredPassword ? "Пароль сохранён" : "Нужен пароль"}
                </span>
              </div>

              <div className="settings-fields-grid">
                <label className="settings-field settings-field-wide">
                  <span>SMTP-сервер</span>
                  <input value={draft.host} onChange={(event) => updateDraft("host", event.target.value)} placeholder="smtp.example.ru" autoComplete="off" />
                </label>
                <label className="settings-field">
                  <span>Порт</span>
                  <input type="number" min="1" max="65535" value={draft.port} onChange={(event) => updateDraft("port", Number(event.target.value))} />
                </label>
                <label className="settings-field">
                  <span>Шифрование</span>
                  <select value={draft.sslMode} onChange={(event) => updateDraft("sslMode", event.target.value as SmtpSettingsDraft["sslMode"])}>
                    <option value="tls">TLS (обычно 465)</option>
                    <option value="starttls">STARTTLS (обычно 587)</option>
                    <option value="none">Без шифрования</option>
                  </select>
                </label>
                <label className="settings-field settings-field-wide">
                  <span>Имя пользователя</span>
                  <input value={draft.username} onChange={(event) => updateDraft("username", event.target.value)} placeholder="mail@example.ru" autoComplete="username" />
                </label>
                <label className="settings-field settings-field-wide">
                  <span>Пароль</span>
                  <input type="password" value={draft.password} onChange={(event) => updateDraft("password", event.target.value)} placeholder={hasStoredPassword ? "••••••••••••" : "Введите пароль"} autoComplete="new-password" />
                  <small>{passwordHint}</small>
                </label>
              </div>
            </section>

            <section className="settings-section" aria-labelledby="smtp-sender-heading">
              <div className="settings-section-heading">
                <div>
                  <h2 id="smtp-sender-heading">Отправитель</h2>
                  <p>Эти данные будут видны получателям писем.</p>
                </div>
              </div>
              <div className="settings-fields-grid">
                <label className="settings-field">
                  <span>Имя отправителя</span>
                  <input value={draft.fromName} onChange={(event) => updateDraft("fromName", event.target.value)} placeholder="Формы" />
                </label>
                <label className="settings-field">
                  <span>Email отправителя</span>
                  <input type="email" value={draft.fromEmail} onChange={(event) => updateDraft("fromEmail", event.target.value)} placeholder="mail@example.ru" />
                </label>
                <label className="settings-field settings-field-wide">
                  <span>Reply-To <small>необязательно</small></span>
                  <input type="email" value={draft.replyTo} onChange={(event) => updateDraft("replyTo", event.target.value)} placeholder="support@example.ru" />
                </label>
              </div>
            </section>

            {formError && <p className="settings-form-error" role="alert">{formError}</p>}

            <div className="settings-save-row">
              <button type="button" className="button-primary settings-save-button" onClick={() => void handleSave()} disabled={isSaving || !isDirty}>
                {isSaving && <InlineSpinner />}
                {isSaving ? "Сохранение…" : "Сохранить настройки"}
              </button>
              {!isDirty && settingsQuery.data?.updatedAt && (
                <span>Сохранено {new Date(settingsQuery.data.updatedAt).toLocaleString("ru-RU")}</span>
              )}
            </div>

            <section className="settings-section settings-test-section" aria-labelledby="smtp-test-heading">
              <div className="settings-section-heading">
                <div>
                  <h2 id="smtp-test-heading">Проверка подключения</h2>
                  <p>Воркер выполнит реальную отправку через сохранённый SMTP-сервер.</p>
                </div>
              </div>
              <div className="settings-test-row">
                <label className="settings-field">
                  <span>Получатель тестового письма</span>
                  <input type="email" value={testRecipient} onChange={(event) => setTestRecipient(event.target.value)} />
                </label>
                <button type="button" className="app-button" onClick={() => void handleQueueTest()} disabled={!canTest || isQueueingTest || !testRecipient.trim()} title={isDirty ? "Сначала сохраните изменения" : undefined}>
                  {isQueueingTest && <InlineSpinner />}
                  Отправить тестовое письмо
                </button>
              </div>
              {testBatchId && (
                <div className="settings-test-status" aria-live="polite">
                  <span className={`mail-status-pill ${testStatusClass}`}>
                    {testJob ? MAIL_STATUS_LABELS[testJob.status] : "В очереди"}
                  </span>
                  <div>
                    <strong>{testJob?.recipient_email ?? testRecipient}</strong>
                    {testJob?.last_error && <p>{testJob.last_error}</p>}
                  </div>
                </div>
              )}
            </section>
          </>
        )}
      </div>
    </div>
  );
}
