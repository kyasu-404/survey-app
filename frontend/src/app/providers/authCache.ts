import type { QueryClient } from "@tanstack/react-query";
import { scheduleQueryInvalidation } from "../../shared/lib/queryRefresh";

export function refreshAuthDependentQueries(queryClient: QueryClient) {
  queryClient.removeQueries({ queryKey: ["builder-templates"] });
  queryClient.removeQueries({ queryKey: ["users"] });
  queryClient.removeQueries({ queryKey: ["form-responses"] });

  scheduleQueryInvalidation(queryClient, "auth state changed", [
    { queryKey: ["forms"] },
    { queryKey: ["form"] },
    { queryKey: ["survey-form"] },
  ]);
}
