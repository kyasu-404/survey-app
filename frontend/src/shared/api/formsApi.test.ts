import { afterEach, describe, expect, it, vi } from "vitest";
import {
  fetchDashboardFormsPage,
  fetchDashboardFormsStats,
  fetchForms,
  fetchTemplateFormsPage,
  insertForm,
  deleteForm,
  updateFormStatus,
  updateFormResponseLimit,
  updateFormSchema,
  updateFormTitle,
} from "./formsApi";
import { apiClient, supabaseClient } from "./client";

vi.mock("./client", () => ({
  supabaseClient: {
    functions: {
      invoke: vi.fn(),
    },
  },
  apiClient: {
    auth: {
      getCurrentUser: vi.fn(),
      getCurrentSession: vi.fn(),
    },
    from: vi.fn(),
    rpc: vi.fn(),
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
    abortSignal: vi.fn((_signal: AbortSignal) => query),
    ilike: vi.fn(() => query),
    gte: vi.fn(() => query),
    lte: vi.fn(() => query),
    eq: vi.fn(() => query),
    neq: vi.fn(() => query),
    not: vi.fn(() => query),
    or: vi.fn(() => query),
    range: vi.fn(() => Promise.resolve(response)),
    limit: vi.fn(() => Promise.resolve(response)),
    then: (resolve: (value: unknown) => unknown, reject: (reason?: unknown) => unknown) =>
      Promise.resolve(response).then(resolve, reject),
  };

  return query;
}

function createRpcQuery(response: { data?: unknown[] | null; error: unknown | null }) {
  const query = {
    abortSignal: vi.fn(() => query),
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

function createSchemaReadQuery(response: { data?: unknown | null; error: unknown | null }) {
  const query = {
    select: vi.fn(() => query),
    eq: vi.fn(() => query),
    single: vi.fn(() => Promise.resolve(response)),
  };

  return query;
}

function createStatusUpdateQuery(response: { data?: unknown | null; error: unknown | null }) {
  const query = {
    update: vi.fn(() => query),
    eq: vi.fn(() => query),
    select: vi.fn(() => query),
    single: vi.fn(() => Promise.resolve(response)),
  };

  return query;
}

function createDeleteQuery() {
  const query = {
    delete: vi.fn(() => query),
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
      order: vi.fn(() => listQuery),
      ilike: vi.fn(() => listQuery),
      gte: vi.fn(() => listQuery),
      lte: vi.fn(() => listQuery),
      eq: vi.fn(() => listQuery),
      then: (resolve: (value: unknown) => unknown, reject: (reason?: unknown) => unknown) =>
        Promise.resolve({ data: [], error: null }).then(resolve, reject),
    };

    vi.mocked(apiClient.from).mockReturnValue(listQuery as never);

    await fetchForms();

    expect(listQuery.select).toHaveBeenCalledWith("*");
    expect(listQuery.order).toHaveBeenCalledWith("created_at", { ascending: false });
    expect(listQuery.order).toHaveBeenCalledWith("id", { ascending: false });
  });
});

describe("fetchDashboardFormsPage", () => {
  afterEach(() => {
    vi.resetAllMocks();
  });

  it.each([fetchDashboardFormsPage, fetchTemplateFormsPage])("seeks from a precise cursor and reserves a lookahead row", async (fetchPage) => {
    const listQuery = createSummaryQuery({ data: [], error: null });
    vi.mocked(apiClient.rpc).mockReturnValue(listQuery as never);
    const cursor = { createdAt: "2026-09-08T10:00:00.123456+00:00", id: "10000000-0000-4000-8000-000000000001" };
    await fetchPage({ cursor, pageSize: 21 });
    expect(apiClient.rpc).toHaveBeenCalledWith("list_forms_keyset", {
      p_before_created_at: cursor.createdAt, p_before_id: cursor.id,
    }, { get: true });
    expect(listQuery.limit).toHaveBeenCalledWith(22);
    expect(listQuery.range).not.toHaveBeenCalled();
  });

  it.each([0, -1, 1000, 1.5, NaN, Infinity])("rejects an invalid page size %s before requesting data", async (pageSize) => {
    await expect(fetchDashboardFormsPage({ pageSize })).rejects.toThrow("Размер страницы");
    expect(apiClient.rpc).not.toHaveBeenCalled();
  });

  it("requests one lookahead item after the first 20 newest dashboard forms", async () => {
    const listQuery = createSummaryQuery({
      data: [],
      count: 75,
      error: null,
    });

    vi.mocked(apiClient.rpc).mockReturnValue(listQuery as never);

    await expect(
      fetchDashboardFormsPage({
        pageSize: 20,
      }),
    ).resolves.toEqual({
      hasMore: false,
      items: [],
      totalCount: 0,
    });

    expect(listQuery.order).toHaveBeenCalledWith("created_at", { ascending: false });
    expect(listQuery.order).toHaveBeenCalledWith("id", { ascending: false });
    expect(listQuery.limit).toHaveBeenCalledWith(21);
    expect(apiClient.rpc).toHaveBeenCalledWith("list_forms_keyset", {}, { get: true });
  });

  it("uses the lookahead item to report another dashboard page without returning it", async () => {
    const data = Array.from({ length: 21 }, (_, index) => ({
      id: `form-${index + 1}`,
      title: `Form ${index + 1}`,
      form_type: "anketa",
      form_reason: "plan",
      is_public: true,
      deadline_at: null,
      max_responses: null,
      author_id: "user-1",
      author_name: "Автор",
      created_at: `2026-04-01T10:${String(index).padStart(2, "0")}:00.000Z`,
      responses_count: 0,
    }));
    const listQuery = createSummaryQuery({ data, count: null, error: null });

    vi.mocked(apiClient.rpc).mockReturnValue(listQuery as never);

    const result = await fetchDashboardFormsPage({ pageSize: 20 });

    expect(result.hasMore).toBe(true);
    expect(result.items).toHaveLength(20);
    expect(result.items[19]?.id).toBe("form-20");
    expect(result.totalCount).toBe(21);
  });

  it("passes abort signals to paginated dashboard requests", async () => {
    const signal = new AbortController().signal;
    const listQuery = createSummaryQuery({
      data: [],
      count: 0,
      error: null,
    });

    vi.mocked(apiClient.rpc).mockReturnValue(listQuery as never);

    await fetchDashboardFormsPage({
      pageSize: 20,
      signal,
    });

    expect(listQuery.abortSignal).toHaveBeenCalledOnce();
    expect(listQuery.abortSignal.mock.calls[0]?.[0]).toMatchObject({ aborted: false });
  });

  it("fetches lightweight dashboard cards without a planned count", async () => {
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
          author_name: "Автор",
          created_at: "2026-04-01T10:00:00.000Z",
          responses_count: 3,
        },
      ],
      count: 41,
      error: null,
    });

    vi.mocked(apiClient.rpc).mockReturnValue(listQuery as never);

    await expect(
      fetchDashboardFormsPage({
        cursor: { createdAt: "2026-04-02T10:00:00Z", id: "form-previous" },
        pageSize: 20,
        filters: {
          authorId: "user-1",
          search: "дашборд",
        },
      }),
    ).resolves.toEqual({
      hasMore: false,
      items: [
        expect.objectContaining({
          id: "form-1",
          author_name: "Автор",
          responses_count: 3,
        }),
      ],
      totalCount: 1,
    });

    expect(listQuery.select).toHaveBeenCalledWith(expect.stringContaining("author_name"));
    expect(listQuery.select).toHaveBeenCalledWith(expect.not.stringContaining("profiles:author_id"));
    expect(listQuery.neq).toHaveBeenCalledWith("form_type", "template");
    expect(listQuery.limit).toHaveBeenCalledWith(21);
  });

  it("applies both type and reason filters to dashboard queries", async () => {
    const listQuery = createSummaryQuery({
      data: [],
      count: 0,
      error: null,
    });

    vi.mocked(apiClient.rpc).mockReturnValue(listQuery as never);

    await fetchDashboardFormsPage({
      pageSize: 20,
      filters: {
        formType: "monitoring",
        formReason: "order",
      },
    });

    expect(listQuery.eq).toHaveBeenCalledWith("form_type", "monitoring");
    expect(listQuery.eq).toHaveBeenCalledWith("form_reason", "order");
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

    vi.mocked(apiClient.rpc).mockReturnValue(listQuery as never);

    await expect(
      fetchDashboardFormsPage({
        pageSize: 20,
      }),
    ).resolves.toEqual({
      hasMore: false,
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

  it("applies reached response limit state locally in dashboard summaries", async () => {
    const listQuery = createSummaryQuery({
      data: [
        {
          id: "form-1",
          title: "Limited summary",
          form_type: "anketa",
          form_reason: "plan",
          is_public: true,
          deadline_at: null,
          max_responses: 1,
          author_id: "user-1",
          created_at: "2026-04-18T10:00:00.000Z",
          responses_count: 1,
          profiles: null,
        },
      ],
      count: 1,
      error: null,
    });

    vi.mocked(apiClient.rpc).mockReturnValue(listQuery as never);

    await expect(
      fetchDashboardFormsPage({
        pageSize: 20,
      }),
    ).resolves.toEqual({
      hasMore: false,
      items: [
        expect.objectContaining({
          id: "form-1",
          is_public: false,
          max_responses: 1,
          responses_count: 1,
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

  it("fetches lightweight template cards with a lookahead item and without a planned count", async () => {
    const listQuery = createSummaryQuery({
      data: [
        {
          id: "template-1",
          title: "Шаблон",
          form_type: "template",
          form_reason: "plan",
          is_public: true,
          author_id: "user-1",
          author_name: "Автор",
          created_at: "2026-04-01T10:00:00.000Z",
        },
      ],
      count: 9,
      error: null,
    });

    vi.mocked(apiClient.rpc).mockReturnValue(listQuery as never);

    await expect(
      fetchTemplateFormsPage({
        pageSize: 24,
        filters: {
          isPublic: true,
          formType: "template",
        },
      }),
    ).resolves.toEqual({
      hasMore: false,
      items: [
        expect.objectContaining({
          id: "template-1",
          author_name: "Автор",
        }),
      ],
      totalCount: 1,
    });

    expect(listQuery.select).toHaveBeenCalledWith(expect.stringContaining("author_name"));
    expect(listQuery.select).toHaveBeenCalledWith(expect.not.stringContaining("profiles:author_id"));
    expect(listQuery.order).toHaveBeenCalledWith("created_at", { ascending: false });
    expect(listQuery.order).toHaveBeenCalledWith("id", { ascending: false });
    expect(listQuery.limit).toHaveBeenCalledWith(25);
  });
});

describe("fetchDashboardFormsStats", () => {
  afterEach(() => {
    vi.resetAllMocks();
  });

  it("requests dashboard stats through one aggregate rpc", async () => {
    const statsQuery = createRpcQuery({
      data: [
        {
          total_count: 25,
          active_count: 18,
          forms_with_deadline_count: 7,
        },
      ],
      error: null,
    });

    vi.mocked(apiClient.rpc).mockReturnValue(statsQuery as never);

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

    expect(apiClient.from).not.toHaveBeenCalled();
    expect(apiClient.rpc).toHaveBeenCalledWith("get_dashboard_forms_stats", {
      p_author_id: "user-1",
      p_date_from: null,
      p_date_to: null,
      p_form_reason: null,
      p_form_type: null,
      p_is_public: null,
      p_search: "автор",
    });
  });

  it("passes abort signals to dashboard stats rpc", async () => {
    const signal = new AbortController().signal;
    const statsQuery = createRpcQuery({
      data: [{ total_count: 25, active_count: 18, forms_with_deadline_count: 7 }],
      error: null,
    });

    vi.mocked(apiClient.rpc).mockReturnValue(statsQuery as never);

    await fetchDashboardFormsStats(undefined, { signal });

    expect(statsQuery.abortSignal).toHaveBeenCalledWith(expect.any(AbortSignal));
  });

  it("passes optional dashboard stats filters as nullable rpc params", async () => {
    const statsQuery = createRpcQuery({
      data: [{ total_count: 0, active_count: 0, forms_with_deadline_count: 0 }],
      error: null,
    });

    vi.mocked(apiClient.rpc).mockReturnValue(statsQuery as never);

    await fetchDashboardFormsStats({
      authorId: "user-1",
      dateFrom: "2026-04-01T00:00:00.000Z",
      dateTo: "2026-04-30T23:59:59.999Z",
      formReason: "plan",
      formType: "monitoring",
      isPublic: true,
    });

    expect(apiClient.rpc).toHaveBeenCalledWith("get_dashboard_forms_stats", {
      p_author_id: "user-1",
      p_date_from: "2026-04-01T00:00:00.000Z",
      p_date_to: "2026-04-30T23:59:59.999Z",
      p_form_reason: "plan",
      p_form_type: "monitoring",
      p_is_public: true,
      p_search: null,
    });
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

  it("deletes forms through the server cleanup function instead of direct table delete", async () => {
    const deleteQuery = createDeleteQuery();
    const invoke = vi.fn().mockResolvedValue({ data: { success: true }, error: null });

    vi.mocked(apiClient.auth.getCurrentSession).mockResolvedValue({
      data: {
        session: {
          access_token: "access-token",
        },
      },
      error: null,
    } as never);
    vi.mocked(apiClient.from).mockReturnValue(deleteQuery as never);

    const clientModule = await import("./client");
    vi.mocked(clientModule.supabaseClient.functions.invoke).mockImplementation(invoke);

    await deleteForm("form-1");

    expect(invoke).toHaveBeenCalledWith(
      "form-admin",
      expect.objectContaining({
        body: { action: "delete", formId: "form-1" },
        headers: expect.objectContaining({
          Authorization: "Bearer access-token",
        }),
      }),
    );
    expect(deleteQuery.delete).not.toHaveBeenCalled();
  });
});

describe("updateFormStatus", () => {
  afterEach(() => {
    vi.resetAllMocks();
  });

  it("clears a stale deadline while reopening a form", async () => {
    const query = createStatusUpdateQuery({
      data: {
        id: "form-1",
        title: "Form",
        form_type: "anketa",
        form_reason: "plan",
        is_public: true,
        deadline_at: null,
        max_responses: 4,
        author_id: "user-1",
        schema: { pages: [] },
        created_at: "2026-04-19T18:00:00.000Z",
        responses_count: 3,
      },
      error: null,
    });
    vi.mocked(apiClient.from).mockReturnValue(query as never);

    await updateFormStatus("form-1", true);

    expect(query.update).toHaveBeenCalledWith({ is_public: true, deadline_at: null });
    expect(query.eq).toHaveBeenCalledWith("id", "form-1");
    expect(query.select).toHaveBeenCalledWith("*");
  });

  it("rejects reopening when the saved form still normalizes to closed", async () => {
    const query = createStatusUpdateQuery({
      data: {
        id: "form-1",
        title: "Form",
        form_type: "anketa",
        form_reason: "plan",
        is_public: true,
        deadline_at: "2020-01-01T00:00:00.000Z",
        max_responses: 4,
        author_id: "user-1",
        schema: { pages: [] },
        created_at: "2026-04-19T18:00:00.000Z",
        responses_count: 3,
      },
      error: null,
    });
    vi.mocked(apiClient.from).mockReturnValue(query as never);

    await expect(updateFormStatus("form-1", true)).rejects.toThrow(
      "Форма осталась закрытой. Проверьте дедлайн или лимит ответов.",
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

describe("updateFormTitle", () => {
  afterEach(() => {
    vi.resetAllMocks();
  });

  it("keeps the persisted survey schema title in sync with the form title", async () => {
    const schemaReadQuery = createSchemaReadQuery({
      data: {
        schema: {
          title: "Старое название",
          pages: [{ name: "page1", elements: [] }],
        },
        theme: {},
        allow_response_editing: false,
        organization_types: ["school"],
      },
      error: null,
    });
    const themeReadQuery = createSchemaReadQuery({ data: { theme: {} }, error: null });
    vi.mocked(apiClient.from)
      .mockReturnValueOnce(schemaReadQuery as never)
      .mockReturnValueOnce(themeReadQuery as never);
    vi.mocked(apiClient.auth.getCurrentUser).mockResolvedValue({
      data: { user: { id: "user-1" } },
      error: null,
    } as never);
    vi.mocked(apiClient.auth.getCurrentSession).mockResolvedValue({
      data: { session: { access_token: "access-token" } },
      error: null,
    } as never);
    vi.mocked(supabaseClient.functions.invoke).mockResolvedValue({
      data: {
        status: "updated",
        safeChanges: ["Изменено оформление или текст формы"],
        warnings: [],
        breakingChanges: [],
      },
      error: null,
    } as never);

    await updateFormTitle("form-1", "Новое название");

    expect(schemaReadQuery.select).toHaveBeenCalledWith(
      "schema, theme, allow_response_editing, organization_types",
    );
    expect(schemaReadQuery.eq).toHaveBeenCalledWith("id", "form-1");
    expect(supabaseClient.functions.invoke).toHaveBeenCalledWith(
      "form-admin",
      expect.objectContaining({
        body: expect.objectContaining({
          action: "update-schema",
          formId: "form-1",
          schema: {
            title: "Новое название",
            pages: [{ name: "page1", elements: [] }],
          },
          confirmWarnings: false,
        }),
        headers: expect.objectContaining({ Authorization: "Bearer access-token" }),
      }),
    );
  });
});

describe("updateFormSchema", () => {
  afterEach(() => {
    vi.resetAllMocks();
  });

  it("uses form-admin and returns compatibility warnings without a direct table update", async () => {
    const themeReadQuery = createSchemaReadQuery({ data: { theme: {} }, error: null });
    vi.mocked(apiClient.from).mockReturnValue(themeReadQuery as never);
    vi.mocked(apiClient.auth.getCurrentUser).mockResolvedValue({
      data: { user: { id: "user-1" } },
      error: null,
    } as never);
    vi.mocked(apiClient.auth.getCurrentSession).mockResolvedValue({
      data: { session: { access_token: "access-token" } },
      error: null,
    } as never);
    vi.mocked(supabaseClient.functions.invoke).mockResolvedValue({
      data: {
        status: "confirmation_required",
        safeChanges: [],
        warnings: ["Добавлен новый необязательный вопрос «Адрес сайта»"],
        breakingChanges: [],
      },
      error: null,
    } as never);

    await expect(updateFormSchema(
      "form-1",
      { pages: [{ name: "page1", elements: [] }] },
      {},
      "Форма",
      false,
      ["school"],
    )).resolves.toMatchObject({ status: "confirmation_required" });

    expect(supabaseClient.functions.invoke).toHaveBeenCalledWith(
      "form-admin",
      expect.objectContaining({
        body: expect.objectContaining({
          action: "update-schema",
          confirmWarnings: false,
        }),
      }),
    );
    expect(themeReadQuery).not.toHaveProperty("update");
  });
});
