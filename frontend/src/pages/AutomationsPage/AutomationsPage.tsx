import { useDeferredValue, useState } from "react";
import { useInfiniteQuery, useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Link, useNavigate, useParams } from "react-router-dom";
import { routes } from "../../app/routes";
import { useAuth } from "../../app/providers/AuthProvider";
import { useToast } from "../../app/providers/ToastProvider";
import { getAutomationForm, getAutomationRule, listAutomationRules, setAutomationEnabled, type AutomationFilter, type AutomationForm } from "../../entities/automation/api";
import { automationEvents, automationKey, type AutomationRule, type AutomationRuleListItem } from "../../entities/automation/model";
import type { TimelineCursor } from "../../shared/api/timelinePage";
import { getErrorMessage } from "../../shared/lib/error";
import { Icon } from "../../shared/ui/Icon";
import { InlineSpinner } from "../../shared/ui/InlineSpinner";
import { Skeleton } from "../../shared/ui/Skeleton";
import { RuleEditor } from "./RuleEditor";

import { RuleHistory } from "./RuleHistory";
import { describeRuleAction, describeRuleTrigger } from "./ruleSummary";
import "./automations.css";

function RuleStateButton({ rule, userId }: { rule: AutomationRule; userId: string }) {
  const queryClient = useQueryClient();
  const { showToast } = useToast();
  const toggle = useMutation({
    mutationFn: (enabled: boolean) => setAutomationEnabled(rule.id, enabled),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: automationKey(userId) }),
    onError: (error) => showToast(getErrorMessage(error, "Не удалось изменить состояние правила"), "error"),
  });
  const status = rule.enabled ? "Включено" : "Выключено";
  return <button type="button" className="app-button rule-status-button" data-enabled={rule.enabled}
    aria-label={`Статус правила «${rule.name}»: ${status}`} aria-busy={toggle.isPending}
    title={rule.enabled ? "Выключить правило" : "Включить правило"} disabled={toggle.isPending}
    onClick={() => toggle.mutate(!rule.enabled)}>
    {toggle.isPending && <InlineSpinner />}
    {status}<span className="chip-indicator" aria-hidden="true">⇄</span>
  </button>;
}

const countFormat = new Intl.NumberFormat("ru-RU");

function RuleCard({ rule, userId }: { rule: AutomationRuleListItem; userId: string }) {
  return <li className="automation-card">
    <div className="automation-card-heading">
      <h3>{rule.name}</h3>
      <RuleStateButton rule={rule} userId={userId} />
    </div>
    {rule.description && <p className="automation-description">{rule.description}</p>}
    <dl className="automation-facts">
      <div>
        <dt><Icon name="bolt" size={18} /> Когда</dt>
        <dd>{describeRuleTrigger(rule)}
          {rule.conditions.length > 0 && <small>
            Учитываются ответы, соответствующие {rule.match_mode === "all" ? "всем условиям" : "хотя бы одному условию"}.
          </small>}
        </dd>
      </div>
      <div>
        <dt><Icon name="arrow_forward" size={18} /> Действие</dt>
        <dd>{describeRuleAction(rule)}</dd>
      </div>
    </dl>
    <div className="automation-card-footer">
      {rule.successfulRunCount !== null && <span>Успешных запусков: {countFormat.format(rule.successfulRunCount)}</span>}
      <Link to={routes.automation(rule.id)} aria-label={`Подробнее о правиле «${rule.name}»`}>
        Подробнее <Icon name="chevron_right" size={18} />
      </Link>
    </div>
  </li>;
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

  return <section className="activity-page">
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
          <p>{rule.form_id ? rule.form?.title ?? "Выбранная форма" : "Все ваши формы"} · {automationEvents[rule.event_type]}</p>
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

  return <section className="activity-page">
    <header className="activity-heading">
      <div>
        <h1>{form ? "Автоматизации формы" : "Автоматизации"}</h1>
        <p>{form ? `«${form.title}»` : "Отправляйте письма при поступлении ответов, достижении заданного показателя или по расписанию."}</p>
      </div>
      <button type="button" className="button-primary" onClick={() => setCreating(true)}><Icon name="add" /> Создать правило</button>
    </header>
    <section className="automation-section automation-rule-list" aria-labelledby="automation-scope-heading">
      <header className="automation-scope-heading">
        <Icon name={form ? "description" : "folder"} size={24} />
        <div>
          <h2 id="automation-scope-heading">{form ? "Правила формы" : "Общие правила"}</h2>
          <p>{form ? "Действуют только для этой формы." : "Действуют для всех ваших форм, включая будущие."}</p>
        </div>
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
      {rules.isSuccess && !items.length && (
        deferredSearch || filter !== "all"
          ? <div className="activity-state">
            <p className="activity-empty-copy">Правил с такими фильтрами нет.</p>
            <button type="button" className="app-button" onClick={() => { setSearch(""); setFilter("all"); }}>Сбросить фильтры</button>
          </div>
          : <p className="activity-state">{form
            ? "Создайте первое правило, чтобы получать уведомления о новых ответах этой формы."
            : "Создайте первое правило, чтобы получать уведомления о новых ответах."}</p>
      )}
      {items.length > 0 && <ul className="automation-cards">
        {items.map((rule) => <RuleCard key={rule.id} rule={rule} userId={userId} />)}
      </ul>}
      {rules.hasNextPage && <button type="button" className="app-button activity-more" disabled={rules.isFetching}
        onClick={() => void rules.fetchNextPage()}>Показать ещё</button>}
    </section>
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
  return <div className="dashboard-page automations-page" key={userId}>
    {ruleId ? <AutomationDetail key={ruleId} ruleId={ruleId} userId={userId} />
      : formId ? <FormAutomationList key={formId} formId={formId} userId={userId} />
        : <AutomationList userId={userId} form={null} />}
  </div>;
}
