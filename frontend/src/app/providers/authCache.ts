import type { QueryClient } from "@tanstack/react-query";
import {
  DASHBOARD_FORMS_QUERY_ROOT,
  DASHBOARD_FORM_STATS_QUERY_ROOT,
  TEMPLATE_FORMS_QUERY_ROOT,
} from "../../entities/survey/model/queryKeys";
import { scheduleQueryInvalidation } from "../../shared/lib/queryRefresh";
import { clearUsersPageSessionState } from "../../pages/UsersPage/usersPageSessionState";

const authGenerations = new WeakMap<QueryClient, number>();

/** Guard imperative cache writes, whose RPC promises cannot be cancelled by removeQueries. */
export function createAuthCacheGuard(queryClient: QueryClient) {
  const generation = authGenerations.get(queryClient);
  return () => authGenerations.get(queryClient) === generation;
}

export function refreshAuthDependentQueries(queryClient: QueryClient) {
  authGenerations.set(queryClient, (authGenerations.get(queryClient) ?? 0) + 1);
  // Keep only globally public branding. Removing queries also cancels in-flight
  // requests so a late result cannot repopulate the previous user's cache.
  queryClient.removeQueries({
    predicate: (query) => query.queryKey[0] !== "app-branding" && query.queryKey[0] !== "app-favicon",
  });
  clearUsersPageSessionState(queryClient);

  scheduleQueryInvalidation(queryClient, "auth state changed", [
    { queryKey: DASHBOARD_FORMS_QUERY_ROOT },
    { queryKey: DASHBOARD_FORM_STATS_QUERY_ROOT },
    { queryKey: TEMPLATE_FORMS_QUERY_ROOT },
  ]);
}
