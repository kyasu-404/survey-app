import { beforeEach, describe, expect, it, vi } from "vitest";
import { apiClient } from "../../shared/api/client";
import { getFormOrganizations, getOrganizations, getSavedFormOrganizations } from "./api";

vi.mock("../../shared/api/client", () => ({ apiClient: { from: vi.fn(), rpc: vi.fn() } }));

function mockPages(rows: Array<{ id: string }>, onPage?: (from: number) => void) {
  let offset = 0;
  const query = {
    eq: vi.fn(() => query), select: vi.fn(() => query), order: vi.fn(() => query), in: vi.fn(() => query),
    range: vi.fn((from: number) => { offset = from; return query; }),
    abortSignal: vi.fn(() => {
      onPage?.(offset);
      return Promise.resolve({ data: rows.slice(offset, offset + 1000), error: null });
    }),
  };
  vi.mocked(apiClient.from).mockReturnValue(query as never);
  vi.mocked(apiClient.rpc).mockReturnValue(query as never);
  return query;
}

describe("organization list pagination", () => {
  beforeEach(() => vi.clearAllMocks());

  it("keeps a small directory to one request", async () => {
    const rows = [{ id: "school-1" }, { id: "school-2" }];
    const query = mockPages(rows);
    expect(await getOrganizations(["school"])).toEqual(rows);
    expect(query.range).toHaveBeenCalledOnce();
    expect(query.eq).toHaveBeenCalledWith("is_archived", false);
    expect(query.in).toHaveBeenCalledWith("organization_type", ["school"]);
  });

  it.each(["directory", "form"])("loads every row beyond the API cap for the %s", async (kind) => {
    const rows = Array.from({ length: 1005 }, (_, index) => ({ id: String(index) }));
    const query = mockPages(rows);
    const result = kind === "directory" ? await getOrganizations() : await getFormOrganizations("form-1");
    expect(result).toEqual(rows);
    expect(query.range.mock.calls).toEqual([[0, 999], [1000, 1999]]);
  });

  it("stops before requesting another page when navigation cancels the request", async () => {
    const controller = new AbortController();
    const query = mockPages(Array.from({ length: 1000 }, (_, index) => ({ id: String(index) })), () => controller.abort());
    await expect(getOrganizations(undefined, controller.signal)).rejects.toThrow();
    expect(query.range).toHaveBeenCalledOnce();
  });
});

it("includes archived organizations only when historical names are requested", async () => {
  const query = mockPages([{ id: "archive-1" }]);
  expect(await getOrganizations(undefined, undefined, true)).toEqual([{ id: "archive-1" }]);
  expect(query.eq).not.toHaveBeenCalled();
});

it("loads saved organizations using the browser capability and paginates", async () => {
  const rows = Array.from({ length: 1005 }, (_, index) => ({ id: String(index) }));
  const query = mockPages(rows);
  expect(await getSavedFormOrganizations("form-1", "browser-1")).toEqual(rows);
  expect(apiClient.rpc).toHaveBeenCalledWith("list_saved_form_organizations", {
    p_form_id: "form-1", p_browser_id: "browser-1",
  });
  expect(query.range.mock.calls).toEqual([[0, 999], [1000, 1999]]);
});
