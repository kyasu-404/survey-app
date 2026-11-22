import { apiClient } from "../../shared/api/client";
import { runRequest } from "../../shared/api/request";
import { TIMELINE_PAGE_SIZE, timelineBefore, timelinePage, type TimelineCursor } from "../../shared/api/timelinePage";
import type { AutomationField, AutomationRule, AutomationRun, RuleConfig } from "./model";

const RULE_COLUMNS = "id,created_at,form_id,name,description,enabled,event_type,threshold,interval_minutes,scheduled_at,match_mode,conditions,action_config,form:forms(title)";

function containsSearch(value: string) {
  return "%" + value.replace(/[\\%_]/g, "\\$&") + "%";
}

export type AutomationFilter = "all" | "enabled" | "disabled";

export async function listAutomationRules(userId: string, formId: string | null, search: string, filter: AutomationFilter, cursor?: TimelineCursor, signal?: AbortSignal) {
  const { data, error } = await runRequest("automations.list", (requestSignal) => {
    const query = apiClient.from("automation_rules").select(RULE_COLUMNS).eq("user_id", userId);
    if (formId === null) query.is("form_id", null);
    else query.eq("form_id", formId);
    if (search) query.ilike("name", containsSearch(search));
    if (filter !== "all") query.eq("enabled", filter === "enabled");
    if (cursor) query.or(timelineBefore(cursor));
    return query.order("created_at", { ascending: false }).order("id", { ascending: false })
      .limit(TIMELINE_PAGE_SIZE + 1).abortSignal(requestSignal);
  }, { signal });
  if (error) throw new Error("Не удалось загрузить правила");
  return timelinePage((data ?? []) as unknown as AutomationRule[]);
}

export async function getAutomationRule(userId: string, id: string, signal?: AbortSignal) {
  const { data, error } = await runRequest("automations.get", (requestSignal) => apiClient.from("automation_rules")
    .select(RULE_COLUMNS).eq("user_id", userId).eq("id", id).abortSignal(requestSignal).maybeSingle(), { signal });
  if (error) throw new Error("Не удалось загрузить правило");
  return data as unknown as AutomationRule | null;
}

export async function listAutomationRuns(id: string, cursor?: TimelineCursor, signal?: AbortSignal) {
  const { data, error } = await runRequest("automations.history", (requestSignal) => {
    const query = apiClient.from("automation_runs")
      .select("id,form_id,form_title,response_id,status,recipient_count,sent_count,failed_count,cancelled_count,last_error,created_at").eq("rule_id", id);
    if (cursor) query.or(timelineBefore(cursor));
    return query.order("created_at", { ascending: false }).order("id", { ascending: false })
      .limit(TIMELINE_PAGE_SIZE + 1).abortSignal(requestSignal);
  }, { signal });
  if (error) throw new Error("Не удалось загрузить историю");
  return timelinePage((data ?? []) as AutomationRun[]);
}

export type AutomationForm = { id: string; title: string };

export async function getAutomationForm(userId: string, formId: string, signal?: AbortSignal) {
  const { data, error } = await runRequest("automations.form", (requestSignal) =>
    apiClient.from("forms").select("id,title").eq("author_id", userId).eq("id", formId).neq("form_type", "template")
      .abortSignal(requestSignal).maybeSingle(), { signal });
  if (error) throw new Error("Не удалось загрузить форму");
  return data as AutomationForm | null;
}

export async function countActiveFormRules(userId: string, formId: string, signal?: AbortSignal) {
  const { count, error } = await runRequest("automations.count", (requestSignal) =>
    apiClient.from("automation_rules").select("id", { count: "exact", head: true })
      .eq("user_id", userId).eq("form_id", formId).eq("enabled", true).abortSignal(requestSignal), { signal });
  if (error || count === null) throw new Error("Не удалось загрузить количество активных правил");
  return count;
}

export async function getAutomationFields(formId: string, signal?: AbortSignal) {
  const { data, error } = await runRequest("automations.fields", (requestSignal) =>
    apiClient.rpc("automation_form_fields", { p_form_id: formId }).abortSignal(requestSignal), { signal });
  if (error) throw new Error("Не удалось загрузить вопросы формы");
  return (data ?? []) as AutomationField[];
}

export async function saveAutomationRule(id: string | null, rule: RuleConfig): Promise<string> {
  const { data, error } = await runRequest("automations.save", (signal) => apiClient.rpc("save_automation_rule", {
    p_id: id, p_form_id: rule.form_id, p_name: rule.name, p_description: rule.description, p_enabled: rule.enabled,
    p_event_type: rule.event_type, p_threshold: rule.threshold, p_interval_minutes: rule.interval_minutes,
    p_scheduled_at: rule.scheduled_at, p_match_mode: rule.match_mode, p_conditions: rule.conditions, p_action: rule.action_config,
  }).abortSignal(signal));
  if (error) throw new Error(["22023", "42501"].includes(error.code) && /^[А-ЯЁ]/.test(error.message) ? error.message : "Не удалось сохранить правило");
  return data as string;
}

export async function setAutomationEnabled(id: string, enabled: boolean) {
  const { error } = await runRequest("automations.toggle", (signal) =>
    apiClient.rpc("set_automation_rule_enabled", { p_id: id, p_enabled: enabled }).abortSignal(signal));
  if (error) throw new Error(["22023", "42501"].includes(error.code) && /^[А-ЯЁ]/.test(error.message) ? error.message : "Не удалось изменить состояние правила");
}
