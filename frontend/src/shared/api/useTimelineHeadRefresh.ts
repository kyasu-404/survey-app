import { useQuery, useQueryClient, type InfiniteData, type QueryKey } from "@tanstack/react-query";
import type { TimelineCursor } from "./timelinePage";

type TimelinePage<T> = { items: T[]; next?: TimelineCursor };

export function useTimelineHeadRefresh<T>({ queryKey, pageCount, interval, fetchPage, getItemKey }: {
  queryKey: QueryKey;
  pageCount: number;
  interval: number | false;
  fetchPage: (signal: AbortSignal) => Promise<TimelinePage<T>>;
  getItemKey?: (item: T) => string;
}) {
  const client = useQueryClient();
  useQuery({
    queryKey: ["timeline-head", queryKey],
    enabled: pageCount > 1 && interval !== false,
    // A successful pagination click already has fresh data. Wait for the
    // first periodic tick instead of immediately rereading its first page.
    initialData: null,
    staleTime: Infinity,
    refetchOnMount: false,
    refetchInterval: interval,
    refetchOnWindowFocus: false,
    refetchOnReconnect: false,
    retry: false,
    queryFn: async ({ signal }) => {
      const previous = client.getQueryData<InfiniteData<TimelinePage<T>>>(queryKey);
      if (!previous || previous.pages.length <= 1 || client.isFetching({ queryKey, exact: true })) return null;
      const first = await fetchPage(signal);
      if (signal.aborted || client.getQueryData(queryKey) !== previous || client.isFetching({ queryKey, exact: true })) return null;

      const cursor = previous.pages[0].next;
      const cursorMoved = cursor?.id !== first.next?.id || cursor?.created_at !== first.next?.created_at;
      const headKeys = getItemKey && new Set(first.items.map(getItemKey));
      const overlapsTail = headKeys && getItemKey && previous.pages.slice(1).some(page =>
        page.items.some(item => headKeys.has(getItemKey(item))));
      if (cursorMoved || overlapsTail) {
        // A promoted group can move across pages without moving the cursor.
        // Refetch the tail so its older copy cannot override the fresh head.
        void client.invalidateQueries({ queryKey, exact: true });
      } else {
        client.setQueryData(queryKey, { ...previous, pages: [first, ...previous.pages.slice(1)] });
      }
      return null;
    },
  });
}
