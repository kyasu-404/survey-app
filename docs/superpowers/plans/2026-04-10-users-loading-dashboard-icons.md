# Users, Loading States, and Dashboard Icons Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add inline user role/status controls with filtering, replace text loading states with skeletons/spinners, and add action/deadline icons in the forms dashboard.

**Architecture:** Extend the existing admin edge function with a focused `updateRole` action, keep user filtering client-side inside the existing React Query list, and introduce small shared loading primitives for reuse across pages. Update the dashboard card/menu rendering in place to preserve the current layout while adding icons and loading polish.

**Tech Stack:** React 18, TypeScript, Vite, Vitest, React Query, Supabase Edge Functions, SurveyJS

---

### Task 1: Lock the expected UI with failing tests

**Files:**
- Modify: `frontend/src/pages/UsersPage/UsersPage.test.tsx`
- Modify: `frontend/src/pages/DashboardPage/DashboardPage.test.tsx`
- Modify: `frontend/src/pages/SurveyPage/SurveyPage.test.tsx`
- Modify: `frontend/src/features/render-form/SurveyFormRenderer.test.tsx`

- [ ] **Step 1: Write failing tests for the new user controls and filters**
- [ ] **Step 2: Write failing tests for dashboard menu icons, deadline icon, and list loading skeleton hooks**
- [ ] **Step 3: Write failing tests for survey submit button loading state and survey page loading skeleton hook**
- [ ] **Step 4: Run targeted Vitest commands and confirm the new assertions fail for the expected missing UI**

### Task 2: Add backend and API support for role updates

**Files:**
- Modify: `functions/user-admin/index.ts`
- Modify: `frontend/src/features/users/api.ts`

- [ ] **Step 1: Extend the admin action union with `updateRole`**
- [ ] **Step 2: Reject self-role changes on the edge function and persist the role into `profiles` and auth metadata**
- [ ] **Step 3: Add the frontend API helper for `updateUserRole(userId, role)`**
- [ ] **Step 4: Re-run the relevant user-page test subset and confirm the API path is wired**

### Task 3: Implement the new users page interactions

**Files:**
- Modify: `frontend/src/pages/UsersPage/UsersPage.tsx`
- Modify: `frontend/src/app.css`

- [ ] **Step 1: Add local filter state for name, role, and status**
- [ ] **Step 2: Render filtered results and an empty state for “nothing matched”**
- [ ] **Step 3: Replace the static role text with a click-to-edit inline control for non-self rows**
- [ ] **Step 4: Replace the separate enable/disable action with a status button in the status column**
- [ ] **Step 5: Add button spinner states for create/save/toggle actions that are pending**
- [ ] **Step 6: Run the user-page tests and fix any regressions**

### Task 4: Add shared loading primitives and swap out text-only loading states

**Files:**
- Create: `frontend/src/shared/ui/InlineSpinner.tsx`
- Create: `frontend/src/shared/ui/Skeleton.tsx`
- Modify: `frontend/src/pages/DashboardPage/DashboardPage.tsx`
- Modify: `frontend/src/pages/SurveyPage/SurveyPage.tsx`
- Modify: `frontend/src/pages/FormResponsesPage/FormResponsesPage.tsx`
- Modify: `frontend/src/widgets/Sidebar/Sidebar.tsx`
- Modify: `frontend/src/widgets/SurveyBuilder/SurveyBuilder.tsx`
- Modify: `frontend/src/features/render-form/SurveyFormRenderer.tsx`
- Modify: `frontend/src/app.css`

- [ ] **Step 1: Add minimal reusable spinner and skeleton React components**
- [ ] **Step 2: Replace dashboard initial loading text with skeleton form cards**
- [ ] **Step 3: Add a subtle fade/loading treatment while dashboard refetch is in progress**
- [ ] **Step 4: Replace survey page, responses page, sidebar, and builder loading text with skeleton or spinner-based UI**
- [ ] **Step 5: Replace submit/save text statuses with inline button spinners where the action button is owned by our code**
- [ ] **Step 6: Run the targeted loading-related tests and adjust styles if snapshots fail**

### Task 5: Add dashboard action icons and deadline icon

**Files:**
- Modify: `frontend/src/pages/DashboardPage/DashboardPage.tsx`
- Modify: `frontend/src/app.css`

- [ ] **Step 1: Import the requested assets from `frontend/src/img/`**
- [ ] **Step 2: Render left-aligned icons inside each dropdown action row without changing labels**
- [ ] **Step 3: Render the deadline icon before the deadline text inside the card metadata**
- [ ] **Step 4: Run the dashboard test subset and verify the icons are exposed to the DOM as expected**

### Task 6: Final verification

**Files:**
- Modify: `frontend/src/pages/UsersPage/UsersPage.test.tsx`
- Modify: `frontend/src/pages/DashboardPage/DashboardPage.test.tsx`
- Modify: `frontend/src/pages/SurveyPage/SurveyPage.test.tsx`
- Modify: `frontend/src/features/render-form/SurveyFormRenderer.test.tsx`
- Modify: `frontend/src/pages/FormResponsesPage/FormResponsesPage.test.tsx`
- Modify: `frontend/src/widgets/SurveyBuilder/SurveyBuilder.test.tsx`

- [ ] **Step 1: Run the focused Vitest suites for the touched pages/features**
- [ ] **Step 2: Run `npm test -- --runInBand` or the repo’s equivalent full frontend test command if the focused suite is clean**
- [ ] **Step 3: Run `npm run build` in `frontend`**
- [ ] **Step 4: Compare the implemented behavior against the approved requirements and note any intentional limitations**
