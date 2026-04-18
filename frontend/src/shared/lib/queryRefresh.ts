import type { QueryClient, QueryKey } from "@tanstack/react-query";
import { logError, logInfo } from "./observability";

type RefreshTarget = {
  queryKey: QueryKey;
};

const pendingInvalidations = new Map<string, ReturnType<typeof setTimeout>>();

export function scheduleQueryInvalidation(
  queryClient: QueryClient,
  reason: string,
  targets: RefreshTarget[],
) {
  logInfo(`[react-query] schedule invalidate for ${reason}`, {
    operation: "react-query.invalidate",
    reason,
    queryKeys: targets.map((target) => target.queryKey),
  });

  void Promise.allSettled(
    targets.map((target) => queryClient.invalidateQueries({ queryKey: target.queryKey })),
  ).then((results) => {
    const rejected = results.filter((result) => result.status === "rejected");

    if (rejected.length > 0) {
      const firstReason = rejected[0]?.reason;
      logError(
        `[react-query] invalidate failed for ${reason}`,
        firstReason instanceof Error ? firstReason : new Error("React Query invalidation failed"),
        {
          operation: "react-query.invalidate",
          reason,
          rejectedCount: rejected.length,
          queryKeys: targets.map((target) => target.queryKey),
        },
      );
      return;
    }

    logInfo(`[react-query] invalidate completed for ${reason}`, {
      operation: "react-query.invalidate",
      reason,
      count: targets.length,
    });
  });
}

export function scheduleDebouncedQueryInvalidation(
  queryClient: QueryClient,
  reason: string,
  targets: RefreshTarget[],
  debounceMs: number,
) {
  const cacheKey = `${reason}:${JSON.stringify(targets.map((target) => target.queryKey))}`;
  const existingTimeoutId = pendingInvalidations.get(cacheKey);

  if (existingTimeoutId) {
    clearTimeout(existingTimeoutId);
  }

  const timeoutId = setTimeout(() => {
    pendingInvalidations.delete(cacheKey);
    scheduleQueryInvalidation(queryClient, reason, targets);
  }, debounceMs);

  pendingInvalidations.set(cacheKey, timeoutId);
}
