import { InfiniteQueryObserver, QueryClient } from "@tanstack/react-query";
import { afterEach, expect, it, vi } from "vitest";
import type { SurveyFormSummary } from "../../entities/survey/types";
import { createBatchedFormsQuery } from "./batchedInfiniteQuery";

const clients: QueryClient[] = [];
afterEach(() => clients.splice(0).forEach((client) => client.clear()));

function setup(count = 220) {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  clients.push(client);
  let rows = Array.from({ length: count }, (_, index) => ({ id: `${index}` } as SurveyFormSummary));
  const fetch = vi.fn(async ({ page, pageSize, offset = page * pageSize }: { page: number; pageSize: number; offset?: number }) => ({
    items: rows.slice(offset, offset + pageSize), hasMore: offset + pageSize < rows.length, totalCount: rows.length,
  }));
  const observer = new InfiniteQueryObserver(client, {
    queryKey: ["forms"], initialPageParam: 0,
    queryFn: createBatchedFormsQuery(client, ["forms"], 20, fetch),
    getNextPageParam: (lastPage, pages) => lastPage.hasMore ? pages.length : undefined,
  });
  return { client, observer, fetch, setRows: (next: SurveyFormSummary[]) => { rows = next; }, getRows: () => rows };
}

it("loads more incrementally, then refreshes 200 visible cards with one request", async () => {
  const { observer, fetch } = setup();
  await observer.refetch();
  for (let page = 1; page < 10; page++) await observer.fetchNextPage();
  expect(fetch).toHaveBeenCalledTimes(10);
  expect(fetch.mock.calls[9][0]).toMatchObject({ page: 9, pageSize: 20 });
  fetch.mockClear();
  await observer.refetch();
  expect(fetch).toHaveBeenCalledOnce();
  expect(fetch.mock.calls[0][0]).toMatchObject({ page: 0, pageSize: 200 });
  expect(observer.getCurrentResult().data?.pages.flatMap((page) => page.items)).toHaveLength(200);
  await observer.fetchNextPage();
  expect(fetch.mock.calls[1][0]).toMatchObject({ page: 10, pageSize: 20 });
});

it("reconciles inserts and deletes across page boundaries without duplicates or lost cards", async () => {
  const { observer, getRows, setRows } = setup(60);
  await observer.refetch();
  await observer.fetchNextPage();
  const rows = [{ id: "new" } as SurveyFormSummary, ...getRows().filter((row) => row.id !== "25")];
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

it("respects the server cap when more than 1000 cards were opened", async () => {
  const { observer, fetch } = setup(1100);
  await observer.refetch();
  for (let page = 1; page < 51; page++) await observer.fetchNextPage();
  fetch.mockClear();
  await observer.refetch();
  expect(fetch.mock.calls.map(([request]) => [request.offset ?? 0, request.pageSize])).toEqual([[0, 999], [999, 21]]);
  expect(observer.getCurrentResult().data?.pages.flatMap((page) => page.items)).toHaveLength(1020);
});

it("keeps the previous complete window if a later batch fails and retries all batches", async () => {
  const { observer, fetch } = setup(1100);
  await observer.refetch();
  for (let page = 1; page < 51; page++) await observer.fetchNextPage();
  const previous = observer.getCurrentResult().data;
  fetch.mockImplementationOnce(async () => ({ items: Array.from({ length: 999 }, () => ({ id: "changed" } as SurveyFormSummary)), hasMore: true, totalCount: 1100 }));
  fetch.mockRejectedValueOnce(new Error("network failed"));
  await observer.refetch();
  expect(observer.getCurrentResult().data).toBe(previous);
  expect(observer.getCurrentResult().isError).toBe(true);
  await observer.refetch();
  expect(observer.getCurrentResult().isSuccess).toBe(true);
});
