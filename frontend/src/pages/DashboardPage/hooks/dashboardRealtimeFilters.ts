import type { DashboardListFilters } from "../types";
import type { SurveyFormSummary } from "../../../entities/survey/types";

type DashboardRealtimeRecord = Partial<{
  author_id: string;
  author_name: string | null;
  created_at: string;
  deadline_at: string | null;
  form_reason: string;
  form_type: string;
  id: string;
  is_public: boolean;
  max_responses: number | null;
  responses_count: number | null;
  title: string;
}> &
  Record<string, unknown>;

export type DashboardRealtimePayload = {
  eventType?: string;
  new?: DashboardRealtimeRecord | null;
  old?: DashboardRealtimeRecord | null;
};

type ShouldInvalidateDashboardFormsOptions = {
  cachedFormIds?: ReadonlySet<string>;
  cachedForms?: ReadonlyMap<string, SurveyFormSummary>;
  filters: DashboardListFilters;
  payload: DashboardRealtimePayload;
};

const TEMPLATE_FORM_TYPE = "template";
const DASHBOARD_RELEVANT_FORM_FIELDS = [
  "author_id",
  "author_name",
  "created_at",
  "deadline_at",
  "form_reason",
  "form_type",
  "is_public",
  "max_responses",
  "responses_count",
  "title",
] as const;
const DASHBOARD_STATS_RELEVANT_FORM_FIELDS = [
  "author_id",
  "author_name",
  "created_at",
  "deadline_at",
  "form_reason",
  "form_type",
  "is_public",
  "title",
] as const;

function isRecord(value: unknown): value is DashboardRealtimeRecord {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function getStringField(record: DashboardRealtimeRecord, field: keyof DashboardRealtimeRecord) {
  const value = record[field];
  return typeof value === "string" ? value : null;
}

function normalizeSearchValue(search: string) {
  return search.trim().replace(/[,()]/g, " ").toLowerCase();
}

function isKnownDifferentString(
  record: DashboardRealtimeRecord,
  field: keyof DashboardRealtimeRecord,
  expected: string,
) {
  const value = getStringField(record, field);
  return value !== null && value !== expected;
}

function isKnownEqualString(
  record: DashboardRealtimeRecord,
  field: keyof DashboardRealtimeRecord,
  expected: string,
) {
  const value = getStringField(record, field);
  return value !== null && value === expected;
}

function isKnownBeforeDate(record: DashboardRealtimeRecord, field: keyof DashboardRealtimeRecord, expected: string) {
  const value = getStringField(record, field);
  const valueTime = value ? Date.parse(value) : Number.NaN;
  const expectedTime = Date.parse(expected);

  return Number.isFinite(valueTime) && Number.isFinite(expectedTime) && valueTime < expectedTime;
}

function isKnownAfterDate(record: DashboardRealtimeRecord, field: keyof DashboardRealtimeRecord, expected: string) {
  const value = getStringField(record, field);
  const valueTime = value ? Date.parse(value) : Number.NaN;
  const expectedTime = Date.parse(expected);

  return Number.isFinite(valueTime) && Number.isFinite(expectedTime) && valueTime > expectedTime;
}

function isKnownOutsideSearch(record: DashboardRealtimeRecord, search: string) {
  const title = getStringField(record, "title");
  const authorName = getStringField(record, "author_name");

  if (title === null || authorName === null) {
    return false;
  }

  return !title.toLowerCase().includes(search) && !authorName.toLowerCase().includes(search);
}

function recordMayMatchDashboardFilters(record: DashboardRealtimeRecord | null, filters: DashboardListFilters) {
  if (!record) {
    return true;
  }

  if (isKnownEqualString(record, "form_type", TEMPLATE_FORM_TYPE)) {
    return false;
  }

  if (filters.authorId && isKnownDifferentString(record, "author_id", filters.authorId)) {
    return false;
  }

  if (filters.formType && isKnownDifferentString(record, "form_type", filters.formType)) {
    return false;
  }

  if (filters.formReason && isKnownDifferentString(record, "form_reason", filters.formReason)) {
    return false;
  }

  if (filters.dateFrom && isKnownBeforeDate(record, "created_at", filters.dateFrom)) {
    return false;
  }

  if (filters.dateTo && isKnownAfterDate(record, "created_at", filters.dateTo)) {
    return false;
  }

  const search = filters.search ? normalizeSearchValue(filters.search) : "";

  if (search && isKnownOutsideSearch(record, search)) {
    return false;
  }

  return true;
}

function getRecordId(record: DashboardRealtimeRecord | null) {
  const id = record?.id;
  return typeof id === "string" ? id : null;
}

function isCachedRecord(
  cachedFormIds: ReadonlySet<string> | undefined,
  ...records: Array<DashboardRealtimeRecord | null>
) {
  if (!cachedFormIds?.size) {
    return false;
  }

  return records.some((record) => {
    const id = getRecordId(record);
    return id ? cachedFormIds.has(id) : false;
  });
}

function hasRelevantDashboardFieldChange(
  oldRecord: DashboardRealtimeRecord | null,
  newRecord: DashboardRealtimeRecord | null,
) {
  if (!oldRecord || !newRecord) {
    return true;
  }

  let comparedFields = 0;

  for (const field of DASHBOARD_RELEVANT_FORM_FIELDS) {
    if (!(field in oldRecord) || !(field in newRecord)) {
      return true;
    }

    comparedFields += 1;

    if (!Object.is(oldRecord[field], newRecord[field])) {
      return true;
    }
  }

  return comparedFields === 0;
}

function previousRecord(payload: DashboardRealtimePayload, cachedForms?: ReadonlyMap<string, SurveyFormSummary>) {
  const oldRecord = isRecord(payload.old) ? payload.old : null;
  const id = getRecordId(oldRecord) ?? getRecordId(payload.new ?? null);
  const cachedForm = id ? cachedForms?.get(id) : undefined;
  // REPLICA IDENTITY DEFAULT normally supplies only the primary key in `old`.
  // Prefer actual old values when supplied; fill missing fields from this list.
  return cachedForm ? { ...cachedForm, ...oldRecord } : oldRecord;
}

function hasRelevantDashboardStatsFieldChange(
  oldRecord: DashboardRealtimeRecord | null,
  newRecord: DashboardRealtimeRecord | null,
) {
  if (!oldRecord || !newRecord) {
    return true;
  }

  let comparedFields = 0;

  for (const field of DASHBOARD_STATS_RELEVANT_FORM_FIELDS) {
    if (!(field in oldRecord) || !(field in newRecord)) {
      return true;
    }

    comparedFields += 1;

    if (!Object.is(oldRecord[field], newRecord[field])) {
      return true;
    }
  }

  if (comparedFields === 0) return true;
  // Counts and limits affect totals only when the effective active state changes.
  const limitReached = (record: DashboardRealtimeRecord) => {
    if (!("max_responses" in record) || !("responses_count" in record)) return null;
    return typeof record.max_responses === "number"
      && (record.responses_count ?? 0) >= record.max_responses;
  };
  const wasAtLimit = limitReached(oldRecord);
  const isAtLimit = limitReached(newRecord);
  return wasAtLimit === null || isAtLimit === null || wasAtLimit !== isAtLimit;
}

export function shouldInvalidateDashboardForms({
  cachedFormIds,
  cachedForms,
  filters,
  payload,
}: ShouldInvalidateDashboardFormsOptions) {
  const newRecord = isRecord(payload.new) ? payload.new : null;
  const oldRecord = previousRecord(payload, cachedForms);
  const eventType = payload.eventType?.toUpperCase();
  const cachedRecordChanged = isCachedRecord(cachedFormIds ?? new Set(cachedForms?.keys()), oldRecord, newRecord);

  if (eventType === "INSERT") {
    return recordMayMatchDashboardFilters(newRecord, filters);
  }

  if (eventType === "DELETE") {
    return cachedRecordChanged || recordMayMatchDashboardFilters(oldRecord, filters);
  }

  if (eventType === "UPDATE") {
    const mayAffectCurrentFilters =
      cachedRecordChanged ||
      recordMayMatchDashboardFilters(oldRecord, filters) ||
      recordMayMatchDashboardFilters(newRecord, filters);

    return mayAffectCurrentFilters && hasRelevantDashboardFieldChange(oldRecord, newRecord);
  }

  return true;
}

export function shouldInvalidateDashboardFormStats({
  cachedFormIds,
  cachedForms,
  filters,
  payload,
}: ShouldInvalidateDashboardFormsOptions) {
  const newRecord = isRecord(payload.new) ? payload.new : null;
  const oldRecord = previousRecord(payload, cachedForms);
  const eventType = payload.eventType?.toUpperCase();
  const cachedRecordChanged = isCachedRecord(cachedFormIds ?? new Set(cachedForms?.keys()), oldRecord, newRecord);

  if (eventType === "INSERT") {
    return recordMayMatchDashboardFilters(newRecord, filters);
  }

  if (eventType === "DELETE") {
    return cachedRecordChanged || recordMayMatchDashboardFilters(oldRecord, filters);
  }

  if (eventType === "UPDATE") {
    const mayAffectCurrentFilters =
      cachedRecordChanged ||
      recordMayMatchDashboardFilters(oldRecord, filters) ||
      recordMayMatchDashboardFilters(newRecord, filters);

    return mayAffectCurrentFilters && hasRelevantDashboardStatsFieldChange(oldRecord, newRecord);
  }

  return true;
}
