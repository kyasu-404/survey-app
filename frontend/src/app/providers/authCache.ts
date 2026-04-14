import type { QueryClient } from "@tanstack/react-query";
import {
  DASHBOARD_FORMS_QUERY_ROOT,
  DASHBOARD_FORM_STATS_QUERY_ROOT,
  TEMPLATE_FORMS_QUERY_ROOT,
} from "../../entities/survey/model/queryKeys";
import { scheduleQueryInvalidation } from "../../shared/lib/queryRefresh";

export function refreshAuthDependentQueries(queryClient: QueryClient) {
  queryClient.removeQueries({ queryKey: ["builder-templates"] });
  queryClient.removeQueries({ queryKey: ["users"] });
  queryClient.removeQueries({ queryKey: ["form-responses"] });

  scheduleQueryInvalidation(queryClient, "auth state changed", [
    { queryKey: DASHBOARD_FORMS_QUERY_ROOT },
    { queryKey: DASHBOARD_FORM_STATS_QUERY_ROOT },
    { queryKey: TEMPLATE_FORMS_QUERY_ROOT },
    { queryKey: ["form"] },
    { queryKey: ["survey-form"] },
  ]);
}
