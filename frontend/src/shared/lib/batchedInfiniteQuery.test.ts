import { InfiniteQueryObserver, QueryClient } from "@tanstack/react-query";
import { afterEach, expect, it, vi } from "vitest";
import type { FormsCursor, SurveyFormSummary } from "../../entities/survey/types";
import { createBatchedFormsQuery, getFormsNextCursor } from "./batchedInfiniteQuery";

const clients: QueryClient[] = [];
afterEach(() => clients.splice(0).forEach((client) => client.clear()));

function row(index: number): SurveyFormSummary {
  return { id: String(index).padStart(8, "0"), created_at: "2026-09-08T10:00:00.123456+00:00" } as SurveyFormSummary;
}

function setup(count = 220) {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  clients.push(client);
  let rows = Array.from({ length: count }, (_, index) => row(count - index));
  const fetch = vi.fn(async ({ cursor, pageSize }: { cursor: FormsCursor | null; pageSize: number }) => {
    const remaining = cursor ? rows.filter((row) => row.created_at < cursor.createdAt || (row.created_at === cursor.createdAt && row.id < cursor.id)) : rows;
    return { items: remaining.slice(0, pageSize), hasMore: remaining.length > pageSize, totalCount: Math.min(remaining.length, pageSize + 1) };
  });
  const observer = new InfiniteQueryObserver(client, {
    queryKey: ["forms"], initialPageParam: null as FormsCursor | null,
    queryFn: createBatchedFormsQuery(client, ["forms"], 20, fetch),
    getNextPageParam: getFormsNextCursor,
  });
  return { client, observer, fetch, setRows: (next: SurveyFormSummary[]) => { rows = next; }, getRows: () => rows };
}

it("loads more by cursor, then refreshes 200 visible cards with one request", async () => {
  const { observer, fetch, getRows } = setup();
  await observer.refetch();
  for (let page = 1; page < 10; page++) await observer.fetchNextPage();
  expect(fetch).toHaveBeenCalledTimes(10);
  expect(fetch.mock.calls[9][0]).toMatchObject({ cursor: { id: getRows()[179].id }, pageSize: 20 });
  fetch.mockClear();
  await observer.refetch();
  expect(fetch).toHaveBeenCalledOnce();
  expect(fetch.mock.calls[0][0]).toMatchObject({ cursor: null, pageSize: 200 });
  expect(observer.getCurrentResult().data?.pages.flatMap((page) => page.items)).toHaveLength(200);
  await observer.fetchNextPage();
  expect(fetch.mock.calls[1][0]).toMatchObject({ cursor: { id: getRows()[199].id }, pageSize: 20 });
});

it("reconciles inserts and deletes across page boundaries on refresh", async () => {
  const { observer, getRows, setRows } = setup(60);
  await observer.refetch();
  await observer.fetchNextPage();
  const rows = [row(100), ...getRows().filter((row) => row.id !== getRows()[25].id)];
  setRows(rows);
  await observer.refetch();
  expect(observer.getCurrentResult().data?.pages.flatMap((page) => page.items)).toEqual(rows.slice(0, 40));
  await observer.fetchNextPage();
  expect(observer.getCurrentResult().data?.pages.flatMap((page) => page.items)).toEqual(rows);
  setRows(rows.slice(0, 7));
  await observer.refetch();
  expect(observer.getCurrentResult().data?.pages).toHaveLength(1);
  expect(observer.getCurrentResult().hasNextPage).toBe(false);
});

it("continues without duplicates or omissions when newer rows and the cursor row are deleted before loading more", async () => {
  const { observer, getRows, setRows } = setup(60);
  const original = getRows();
  await observer.refetch();
  setRows([row(100), ...original.filter((_, index) => index !== 0 && index !== 19)]);
  await observer.fetchNextPage();
  expect(observer.getCurrentResult().data?.pages[1].items).toEqual(original.slice(20, 40));
  expect(observer.getCurrentResult().data?.pageParams[1]).toEqual({ createdAt: original[19].created_at, id: original[19].id });
});

it("refreshes more than 1000 cards in bounded batches using the last returned key", async () => {
  const { observer, fetch, getRows } = setup(1100);
  await observer.refetch();
  for (let page = 1; page < 51; page++) await observer.fetchNextPage();
  fetch.mockClear();
  await observer.refetch();
  expect(fetch.mock.calls.map(([request]) => [request.cursor?.id ?? null, request.pageSize])).toEqual([[null, 999], [getRows()[998].id, 21]]);
  expect(observer.getCurrentResult().data?.pages.flatMap((page) => page.items)).toEqual(getRows().slice(0, 1020));
  await observer.fetchNextPage();
  expect(observer.getCurrentResult().data?.pages.flatMap((page) => page.items)).toEqual(getRows().slice(0, 1040));
});

it("keeps the previous complete window if a later batch fails and retries all batches", async () => {
  const { observer, fetch, getRows } = setup(1100);
  await observer.refetch();
  for (let page = 1; page < 51; page++) await observer.fetchNextPage();
  const previous = observer.getCurrentResult().data;
  fetch.mockImplementationOnce(async () => ({ items: getRows().slice(0, 999), hasMore: true, totalCount: 1000 }));
  fetch.mockRejectedValueOnce(new Error("network failed"));
  await observer.refetch();
  expect(observer.getCurrentResult().data).toBe(previous);
  expect(observer.getCurrentResult().isError).toBe(true);
  await observer.refetch();
  expect(observer.getCurrentResult().isSuccess).toBe(true);
});

it("stops a multi-batch refresh when cancelled without changing the cached window", async () => {
  const { client, getRows } = setup(1100);
  const previous = { pages: Array.from({ length: 51 }, (_, i) => ({ items: getRows().slice(i * 20, i * 20 + 20), hasMore: true, totalCount: 1100 })) };
  client.setQueryData(["forms"], previous);
  const controller = new AbortController();
  const fetch = vi.fn(async () => {
    controller.abort();
    return { items: getRows().slice(0, 999), hasMore: true, totalCount: 1000 };
  });
  const query = createBatchedFormsQuery(client, ["forms"], 20, fetch);
  await expect(query({ pageParam: null, signal: controller.signal })).rejects.toThrow();
  expect(fetch).toHaveBeenCalledOnce();
  expect(client.getQueryData(["forms"])).toEqual(previous);
});

it.each([0, 20, 40])("terminates exactly for %s rows without an extra page", async (count) => {
  const { observer, getRows } = setup(count);
  await observer.refetch();
  while (observer.getCurrentResult().hasNextPage) await observer.fetchNextPage();
  expect(observer.getCurrentResult().data?.pages.flatMap((page) => page.items)).toEqual(getRows());
  const pages = observer.getCurrentResult().data?.pages ?? [];
  expect(pages[pages.length - 1]?.totalCount).toBe(count);
});
