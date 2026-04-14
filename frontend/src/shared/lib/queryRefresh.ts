import type { QueryClient, QueryKey } from "@tanstack/react-query";

type RefreshTarget = {
  queryKey: QueryKey;
};

const pendingInvalidations = new Map<string, ReturnType<typeof setTimeout>>();

export function scheduleQueryInvalidation(
  queryClient: QueryClient,
  reason: string,
  targets: RefreshTarget[],
) {
  console.info(`[react-query] schedule invalidate for ${reason}`, {
    queryKeys: targets.map((target) => target.queryKey),
  });

  void Promise.allSettled(
    targets.map((target) => queryClient.invalidateQueries({ queryKey: target.queryKey })),
  ).then((results) => {
    const rejected = results.filter((result) => result.status === "rejected");

    if (rejected.length > 0) {
      console.error(`[react-query] invalidate failed for ${reason}`, { rejectedCount: rejected.length });
      return;
    }

    console.info(`[react-query] invalidate completed for ${reason}`, {
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
