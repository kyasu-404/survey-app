import type { QueryClient } from "@tanstack/react-query";
import { describe, expect, it, vi } from "vitest";
import {
  DASHBOARD_FORMS_QUERY_ROOT,
  DASHBOARD_FORM_STATS_QUERY_ROOT,
  FORM_QUERY_ROOT,
  FORM_RESPONSES_QUERY_ROOT,
  TEMPLATE_FORMS_QUERY_ROOT,
} from "../../entities/survey/model/queryKeys";
import { refreshAuthDependentQueries } from "./authCache";
import { scheduleQueryInvalidation } from "../../shared/lib/queryRefresh";

vi.mock("../../shared/lib/queryRefresh", () => ({
  scheduleQueryInvalidation: vi.fn(),
}));

describe("refreshAuthDependentQueries", () => {
  it("drops auth-sensitive caches and schedules dashboard refreshes", () => {
    const queryClient = {
      removeQueries: vi.fn(),
    } as unknown as QueryClient;

    refreshAuthDependentQueries(queryClient);

    expect(queryClient.removeQueries).toHaveBeenCalledWith({ queryKey: ["builder-templates"] });
    expect(queryClient.removeQueries).toHaveBeenCalledWith({ queryKey: ["users"] });
    expect(queryClient.removeQueries).toHaveBeenCalledWith({ queryKey: FORM_RESPONSES_QUERY_ROOT });
    expect(scheduleQueryInvalidation).toHaveBeenCalledWith(queryClient, "auth state changed", [
      { queryKey: DASHBOARD_FORMS_QUERY_ROOT },
      { queryKey: DASHBOARD_FORM_STATS_QUERY_ROOT },
      { queryKey: TEMPLATE_FORMS_QUERY_ROOT },
      { queryKey: FORM_QUERY_ROOT },
    ]);
  });
});
