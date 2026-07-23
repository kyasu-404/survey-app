import { afterEach, describe, expect, it, vi } from "vitest";
import { fetchResponsesByForm, insertResponse } from "./responsesApi";
import { apiClient } from "./client";

vi.mock("./client", () => ({
  apiClient: {
    from: vi.fn(),
  },
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
    vi.mocked(apiClient.from).mockReturnValue({
      insert: vi.fn(() => createHangingInsert()),
    } as never);

    const mutationStatePromise = Promise.race([
      insertResponse("form-1", { q1: "yes" }, "123e4567-e89b-42d3-a456-426614174000").then(
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

  it("treats a repeated idempotency key as success and forwards cancellation", async () => {
    const signal = new AbortController().signal;
    const query = {
      abortSignal: vi.fn(() => Promise.resolve({
        data: null,
        error: {
          code: "23505",
          message: 'duplicate key value violates unique constraint "idx_responses_form_submission_id"',
        },
      })),
    };
    const insert = vi.fn(() => query);
    vi.mocked(apiClient.from).mockReturnValue({ insert } as never);

    await expect(
      insertResponse("form-1", { q1: "yes" }, "123e4567-e89b-42d3-a456-426614174000", signal),
    ).resolves.toBeUndefined();

    expect(insert).toHaveBeenCalledWith(expect.objectContaining({
      form_id: "form-1",
      submission_id: "123e4567-e89b-42d3-a456-426614174000",
    }));
    expect(query.abortSignal).toHaveBeenCalledWith(expect.any(AbortSignal));
  });
});

describe("fetchResponsesByForm", () => {
  afterEach(() => {
    vi.clearAllMocks();
  });

  it("loads a bounded response page with a planned total count", async () => {
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

    expect(query.select).toHaveBeenCalledWith("*", { count: "planned" });
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
});
