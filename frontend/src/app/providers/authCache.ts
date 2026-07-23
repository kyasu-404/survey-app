import type { QueryClient } from "@tanstack/react-query";
import {
  DASHBOARD_FORMS_QUERY_ROOT,
  DASHBOARD_FORM_STATS_QUERY_ROOT,
  FORM_QUERY_ROOT,
  FORM_RESPONSES_QUERY_ROOT,
  SURVEY_FORM_QUERY_ROOT,
  TEMPLATE_FORMS_QUERY_ROOT,
  USERS_QUERY_ROOT,
} from "../../entities/survey/model/queryKeys";
import { scheduleQueryInvalidation } from "../../shared/lib/queryRefresh";
import { clearUsersPageSessionState } from "../../pages/UsersPage/usersPageSessionState";

export function refreshAuthDependentQueries(queryClient: QueryClient) {
  queryClient.removeQueries({ queryKey: ["builder-templates"] });
  queryClient.removeQueries({ queryKey: USERS_QUERY_ROOT });
  queryClient.removeQueries({ queryKey: FORM_RESPONSES_QUERY_ROOT });
  queryClient.removeQueries({ queryKey: FORM_QUERY_ROOT });
  queryClient.removeQueries({ queryKey: SURVEY_FORM_QUERY_ROOT });
  clearUsersPageSessionState(queryClient);

  scheduleQueryInvalidation(queryClient, "auth state changed", [
    { queryKey: DASHBOARD_FORMS_QUERY_ROOT },
    { queryKey: DASHBOARD_FORM_STATS_QUERY_ROOT },
    { queryKey: TEMPLATE_FORMS_QUERY_ROOT },
  ]);
}
