import type { QueryClient } from "@tanstack/react-query";
import { logWarning } from "./observability";

function stringifyKey(queryKey: readonly unknown[]) {
  try {
    return JSON.stringify(queryKey);
  } catch {
    return String(queryKey);
  }
}

export function logPendingReactQueryState(queryClient: QueryClient, label: string) {
  const pendingQueries = queryClient
    .getQueryCache()
    .getAll()
    .filter((query) => query.state.fetchStatus === "fetching")
    .map((query) => ({
      queryKey: stringifyKey(query.queryKey),
      status: query.state.status,
    }));

  const pendingMutations = queryClient
    .getMutationCache()
    .getAll()
    .filter((mutation) => mutation.state.status === "pending")
    .map((mutation) => ({
      mutationKey: mutation.options.mutationKey ? stringifyKey(mutation.options.mutationKey) : "unkeyed",
      status: mutation.state.status,
    }));

  if (pendingQueries.length === 0 && pendingMutations.length === 0) {
    return;
  }

  logWarning(
    `[react-query] pending operations for ${label}`,
    {
      operation: "react-query.pending",
      label,
      pendingQueries,
      pendingMutations,
    },
    { report: true },
  );
}

export function createPendingStateLogger(queryClient: QueryClient, label: string, delayMs = 1_500) {
  const timerId = setTimeout(() => {
    logPendingReactQueryState(queryClient, label);
  }, delayMs);

  return () => {
    clearTimeout(timerId);
  };
}
