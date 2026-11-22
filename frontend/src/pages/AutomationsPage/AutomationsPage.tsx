import { useDeferredValue, useState } from "react";
import { useInfiniteQuery, useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Link, useNavigate, useParams } from "react-router-dom";
import { routes } from "../../app/routes";
import { useAuth } from "../../app/providers/AuthProvider";
import { useToast } from "../../app/providers/ToastProvider";
import { getAutomationForm, getAutomationRule, listAutomationRules, listAutomationRuns, setAutomationEnabled, type AutomationFilter, type AutomationForm } from "../../entities/automation/api";
import { automationEvents, automationKey, type AutomationRule, type AutomationRun } from "../../entities/automation/model";
import type { TimelineCursor } from "../../shared/api/timelinePage";
import { formatActivityTime } from "../../shared/lib/activityTime";
import { getErrorMessage } from "../../shared/lib/error";
import { Icon } from "../../shared/ui/Icon";
import { Skeleton } from "../../shared/ui/Skeleton";
import { RuleEditor } from "./RuleEditor";

const statuses: Record<AutomationRun["status"], string> = {
  pending: "Подготовка письма",
  queued: "В очереди",
  succeeded: "Отправлено",
  failed: "Ошибка",
  cancelled: "Отменено",
};

function RuleStateButton({ rule, userId }: { rule: AutomationRule; userId: string }) {
  const queryClient = useQueryClient();
  const { showToast } = useToast();
  const toggle = useMutation({
    mutationFn: (enabled: boolean) => setAutomationEnabled(rule.id, enabled),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: automationKey(userId) }),
    onError: (error) => showToast(getErrorMessage(error, "Не удалось изменить состояние правила"), "error"),
  });
  return <button type="button" className="app-button" disabled={toggle.isPending}
    onClick={() => toggle.mutate(!rule.enabled)}>{rule.enabled ? "Выключить" : "Включить"}</button>;
}

function RuleHistory({ ruleId, userId }: { ruleId: string; userId: string }) {
  const history = useInfiniteQuery({
    queryKey: [...automationKey(userId), "runs", ruleId],
    initialPageParam: undefined as TimelineCursor | undefined,
    queryFn: ({ pageParam, signal }) => listAutomationRuns(ruleId, pageParam, signal),
    getNextPageParam: (last) => last.next,
    refetchInterval: 10_000,
  });
  const runs = history.data?.pages.flatMap((page) => page.items) ?? [];
  return <section aria-labelledby="rule-history-heading" className="activity-history">
    <h2 id="rule-history-heading">История срабатываний</h2>
    {history.isPending && <Skeleton className="activity-skeleton" />}
    {history.isError && <div className="activity-state" role="alert">
      <p>Не удалось загрузить историю.</p>
      <button type="button" className="app-button" onClick={() => void history.refetch()}>Повторить</button>
    </div>}
    {history.isSuccess && !runs.length && <p className="activity-state">Правило ещё не срабатывало.</p>}
    {runs.length > 0 && <ul className="activity-list">
      {runs.map((run) => <li key={run.id} className="activity-row">
        <div className="activity-row-body">
          <div className="activity-row-meta"><time dateTime={run.created_at}>{formatActivityTime(run.created_at)}</time></div>
          <strong>{run.form_title}</strong>
          {run.recipient_count > 0 && <p>Отправлено {run.sent_count} из {run.recipient_count}{run.failed_count > 0 ? " · Ошибок: " + run.failed_count : ""}</p>}
          {run.last_error && <p className="activity-error">{run.last_error}</p>}
          <div className="activity-links">
            <Link to={run.response_id ? routes.formResponse(run.form_id, run.response_id) : routes.formResponses(run.form_id)}>
              {run.response_id ? "Открыть ответ" : "Открыть форму"}
            </Link>
          </div>
        </div>
        <span className={"activity-status activity-status-" + run.status}>{statuses[run.status]}</span>
      </li>)}
    </ul>}
    {history.hasNextPage && <button type="button" className="app-button activity-more" disabled={history.isFetching}
      onClick={() => void history.fetchNextPage()}>Показать ещё</button>}
  </section>;
}

function AutomationDetail({ ruleId, userId }: { ruleId: string; userId: string }) {
  const [editing, setEditing] = useState(false);
  const queryClient = useQueryClient();
  const { showToast } = useToast();
  const result = useQuery({
    queryKey: [...automationKey(userId), "rule", ruleId],
    queryFn: ({ signal }) => getAutomationRule(userId, ruleId, signal),
    refetchOnMount: true,
  });
  const rule = result.data;

  return <section className="card activity-page">
    {!result.isPending && <Link to={rule?.form_id ? routes.formAutomations(rule.form_id) : routes.automations} className="activity-back">
      <Icon name="arrow_back" size={18} /> {rule?.form_id ? "Автоматизации формы" : "Общие автоматизации"}
    </Link>}
    {result.isPending && <Skeleton className="activity-skeleton" />}
    {result.isError && <div className="activity-state" role="alert">
      <p>Не удалось загрузить правило.</p>
      <button type="button" className="app-button" onClick={() => void result.refetch()}>Повторить</button>
    </div>}
    {result.isSuccess && !rule && <p className="activity-state">Правило недоступно.</p>}
    {rule && <>
      <header className="activity-heading">
        <div>
          <h1>{rule.name}</h1>
          <p>{rule.form_id ? rule.form?.title ?? "Выбранная форма" : "Все мои формы"} · {automationEvents[rule.event_type]} · {rule.enabled ? "Включено" : "Выключено"}</p>
          {rule.description && <p>{rule.description}</p>}
        </div>
        <div className="activity-actions">
          <RuleStateButton rule={rule} userId={userId} />
          <button type="button" className="app-button" onClick={() => setEditing(true)}><Icon name="edit" /> Редактировать</button>
        </div>
      </header>
      <RuleHistory ruleId={rule.id} userId={userId} />
      {editing && <RuleEditor userId={userId} rule={rule} form={rule.form_id ? { id: rule.form_id, title: rule.form?.title ?? "Выбранная форма" } : null} onClose={() => setEditing(false)} onSaved={() => {
        void queryClient.invalidateQueries({ queryKey: automationKey(userId) });
        showToast("Правило сохранено", "success");
        setEditing(false);
      }} />}
    </>}
  </section>;
}

function AutomationList({ userId, form }: { userId: string; form: AutomationForm | null }) {
  const [creating, setCreating] = useState(false);
  const [search, setSearch] = useState("");
  const [filter, setFilter] = useState<AutomationFilter>("all");
  const queryClient = useQueryClient();
  const { showToast } = useToast();
  const navigate = useNavigate();
  const formId = form?.id ?? null;
  const deferredSearch = useDeferredValue(search.trim());
  const rules = useInfiniteQuery({
    queryKey: [...automationKey(userId), "list", formId, deferredSearch, filter],
    initialPageParam: undefined as TimelineCursor | undefined,
    queryFn: ({ pageParam, signal }) => listAutomationRules(userId, formId, deferredSearch, filter, pageParam, signal),
    refetchOnMount: true,
    getNextPageParam: (last) => last.next,
  });
  const items = rules.data?.pages.flatMap((page) => page.items) ?? [];

  return <section className="card activity-page">
    <header className="activity-heading">
      <div>
        <h1>{form ? form.title : "Автоматизации"}</h1>
        <p>{form ? "Индивидуальные правила действуют только для этой формы." : "Общие правила действуют для всех ваших форм, в том числе для новых."}</p>
      </div>
      <button type="button" className="button-primary" onClick={() => setCreating(true)}><Icon name="add" /> Создать правило</button>
    </header>
    <div className="activity-toolbar">
      <label className="activity-field">Поиск
        <input type="search" value={search} onChange={(change) => setSearch(change.target.value)} placeholder="Название правила" />
      </label>
      <label className="activity-field">Статус
        <select value={filter} onChange={(change) => setFilter(change.target.value as AutomationFilter)}>
          <option value="all">Все правила</option><option value="enabled">Включённые</option><option value="disabled">Выключенные</option>
        </select>
      </label>
    </div>
    {rules.isPending && <Skeleton className="activity-skeleton" />}
    {rules.isError && <div className="activity-state" role="alert">
      <p>Не удалось загрузить правила.</p>
      <button type="button" className="app-button" onClick={() => void rules.refetch()}>Повторить</button>
    </div>}
    {rules.isSuccess && !items.length && <p className="activity-state">{search || filter !== "all"
      ? "Правил с такими фильтрами нет."
      : form ? "У этой формы пока нет индивидуальных правил." : "Общих правил пока нет. Создайте правило для всех своих форм."}</p>}
    {items.length > 0 && <ul className="activity-list">
      {items.map((rule) => <li key={rule.id} className="activity-row">
        <div className="activity-row-body">
          <Link to={routes.automation(rule.id)} className="activity-rule-name">{rule.name}</Link>
          <p>{rule.form_id ? rule.form?.title ?? "Выбранная форма" : "Все мои формы"} · {automationEvents[rule.event_type]}</p>
          {rule.description && <p className="activity-rule-description">{rule.description}</p>}
        </div>
        <div className="activity-actions">
          <span className={"activity-status" + (rule.enabled ? " activity-status-succeeded" : "")}>{rule.enabled ? "Включено" : "Выключено"}</span>
          <RuleStateButton rule={rule} userId={userId} />
        </div>
      </li>)}
    </ul>}
    {rules.hasNextPage && <button type="button" className="app-button activity-more" disabled={rules.isFetching}
      onClick={() => void rules.fetchNextPage()}>Показать ещё</button>}
    {creating && <RuleEditor userId={userId} rule={null} form={form} onClose={() => setCreating(false)} onSaved={(id) => {
      void queryClient.invalidateQueries({ queryKey: automationKey(userId), refetchType: "none" });
      showToast("Правило создано", "success");
      setCreating(false);
      navigate(routes.automation(id));
    }} />}
  </section>;
}

function FormAutomationList({ userId, formId }: { userId: string; formId: string }) {
  const form = useQuery({
    queryKey: [...automationKey(userId), "form", formId],
    queryFn: ({ signal }) => getAutomationForm(userId, formId, signal),
    refetchOnMount: true,
  });
  return <>
    <Link to={routes.dashboardMy} className="activity-back"><Icon name="arrow_back" size={18} /> Мои формы</Link>
    {form.isPending && <Skeleton className="activity-skeleton" />}
    {form.isError && <div role="alert" className="activity-state">
      <p>Не удалось загрузить форму.</p>
      <button type="button" className="app-button" onClick={() => void form.refetch()}>Повторить</button>
    </div>}
    {form.isSuccess && (form.data ? <AutomationList userId={userId} form={form.data} /> : <p className="activity-state">Форма недоступна.</p>)}
  </>;
}

export default function AutomationsPage() {
  const userId = useAuth().user!.id;
  const { ruleId, formId } = useParams<{ ruleId: string; formId: string }>();
  return <div className="dashboard-page" key={userId}>
    {ruleId ? <AutomationDetail key={ruleId} ruleId={ruleId} userId={userId} />
      : formId ? <FormAutomationList key={formId} formId={formId} userId={userId} />
        : <AutomationList userId={userId} form={null} />}
  </div>;
}
