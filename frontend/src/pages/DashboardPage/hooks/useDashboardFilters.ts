import { useMemo, useState } from "react";
import { DASHBOARD_SEARCH_DEBOUNCE_MS } from "../dashboardPageConstants";
import type { DashboardViewMode } from "../types";
import { useDebouncedValue } from "./useDebouncedValue";

export type DashboardFilterValues = { search: string; dateFrom: string; dateTo: string; formType: string; formReason: string };

export function useDashboardFilters(viewMode: DashboardViewMode, userId?: string, initial?: DashboardFilterValues) {
  const [search, setSearch] = useState(initial?.search ?? "");
  const debouncedSearch = useDebouncedValue(search, DASHBOARD_SEARCH_DEBOUNCE_MS);
  const normalizedSearch = debouncedSearch.trim();
  const [dateFrom, setDateFrom] = useState(initial?.dateFrom ?? "");
  const [dateTo, setDateTo] = useState(initial?.dateTo ?? "");
  const [formType, setFormType] = useState(initial?.formType ?? "");
  const [formReason, setFormReason] = useState(initial?.formReason ?? "");

  const listFilters = useMemo(
    () => ({
      search: normalizedSearch || undefined,
      dateFrom: dateFrom || undefined,
      dateTo: dateTo || undefined,
      formType: formType || undefined,
      formReason: formReason || undefined,
      authorId: viewMode === "mine" ? userId : undefined,
    }),
    [dateFrom, dateTo, formReason, formType, normalizedSearch, userId, viewMode],
  );

  return {
    dateFrom,
    dateTo,
    formReason,
    formType,
    listFilters,
    normalizedSearch,
    search,
    setDateFrom,
    setDateTo,
    setFormReason,
    setFormType,
    setSearch,
  };
}
