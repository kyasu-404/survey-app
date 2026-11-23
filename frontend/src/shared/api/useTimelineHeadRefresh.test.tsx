import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
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
