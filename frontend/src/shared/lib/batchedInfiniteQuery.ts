import type { InfiniteData, QueryClient, QueryKey } from "@tanstack/react-query";
import type { FormsCursor, PaginatedSurveyFormSummaries } from "../../entities/survey/types";

type PageRequest = { cursor: FormsCursor | null; pageSize: number; signal?: AbortSignal };

export function getFormsNextCursor(page: PaginatedSurveyFormSummaries): FormsCursor | undefined {
  const last = page.items[page.items.length - 1];
  return page.hasMore && last ? { createdAt: last.created_at, id: last.id } : undefined;
}

function cursorKey(cursor: FormsCursor | null) {
  return JSON.stringify(cursor ? [cursor.createdAt, cursor.id] : null);
}

// Refresh the loaded window in batches, preserving the infinite-query cache,
// cancellation and retry behavior. Every database read seeks by the last key.
export function createBatchedFormsQuery(
  client: QueryClient,
  queryKey: QueryKey,
  pageSize: number,
  fetchPage: (request: PageRequest) => Promise<PaginatedSurveyFormSummaries>,
) {
  const refreshes = new WeakMap<AbortSignal, Promise<Map<string, PaginatedSurveyFormSummaries>>>();

  async function refreshWindow(signal: AbortSignal) {
    const cached = client.getQueryData<InfiniteData<PaginatedSurveyFormSummaries, FormsCursor | null>>(queryKey);
    const requestedCount = Math.max(1, cached?.pages.length ?? 0) * pageSize;
    const items: PaginatedSurveyFormSummaries["items"] = [];
    let cursor: FormsCursor | null = null;
    let hasMore = false;
    while (items.length < requestedCount) {
      signal.throwIfAborted();
      // Reserve one lookahead row below PostgREST's 1000-row limit.
      const count = Math.min(999, requestedCount - items.length);
      const result = await fetchPage({ cursor, pageSize: count, signal });
      items.push(...result.items);
      const nextCursor = getFormsNextCursor(result);
      hasMore = Boolean(nextCursor);
      if (!nextCursor) break;
      cursor = nextCursor;
    }
    const pages = new Map<string, PaginatedSurveyFormSummaries>();
    cursor = null;
    for (let start = 0; start < Math.max(1, items.length); start += pageSize) {
      const page = {
        items: items.slice(start, start + pageSize),
        hasMore: start + pageSize < items.length || hasMore,
        totalCount: items.length + (hasMore ? 1 : 0),
      };
      pages.set(cursorKey(cursor), page);
      cursor = getFormsNextCursor(page) ?? null;
    }
    return pages;
  }

  return async ({ pageParam, signal }: { pageParam: FormsCursor | null; signal: AbortSignal }) => {
    // Refetch starts from the newest row and shares its freshly computed cursor
    // chain across the subsequent calls made by TanStack with this fetch signal.
    if (pageParam === null) refreshes.set(signal, refreshWindow(signal));
    const refresh = refreshes.get(signal);
    if (refresh) {
      const pages = await refresh;
      signal.throwIfAborted();
      const page = pages.get(cursorKey(pageParam));
      if (!page) throw new Error("Не найдена страница обновлённого списка форм");
      return page;
    }
    const result = await fetchPage({ cursor: pageParam, pageSize, signal });
    const cached = client.getQueryData<InfiniteData<PaginatedSurveyFormSummaries>>(queryKey);
    const loadedCount = cached?.pages.reduce((count, page) => count + page.items.length, 0) ?? 0;
    return { ...result, totalCount: loadedCount + result.items.length + (result.hasMore ? 1 : 0) };
  };
}
