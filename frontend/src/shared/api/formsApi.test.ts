import { afterEach, describe, expect, it, vi } from "vitest";
import { fetchForms, insertForm } from "./formsApi";
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
