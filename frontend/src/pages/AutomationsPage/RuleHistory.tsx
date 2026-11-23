import { useInfiniteQuery } from "@tanstack/react-query";
import { Link } from "react-router-dom";
import { routes } from "../../app/routes";
import { listAutomationRuns } from "../../entities/automation/api";
import { automationKey, type AutomationRun } from "../../entities/automation/model";
import type { TimelineCursor } from "../../shared/api/timelinePage";
import { formatActivityTime } from "../../shared/lib/activityTime";
import { Icon } from "../../shared/ui/Icon";
import { Skeleton } from "../../shared/ui/Skeleton";
import { describeRunEvent } from "./ruleSummary";

const statuses: Record<AutomationRun["status"], string> = {
  pending: "Подготовка письма",
  queued: "В очереди",
  succeeded: "Отправлено",
  failed: "Ошибка",
  cancelled: "Отменено",
};

function RunCard({ run }: { run: AutomationRun }) {
  const waiting = run.recipient_count - run.sent_count - run.failed_count - run.cancelled_count;
  const inQueue = run.status === "queued" && waiting > 0;
  const hasDetails = run.failed_count > 0 || run.cancelled_count > 0 || inQueue;
  return <li className="automation-card automation-run">
    <div className="automation-card-heading">
      <time dateTime={run.created_at}>{formatActivityTime(run.created_at)}</time>
      <span className={`activity-status automation-run-status automation-run-status-${run.status}`}>{statuses[run.status]}</span>
    </div>
    <h3>{describeRunEvent(run)}</h3>
    {run.recipient_count > 0 && <p className="automation-run-delivery">
      <Icon name={run.status === "succeeded" ? "check_circle" : "info"} size={18} />
      <span>Отправлено писем: {run.sent_count} из {run.recipient_count}</span>
    </p>}
    {run.last_error && <p className="activity-error">{run.last_error}</p>}
    <div className="activity-links automation-run-actions">
      <Link to={run.response_id ? routes.formResponse(run.form_id, run.response_id) : routes.formResponses(run.form_id)}>
        {run.response_id ? "Открыть ответ" : "Ответы формы"}
      </Link>
      {hasDetails && <details className="automation-run-details">
        <summary>Подробности отправки</summary>
        <ul>
          {run.failed_count > 0 && <li>Ошибок отправки: {run.failed_count}</li>}
          {run.cancelled_count > 0 && <li>Отменено: {run.cancelled_count}</li>}
          {inQueue && <li>Ожидают отправки: {waiting}</li>}
        </ul>
      </details>}
    </div>
  </li>;
}

export function RuleHistory({ ruleId, userId }: { ruleId: string; userId: string }) {
  const history = useInfiniteQuery({
    queryKey: [...automationKey(userId), "runs", ruleId],
    initialPageParam: undefined as TimelineCursor | undefined,
    queryFn: ({ pageParam, signal }) => listAutomationRuns(ruleId, pageParam, signal),
    getNextPageParam: (last) => last.next,
    refetchOnWindowFocus: true,
    refetchInterval: ({ state }) => {
      if (state.status !== "success" || !state.data) return false;
      const pages = state.data.pages;
      return !pages[0]?.items.length || pages.some(page => page.items.some(
        run => run.status === "pending" || run.status === "queued",
      )) ? 10_000 : false;
    },
  });
  const runs = history.data?.pages.flatMap((page) => page.items) ?? [];
  return <section aria-labelledby="rule-history-heading" className="automation-section">
    <header className="activity-heading">
      <h2 id="rule-history-heading">История срабатываний</h2>
      {history.isSuccess && <button type="button" className="app-button" disabled={history.isFetching}
        onClick={() => void history.refetch()}>Обновить историю</button>}
    </header>
    {history.isPending && <Skeleton className="activity-skeleton" />}
    {history.isError && !history.isFetchNextPageError && <div className="activity-state" role="alert">
      <p>Не удалось загрузить историю.</p>
      <button type="button" className="app-button" onClick={() => void history.refetch()}>Повторить</button>
    </div>}
    {history.isSuccess && !runs.length && <p className="activity-state">Правило ещё не срабатывало.</p>}
    {runs.length > 0 && <ul className="automation-cards">
      {runs.map((run) => <RunCard key={run.id} run={run} />)}
    </ul>}
    {history.isFetchNextPageError && <div className="activity-state" role="alert">
      <p>Не удалось загрузить следующую страницу истории.</p>
      <button type="button" className="app-button" disabled={history.isFetching} onClick={() => void history.fetchNextPage()}>Повторить</button>
    </div>}
    {history.hasNextPage && !history.isFetchNextPageError && <button type="button" className="app-button activity-more" disabled={history.isFetching}
      onClick={() => void history.fetchNextPage()}>Показать ещё</button>}
  </section>;
}
