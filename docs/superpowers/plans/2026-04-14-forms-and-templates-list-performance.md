# Forms And Templates List Performance Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make dashboard forms and template cards load and refresh without blocking interaction by switching list views to lightweight paged data and on-demand detail fetches.

**Architecture:** Add dedicated summary-list API functions that fetch only card metadata and support server-side paging/counts. Keep full-form queries for detail screens and actions that truly need `schema`, then update dashboard/templates to use summary queries, quiet background refresh, and scoped invalidation.

**Tech Stack:** React 18, TanStack Query v5, Vite, Vitest, Supabase/PostgREST SQL

---

### Task 1: Lock Behavior With Failing Tests

**Files:**
- Modify: `frontend/src/shared/api/formsApi.test.ts`
- Modify: `frontend/src/pages/DashboardPage/DashboardPage.test.tsx`
- Modify: `frontend/src/pages/TemplatesPage/TemplatesPage.test.tsx`

- [ ] **Step 1: Write the failing tests**

```ts
it("fetches dashboard cards without schema and with range/count metadata", async () => {
  await fetchFormsPage({ page: 0, pageSize: 20, summary: "dashboard" });
  expect(listQuery.select).toHaveBeenCalledWith(expect.stringContaining("responses_count"), { count: "exact" });
  expect(listQuery.range).toHaveBeenCalledWith(0, 19);
});

it("keeps dashboard cards interactive during background refresh", async () => {
  await userEvent.click(screen.getByRole("button", { name: "Обновить" }));
  expect(screen.queryByText("Загрузка форм")).not.toBeInTheDocument();
});

it("loads full template details only after opening preview or using a template", async () => {
  await userEvent.click(screen.getByRole("button", { name: "Использовать шаблон Шаблон заявки" }));
  expect(getFormById).toHaveBeenCalledWith("template-1");
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npm test -- src/shared/api/formsApi.test.ts src/pages/DashboardPage/DashboardPage.test.tsx src/pages/TemplatesPage/TemplatesPage.test.tsx`
Expected: FAIL because summary-list APIs and lazy template detail loading do not exist yet, and background refresh still renders blocking states.

- [ ] **Step 3: Keep the failures focused**

```ts
expect(getForms).toHaveBeenCalledWith(
  expect.objectContaining({ page: 0, pageSize: 20, summary: "template" }),
);
```

- [ ] **Step 4: Re-run the focused suite**

Run: `npm test -- src/shared/api/formsApi.test.ts src/pages/DashboardPage/DashboardPage.test.tsx src/pages/TemplatesPage/TemplatesPage.test.tsx`
Expected: FAIL with assertion mismatches only, not setup/runtime errors.

- [ ] **Step 5: Commit**

```bash
git add frontend/src/shared/api/formsApi.test.ts frontend/src/pages/DashboardPage/DashboardPage.test.tsx frontend/src/pages/TemplatesPage/TemplatesPage.test.tsx docs/superpowers/plans/2026-04-14-forms-and-templates-list-performance.md
git commit -m "test: cover lighter form and template list loading"
```

### Task 2: Build Summary List APIs And Query Helpers

**Files:**
- Modify: `frontend/src/shared/api/formsApi.ts`
- Modify: `frontend/src/shared/api/index.ts`
- Modify: `frontend/src/entities/survey/api/surveysApi.ts`
- Modify: `frontend/src/entities/survey/types.ts`
- Modify: `frontend/src/shared/lib/queryRefresh.ts`

- [ ] **Step 1: Write the failing API test for paged summary responses**

```ts
await expect(
  fetchFormsPage({
    page: 1,
    pageSize: 20,
    summary: "dashboard",
    filters: { authorId: "user-1" },
  }),
).resolves.toMatchObject({
  items: [expect.objectContaining({ id: "form-1" })],
  totalCount: 41,
});
```

- [ ] **Step 2: Run the API test to verify it fails**

Run: `npm test -- src/shared/api/formsApi.test.ts`
Expected: FAIL because `fetchFormsPage` and summary types are missing.

- [ ] **Step 3: Implement minimal summary APIs and scoped invalidation**

```ts
export type SurveyFormSummary = Omit<SurveyForm, "schema">;

export async function fetchFormsPage(options: FetchFormsPageOptions): Promise<PaginatedFormsPage> {
  const rangeFrom = options.page * options.pageSize;
  const rangeTo = rangeFrom + options.pageSize - 1;
  const { data, count } = await query.select(DASHBOARD_FORM_LIST_SELECT, { count: "exact" }).range(rangeFrom, rangeTo);
  return { items: mapSummaryForms(data), totalCount: count ?? 0 };
}

export function scheduleDebouncedQueryInvalidation(...) {
  // coalesce repeated realtime invalidations by reason/query key
}
```

- [ ] **Step 4: Run the API test to verify it passes**

Run: `npm test -- src/shared/api/formsApi.test.ts`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add frontend/src/shared/api/formsApi.ts frontend/src/shared/api/index.ts frontend/src/entities/survey/api/surveysApi.ts frontend/src/entities/survey/types.ts frontend/src/shared/lib/queryRefresh.ts
git commit -m "feat: add lightweight paged form summary queries"
```

### Task 3: Refactor Dashboard List Loading

**Files:**
- Modify: `frontend/src/pages/DashboardPage/DashboardPage.tsx`
- Modify: `frontend/src/pages/DashboardPage/DashboardPage.test.tsx`
- Modify: `frontend/src/app.css`

- [ ] **Step 1: Write the failing dashboard interaction tests**

```ts
it("requests the current page from the server instead of slicing all forms locally", async () => {
  expect(getFormsPage).toHaveBeenCalledWith(expect.objectContaining({ page: 0, pageSize: 20, summary: "dashboard" }));
});

it("does not dim the grid during background refresh", async () => {
  expect(container.querySelector(".dashboard-forms-grid-refreshing")).not.toBeInTheDocument();
});
```

- [ ] **Step 2: Run the dashboard tests to verify they fail**

Run: `npm test -- src/pages/DashboardPage/DashboardPage.test.tsx`
Expected: FAIL because the page still slices a fully loaded array, uses blocking refresh UI, and reloads from deadline timers.

- [ ] **Step 3: Implement the minimal dashboard refactor**

```tsx
const formsQuery = useInfiniteQuery({
  queryKey: formsQueryKey,
  queryFn: ({ pageParam = 0 }) => getFormsPage({ page: pageParam, pageSize, summary: "dashboard", filters }),
  getNextPageParam: (lastPage, allPages) => allPages.flatMap((page) => page.items).length < lastPage.totalCount ? allPages.length : undefined,
  staleTime: 30_000,
  refetchOnWindowFocus: false,
});

const isInitialFormsLoading = !loadedForms.length && formsQuery.isLoading;
const isRefreshingForms = formsQuery.isFetching && loadedForms.length > 0;
```

- [ ] **Step 4: Run the dashboard tests to verify they pass**

Run: `npm test -- src/pages/DashboardPage/DashboardPage.test.tsx`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add frontend/src/pages/DashboardPage/DashboardPage.tsx frontend/src/pages/DashboardPage/DashboardPage.test.tsx frontend/src/app.css
git commit -m "refactor: quiet dashboard form list refreshes"
```

### Task 4: Refactor Template Cards To Lazy-Load Full Details

**Files:**
- Modify: `frontend/src/pages/TemplatesPage/TemplatesPage.tsx`
- Modify: `frontend/src/pages/TemplatesPage/TemplatesPage.test.tsx`

- [ ] **Step 1: Write the failing template tests**

```ts
it("fetches template cards through the lightweight summary query", async () => {
  expect(getFormsPage).toHaveBeenCalledWith(expect.objectContaining({ summary: "template" }));
});

it("lazy-loads template schema for preview", async () => {
  await userEvent.click(screen.getByRole("button", { name: "Открыть превью шаблона Заявка на конкурс" }));
  expect(getFormById).toHaveBeenCalledWith("template-1");
});
```

- [ ] **Step 2: Run the template tests to verify they fail**

Run: `npm test -- src/pages/TemplatesPage/TemplatesPage.test.tsx`
Expected: FAIL because the page still loads full template schema in the list query.

- [ ] **Step 3: Implement the minimal template refactor**

```tsx
const templatesQuery = useInfiniteQuery({
  queryKey: templatesQueryKey,
  queryFn: ({ pageParam = 0 }) => getFormsPage({ page: pageParam, pageSize: TEMPLATE_PAGE_SIZE, summary: "template", filters }),
});

const ensureTemplateDetails = (templateId: string) =>
  queryClient.fetchQuery({
    queryKey: ["form", templateId],
    queryFn: () => getFormById(templateId),
    staleTime: 60_000,
  });
```

- [ ] **Step 4: Run the template tests to verify they pass**

Run: `npm test -- src/pages/TemplatesPage/TemplatesPage.test.tsx`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add frontend/src/pages/TemplatesPage/TemplatesPage.tsx frontend/src/pages/TemplatesPage/TemplatesPage.test.tsx
git commit -m "refactor: lazy-load template details from lightweight cards"
```

### Task 5: Add Supporting Database Indexes And Verify

**Files:**
- Create: `database/migrations/202604141900_forms_list_indexes.sql`
- Modify: `database/supabase_schema.sql`

- [ ] **Step 1: Write the migration**

```sql
create index if not exists idx_forms_created_at
  on public.forms(created_at desc);

create index if not exists idx_forms_author_created_at
  on public.forms(author_id, created_at desc);
```

- [ ] **Step 2: Run schema-alignment checks**

Run: `npm test -- database/supabase_schema.test.mjs`
Expected: PASS

- [ ] **Step 3: Run the focused frontend verification**

Run: `npm test -- src/shared/api/formsApi.test.ts src/pages/DashboardPage/DashboardPage.test.tsx src/pages/TemplatesPage/TemplatesPage.test.tsx`
Expected: PASS

- [ ] **Step 4: Run the type checker**

Run: `npm run typecheck`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add database/migrations/202604141900_forms_list_indexes.sql database/supabase_schema.sql
git commit -m "chore: add indexes for paged form and template lists"
```
