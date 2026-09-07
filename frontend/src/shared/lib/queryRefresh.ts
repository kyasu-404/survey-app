import type { QueryClient, QueryKey } from "@tanstack/react-query";
import { logError, logInfo } from "./observability";

type RefreshTarget = {
  queryKey: QueryKey;
};

type QueryInvalidationOptions = {
  cancelRefetch?: boolean;
  refetchType?: "active" | "inactive" | "all" | "none";
};

export function scheduleQueryInvalidation(
  queryClient: QueryClient,
  reason: string,
  targets: RefreshTarget[],
  options: QueryInvalidationOptions = {},
) {
  logInfo(`[react-query] schedule invalidate for ${reason}`, {
    operation: "react-query.invalidate",
    reason,
    queryKeys: targets.map((target) => target.queryKey),
  });

  return Promise.allSettled(
    targets.map((target) => {
      const queryFilters = options.refetchType
        ? { queryKey: target.queryKey, refetchType: options.refetchType }
        : { queryKey: target.queryKey };
      const invalidateOptions =
        typeof options.cancelRefetch === "boolean" ? { cancelRefetch: options.cancelRefetch } : undefined;

      return invalidateOptions
        ? queryClient.invalidateQueries(queryFilters, invalidateOptions)
        : queryClient.invalidateQueries(queryFilters);
    }),
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

/** Bound burst coalescing by maxWaitMs; let an in-flight read finish before refreshing. */
export function createQueryRefreshScheduler(
  queryClient: QueryClient,
  reason: string,
  debounceMs: number,
  maxWaitMs = 1000,
) {
  const pendingTargets = new Map<string, RefreshTarget>();
  let firstScheduledAt: number | null = null;
  let timeoutId: ReturnType<typeof setTimeout> | undefined;
  let running = false;
  let disposed = false;

  function armTimer() {
    if (timeoutId !== undefined) clearTimeout(timeoutId);
    const remaining = Math.max(0, maxWaitMs - (Date.now() - (firstScheduledAt ?? Date.now())));
    timeoutId = setTimeout(() => void flush(), Math.min(debounceMs, remaining));
  }

  async function flush() {
    timeoutId = undefined;
    if (disposed || running) return;
    running = true;
    const targets = [...pendingTargets.values()];
    pendingTargets.clear();
    firstScheduledAt = null;

    try {
      // A change may arrive after an in-flight request took its snapshot. Wait
      // for that request, then read again instead of losing the invalidation.
      const inFlight = targets.flatMap(({ queryKey }) =>
        queryClient.getQueryCache().findAll({ queryKey, type: "active" })
          .flatMap((query) => query.promise ? [query.promise] : []),
      );
      await Promise.allSettled(inFlight);
      if (!disposed) {
        await scheduleQueryInvalidation(queryClient, reason, targets, {
          cancelRefetch: false,
          refetchType: "active",
        });
      }
    } finally {
      running = false;
      if (!disposed && pendingTargets.size > 0) armTimer();
    }
  }

  return {
    schedule(targets: RefreshTarget[]) {
      if (disposed) return;
      firstScheduledAt ??= Date.now();
      for (const target of targets) {
        pendingTargets.set(JSON.stringify(target.queryKey), target);
      }
      if (!running) armTimer();
    },
    dispose() {
      disposed = true;
      if (timeoutId !== undefined) clearTimeout(timeoutId);
      pendingTargets.clear();
    },
  };
}
