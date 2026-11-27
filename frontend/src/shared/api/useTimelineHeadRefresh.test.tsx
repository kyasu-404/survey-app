import { QueryClient, QueryClientProvider, useInfiniteQuery } from "@tanstack/react-query";
import { renderHook, waitFor } from "@testing-library/react";
import type { PropsWithChildren } from "react";
import { expect, it, vi } from "vitest";
import { useTimelineHeadRefresh } from "./useTimelineHeadRefresh";

const key = ["timeline"];
const newer = { id: "newer", created_at: "2026-11-23T10:00:00Z", status: "scheduled" };
const older = { id: "older", created_at: "2026-11-22T10:00:00Z", status: "scheduled" };
const first = { items: [newer], next: { id: newer.id, created_at: newer.created_at } };
const tail = { items: [older], next: undefined };

function setup() {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  client.setQueryData(key, { pages: [first, tail], pageParams: [undefined, first.next] });
  const Wrapper = ({ children }: PropsWithChildren) => <QueryClientProvider client={client}>{children}</QueryClientProvider>;
  return { client, Wrapper };
}

it("refreshes changing head entries without rereading unchanged older pages", async () => {
  const { client, Wrapper } = setup();
  const invalidate = vi.spyOn(client, "invalidateQueries");
  const refreshed = { ...first, items: [{ ...newer, status: "published" }] };
  const fetch = vi.fn().mockResolvedValue(refreshed);
  renderHook(() => useTimelineHeadRefresh({ queryKey: key, pageCount: 2, interval: 90, fetchPage: fetch }), { wrapper: Wrapper });

  await waitFor(() => expect(client.getQueryData(key)).toEqual({ pages: [refreshed, tail], pageParams: [undefined, first.next] }));
  expect(fetch).toHaveBeenCalledOnce();
  expect(invalidate).not.toHaveBeenCalled();
});

it("reconciles pagination when a changed announcement moves the cursor", async () => {
  const { client, Wrapper } = setup();
  const invalidate = vi.spyOn(client, "invalidateQueries");
  const fetch = vi.fn().mockResolvedValue({ items: [older], next: undefined });
  renderHook(() => useTimelineHeadRefresh({ queryKey: key, pageCount: 2, interval: 90, fetchPage: fetch }), { wrapper: Wrapper });

  await waitFor(() => expect(invalidate).toHaveBeenCalledWith({ queryKey: key, exact: true }));
  expect(fetch).toHaveBeenCalledOnce();
});

it("reconciles a promoted group with a stale tail even when the first page cursor has not changed", async () => {
  const { client, Wrapper } = setup();
  const removed = { ...newer, id: "removed", created_at: "2026-11-23T11:00:00Z" };
  const unaffectedTailItem = { ...older, id: "unaffected", created_at: "2026-11-21T10:00:00Z" };
  const staleGroup = { ...older, group: "form-responses-on-2026-11-22", count: 1 };
  const promotedGroup = { ...staleGroup, id: "latest", created_at: "2026-11-24T10:00:00Z", count: 2 };
  const head = { ...first, items: [promotedGroup, newer] };
  const oldHead = { ...first, items: [removed, newer] };
  const oldTail = { items: [staleGroup, unaffectedTailItem], next: undefined };
  const nextTail = { items: [unaffectedTailItem], next: undefined };
  client.setQueryData(key, { pages: [oldHead, oldTail], pageParams: [undefined, first.next] });
  const fetchPage = vi.fn().mockResolvedValue(head);

  renderHook(() => {
    useInfiniteQuery({
      queryKey: key,
      queryFn: ({ pageParam }) => Promise.resolve(pageParam ? nextTail : head),
      initialPageParam: undefined as typeof first.next | undefined,
      getNextPageParam: page => page.next,
      staleTime: Infinity,
    });
    useTimelineHeadRefresh({
      queryKey: key, pageCount: 2, interval: 90, fetchPage,
      getItemKey: (item: typeof newer & { group?: string }) => item.group ?? item.id,
    });
  }, { wrapper: Wrapper });

  await waitFor(() => expect(client.getQueryData(key)).toEqual({ pages: [head, nextTail], pageParams: [undefined, first.next] }));
});
