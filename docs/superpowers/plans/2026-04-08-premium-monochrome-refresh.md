# Premium Monochrome Refresh Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Restyle the existing Survey App into a premium monochrome interface with subtle motion, without changing structure or business behavior.

**Architecture:** Keep the current React route and page structure intact, add only the styling hooks needed to replace inline styles, and centralize the redesign in `frontend/src/app.css`. Use targeted Vitest coverage to lock in the new class hooks and preserve existing dashboard, auth, admin, and survey flows while keeping SurveyJS theming scoped to the existing builder and public survey shells.

**Tech Stack:** React 18, React Router 6, TanStack Query 5, Vite 5, Vitest, Testing Library, SurveyJS

---

## File Map

- `frontend/src/app.css`
  Global tokens, shared surfaces, monochrome controls, dashboard/admin styling, modal/popover styling, motion rules, responsive adjustments, SurveyJS scoped theme overrides.
- `frontend/src/app/layout/AppLayout.tsx`
  App-shell class hooks for authenticated vs public/login layouts and shell-level theme modifiers.
- `frontend/src/pages/LoginPage/LoginPage.tsx`
  Replace inline layout/message styling with reusable auth classes.
- `frontend/src/pages/DashboardPage/DashboardPage.tsx`
  Keep behavior intact, add any missing modal/action wrapper classes needed by the new CSS system.
- `frontend/src/pages/FormResponsesPage/FormResponsesPage.tsx`
  Replace remaining inline error and shell styling with reusable classes.
- `frontend/src/pages/UsersPage/UsersPage.tsx`
  Replace inline layout and status styling with reusable admin-page classes.
- `frontend/src/pages/SurveyPage/SurveyPage.tsx`
  Add public survey shell hooks without changing rendering flow.
- `frontend/src/pages/LoginPage/LoginPage.test.tsx`
  New auth-page structure test for premium styling hooks.
- `frontend/src/pages/UsersPage/UsersPage.test.tsx`
  New admin-page structure test for reusable class hooks.
- `frontend/src/pages/SurveyPage/SurveyPage.test.tsx`
  New public survey shell test for safe page-level styling hooks.
- `frontend/src/pages/DashboardPage/DashboardPage.test.tsx`
  Extend existing coverage with modal/action wrapper class expectations.
- `frontend/src/pages/FormResponsesPage/FormResponsesPage.test.tsx`
  Extend existing coverage with responses workspace shell class expectations.

### Task 1: Lock Auth And Shell Styling Hooks

**Files:**
- Create: `frontend/src/pages/LoginPage/LoginPage.test.tsx`
- Modify: `frontend/src/app/layout/AppLayout.tsx`
- Modify: `frontend/src/pages/LoginPage/LoginPage.tsx`
- Test: `frontend/src/pages/LoginPage/LoginPage.test.tsx`

- [ ] **Step 1: Write the failing test**

```tsx
import { render, screen } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { describe, expect, it, vi } from "vitest";
import LoginPage from "./LoginPage";

vi.mock("../../app/providers/AuthProvider", () => ({
  useAuth: () => ({
    user: null,
    loading: false,
  }),
}));

vi.mock("../../features/auth/api", () => ({
  login: vi.fn(),
}));

describe("LoginPage", () => {
  it("renders stable monochrome auth hooks", () => {
    const { container } = render(
      <MemoryRouter>
        <LoginPage />
      </MemoryRouter>,
    );

    expect(container.querySelector(".login-card")).toBeInTheDocument();
    expect(container.querySelector(".login-form")).toBeInTheDocument();
    expect(container.querySelector(".login-fields")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Войти" })).toHaveClass("button-primary");
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd /opt/survey-app/frontend && npm run test -- src/pages/LoginPage/LoginPage.test.tsx`

Expected: FAIL because `.login-card`, `.login-form`, `.login-fields`, and `.button-primary` are not present in the current markup.

- [ ] **Step 3: Write minimal implementation**

```tsx
return (
  <div className="login-page">
    <div className="card login-card">
      <h2 className="login-title">Авторизация</h2>
      <form
        className="login-form"
        onSubmit={(event) => {
          event.preventDefault();
          void onLogin();
        }}
      >
        <div className="login-fields">
          <input value={email} onChange={(event) => setEmail(event.target.value)} placeholder="Электронная почта" />
          <input value={password} onChange={(event) => setPassword(event.target.value)} placeholder="Пароль" type="password" />
        </div>
        <div className="login-actions">
          <button type="submit" className="button-primary">Войти</button>
        </div>
      </form>
      {message && (
        <p className={`login-message login-message-${messageType}`}>
          {message}
        </p>
      )}
    </div>
  </div>
);
```

```tsx
<div
  className={
    shouldHideSidebar
      ? "app-shell app-shell-login app-shell-monochrome"
      : `app-shell app-shell-monochrome ${isSidebarHidden ? "app-shell-sidebar-hidden" : ""}`.trim()
  }
>
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cd /opt/survey-app/frontend && npm run test -- src/pages/LoginPage/LoginPage.test.tsx`

Expected: PASS

- [ ] **Step 5: Commit**

```bash
git -C /opt/survey-app add \
  frontend/src/app/layout/AppLayout.tsx \
  frontend/src/pages/LoginPage/LoginPage.tsx \
  frontend/src/pages/LoginPage/LoginPage.test.tsx
git -C /opt/survey-app commit -m "test: add auth styling hooks"
```

### Task 2: Lock Dashboard, Responses, And Users Surface Hooks

**Files:**
- Create: `frontend/src/pages/UsersPage/UsersPage.test.tsx`
- Modify: `frontend/src/pages/DashboardPage/DashboardPage.test.tsx`
- Modify: `frontend/src/pages/FormResponsesPage/FormResponsesPage.test.tsx`
- Modify: `frontend/src/pages/DashboardPage/DashboardPage.tsx`
- Modify: `frontend/src/pages/FormResponsesPage/FormResponsesPage.tsx`
- Modify: `frontend/src/pages/UsersPage/UsersPage.tsx`
- Test: `frontend/src/pages/DashboardPage/DashboardPage.test.tsx`
- Test: `frontend/src/pages/FormResponsesPage/FormResponsesPage.test.tsx`
- Test: `frontend/src/pages/UsersPage/UsersPage.test.tsx`

- [ ] **Step 1: Write the failing tests**

```tsx
it("renders the delete modal action wrapper for dashboard styling", async () => {
  getForms.mockResolvedValue([
    createForm(1, { title: "Моя форма", author_id: "user-1" }),
  ]);

  const { container } = renderPage("all");

  await userEvent.click(await screen.findByRole("button", { name: "Действия формы Моя форма" }));
  await userEvent.click(await screen.findByRole("menuitem", { name: "Удалить" }));

  expect(container.querySelector(".dashboard-delete-modal-actions")).toBeInTheDocument();
});
```

```tsx
it("renders reusable responses workspace classes", async () => {
  getFormById.mockResolvedValue({
    id: "form-1",
    title: "Форма обратной связи",
    created_at: "2026-04-08T10:00:00.000Z",
    is_public: true,
    author_id: "user-1",
    form_type: "anketa",
    form_reason: "plan",
    deadline_at: null,
    schema: {
      pages: [{ elements: [{ type: "text", name: "name", title: "Имя" }] }],
    },
  });
  getResponsesByForm.mockResolvedValue([
    {
      id: "response-1",
      form_id: "form-1",
      created_at: "2026-04-08T11:30:00.000Z",
      data: { name: "Анна" },
    },
  ]);

  const { container } = render(
    <MemoryRouter initialEntries={["/dashboard/forms/form-1/responses"]}>
      <QueryClientProvider client={createQueryClient()}>
        <Routes>
          <Route path="/dashboard/forms/:id/responses" element={<FormResponsesPage />} />
        </Routes>
      </QueryClientProvider>
    </MemoryRouter>,
  );

  expect(await screen.findByRole("heading", { name: "Форма обратной связи" })).toBeInTheDocument();
  expect(container.querySelector(".responses-page-card")).toBeInTheDocument();
  expect(container.querySelector(".responses-page-table-shell")).toBeInTheDocument();
});
```

```tsx
it("renders reusable users workspace classes", async () => {
  getAllUsers.mockResolvedValue([
    {
      id: "user-1",
      name: "Администратор",
      email: "admin@example.com",
      role: "admin",
      is_disabled: false,
      created_at: "2026-04-08T09:00:00.000Z",
    },
  ]);

  const { container } = render(
    <QueryClientProvider client={createQueryClient()}>
      <UsersPage />
    </QueryClientProvider>,
  );

  expect(await screen.findByRole("heading", { name: "Пользователи" })).toBeInTheDocument();
  expect(container.querySelector(".users-page-card")).toBeInTheDocument();
  expect(container.querySelector(".users-page-toolbar")).toBeInTheDocument();
  expect(container.querySelector(".users-table-shell")).toBeInTheDocument();
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `cd /opt/survey-app/frontend && npm run test -- src/pages/DashboardPage/DashboardPage.test.tsx src/pages/FormResponsesPage/FormResponsesPage.test.tsx src/pages/UsersPage/UsersPage.test.tsx`

Expected: FAIL because the new class hooks do not exist yet and `UsersPage.test.tsx` is new.

- [ ] **Step 3: Write minimal implementation**

```tsx
<div className="modal-card card dashboard-delete-modal">
  <h3 className="dashboard-delete-modal-title">Удаление формы</h3>
  <p className="dashboard-delete-modal-copy">
    Удалить форму «{formToDelete.title}»? Это действие нельзя отменить.
  </p>
  <div className="dashboard-delete-modal-actions">
    <button type="button" onClick={() => setFormToDelete(null)}>Отмена</button>
    <button type="button" onClick={() => void confirmDelete()}>Удалить</button>
  </div>
</div>
```

```tsx
{!isLoading && combinedError && (
  <p className="responses-page-error">
    {getErrorMessage(combinedError, "Не удалось загрузить ответы")}
  </p>
)}
```

```tsx
<div className="dashboard-page">
  <div className="card users-page-card">
    <h2 className="users-page-title">Пользователи</h2>
    <div className="users-create-grid">
      <input value={newUser.name} onChange={(event) => setNewUser((prev) => ({ ...prev, name: event.target.value }))} placeholder="Имя" />
      <input value={newUser.email} onChange={(event) => setNewUser((prev) => ({ ...prev, email: event.target.value }))} placeholder="Email" />
      <input type="password" value={newUser.password} onChange={(event) => setNewUser((prev) => ({ ...prev, password: event.target.value }))} placeholder="Пароль (минимум 8 символов)" />
      <select value={newUser.role} onChange={(event) => setNewUser((prev) => ({ ...prev, role: event.target.value as UserRole }))}>
        <option value="user">user</option>
        <option value="admin">admin</option>
      </select>
    </div>
    <div className="users-page-toolbar">
      <button onClick={() => void onCreateUser()} disabled={createUserMutation.isPending || !isPasswordValid}>Создать пользователя</button>
      <button onClick={() => openPasswordModal(user?.id ?? "", "Смена моего пароля", true)} disabled={!user}>Сменить мой пароль</button>
    </div>
    <div className="users-table-shell">
      <table className="responses-table users-table">
        <thead>
          <tr>
            <th>Имя</th>
            <th>Email</th>
            <th>Роль</th>
            <th>Статус</th>
            <th>Создан</th>
            <th>Действия</th>
          </tr>
        </thead>
      </table>
    </div>
  </div>
</div>
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `cd /opt/survey-app/frontend && npm run test -- src/pages/DashboardPage/DashboardPage.test.tsx src/pages/FormResponsesPage/FormResponsesPage.test.tsx src/pages/UsersPage/UsersPage.test.tsx`

Expected: PASS

- [ ] **Step 5: Commit**

```bash
git -C /opt/survey-app add \
  frontend/src/pages/DashboardPage/DashboardPage.test.tsx \
  frontend/src/pages/FormResponsesPage/FormResponsesPage.test.tsx \
  frontend/src/pages/UsersPage/UsersPage.test.tsx \
  frontend/src/pages/DashboardPage/DashboardPage.tsx \
  frontend/src/pages/FormResponsesPage/FormResponsesPage.tsx \
  frontend/src/pages/UsersPage/UsersPage.tsx
git -C /opt/survey-app commit -m "test: add admin surface styling hooks"
```

### Task 3: Apply The Monochrome Design System In CSS

**Files:**
- Modify: `frontend/src/app.css`
- Test: `frontend/src/pages/LoginPage/LoginPage.test.tsx`
- Test: `frontend/src/pages/DashboardPage/DashboardPage.test.tsx`
- Test: `frontend/src/pages/FormResponsesPage/FormResponsesPage.test.tsx`
- Test: `frontend/src/pages/UsersPage/UsersPage.test.tsx`

- [ ] **Step 1: Verify the styling-hook tests protect the markup you are about to style**

Run: `cd /opt/survey-app/frontend && npm run test -- src/pages/LoginPage/LoginPage.test.tsx src/pages/DashboardPage/DashboardPage.test.tsx src/pages/FormResponsesPage/FormResponsesPage.test.tsx src/pages/UsersPage/UsersPage.test.tsx`

Expected: PASS, giving you a safe baseline for CSS-only work.

- [ ] **Step 2: Write the minimal monochrome token and base-control implementation**

```css
:root {
  font-family: "Manrope", "Segoe UI", sans-serif;
  color: #111111;
  background:
    radial-gradient(circle at top left, rgba(255, 255, 255, 0.86), transparent 28%),
    radial-gradient(circle at top right, rgba(24, 24, 24, 0.06), transparent 24%),
    linear-gradient(180deg, #f7f7f5 0%, #eceae7 52%, #e3e0db 100%);
  --app-bg: linear-gradient(180deg, #f7f7f5 0%, #eceae7 52%, #e3e0db 100%);
  --sidebar-bg: rgba(248, 247, 244, 0.78);
  --card-bg: rgba(255, 255, 255, 0.86);
  --card-border: rgba(17, 17, 17, 0.08);
  --text-muted: #5a5a57;
  --surface-muted: linear-gradient(180deg, rgba(255, 255, 255, 0.88), rgba(241, 239, 235, 0.92));
  --accent: #111111;
  --accent-strong: #000000;
  --shadow-lg: 0 24px 60px rgba(17, 17, 17, 0.12);
  --shadow-md: 0 16px 34px rgba(17, 17, 17, 0.1);
}

.button-primary {
  background: linear-gradient(180deg, #1c1c1c, #0d0d0d);
  border-color: transparent;
  color: #ffffff;
}

.button-primary:hover {
  background: linear-gradient(180deg, #2a2a2a, #111111);
}
```

- [ ] **Step 3: Extend the CSS to cover shared surfaces, dashboard rows, users/responses shells, modal/toast treatments, and restrained motion**

```css
.login-card,
.dashboard-main-card,
.responses-page-card,
.users-page-card,
.survey-page-card,
.modal-card {
  border: 1px solid var(--card-border);
  background: var(--card-bg);
  box-shadow: var(--shadow-lg);
  backdrop-filter: blur(18px);
}

.dashboard-form-card-interactive:hover,
.dashboard-form-card-interactive:focus-visible,
button:hover,
.button-link:hover {
  transform: translateY(-2px);
}

.form-menu-dropdown,
.dashboard-stats-popover,
.toast,
.modal-card {
  animation: surface-enter 180ms ease-out;
}

@keyframes surface-enter {
  from {
    opacity: 0;
    transform: translateY(8px) scale(0.985);
  }
  to {
    opacity: 1;
    transform: translateY(0) scale(1);
  }
}

@media (prefers-reduced-motion: reduce) {
  *,
  *::before,
  *::after {
    animation: none !important;
    transition-duration: 0.01ms !important;
    scroll-behavior: auto !important;
  }
}
```

- [ ] **Step 4: Run regression tests and a production build**

Run: `cd /opt/survey-app/frontend && npm run test -- src/pages/LoginPage/LoginPage.test.tsx src/pages/DashboardPage/DashboardPage.test.tsx src/pages/FormResponsesPage/FormResponsesPage.test.tsx src/pages/UsersPage/UsersPage.test.tsx && npm run build`

Expected: PASS, then Vite build succeeds without CSS or TypeScript errors.

- [ ] **Step 5: Commit**

```bash
git -C /opt/survey-app add frontend/src/app.css
git -C /opt/survey-app commit -m "feat: apply premium monochrome design system"
```

### Task 4: Retheme The Public Survey And Builder Safely

**Files:**
- Create: `frontend/src/pages/SurveyPage/SurveyPage.test.tsx`
- Modify: `frontend/src/pages/SurveyPage/SurveyPage.tsx`
- Modify: `frontend/src/app.css`
- Test: `frontend/src/pages/SurveyPage/SurveyPage.test.tsx`
- Test: `frontend/src/features/render-form/SurveyFormRenderer.test.tsx`

- [ ] **Step 1: Write the failing public-survey shell test**

```tsx
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { render, screen } from "@testing-library/react";
import { MemoryRouter, Route, Routes } from "react-router-dom";
import { describe, expect, it, vi } from "vitest";
import SurveyPage from "./SurveyPage";

vi.mock("../../app/providers/AuthProvider", () => ({
  useAuth: () => ({ user: null, loading: false }),
}));

vi.mock("../../entities/survey/api/surveysApi", () => ({
  getFormById: vi.fn(),
  getPublicFormById: vi.fn().mockResolvedValue({
    id: "form-1",
    title: "Анкета",
    schema: { pages: [] },
  }),
}));

vi.mock("../../widgets/SurveyRenderer/SurveyRenderer", () => ({
  SurveyRenderer: () => <div data-testid="survey-renderer" />,
}));

it("renders public survey shell hooks", async () => {
  const { container } = render(
    <MemoryRouter initialEntries={["/form/form-1"]}>
      <QueryClientProvider client={new QueryClient()}>
        <Routes>
          <Route path="/form/:id" element={<SurveyPage />} />
        </Routes>
      </QueryClientProvider>
    </MemoryRouter>,
  );

  expect(await screen.findByTestId("survey-renderer")).toBeInTheDocument();
  expect(container.querySelector(".survey-page")).toBeInTheDocument();
  expect(container.querySelector(".survey-page-card")).toBeInTheDocument();
  expect(container.querySelector(".survey-page-shell")).toBeInTheDocument();
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `cd /opt/survey-app/frontend && npm run test -- src/pages/SurveyPage/SurveyPage.test.tsx src/features/render-form/SurveyFormRenderer.test.tsx`

Expected: FAIL because `.survey-page-shell` does not exist yet.

- [ ] **Step 3: Write minimal implementation**

```tsx
return (
  <div className="survey-page survey-page-shell">
    <div className="survey-page-card card">
      <SurveyRenderer schema={form.schema} formId={form.id} />
    </div>
  </div>
);
```

```css
.survey-page-shell .survey-page-card .sd-root-modern,
.survey-page-shell .survey-page-card .sd-root-modern__wrapper,
.builder-creator-shell .svc-creator {
  --sjs-primary-backcolor: #111111;
  --sjs-primary-backcolor-dark: #000000;
  --sjs-primary-backcolor-light: rgba(17, 17, 17, 0.12);
  --sjs-general-backcolor-dim: #f1efeb;
  --sjs-general-backcolor-dark: #ddd9d3;
  --sjs-general-forecolor: #171717;
  --sjs-general-forecolor-light: #5c5c59;
}
```

- [ ] **Step 4: Run tests and a full frontend regression pass**

Run: `cd /opt/survey-app/frontend && npm run test -- src/pages/SurveyPage/SurveyPage.test.tsx src/features/render-form/SurveyFormRenderer.test.tsx src/pages/DashboardPage/DashboardPage.test.tsx src/pages/FormResponsesPage/FormResponsesPage.test.tsx src/pages/UsersPage/UsersPage.test.tsx src/pages/LoginPage/LoginPage.test.tsx && npm run build`

Expected: PASS, then Vite build succeeds.

- [ ] **Step 5: Commit**

```bash
git -C /opt/survey-app add \
  frontend/src/pages/SurveyPage/SurveyPage.test.tsx \
  frontend/src/pages/SurveyPage/SurveyPage.tsx \
  frontend/src/app.css
git -C /opt/survey-app commit -m "feat: retheme survey and builder shells"
```

### Task 5: Final Verification And Visual QA

**Files:**
- Modify: `frontend/src/app.css`
- Modify: `frontend/src/pages/LoginPage/LoginPage.tsx`
- Modify: `frontend/src/pages/DashboardPage/DashboardPage.tsx`
- Modify: `frontend/src/pages/FormResponsesPage/FormResponsesPage.tsx`
- Modify: `frontend/src/pages/UsersPage/UsersPage.tsx`
- Modify: `frontend/src/pages/SurveyPage/SurveyPage.tsx`

- [ ] **Step 1: Run the full targeted frontend suite**

Run: `cd /opt/survey-app/frontend && npm run test -- src/pages/LoginPage/LoginPage.test.tsx src/pages/DashboardPage/DashboardPage.test.tsx src/pages/FormResponsesPage/FormResponsesPage.test.tsx src/pages/UsersPage/UsersPage.test.tsx src/pages/SurveyPage/SurveyPage.test.tsx src/features/render-form/SurveyFormRenderer.test.tsx`

Expected: PASS

- [ ] **Step 2: Run a production build**

Run: `cd /opt/survey-app/frontend && npm run build`

Expected: Vite build completes successfully.

- [ ] **Step 3: Run a visual smoke checklist in the browser**

Run:

```bash
cd /opt/survey-app/frontend
npm run dev
```

Check manually:

- login feels monochrome and premium
- sidebar active state is monochrome, not blue
- dashboard cards, menus, and modals use the new surface system
- users and responses pages no longer rely on inline-style presentation
- builder keeps working with scoped neutral SurveyJS theming
- public survey renders with the premium shell and still submits
- motion stays subtle and reduced-motion rules are present

- [ ] **Step 4: Make only the final polish fixes needed by verification**

```css
/* Examples of acceptable polish-only fixes */
.dashboard-meta-pill { letter-spacing: 0.01em; }
.toast { border-color: rgba(17, 17, 17, 0.08); }
.logout-button { background: rgba(17, 17, 17, 0.06); }
```

- [ ] **Step 5: Commit**

```bash
git -C /opt/survey-app add frontend/src/app.css frontend/src/pages
git -C /opt/survey-app commit -m "chore: finalize monochrome polish"
```
