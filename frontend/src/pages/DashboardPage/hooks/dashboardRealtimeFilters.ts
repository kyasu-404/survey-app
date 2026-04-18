import type { DashboardListFilters } from "../types";

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
const STATS_IRRELEVANT_CARD_FIELDS = ["max_responses", "responses_count"] as const;

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

function changedFieldNames(
  oldRecord: DashboardRealtimeRecord | null,
  newRecord: DashboardRealtimeRecord | null,
) {
  if (!oldRecord || !newRecord) {
    return null;
  }

  const fields = new Set([...Object.keys(oldRecord), ...Object.keys(newRecord)]);
  const changedFields = new Set<string>();

  for (const field of fields) {
    if (!Object.is(oldRecord[field], newRecord[field])) {
      changedFields.add(field);
    }
  }

  return changedFields;
}

function hasOnlyStatsIrrelevantCardFieldChanges(
  oldRecord: DashboardRealtimeRecord | null,
  newRecord: DashboardRealtimeRecord | null,
) {
  const changedFields = changedFieldNames(oldRecord, newRecord);

  if (!changedFields || changedFields.size === 0) {
    return false;
  }

  return [...changedFields].every((field) =>
    STATS_IRRELEVANT_CARD_FIELDS.includes(field as (typeof STATS_IRRELEVANT_CARD_FIELDS)[number]),
  );
}

function hasRelevantDashboardStatsFieldChange(
  oldRecord: DashboardRealtimeRecord | null,
  newRecord: DashboardRealtimeRecord | null,
) {
  if (!oldRecord || !newRecord) {
    return true;
  }

  if (hasOnlyStatsIrrelevantCardFieldChanges(oldRecord, newRecord)) {
    return false;
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

  return comparedFields === 0;
}

export function shouldInvalidateDashboardForms({
  cachedFormIds,
  filters,
  payload,
}: ShouldInvalidateDashboardFormsOptions) {
  const newRecord = isRecord(payload.new) ? payload.new : null;
  const oldRecord = isRecord(payload.old) ? payload.old : null;
  const eventType = payload.eventType?.toUpperCase();
  const cachedRecordChanged = isCachedRecord(cachedFormIds, oldRecord, newRecord);

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
  filters,
  payload,
}: ShouldInvalidateDashboardFormsOptions) {
  const newRecord = isRecord(payload.new) ? payload.new : null;
  const oldRecord = isRecord(payload.old) ? payload.old : null;
  const eventType = payload.eventType?.toUpperCase();
  const cachedRecordChanged = isCachedRecord(cachedFormIds, oldRecord, newRecord);

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
