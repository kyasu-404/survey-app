import { afterEach, describe, expect, it, vi } from "vitest";
import { fetchForms, insertForm, updateFormResponseLimit } from "./formsApi";
import { apiClient } from "./client";

vi.mock("./client", () => ({
  apiClient: {
    auth: {
      getCurrentUser: vi.fn(),
    },
    from: vi.fn(),
  },
  publicApiClient: {
    from: vi.fn(),
  },
}));

function createHangingQuery() {
  const query = {
    select: vi.fn(() => query),
    order: vi.fn(() => query),
    ilike: vi.fn(() => query),
    gte: vi.fn(() => query),
    lte: vi.fn(() => query),
    eq: vi.fn(() => query),
    then: vi.fn(() => undefined),
  };

  return query;
}

function createInsertQuery() {
  const query = {
    insert: vi.fn(() => query),
    select: vi.fn(() => query),
    single: vi.fn(() => Promise.resolve({ data: { id: "created-form" }, error: null })),
  };

  return query;
}

function createUpdateQuery() {
  const query = {
    update: vi.fn(() => query),
    eq: vi.fn(() => Promise.resolve({ error: null })),
  };

  return query;
}

describe("fetchForms", () => {
  afterEach(() => {
    vi.useRealTimers();
    vi.clearAllMocks();
  });

  it("rejects with timeout instead of hanging forever", async () => {
    vi.useFakeTimers();
    vi.mocked(apiClient.from).mockReturnValue(createHangingQuery() as never);

    const fetchStatePromise = Promise.race([
      fetchForms().then(
        () => "resolved",
        () => "rejected",
      ),
      new Promise<string>((resolve) => {
        setTimeout(() => resolve("test-timeout"), 20_000);
      }),
    ]);

    await vi.advanceTimersByTimeAsync(20_000);

    await expect(fetchStatePromise).resolves.toBe("rejected");
  });

  it("applies expired deadline state locally without updating forms during reads", async () => {
    const listQuery = {
      select: vi.fn(() => listQuery),
      order: vi.fn(() => listQuery),
      ilike: vi.fn(() => listQuery),
      gte: vi.fn(() => listQuery),
      lte: vi.fn(() => listQuery),
      eq: vi.fn(() => listQuery),
      then: (resolve: (value: unknown) => unknown, reject: (reason?: unknown) => unknown) =>
        Promise.resolve({
          data: [
            {
              id: "form-1",
              title: "Expired",
              form_type: "anketa",
              form_reason: "plan",
              is_public: true,
              deadline_at: "2020-01-01T00:00:00.000Z",
              author_id: "user-1",
              schema: { pages: [] },
              created_at: "2020-01-01T00:00:00.000Z",
              profiles: null,
              responses: [{ count: 0 }],
            },
          ],
          error: null,
        }).then(resolve, reject),
    };

    vi.mocked(apiClient.from).mockReturnValue(listQuery as never);

    await expect(fetchForms()).resolves.toEqual([
      expect.objectContaining({
        id: "form-1",
        is_public: false,
        deadline_at: null,
      }),
    ]);

    expect(apiClient.from).toHaveBeenCalledTimes(1);
  });
});

describe("insertForm", () => {
  afterEach(() => {
    vi.clearAllMocks();
  });

  it("creates templates unpublished by default", async () => {
    const query = createInsertQuery();
    vi.mocked(apiClient.auth.getCurrentUser).mockResolvedValue({ data: { user: { id: "user-1" } } } as never);
    vi.mocked(apiClient.from).mockReturnValue(query as never);

    await insertForm({
      title: "Template",
      formType: "template",
      formReason: "plan",
      schema: { pages: [] },
      authorId: "user-1",
    });

    expect(query.insert).toHaveBeenCalledWith(
      expect.objectContaining({
        form_type: "template",
        is_public: false,
      }),
    );
  });

  it("keeps regular forms public by default", async () => {
    const query = createInsertQuery();
    vi.mocked(apiClient.auth.getCurrentUser).mockResolvedValue({ data: { user: { id: "user-1" } } } as never);
    vi.mocked(apiClient.from).mockReturnValue(query as never);

    await insertForm({
      title: "Form",
      formType: "anketa",
      formReason: "plan",
      schema: { pages: [] },
      authorId: "user-1",
    });

    expect(query.insert).toHaveBeenCalledWith(
      expect.objectContaining({
        form_type: "anketa",
        is_public: true,
      }),
    );
  });
});

describe("updateFormResponseLimit", () => {
  afterEach(() => {
    vi.clearAllMocks();
  });

  it("persists a numeric maximum response limit", async () => {
    const query = createUpdateQuery();
    vi.mocked(apiClient.from).mockReturnValue(query as never);

    await updateFormResponseLimit("form-1", 25);

    expect(query.update).toHaveBeenCalledWith({ max_responses: 25 });
    expect(query.eq).toHaveBeenCalledWith("id", "form-1");
  });

  it("clears the maximum response limit", async () => {
    const query = createUpdateQuery();
    vi.mocked(apiClient.from).mockReturnValue(query as never);

    await updateFormResponseLimit("form-1", null);

    expect(query.update).toHaveBeenCalledWith({ max_responses: null });
    expect(query.eq).toHaveBeenCalledWith("id", "form-1");
  });
});
