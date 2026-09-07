import type { InfiniteData, QueryClient, QueryKey } from "@tanstack/react-query";
import type { PaginatedSurveyFormSummaries } from "../../entities/survey/types";

type PageRequest = { page: number; pageSize: number; offset?: number; signal?: AbortSignal };

// Preserve the infinite-query cache and its cancellation/retry behavior, but
// read the loaded window in batches instead of making one HTTP call per UI page.
export function createBatchedFormsQuery(
  client: QueryClient,
  queryKey: QueryKey,
  pageSize: number,
  fetchPage: (request: PageRequest) => Promise<PaginatedSurveyFormSummaries>,
) {
  const refreshes = new WeakMap<AbortSignal, Promise<PaginatedSurveyFormSummaries[]>>();

  async function refreshWindow(signal: AbortSignal) {
    const cached = client.getQueryData<InfiniteData<PaginatedSurveyFormSummaries>>(queryKey);
    const requestedCount = Math.max(1, cached?.pages.length ?? 0) * pageSize;
    const items: PaginatedSurveyFormSummaries["items"] = [];
    let hasMore = false;
    let totalCount = 0;
    for (let offset = 0; offset < requestedCount;) {
      signal.throwIfAborted();
      // Reserve one lookahead row below PostgREST's 1000-row limit.
      const count = Math.min(999, requestedCount - offset);
      const result = await fetchPage({ page: 0, pageSize: count, ...(offset ? { offset } : {}), signal });
      items.push(...result.items);
      totalCount = result.totalCount;
      hasMore = result.hasMore;
      if (!hasMore) break;
      offset += count;
    }
    const pages: PaginatedSurveyFormSummaries[] = [];
    for (let offset = 0; offset < Math.max(1, items.length); offset += pageSize) {
      pages.push({
        items: items.slice(offset, offset + pageSize),
        hasMore: offset + pageSize < items.length || hasMore,
        totalCount,
      });
    }
    return pages;
  }

  return async ({ pageParam, signal }: { pageParam: number; signal: AbortSignal }) => {
    // A new page still loads only its own rows. Refetch always starts at page 0
    // and shares its result across subsequent calls with the same fetch signal.
    if (pageParam === 0) refreshes.set(signal, refreshWindow(signal));
    const refresh = refreshes.get(signal);
    if (refresh) {
      const pages = await refresh;
      signal.throwIfAborted();
      return pages[pageParam] ?? { items: [], hasMore: false, totalCount: pages[pages.length - 1]?.totalCount ?? 0 };
    }
    return fetchPage({ page: pageParam, pageSize, signal });
  };
}
