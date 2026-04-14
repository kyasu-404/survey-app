import { afterEach, describe, expect, it, vi } from "vitest";
import {
  fetchDashboardFormsPage,
  fetchDashboardFormsStats,
  fetchForms,
  fetchTemplateFormsPage,
  insertForm,
  updateFormResponseLimit,
} from "./formsApi";
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
    neq: vi.fn(() => query),
    not: vi.fn(() => query),
    or: vi.fn(() => query),
    range: vi.fn(() => query),
    then: vi.fn(() => undefined),
  };

  return query;
}

function createSummaryQuery(response: { data?: unknown[] | null; count?: number | null; error: unknown | null }) {
  const query = {
    select: vi.fn(() => query),
    order: vi.fn(() => query),
    ilike: vi.fn(() => query),
    gte: vi.fn(() => query),
    lte: vi.fn(() => query),
    eq: vi.fn(() => query),
    neq: vi.fn(() => query),
    not: vi.fn(() => query),
    or: vi.fn(() => query),
    range: vi.fn(() => Promise.resolve(response)),
    then: (resolve: (value: unknown) => unknown, reject: (reason?: unknown) => unknown) =>
      Promise.resolve(response).then(resolve, reject),
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
    vi.resetAllMocks();
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

  it("reads the cached responses counter from forms instead of aggregate embedding responses", async () => {
    const listQuery = {
      select: vi.fn(() => listQuery),
      order: vi.fn(() => Promise.resolve({ data: [], error: null })),
      ilike: vi.fn(() => listQuery),
      gte: vi.fn(() => listQuery),
      lte: vi.fn(() => listQuery),
      eq: vi.fn(() => listQuery),
    };

    vi.mocked(apiClient.from).mockReturnValue(listQuery as never);

    await fetchForms();

    expect(listQuery.select).toHaveBeenCalledWith("*, profiles:author_id(email, name)");
  });
});

describe("fetchDashboardFormsPage", () => {
  afterEach(() => {
    vi.resetAllMocks();
  });

  it("fetches lightweight dashboard cards with exact count and server range", async () => {
    const listQuery = createSummaryQuery({
      data: [
        {
          id: "form-1",
          title: "Dashboard form",
          form_type: "anketa",
          form_reason: "plan",
          is_public: true,
          deadline_at: "2026-05-01T12:00:00.000Z",
          max_responses: 50,
          author_id: "user-1",
          created_at: "2026-04-01T10:00:00.000Z",
          responses_count: 3,
          profiles: { email: "author@example.com", name: "Автор" },
        },
      ],
      count: 41,
      error: null,
    });

    vi.mocked(apiClient.from).mockReturnValue(listQuery as never);

    await expect(
      fetchDashboardFormsPage({
        page: 1,
        pageSize: 20,
        filters: {
          authorId: "user-1",
          search: "дашборд",
        },
      }),
    ).resolves.toEqual({
      items: [
        expect.objectContaining({
          id: "form-1",
          author_email: "author@example.com",
          author_name: "Автор",
          responses_count: 3,
        }),
      ],
      totalCount: 41,
    });

    expect(listQuery.select).toHaveBeenCalledWith(
      expect.stringContaining("profiles:author_id!inner(email, name)"),
      { count: "exact" },
    );
    expect(listQuery.select).toHaveBeenCalledWith(
      expect.not.stringContaining("schema"),
      { count: "exact" },
    );
    expect(listQuery.neq).toHaveBeenCalledWith("form_type", "template");
    expect(listQuery.range).toHaveBeenCalledWith(20, 39);
  });

  it("applies expired deadline state locally in dashboard summaries", async () => {
    const listQuery = createSummaryQuery({
      data: [
        {
          id: "form-1",
          title: "Expired summary",
          form_type: "anketa",
          form_reason: "plan",
          is_public: true,
          deadline_at: "2020-01-01T00:00:00.000Z",
          max_responses: null,
          author_id: "user-1",
          created_at: "2020-01-01T00:00:00.000Z",
          responses_count: 0,
          profiles: null,
        },
      ],
      count: 1,
      error: null,
    });

    vi.mocked(apiClient.from).mockReturnValue(listQuery as never);

    await expect(
      fetchDashboardFormsPage({
        page: 0,
        pageSize: 20,
      }),
    ).resolves.toEqual({
      items: [
        expect.objectContaining({
          id: "form-1",
          is_public: false,
          deadline_at: null,
        }),
      ],
      totalCount: 1,
    });
  });
});

describe("fetchTemplateFormsPage", () => {
  afterEach(() => {
    vi.resetAllMocks();
  });

  it("fetches lightweight template cards without schema payload", async () => {
    const listQuery = createSummaryQuery({
      data: [
        {
          id: "template-1",
          title: "Шаблон",
          form_type: "template",
          form_reason: "plan",
          is_public: true,
          author_id: "user-1",
          created_at: "2026-04-01T10:00:00.000Z",
          profiles: { email: "author@example.com", name: "Автор" },
        },
      ],
      count: 9,
      error: null,
    });

    vi.mocked(apiClient.from).mockReturnValue(listQuery as never);

    await expect(
      fetchTemplateFormsPage({
        page: 0,
        pageSize: 24,
        filters: {
          isPublic: true,
          formType: "template",
        },
      }),
    ).resolves.toEqual({
      items: [
        expect.objectContaining({
          id: "template-1",
          author_email: "author@example.com",
          author_name: "Автор",
        }),
      ],
      totalCount: 9,
    });

    expect(listQuery.select).toHaveBeenCalledWith(
      expect.stringContaining("profiles:author_id!inner(email, name)"),
      { count: "exact" },
    );
    expect(listQuery.select).toHaveBeenCalledWith(
      expect.not.stringContaining("schema"),
      { count: "exact" },
    );
    expect(listQuery.range).toHaveBeenCalledWith(0, 23);
  });
});

describe("fetchDashboardFormsStats", () => {
  afterEach(() => {
    vi.resetAllMocks();
  });

  it("requests exact counts for total, active, and deadline-filtered forms", async () => {
    const totalQuery = createSummaryQuery({ data: null, count: 25, error: null });
    const activeQuery = createSummaryQuery({ data: null, count: 18, error: null });
    const deadlineQuery = createSummaryQuery({ data: null, count: 7, error: null });

    vi.mocked(apiClient.from)
      .mockReturnValueOnce(totalQuery as never)
      .mockReturnValueOnce(activeQuery as never)
      .mockReturnValueOnce(deadlineQuery as never);

    await expect(
      fetchDashboardFormsStats({
        authorId: "user-1",
        search: "автор",
      }),
    ).resolves.toEqual({
      totalCount: 25,
      activeCount: 18,
      formsWithDeadlineCount: 7,
    });

    expect(totalQuery.select).toHaveBeenCalledWith(
      expect.stringContaining("profiles:author_id!inner(id)"),
      { count: "exact", head: true },
    );
    expect(activeQuery.eq).toHaveBeenCalledWith("is_public", true);
    expect(deadlineQuery.not).toHaveBeenCalledWith("deadline_at", "is", null);
  });
});

describe("insertForm", () => {
  afterEach(() => {
    vi.resetAllMocks();
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
    vi.resetAllMocks();
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
