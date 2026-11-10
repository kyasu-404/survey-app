import { TEMPLATE_FORM_TYPE } from "../../../entities/survey/model/surveyModel";
import type { DashboardRealtimePayload } from "../../DashboardPage/hooks/dashboardRealtimeFilters";
import type { TemplatesSection } from "../types";

export function shouldInvalidateTemplates({ payload, cachedIds, section, userId, isFetching = false }: {
  payload: DashboardRealtimePayload;
  cachedIds: ReadonlySet<string>;
  section: TemplatesSection;
  userId: string;
  isFetching?: boolean;
}) {
  if ([payload.old?.id, payload.new?.id].some(id => typeof id === "string" && cachedIds.has(id))) return true;
  // DELETE only supplies the primary key. An off-screen deletion cannot change
  // the loaded cards; the next page is still fetched against the current DB.
  if (payload.eventType === "DELETE") return isFetching;
  const record = payload.new;
  if (record?.form_type !== TEMPLATE_FORM_TYPE) return false;
  return section === "mine"
    ? record.author_id === undefined || record.author_id === userId
    : record.is_public === undefined || record.is_public === true;
}
