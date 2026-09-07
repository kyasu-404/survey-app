import { useEffect, useMemo, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { getFormMailActivity, getMailJobs } from "../../entities/mail/api";
import { getMailProgress, MAIL_STATUS_LABELS } from "../../entities/mail/model";
import { supabaseClient } from "../../shared/api";
import { getErrorMessage } from "../../shared/lib/error";
import { InlineSpinner } from "../../shared/ui/InlineSpinner";
import { createQueryRefreshScheduler } from "../../shared/lib/queryRefresh";

export function MailDeliveryPanel({
  formId,
  preferredBatchId,
  onClose,
}: {
  formId: string;
  preferredBatchId: string | null;
  onClose: () => void;
}) {
  const queryClient = useQueryClient();
  const [isRealtimeConnected, setIsRealtimeConnected] = useState(false);
  const activityQuery = useQuery({
    queryKey: ["form-mail-activity", formId],
    queryFn: ({ signal }) => getFormMailActivity(formId, signal),
    refetchOnMount: "always",
  });
  const [selectedBatchId, setSelectedBatchId] = useState<string | null>(preferredBatchId);

  useEffect(() => {
    if (preferredBatchId) setSelectedBatchId(preferredBatchId);
  }, [preferredBatchId]);

  const batches = activityQuery.data?.batches ?? [];
  const effectiveBatchId = selectedBatchId && batches.some((batch) => batch.id === selectedBatchId)
    ? selectedBatchId
    : batches[0]?.id ?? null;
  const selectedBatch = batches.find((batch) => batch.id === effectiveBatchId) ?? null;
  const jobsQuery = useQuery({
    queryKey: ["mail-batch-jobs", effectiveBatchId],
    queryFn: ({ signal }) => getMailJobs(effectiveBatchId!, signal),
    enabled: Boolean(effectiveBatchId),
    refetchOnMount: "always",
    refetchInterval: (query) => {
      const hasActiveJobs = query.state.data?.some((job) => job.status === "queued" || job.status === "processing");
      return hasActiveJobs && !isRealtimeConnected ? 5000 : false;
    },
  });
  const jobs = useMemo(() => jobsQuery.data ?? [], [jobsQuery.data]);
  const progress = getMailProgress(jobs);

  useEffect(() => {
    setIsRealtimeConnected(false);
    const refresh = createQueryRefreshScheduler(queryClient, `mail activity ${formId}`, 500);
    const activityTarget = { queryKey: ["form-mail-activity", formId] };
    const jobsTarget = effectiveBatchId ? { queryKey: ["mail-batch-jobs", effectiveBatchId] } : null;
    const channel = supabaseClient
      .channel(`form-mail-activity:${formId}`)
      .on("postgres_changes", {
        event: "*",
        schema: "public",
        table: "mail_queue",
        filter: `form_id=eq.${formId}`,
      }, (payload) => {
        const row = payload.eventType === "DELETE" ? payload.old : payload.new;
        const batchId = typeof row.batch_id === "string" ? row.batch_id : null;
        // A delivery status change doesn't change the list of mail batches.
        // Inserts may introduce a new batch; incomplete DELETE payloads need reconciliation.
        const targets = payload.eventType === "UPDATE" && batchId ? [] : [activityTarget];
        if (jobsTarget && (!batchId || batchId === effectiveBatchId)) targets.push(jobsTarget);
        if (targets.length) refresh.schedule(targets);
      })
      .subscribe((status) => {
        setIsRealtimeConnected(status === "SUBSCRIBED");
        if (status === "SUBSCRIBED") refresh.schedule([activityTarget, ...(jobsTarget ? [jobsTarget] : [])]);
      });
    return () => {
      refresh.dispose();
      void supabaseClient.removeChannel(channel);
    };
  }, [effectiveBatchId, formId, queryClient]);

  return (
    <section className="mail-delivery-panel" aria-labelledby="mail-delivery-title">
      <div className="mail-delivery-header">
        <div>
          <h3 id="mail-delivery-title">Статусы отправки</h3>
          <p>Обновляются автоматически, в том числе после повторного открытия отчёта.</p>
        </div>
        <button type="button" className="response-preview-close" onClick={onClose}>Скрыть</button>
      </div>

      {activityQuery.isLoading ? (
        <p className="mail-delivery-loading"><InlineSpinner /> Загрузка журнала…</p>
      ) : activityQuery.error ? (
        <div className="users-page-error">
          <p>{getErrorMessage(activityQuery.error, "Не удалось загрузить статусы отправки")}</p>
          <button type="button" className="users-page-retry-button" onClick={() => void activityQuery.refetch()}>Повторить</button>
        </div>
      ) : batches.length === 0 ? (
        <p className="response-report-empty">Рассылок по этой форме ещё не было.</p>
      ) : (
        <>
          <label className="mail-batch-select">
            <span>Рассылка</span>
            <select value={effectiveBatchId ?? ""} onChange={(event) => setSelectedBatchId(event.target.value)}>
              {batches.map((batch) => (
                <option key={batch.id} value={batch.id}>
                  {new Date(batch.created_at).toLocaleString("ru-RU")} · {batch.total_count} писем
                </option>
              ))}
            </select>
          </label>

          {selectedBatch && (
            <div className="mail-delivery-summary" aria-live="polite">
              <span>Всего <strong>{selectedBatch.total_count}</strong></span>
              <span>В очереди <strong>{progress.queued}</strong></span>
              <span>Отправляется <strong>{progress.processing}</strong></span>
              <span>Отправлено <strong>{progress.sent}</strong></span>
              <span>Ошибки <strong>{progress.failed}</strong></span>
            </div>
          )}

          {jobsQuery.isLoading ? (
            <p className="mail-delivery-loading"><InlineSpinner /> Загрузка писем…</p>
          ) : jobsQuery.error ? (
            <p className="settings-form-error">{getErrorMessage(jobsQuery.error, "Не удалось загрузить письма рассылки")}</p>
          ) : <div className="mail-delivery-table-shell">
            <table className="responses-table mail-delivery-table">
              <thead><tr><th>Организация</th><th>Email</th><th>Статус</th><th>Комментарий</th></tr></thead>
              <tbody>
                {jobs.map((job) => (
                  <tr key={job.id}>
                    <td>{job.recipient_name}</td>
                    <td>{job.recipient_email}</td>
                    <td><span className={`mail-status-pill mail-status-${job.status}`}>{MAIL_STATUS_LABELS[job.status]}</span></td>
                    <td className="mail-delivery-error">{job.last_error ?? (job.status === "sent" && job.sent_at ? new Date(job.sent_at).toLocaleString("ru-RU") : "—")}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>}
        </>
      )}
    </section>
  );
}
