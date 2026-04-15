# React Lazy Form Preview Safety Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Improve page-load performance with route-level lazy loading and lighter initial data fetching without breaking public SurveyJS styling or preview flows.

**Architecture:** Keep public form rendering eager, move base SurveyJS CSS to the global entry, and split only secondary heavy route modules with React Router `route.lazy`. Refine survey and responses queries so public forms do not wait on auth restoration and the responses page renders from the first page instead of blocking on the full dataset.

**Tech Stack:** React 18, React Router 6 `createBrowserRouter`, TanStack Query v5, Vite, Vitest, TypeScript

---

### Task 1: Lock In Router and CSS Safety

**Files:**
- Modify: `frontend/src/app/router.test.tsx`
- Modify: `frontend/src/main.tsx`
- Modify: `frontend/src/widgets/SurveyBuilder/SurveyBuilder.tsx`
- Modify: `frontend/src/app/router.tsx`

- [ ] **Step 1: Write the failing router/CSS safety tests**

Add expectations in `frontend/src/app/router.test.tsx` that:
- `SurveyPage` still loads eagerly
- secondary route modules use `lazy`
- the previous eager-import counters for builder/users/html stop being the source of truth

- [ ] **Step 2: Run test to verify it fails**

Run: `npm test -- src/app/router.test.tsx`
Expected: FAIL because the router still uses eager imports for all route modules.

- [ ] **Step 3: Write the minimal implementation**

Update `frontend/src/main.tsx` to import `survey-core/defaultV2.min.css`.

Remove that import from `frontend/src/widgets/SurveyBuilder/SurveyBuilder.tsx`, leaving `survey-creator-core/survey-creator-core.min.css` scoped to builder code.

Update `frontend/src/app/router.tsx` to:
- keep `SurveyPage` eager
- convert approved secondary route modules to `route.lazy`
- keep the layout route eager and avoid lifting the fallback above the route boundary

- [ ] **Step 4: Run test to verify it passes**

Run: `npm test -- src/app/router.test.tsx`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add frontend/src/app/router.test.tsx frontend/src/main.tsx frontend/src/widgets/SurveyBuilder/SurveyBuilder.tsx frontend/src/app/router.tsx
git commit -m "refactor: lazy load secondary route modules"
```

### Task 2: Separate Public and Private Survey Loading

**Files:**
- Modify: `frontend/src/entities/survey/model/queryKeys.ts`
- Modify: `frontend/src/pages/SurveyPage/SurveyPage.tsx`
- Modify: `frontend/src/pages/SurveyPage/SurveyPage.test.tsx`

- [ ] **Step 1: Write the failing survey loading tests**

Add tests in `frontend/src/pages/SurveyPage/SurveyPage.test.tsx` that:
- public forms begin loading while auth is still restoring
- preview/private flows keep their protected behavior
- already rendered form content is not replaced by a full-page loading state during later refetch behavior

- [ ] **Step 2: Run test to verify it fails**

Run: `npm test -- src/pages/SurveyPage/SurveyPage.test.tsx`
Expected: FAIL because the current query is gated by `isAuthLoading` and uses one shared query key.

- [ ] **Step 3: Write the minimal implementation**

Update `frontend/src/entities/survey/model/queryKeys.ts` with separate helpers for public and private survey keys.

Update `frontend/src/pages/SurveyPage/SurveyPage.tsx` to:
- detect preview mode cleanly
- use the public query path immediately for non-preview public access
- keep private preview behind auth
- show the page skeleton only for the first empty render

- [ ] **Step 4: Run test to verify it passes**

Run: `npm test -- src/pages/SurveyPage/SurveyPage.test.tsx`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add frontend/src/entities/survey/model/queryKeys.ts frontend/src/pages/SurveyPage/SurveyPage.tsx frontend/src/pages/SurveyPage/SurveyPage.test.tsx
git commit -m "fix: separate public and private survey loading"
```

### Task 3: Stop Blocking the Responses Page on Full Dataset Fetches

**Files:**
- Modify: `frontend/src/pages/FormResponsesPage/FormResponsesPage.test.tsx`
- Modify: `frontend/src/pages/FormResponsesPage/FormResponsesPage.tsx`

- [ ] **Step 1: Write the failing responses-page tests**

Add tests in `frontend/src/pages/FormResponsesPage/FormResponsesPage.test.tsx` that:
- initial render requests only page 1
- already shown rows stay visible during a manual refresh
- the page no longer waits for every responses page before painting the table

- [ ] **Step 2: Run test to verify it fails**

Run: `npm test -- src/pages/FormResponsesPage/FormResponsesPage.test.tsx`
Expected: FAIL because the page still uses `getAllResponsesByForm()` and the initial loading state waits for all pages.

- [ ] **Step 3: Write the minimal implementation**

Update `frontend/src/pages/FormResponsesPage/FormResponsesPage.tsx` to:
- remove `getAllResponsesByForm()` from initial rendering
- fetch only the first page in the main query
- reserve the full skeleton for first empty render only
- keep visible rows on screen during refetch
- move all-pages loading to the XLSX export action only

- [ ] **Step 4: Run test to verify it passes**

Run: `npm test -- src/pages/FormResponsesPage/FormResponsesPage.test.tsx`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add frontend/src/pages/FormResponsesPage/FormResponsesPage.tsx frontend/src/pages/FormResponsesPage/FormResponsesPage.test.tsx
git commit -m "perf: render responses from first page only"
```

### Task 4: Verify Type Safety and Full Regression Surface

**Files:**
- Modify: any files changed by Tasks 1-3 only if verification exposes real defects

- [ ] **Step 1: Run focused regression tests**

Run: `npm test -- src/app/router.test.tsx src/pages/SurveyPage/SurveyPage.test.tsx src/pages/FormResponsesPage/FormResponsesPage.test.tsx src/pages/FormResponsesHtmlPage/FormResponsesHtmlPage.test.tsx`
Expected: PASS

- [ ] **Step 2: Run full test suite**

Run: `npm test`
Expected: PASS with 0 failing test files

- [ ] **Step 3: Run type check**

Run: `npx tsc --noEmit`
Expected: PASS

- [ ] **Step 4: Run production build**

Run: `npm run build`
Expected: PASS

- [ ] **Step 5: Commit final verification or last fixes if needed**

```bash
git status --short
```

If verification required code changes, commit them with:

```bash
git add <touched-files>
git commit -m "test: finalize react lazy preview safety changes"
```
