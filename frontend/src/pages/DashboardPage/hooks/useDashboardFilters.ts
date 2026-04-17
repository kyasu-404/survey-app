import { useMemo, useState } from "react";
import { DASHBOARD_SEARCH_DEBOUNCE_MS } from "../dashboardPageConstants";
import type { DashboardViewMode } from "../types";
import { useDebouncedValue } from "./useDebouncedValue";

export function useDashboardFilters(viewMode: DashboardViewMode, userId?: string) {
  const [search, setSearch] = useState("");
  const debouncedSearch = useDebouncedValue(search, DASHBOARD_SEARCH_DEBOUNCE_MS);
  const normalizedSearch = debouncedSearch.trim();
  const [dateFrom, setDateFrom] = useState("");
  const [dateTo, setDateTo] = useState("");
  const [formType, setFormType] = useState("");
  const [formReason, setFormReason] = useState("");

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
