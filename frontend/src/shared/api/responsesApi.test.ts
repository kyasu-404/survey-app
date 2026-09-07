import { afterEach, describe, expect, it, vi } from "vitest";
import { fetchAllResponsesByForm, fetchExistingResponse, fetchResponsesByForm, insertResponse, updateResponse } from "./responsesApi";
import { apiClient } from "./client";

vi.mock("./client", () => ({
  apiClient: {
    from: vi.fn(),
    rpc: vi.fn(),
    auth: { getCurrentSession: vi.fn() },
  },
  supabaseClient: { functions: { invoke: vi.fn() } },
}));

function createHangingInsert() {
  return {
    then: vi.fn(() => undefined),
  };
}

describe("insertResponse", () => {
  afterEach(() => {
    vi.useRealTimers();
    vi.clearAllMocks();
  });

  it("fails with timeout instead of leaving submit pending forever", async () => {
    vi.useFakeTimers();
    vi.mocked(apiClient.rpc).mockReturnValue(createHangingInsert() as never);

    const mutationStatePromise = Promise.race([
      insertResponse(
        "form-1",
        { q1: "yes" },
        "123e4567-e89b-42d3-a456-426614174000",
        "223e4567-e89b-42d3-a456-426614174000",
      ).then(
        () => "resolved",
        () => "rejected",
      ),
      new Promise<string>((resolve) => {
        setTimeout(() => resolve("test-timeout"), 20_000);
      }),
    ]);

    await vi.advanceTimersByTimeAsync(20_000);

    await expect(mutationStatePromise).resolves.toBe("rejected");
  });

  it("submits with a persistent browser id and forwards cancellation", async () => {
    const signal = new AbortController().signal;
    const query = {
      abortSignal: vi.fn(() => Promise.resolve({
        data: [{
          status: "already_submitted",
          response_id: "response-1",
          response_data: { q1: "first answer" },
          response_editable: true,
        }],
        error: null,
      })),
    };
    vi.mocked(apiClient.rpc).mockReturnValue(query as never);

    await expect(
      insertResponse(
        "form-1",
        { q1: "yes" },
        "123e4567-e89b-42d3-a456-426614174000",
        "223e4567-e89b-42d3-a456-426614174000",
        signal,
      ),
    ).resolves.toEqual({
      status: "already_submitted",
      responseId: "response-1",
      data: { q1: "first answer" },
      editable: true,
    });

    expect(apiClient.rpc).toHaveBeenCalledWith("submit_form_response", {
      p_form_id: "form-1",
      p_browser_id: "223e4567-e89b-42d3-a456-426614174000",
      p_submission_id: "123e4567-e89b-42d3-a456-426614174000",
      p_data: { q1: "yes" },
    });
    expect(query.abortSignal).toHaveBeenCalledWith(expect.any(AbortSignal));
  });

  it("updates only the response that matches the browser capability", async () => {
    vi.mocked(apiClient.rpc).mockResolvedValue({
      data: [{ response_id: "response-1", response_data: { q1: "updated" } }],
      error: null,
    } as never);

    await expect(updateResponse(
      "form-1",
      "response-1",
      { q1: "updated" },
      "223e4567-e89b-42d3-a456-426614174000",
    )).resolves.toEqual({ responseId: "response-1", data: { q1: "updated" } });

    expect(apiClient.rpc).toHaveBeenCalledWith("update_form_response", expect.objectContaining({
      p_response_id: "response-1",
      p_browser_id: "223e4567-e89b-42d3-a456-426614174000",
    }));
  });
});

describe("fetchExistingResponse", () => {
  afterEach(() => {
    vi.clearAllMocks();
  });

  it("checks the browser response without submitting new data", async () => {
    vi.mocked(apiClient.rpc).mockResolvedValue({
      data: [{
        response_id: "response-1",
        response_data: { q1: "saved" },
        response_editable: true,
      }],
      error: null,
    } as never);

    await expect(fetchExistingResponse(
      "form-1",
      "223e4567-e89b-42d3-a456-426614174000",
    )).resolves.toEqual({
      responseId: "response-1",
      data: { q1: "saved" },
      editable: true,
    });

    expect(apiClient.rpc).toHaveBeenCalledWith("get_form_response_status", {
      p_form_id: "form-1",
      p_browser_id: "223e4567-e89b-42d3-a456-426614174000",
    });
  });

  it("returns null when this browser has not submitted the form", async () => {
    vi.mocked(apiClient.rpc).mockResolvedValue({ data: [], error: null } as never);

    await expect(fetchExistingResponse("form-1", "browser-1")).resolves.toBeNull();
  });
});

describe("fetchResponsesByForm", () => {
  afterEach(() => {
    vi.clearAllMocks();
  });

  it("loads a bounded response page with an exact total count", async () => {
    const response = {
      id: "response-1",
      form_id: "form-1",
      created_at: "2026-04-08T11:30:00.000Z",
      data: { name: "Анна" },
    };
    const query = {
      select: vi.fn(() => query),
      eq: vi.fn(() => query),
      order: vi.fn(() => query),
      abortSignal: vi.fn((_signal: AbortSignal) => query),
      range: vi.fn(() => Promise.resolve({ data: [response], count: 72, error: null })),
    };
    vi.mocked(apiClient.from).mockReturnValue(query as never);

    await expect(fetchResponsesByForm("form-1", { page: 2, pageSize: 25 })).resolves.toEqual({
      data: [response],
      count: 72,
      page: 2,
      pageSize: 25,
      totalPages: 3,
    });

    expect(query.select).toHaveBeenCalledWith(
      "id, form_id, data, created_at, updated_at",
      { count: "exact" },
    );
    expect(query.eq).toHaveBeenCalledWith("form_id", "form-1");
    expect(query.order).toHaveBeenCalledWith("created_at", { ascending: false });
    expect(query.order).toHaveBeenCalledWith("id", { ascending: false });
    expect(query.range).toHaveBeenCalledWith(25, 49);
  });

  it("passes abort signals to response page requests", async () => {
    const signal = new AbortController().signal;
    const query = {
      select: vi.fn(() => query),
      eq: vi.fn(() => query),
      order: vi.fn(() => query),
      abortSignal: vi.fn((_signal: AbortSignal) => query),
      range: vi.fn(() => Promise.resolve({ data: [], count: 0, error: null })),
    };
    vi.mocked(apiClient.from).mockReturnValue(query as never);

    await fetchResponsesByForm("form-1", { page: 1, pageSize: 25, signal });

    expect(query.abortSignal).toHaveBeenCalledOnce();
    expect(query.abortSignal.mock.calls[0]?.[0]).toMatchObject({ aborted: false });
  });

  it("rejects a missing count instead of treating one page as the complete list", async () => {
    const query = {
      select: vi.fn(() => query), eq: vi.fn(() => query), order: vi.fn(() => query), abortSignal: vi.fn(() => query),
      range: vi.fn(async () => ({ data: [], count: null, error: null })),
    };
    vi.mocked(apiClient.from).mockReturnValue(query as never);
    await expect(fetchResponsesByForm("form-1")).rejects.toThrow("точное количество ответов");
  });
});


describe("fetchAllResponsesByForm", () => {
  afterEach(() => vi.clearAllMocks());

  function mockRows(total: number, onPage?: (offset: number) => void) {
    const rows = Array.from({ length: total }, (_, index) => ({ id: String(index), form_id: "form-1", data: {}, created_at: "2026-09-07T00:00:00Z" }));
    const query = {
      select: vi.fn(() => query), eq: vi.fn(() => query), order: vi.fn(() => query), abortSignal: vi.fn(() => query),
      range: vi.fn(async (from: number, to: number) => {
        onPage?.(from);
        if (from > 0 && from >= total) throw new Error("PGRST103: requested range not satisfiable");
        return { data: rows.slice(from, to + 1), count: total, error: null };
      }),
    };
    vi.mocked(apiClient.from).mockReturnValue(query as never);
    return { query, rows };
  }

  it.each([0, 50, 100, 200, 250])("returns all %i responses including full page boundaries", async (total) => {
    const { rows, query } = mockRows(total);
    expect(await fetchAllResponsesByForm("form-1")).toEqual(rows);
    expect(query.range).toHaveBeenCalledTimes(Math.max(1, Math.ceil(total / 100)));
  });

  it("cancels between batches without returning partial results", async () => {
    const controller = new AbortController();
    const { query } = mockRows(200, () => controller.abort());
    await expect(fetchAllResponsesByForm("form-1", { signal: controller.signal })).rejects.toThrow();
    expect(query.range).toHaveBeenCalledOnce();
  });

  it("rejects a failed later page instead of treating the first page as the full list", async () => {
    const { query, rows } = mockRows(200);
    query.range.mockResolvedValueOnce({ data: rows.slice(0, 100), count: 200, error: null });
    query.range.mockRejectedValueOnce(new Error("page failed"));
    await expect(fetchAllResponsesByForm("form-1")).rejects.toThrow("page failed");
  });
});
