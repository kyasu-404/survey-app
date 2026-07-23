# Survey App Redesign Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Implement the approved `Editorial Warm` redesign across the full app, remove zebra striping from the forms list, and turn the dashboard into a `Command Center` without changing application behavior or breaking SurveyJS / Survey Creator.

**Architecture:** Keep the redesign presentation-focused by driving most changes through `frontend/src/app.css` tokens and semantic wrappers in existing page components. Preserve the current React Query, router, and mutation flows, and keep all SurveyJS overrides scoped to builder or public survey containers so the editor and renderer continue working unchanged.

**Tech Stack:** React 18, TypeScript, Vite, Vitest, React Testing Library, React Router, React Query, SurveyJS / Survey Creator, CSS in `frontend/src/app.css`

---

## File Map

### Existing files to modify

- `frontend/src/app.css`
  - Replace the cold blue palette with `Editorial Warm` tokens.
  - Define reusable shell, hero, module, table, auth, public survey, admin, and builder classes.
  - Remove zebra striping from the forms table and responses table.
  - Keep SurveyJS rules scoped under `.builder-creator-shell` and `.survey-page-card`.

- `frontend/src/app/layout/AppLayout.tsx`
  - Add a reusable page-shell wrapper for authenticated and public screens.

- `frontend/src/widgets/Sidebar/Sidebar.tsx`
  - Add stronger brand/nav/account structure while keeping current links and collapse/logout behavior.

- `frontend/src/pages/LoginPage/LoginPage.tsx`
  - Replace the minimal auth card with an editorial login shell using shared classes.

- `frontend/src/pages/DashboardPage/DashboardPage.tsx`
  - Add hero, KPI row, nearest-deadline module, recent-forms module, and a workspace section that still contains the full table and existing actions.

- `frontend/src/pages/SurveyPage/SurveyPage.tsx`
  - Add a richer public shell around the survey card while preserving preview mode and existing query behavior.

- `frontend/src/features/render-form/SurveyFormRenderer.tsx`
  - Convert loading/error text into styled inline feedback blocks.

- `frontend/src/pages/FormResponsesPage/FormResponsesPage.tsx`
  - Add a stronger header, summary module, and a redesigned table container.

- `frontend/src/pages/UsersPage/UsersPage.tsx`
  - Replace the current inline-layout page with modular controls and a structured user list while preserving modals and actions.

- `frontend/src/pages/BuilderPage/BuilderPage.tsx`
  - Add a builder intro shell above the existing Survey Creator host.

### Existing tests to modify

- `frontend/src/pages/DashboardPage/DashboardPage.test.tsx`
  - Update expectations for `Command Center` modules while keeping action behavior coverage.

- `frontend/src/features/render-form/SurveyFormRenderer.test.tsx`
  - Keep preview/error checks and assert the new feedback wrapper.

- `frontend/src/pages/FormResponsesPage/FormResponsesPage.test.tsx`
  - Assert the new summary shell and existing export/refresh behavior.

### New tests to create

- `frontend/src/widgets/Sidebar/Sidebar.test.tsx`
  - Smoke test the new sidebar information architecture.

- `frontend/src/pages/LoginPage/LoginPage.test.tsx`
  - Smoke test the editorial login shell and error surface.

- `frontend/src/pages/SurveyPage/SurveyPage.test.tsx`
  - Smoke test the new public survey shell while mocking the renderer.

- `frontend/src/pages/UsersPage/UsersPage.test.tsx`
  - Smoke test the modular users layout with mocked data.

- `frontend/src/pages/BuilderPage/BuilderPage.test.tsx`
  - Smoke test the builder intro shell without mounting the real Survey Creator.

---

### Task 0: Create a Safe Execution Workspace

**Files:**
- Create: none
- Modify: none
- Test: none

- [ ] **Step 1: Copy the current repo into an isolated execution workspace**

Run:

```bash
cd /opt
rm -rf /opt/survey-app-redesign
cp -a /opt/survey-app /opt/survey-app-redesign
cd /opt/survey-app-redesign
git switch -c codex/survey-app-redesign
```

Expected: a new local repo copy exists at `/opt/survey-app-redesign` on branch `codex/survey-app-redesign`.

- [ ] **Step 2: Install frontend dependencies in the isolated workspace**

Run:

```bash
cd /opt/survey-app-redesign/frontend
npm install
```

Expected: install completes without changing the original `/opt/survey-app` workspace.

- [ ] **Step 3: Capture a clean baseline before any UI changes**

Run:

```bash
cd /opt/survey-app-redesign/frontend
npx vitest run \
  src/pages/DashboardPage/DashboardPage.test.tsx \
  src/features/render-form/SurveyFormRenderer.test.tsx \
  src/pages/FormResponsesPage/FormResponsesPage.test.tsx
```

Expected: the current focused regression suite passes before redesign work starts.

---

### Task 1: Build the Editorial Warm Shell Foundation

**Files:**
- Create: `frontend/src/widgets/Sidebar/Sidebar.test.tsx`
- Modify: `frontend/src/app/layout/AppLayout.tsx`
- Modify: `frontend/src/widgets/Sidebar/Sidebar.tsx`
- Modify: `frontend/src/app.css`
- Test: `frontend/src/widgets/Sidebar/Sidebar.test.tsx`

- [ ] **Step 1: Write the failing sidebar shell test**

Create `frontend/src/widgets/Sidebar/Sidebar.test.tsx`:

```tsx
import { render, screen } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { describe, expect, it, vi } from "vitest";
import { Sidebar } from "./Sidebar";

vi.mock("../../app/providers/AuthProvider", () => ({
  useAuth: () => ({
    user: { id: "user-1", email: "lead@example.com" },
    profile: { role: "admin", name: "Руководитель" },
    loading: false,
  }),
}));

describe("Sidebar", () => {
  it("renders the redesigned brand, nav, and account areas", () => {
    render(
      <MemoryRouter>
        <Sidebar onToggle={() => undefined} />
      </MemoryRouter>,
    );

    expect(screen.getByText("Рабочее пространство")).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "Все формы" })).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "Пользователи" })).toBeInTheDocument();
    expect(screen.getByText("Руководитель")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Выйти" })).toBeInTheDocument();
  });
});
```

- [ ] **Step 2: Run the new sidebar test and verify it fails**

Run:

```bash
cd /opt/survey-app-redesign/frontend
npx vitest run src/widgets/Sidebar/Sidebar.test.tsx
```

Expected: FAIL because the current sidebar does not render `Рабочее пространство` or the new account block.

- [ ] **Step 3: Implement shared shell wrappers, sidebar structure, and warm foundation tokens**

Update `frontend/src/app/layout/AppLayout.tsx`:

```tsx
export function AppLayout() {
  const { showToast } = useToast();
  const location = useLocation();
  const navigate = useNavigate();
  const isLoginPage = location.pathname === routes.login;
  const isSurveyPage = location.pathname.startsWith("/form/");
  const shouldHideSidebar = isLoginPage || isSurveyPage;
  const [isSidebarHidden, setIsSidebarHidden] = useState(false);

  useEffect(() => {
    const toast = (location.state as { toast?: string } | null)?.toast;
    if (!toast) return;

    showToast(toast, "success");
    navigate(location.pathname, { replace: true, state: null });
  }, [location.pathname, location.state, navigate, showToast]);

  return (
    <div className={shouldHideSidebar ? "app-shell app-shell-login" : `app-shell ${isSidebarHidden ? "app-shell-sidebar-hidden" : ""}`.trim()}>
      {!shouldHideSidebar && isSidebarHidden && (
        <button
          type="button"
          className="sidebar-open-button"
          onClick={() => setIsSidebarHidden(false)}
          aria-label="Показать меню"
        >
          →
        </button>
      )}
      {!shouldHideSidebar && !isSidebarHidden && <Sidebar onToggle={() => setIsSidebarHidden(true)} />}
      <main className={shouldHideSidebar ? "app-main app-main-login" : "app-main"}>
        <div className={shouldHideSidebar ? "page-shell page-shell-public" : "page-shell"}>
          <Outlet />
        </div>
      </main>
    </div>
  );
}
```

Update the sidebar structure in `frontend/src/widgets/Sidebar/Sidebar.tsx`:

```tsx
    <aside className="sidebar">
      <div className="brand">
        <div className="brand-mark">
          <img src={blackLogo} alt="Логотип ИМЦ" className="logo-image" />
        </div>
        <div className="brand-copy">
          <p className="brand-eyebrow">Рабочее пространство</p>
          <h3 className="brand-title">Формы</h3>
        </div>
        <button type="button" className="sidebar-toggle-button" onClick={onToggle} aria-label="Скрыть меню">
          ←
        </button>
      </div>

      <nav className="sidebar-nav">
        <span className="sidebar-section-label">Навигация</span>
        {loading && <span>Загрузка...</span>}

        {!loading && user && (
          <>
            <NavLink className={({ isActive }) => `nav-link ${isActive ? "nav-link-active" : ""}`.trim()} to={routes.dashboardAll}>
              Все формы
            </NavLink>
            <NavLink className={({ isActive }) => `nav-link ${isActive ? "nav-link-active" : ""}`.trim()} to={routes.dashboardMy}>
              Мои формы
            </NavLink>
            <NavLink className={({ isActive }) => `nav-link ${isActive ? "nav-link-active" : ""}`.trim()} to={routes.builder}>
              Конструктор
            </NavLink>
            {profile?.role === "admin" && (
              <NavLink className={({ isActive }) => `nav-link ${isActive ? "nav-link-active" : ""}`.trim()} to={routes.users}>
                Пользователи
              </NavLink>
            )}
            <div className="sidebar-spacer" />
            <div className="sidebar-account">
              <p className="sidebar-account-name">{profile?.name || user.email || "Аккаунт"}</p>
              <p className="sidebar-account-role">{profile?.role === "admin" ? "Администратор" : "Пользователь"}</p>
              <button className="logout-button" onClick={onLogout}>Выйти</button>
            </div>
          </>
        )}
```

Add the foundation tokens and shell classes in `frontend/src/app.css`:

```css
:root {
  font-family: "Manrope", "Segoe UI", sans-serif;
  color: #241f1a;
  --app-bg:
    radial-gradient(circle at top left, rgba(251, 191, 36, 0.14), transparent 28%),
    radial-gradient(circle at top right, rgba(251, 113, 133, 0.12), transparent 24%),
    linear-gradient(180deg, #f7efe4 0%, #f2e8dc 46%, #ede1d4 100%);
  --surface-base: rgba(255, 250, 244, 0.88);
  --surface-raised: rgba(255, 255, 255, 0.92);
  --surface-muted: linear-gradient(180deg, rgba(255, 249, 241, 0.96), rgba(245, 236, 226, 0.92));
  --surface-strong: linear-gradient(180deg, rgba(255, 255, 255, 0.98), rgba(249, 241, 233, 0.96));
  --border-soft: rgba(155, 126, 89, 0.16);
  --border-medium: rgba(120, 92, 58, 0.24);
  --text-muted: #6d5d4d;
  --text-strong: #241f1a;
  --accent: #c26738;
  --accent-strong: #a94b20;
  --accent-soft: rgba(194, 103, 56, 0.14);
  --warning-soft: rgba(245, 158, 11, 0.16);
  --danger-soft: rgba(239, 68, 68, 0.14);
  --shadow-lg: 0 26px 60px rgba(92, 67, 42, 0.12);
  --shadow-md: 0 16px 34px rgba(92, 67, 42, 0.1);
  --shadow-sm: 0 10px 20px rgba(92, 67, 42, 0.08);
}

.page-shell {
  width: 100%;
  min-height: 100%;
}

.page-shell-public {
  display: flex;
  align-items: stretch;
}

.sidebar {
  background: linear-gradient(180deg, rgba(89, 64, 42, 0.88), rgba(61, 45, 30, 0.92));
  border-right: 1px solid rgba(255, 244, 231, 0.08);
  box-shadow: inset -1px 0 0 rgba(255, 255, 255, 0.06);
}

.brand-mark {
  width: 52px;
  height: 52px;
  display: grid;
  place-items: center;
  border-radius: 18px;
  background: rgba(255, 248, 240, 0.12);
  box-shadow: inset 0 1px 0 rgba(255, 255, 255, 0.14);
}

.brand-copy {
  min-width: 0;
}

.brand-eyebrow,
.sidebar-section-label,
.sidebar-account-role {
  margin: 0;
  color: rgba(255, 237, 213, 0.72);
  font-size: 0.74rem;
  font-weight: 700;
  letter-spacing: 0.08em;
  text-transform: uppercase;
}

.brand-title,
.nav-link,
.logout-button,
.sidebar-toggle-button,
.sidebar-open-button {
  color: #fff7ed;
}

.sidebar-account {
  display: grid;
  gap: 8px;
  padding: 14px;
  border-radius: 20px;
  background: rgba(255, 248, 240, 0.1);
  border: 1px solid rgba(255, 237, 213, 0.12);
}

.sidebar-account-name {
  margin: 0;
  color: #fffaf5;
  font-weight: 800;
}
```

- [ ] **Step 4: Run the sidebar shell test and make sure it passes**

Run:

```bash
cd /opt/survey-app-redesign/frontend
npx vitest run src/widgets/Sidebar/Sidebar.test.tsx
```

Expected: PASS.

- [ ] **Step 5: Commit the shell foundation**

Run:

```bash
cd /opt/survey-app-redesign
git add frontend/src/app/layout/AppLayout.tsx frontend/src/widgets/Sidebar/Sidebar.tsx frontend/src/widgets/Sidebar/Sidebar.test.tsx frontend/src/app.css
git commit -m "feat: add editorial shell foundation"
```

---

### Task 2: Redesign the Login Experience

**Files:**
- Create: `frontend/src/pages/LoginPage/LoginPage.test.tsx`
- Modify: `frontend/src/pages/LoginPage/LoginPage.tsx`
- Modify: `frontend/src/app.css`
- Test: `frontend/src/pages/LoginPage/LoginPage.test.tsx`

- [ ] **Step 1: Write the failing login shell test**

Create `frontend/src/pages/LoginPage/LoginPage.test.tsx`:

```tsx
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MemoryRouter } from "react-router-dom";
import { describe, expect, it, vi } from "vitest";
import LoginPage from "./LoginPage";

const login = vi.fn().mockRejectedValue(new Error("Неверный логин или пароль"));

vi.mock("../../app/providers/AuthProvider", () => ({
  useAuth: () => ({
    user: null,
    loading: false,
  }),
}));

vi.mock("../../features/auth/api", () => ({
  login,
}));

describe("LoginPage", () => {
  it("renders the editorial login shell and shows the error surface", async () => {
    render(
      <MemoryRouter>
        <LoginPage />
      </MemoryRouter>,
    );

    expect(screen.getByText("Формы для команды")).toBeInTheDocument();
    expect(screen.getByRole("heading", { name: "Авторизация" })).toBeInTheDocument();

    await userEvent.type(screen.getByPlaceholderText("Электронная почта"), "lead@example.com");
    await userEvent.type(screen.getByPlaceholderText("Пароль"), "wrong-password");
    await userEvent.click(screen.getByRole("button", { name: "Войти" }));

    expect(await screen.findByText("Неверный логин или пароль")).toBeInTheDocument();
  });
});
```

- [ ] **Step 2: Run the new login test and verify it fails**

Run:

```bash
cd /opt/survey-app-redesign/frontend
npx vitest run src/pages/LoginPage/LoginPage.test.tsx
```

Expected: FAIL because `Формы для команды` and the redesigned shell are not present.

- [ ] **Step 3: Implement the editorial login layout and feedback styles**

Update `frontend/src/pages/LoginPage/LoginPage.tsx`:

```tsx
  return (
    <div className="login-page">
      <div className="login-shell">
        <section className="card login-showcase">
          <p className="page-kicker">Editorial Warm</p>
          <h1 className="login-showcase-title">Формы для команды</h1>
          <p className="login-showcase-text">
            Управляйте опросами, следите за дедлайнами и открывайте нужные формы из единого рабочего пространства.
          </p>
          <div className="login-showcase-points">
            <span>Командный центр форм</span>
            <span>Современный рабочий интерфейс</span>
            <span>Безопасная интеграция с SurveyJS</span>
          </div>
        </section>

        <section className="card login-card">
          <p className="login-kicker">Вход</p>
          <h2 className="login-title">Авторизация</h2>
          <form
            className="login-form"
            onSubmit={(event) => {
              event.preventDefault();
              void onLogin();
            }}
          >
            <div className="login-fields">
              <input value={email} onChange={(e) => setEmail(e.target.value)} placeholder="Электронная почта" />
              <input value={password} onChange={(e) => setPassword(e.target.value)} placeholder="Пароль" type="password" />
            </div>
            <div className="login-actions">
              <button type="submit">Войти</button>
            </div>
          </form>
          {message && (
            <p className={`inline-feedback ${messageType === "error" ? "inline-feedback-error" : "inline-feedback-success"}`.trim()}>
              {message}
            </p>
          )}
        </section>
      </div>
    </div>
  );
```

Add the login-specific styles in `frontend/src/app.css`:

```css
.login-shell {
  width: min(1080px, 100%);
  margin: auto;
  display: grid;
  grid-template-columns: minmax(0, 1.1fr) minmax(340px, 420px);
  gap: 24px;
}

.login-showcase,
.login-card {
  padding: 28px;
  background: var(--surface-strong);
}

.login-showcase {
  display: grid;
  align-content: space-between;
  min-height: 480px;
}

.login-showcase-title {
  margin: 0;
  font-size: clamp(2rem, 4vw, 3.2rem);
  line-height: 1;
  letter-spacing: -0.06em;
}

.login-showcase-points {
  display: flex;
  flex-wrap: wrap;
  gap: 10px;
}

.login-showcase-points span,
.page-kicker,
.login-kicker {
  display: inline-flex;
  align-items: center;
  gap: 8px;
  padding: 6px 10px;
  border-radius: 999px;
  background: var(--accent-soft);
  color: var(--accent-strong);
  font-size: 0.78rem;
  font-weight: 800;
  letter-spacing: 0.05em;
  text-transform: uppercase;
}

.inline-feedback {
  margin: 16px 0 0;
  padding: 12px 14px;
  border-radius: 14px;
  border: 1px solid transparent;
}

.inline-feedback-error {
  background: rgba(254, 226, 226, 0.82);
  border-color: rgba(220, 38, 38, 0.16);
  color: #991b1b;
}

.inline-feedback-success {
  background: rgba(220, 252, 231, 0.84);
  border-color: rgba(22, 163, 74, 0.14);
  color: #166534;
}
```

- [ ] **Step 4: Run the login test and make sure it passes**

Run:

```bash
cd /opt/survey-app-redesign/frontend
npx vitest run src/pages/LoginPage/LoginPage.test.tsx
```

Expected: PASS.

- [ ] **Step 5: Commit the login redesign**

Run:

```bash
cd /opt/survey-app-redesign
git add frontend/src/pages/LoginPage/LoginPage.tsx frontend/src/pages/LoginPage/LoginPage.test.tsx frontend/src/app.css
git commit -m "feat: redesign login experience"
```

---

### Task 3: Turn the Dashboard into a Command Center

**Files:**
- Modify: `frontend/src/pages/DashboardPage/DashboardPage.tsx`
- Modify: `frontend/src/pages/DashboardPage/DashboardPage.test.tsx`
- Modify: `frontend/src/app.css`
- Test: `frontend/src/pages/DashboardPage/DashboardPage.test.tsx`

- [ ] **Step 1: Update the dashboard test to expect the new modules first**

Replace the first dashboard test assertions in `frontend/src/pages/DashboardPage/DashboardPage.test.tsx` with:

```tsx
    expect(await screen.findByRole("heading", { name: "Командный центр форм" })).toBeInTheDocument();
    expect(screen.getByText("Ближайшие дедлайны")).toBeInTheDocument();
    expect(screen.getByText("Недавние формы")).toBeInTheDocument();
    expect(screen.getByText("Всего форм")).toBeInTheDocument();
    expect(screen.getByText("Активные")).toBeInTheDocument();
    expect(screen.getByText("С дедлайном")).toBeInTheDocument();
    expect(screen.getByText("Форма обратной связи")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Показать статистику" })).toBeInTheDocument();

    const responsesLink = screen.getAllByRole("link", { name: "Показать ответы" })[0];
    expect(responsesLink).toHaveAttribute("href", routes.formResponses("form-1"));

    await userEvent.click(screen.getByText("Форма обратной связи"));
    expect(navigate).toHaveBeenCalledWith(`${routes.survey("form-1")}?mode=preview`);
```

Remove the old assertion:

```tsx
    expect(screen.queryByText("Всего форм")).not.toBeInTheDocument();
```

- [ ] **Step 2: Run the dashboard suite and verify it fails**

Run:

```bash
cd /opt/survey-app-redesign/frontend
npx vitest run src/pages/DashboardPage/DashboardPage.test.tsx
```

Expected: FAIL because `Командный центр форм`, `Ближайшие дедлайны`, and `Недавние формы` are not rendered yet.

- [ ] **Step 3: Implement the Command Center layout and remove zebra-striping CSS**

Add the new derived modules in `frontend/src/pages/DashboardPage/DashboardPage.tsx`:

```tsx
  const nearestDeadlineForms = useMemo(
    () =>
      [...visibleForms]
        .filter((form) => !isTemplateForm(form) && Boolean(form.deadline_at) && !isFormDeadlineExpired(form, currentTime))
        .sort((left, right) => new Date(left.deadline_at ?? "").getTime() - new Date(right.deadline_at ?? "").getTime())
        .slice(0, 4),
    [currentTime, visibleForms],
  );

  const recentForms = useMemo(
    () =>
      [...visibleForms]
        .filter((form) => !isTemplateForm(form))
        .sort((left, right) => new Date(right.created_at).getTime() - new Date(left.created_at).getTime())
        .slice(0, 4),
    [visibleForms],
  );
```

Reshape the page body in `frontend/src/pages/DashboardPage/DashboardPage.tsx`:

```tsx
    <div className="dashboard-page dashboard-shell command-center-page">
      <section className="card dashboard-hero command-center-hero">
        <div className="dashboard-hero-copy">
          <span className="dashboard-kicker">{viewMode === "mine" ? "Мои формы" : "Все формы"}</span>
          <h1 className="dashboard-title">Командный центр форм</h1>
          <p className="dashboard-subtitle">
            Следите за дедлайнами, быстрыми действиями и последними формами из одного рабочего пространства.
          </p>
        </div>
        <div className="dashboard-stats">
          <div className="dashboard-stat-card"><span>Всего форм</span><strong>{filteredForms.length}</strong></div>
          <div className="dashboard-stat-card"><span>Активные</span><strong>{activeFormsCount}</strong></div>
          <div className="dashboard-stat-card"><span>С дедлайном</span><strong>{formsWithDeadlineCount}</strong></div>
        </div>
      </section>

      <div className="command-center-grid">
        <section className="card dashboard-module">
          <div className="dashboard-module-header">
            <h2>Ближайшие дедлайны</h2>
            <span>{nearestDeadlineForms.length || "Нет активных дедлайнов"}</span>
          </div>
          <div className="dashboard-priority-list">
            {nearestDeadlineForms.map((form) => (
              <button key={form.id} className="dashboard-priority-item" onClick={() => handleOpenForm(form)}>
                <strong>{getSurveyDisplayTitle(form)}</strong>
                <span>{form.deadline_at ? formatDashboardDate(form.deadline_at) : "Без дедлайна"}</span>
              </button>
            ))}
          </div>
        </section>

        <section className="card dashboard-module">
          <div className="dashboard-module-header">
            <h2>Недавние формы</h2>
            <span>{recentForms.length}</span>
          </div>
          <div className="dashboard-priority-list">
            {recentForms.map((form) => (
              <button key={form.id} className="dashboard-priority-item" onClick={() => handleOpenForm(form)}>
                <strong>{getSurveyDisplayTitle(form)}</strong>
                <span>{formatDashboardDate(form.created_at)}</span>
              </button>
            ))}
          </div>
        </section>
      </div>

      <section className="card dashboard-main-card dashboard-workspace-card">
```

Replace the striped row rules in `frontend/src/app.css` with a single-surface table:

```css
.dashboard-forms-table-wrapper,
.responses-page-table-wrapper {
  overflow-x: auto;
  overflow-y: visible;
  padding: 6px;
  border-radius: 26px;
  background: linear-gradient(180deg, rgba(255, 252, 247, 0.86), rgba(244, 236, 228, 0.92));
  box-shadow: inset 0 1px 0 rgba(255, 255, 255, 0.86), var(--shadow-sm);
}

.dashboard-forms-table,
.responses-table {
  background: rgba(255, 253, 249, 0.96);
  border: 1px solid var(--border-soft);
  box-shadow: var(--shadow-md);
}

.dashboard-forms-table tbody td,
.responses-table tbody td {
  background: rgba(255, 253, 249, 0.96);
}

.dashboard-table-row + .dashboard-table-row td,
.responses-table tbody tr + tr td {
  border-top: 1px solid rgba(155, 126, 89, 0.12);
}

.dashboard-table-row:hover td,
.responses-table tbody tr:hover td {
  background: rgba(255, 247, 239, 0.98);
  border-color: rgba(194, 103, 56, 0.18);
}
```

- [ ] **Step 4: Run the dashboard suite and make sure it passes**

Run:

```bash
cd /opt/survey-app-redesign/frontend
npx vitest run src/pages/DashboardPage/DashboardPage.test.tsx
```

Expected: PASS.

- [ ] **Step 5: Commit the dashboard redesign**

Run:

```bash
cd /opt/survey-app-redesign
git add frontend/src/pages/DashboardPage/DashboardPage.tsx frontend/src/pages/DashboardPage/DashboardPage.test.tsx frontend/src/app.css
git commit -m "feat: redesign dashboard as command center"
```

---

### Task 4: Redesign the Public Survey Shell Safely

**Files:**
- Create: `frontend/src/pages/SurveyPage/SurveyPage.test.tsx`
- Modify: `frontend/src/pages/SurveyPage/SurveyPage.tsx`
- Modify: `frontend/src/features/render-form/SurveyFormRenderer.tsx`
- Modify: `frontend/src/features/render-form/SurveyFormRenderer.test.tsx`
- Modify: `frontend/src/app.css`
- Test: `frontend/src/pages/SurveyPage/SurveyPage.test.tsx`
- Test: `frontend/src/features/render-form/SurveyFormRenderer.test.tsx`

- [ ] **Step 1: Write the failing public survey shell test**

Create `frontend/src/pages/SurveyPage/SurveyPage.test.tsx`:

```tsx
import { render, screen } from "@testing-library/react";
import { MemoryRouter, Route, Routes } from "react-router-dom";
import { describe, expect, it, vi } from "vitest";
import { routes } from "../../app/routes";
import SurveyPage from "./SurveyPage";

const useQueryMock = vi.fn();

vi.mock("@tanstack/react-query", () => ({
  useQuery: () => useQueryMock(),
}));

vi.mock("../../widgets/SurveyRenderer/SurveyRenderer", () => ({
  SurveyRenderer: () => <div>Survey renderer stub</div>,
}));

describe("SurveyPage", () => {
  it("renders the redesigned public shell around the survey", () => {
    useQueryMock.mockReturnValue({
      data: {
        id: "form-1",
        title: "Опрос сотрудников",
        schema: { pages: [] },
      },
      isLoading: false,
      error: null,
    });

    render(
      <MemoryRouter initialEntries={[routes.survey("form-1")]}>
        <Routes>
          <Route path={routes.surveyById} element={<SurveyPage />} />
        </Routes>
      </MemoryRouter>,
    );

    expect(screen.getByRole("heading", { name: "Опрос сотрудников" })).toBeInTheDocument();
    expect(screen.getByText("Заполните форму и отправьте ответ")).toBeInTheDocument();
    expect(screen.getByText("Survey renderer stub")).toBeInTheDocument();
  });
});
```

Expand `frontend/src/features/render-form/SurveyFormRenderer.test.tsx` with:

```tsx
    expect(await screen.findByText(/Ошибка отправки:/)).toHaveClass("survey-inline-feedback");
```

- [ ] **Step 2: Run the public survey tests and verify they fail**

Run:

```bash
cd /opt/survey-app-redesign/frontend
npx vitest run \
  src/pages/SurveyPage/SurveyPage.test.tsx \
  src/features/render-form/SurveyFormRenderer.test.tsx
```

Expected: FAIL because the public shell copy and feedback class do not exist yet.

- [ ] **Step 3: Implement the public shell and scoped inline feedback**

Update `frontend/src/pages/SurveyPage/SurveyPage.tsx`:

```tsx
  if (!id) return <p>Форма не найдена.</p>;
  if (isLoading) return <p>Загрузка...</p>;
  if (errorMessage) return <p>Ошибка: {errorMessage}</p>;
  if (!form) return <p>Форма не найдена или недоступна.</p>;

  return (
    <div className="survey-page survey-page-shell">
      <section className="card survey-page-hero">
        <span className="page-kicker">{isPreviewMode ? "Preview" : "Открытая форма"}</span>
        <h1 className="survey-page-title">{form.title}</h1>
        <p className="survey-page-subtitle">
          {isPreviewMode ? "Заполните форму в режиме предварительного просмотра." : "Заполните форму и отправьте ответ."}
        </p>
      </section>
      <div className={`survey-page-card card ${isPreviewMode ? "survey-page-card-preview" : ""}`.trim()}>
        <SurveyRenderer schema={form.schema} formId={form.id} isPreviewMode={isPreviewMode} />
      </div>
    </div>
  );
```

Update `frontend/src/features/render-form/SurveyFormRenderer.tsx`:

```tsx
  return (
    <>
      {isSubmitting && <p className="survey-inline-feedback survey-inline-feedback-muted">Отправка ответа...</p>}
      {submitError && <p className="survey-inline-feedback survey-inline-feedback-error">Ошибка отправки: {submitError}</p>}
      <Survey model={model} />
    </>
  );
```

Add the public-shell styles in `frontend/src/app.css` while keeping SurveyJS selectors scoped:

```css
.survey-page-shell {
  width: min(980px, 100%);
  margin: 0 auto;
  display: grid;
  gap: 18px;
}

.survey-page-hero {
  padding: 24px 28px;
  background: var(--surface-strong);
}

.survey-page-title {
  margin: 10px 0 8px;
  font-size: clamp(2rem, 4vw, 2.8rem);
  letter-spacing: -0.05em;
}

.survey-inline-feedback {
  margin: 0 0 12px;
  padding: 12px 14px;
  border-radius: 14px;
}

.survey-inline-feedback-muted {
  background: rgba(255, 247, 237, 0.84);
  color: #9a6700;
}

.survey-inline-feedback-error {
  background: rgba(254, 226, 226, 0.84);
  color: #991b1b;
}
```

- [ ] **Step 4: Run the public survey tests and make sure they pass**

Run:

```bash
cd /opt/survey-app-redesign/frontend
npx vitest run \
  src/pages/SurveyPage/SurveyPage.test.tsx \
  src/features/render-form/SurveyFormRenderer.test.tsx
```

Expected: PASS.

- [ ] **Step 5: Commit the public survey redesign**

Run:

```bash
cd /opt/survey-app-redesign
git add frontend/src/pages/SurveyPage/SurveyPage.tsx frontend/src/pages/SurveyPage/SurveyPage.test.tsx frontend/src/features/render-form/SurveyFormRenderer.tsx frontend/src/features/render-form/SurveyFormRenderer.test.tsx frontend/src/app.css
git commit -m "feat: redesign public survey shell"
```

---

### Task 5: Redesign the Form Responses Workspace

**Files:**
- Modify: `frontend/src/pages/FormResponsesPage/FormResponsesPage.tsx`
- Modify: `frontend/src/pages/FormResponsesPage/FormResponsesPage.test.tsx`
- Modify: `frontend/src/app.css`
- Test: `frontend/src/pages/FormResponsesPage/FormResponsesPage.test.tsx`

- [ ] **Step 1: Update the responses test to expect summary modules**

Add these assertions to `frontend/src/pages/FormResponsesPage/FormResponsesPage.test.tsx`:

```tsx
    expect(screen.getByText("Всего ответов")).toBeInTheDocument();
    expect(screen.getByText("Последний ответ")).toBeInTheDocument();
```

- [ ] **Step 2: Run the responses test and verify it fails**

Run:

```bash
cd /opt/survey-app-redesign/frontend
npx vitest run src/pages/FormResponsesPage/FormResponsesPage.test.tsx
```

Expected: FAIL because the summary labels are not rendered yet.

- [ ] **Step 3: Implement the responses header and summary modules**

Update `frontend/src/pages/FormResponsesPage/FormResponsesPage.tsx`:

```tsx
  const latestResponseAt = responsesQuery.data?.length
    ? new Date(
        [...responsesQuery.data].sort(
          (left, right) => new Date(right.created_at).getTime() - new Date(left.created_at).getTime(),
        )[0].created_at,
      ).toLocaleString("ru-RU")
    : "Пока нет ответов";

  return (
    <div className="dashboard-page dashboard-shell responses-page-shell">
      <section className="card responses-page-hero">
        <div className="responses-page-header">
          <div>
            <p className="page-kicker">Аналитика формы</p>
            <h1 className="responses-page-title">{formQuery.data?.title ?? "Ответы формы"}</h1>
          </div>
          <div className="responses-page-actions">
            <button className="dashboard-refresh-button responses-page-export-button" onClick={handleExport} disabled={isLoading || !rows.length}>
              Выгрузить в XLSX
            </button>
            <button className="dashboard-refresh-button" onClick={() => void handleRefresh()} disabled={isFetching}>
              <img src={refreshIcon} alt="" aria-hidden="true" className="toolbar-icon" />
              <span>{isFetching ? "Обновляется..." : "Обновить"}</span>
            </button>
          </div>
        </div>

        <div className="responses-summary-grid">
          <div className="dashboard-stat-card"><span>Всего ответов</span><strong>{rows.length}</strong></div>
          <div className="dashboard-stat-card"><span>Последний ответ</span><strong>{latestResponseAt}</strong></div>
        </div>
      </section>
```

Add the responses-specific layout styles in `frontend/src/app.css`:

```css
.responses-page-shell {
  gap: 18px;
}

.responses-page-hero {
  padding: 20px;
  background: var(--surface-strong);
}

.responses-summary-grid {
  display: grid;
  grid-template-columns: repeat(2, minmax(0, 1fr));
  gap: 12px;
  margin-top: 16px;
}
```

- [ ] **Step 4: Run the responses test and make sure it passes**

Run:

```bash
cd /opt/survey-app-redesign/frontend
npx vitest run src/pages/FormResponsesPage/FormResponsesPage.test.tsx
```

Expected: PASS.

- [ ] **Step 5: Commit the responses redesign**

Run:

```bash
cd /opt/survey-app-redesign
git add frontend/src/pages/FormResponsesPage/FormResponsesPage.tsx frontend/src/pages/FormResponsesPage/FormResponsesPage.test.tsx frontend/src/app.css
git commit -m "feat: redesign form responses workspace"
```

---

### Task 6: Redesign the Users Admin Screen

**Files:**
- Create: `frontend/src/pages/UsersPage/UsersPage.test.tsx`
- Modify: `frontend/src/pages/UsersPage/UsersPage.tsx`
- Modify: `frontend/src/app.css`
- Test: `frontend/src/pages/UsersPage/UsersPage.test.tsx`

- [ ] **Step 1: Write the failing users page layout test**

Create `frontend/src/pages/UsersPage/UsersPage.test.tsx`:

```tsx
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import UsersPage from "./UsersPage";

const getAllUsers = vi.fn().mockResolvedValue([
  {
    id: "user-1",
    name: "Анна",
    email: "anna@example.com",
    role: "admin",
    is_disabled: false,
    created_at: "2026-04-08T10:00:00.000Z",
  },
]);

vi.mock("../../app/providers/AuthProvider", () => ({
  useAuth: () => ({
    user: { id: "admin-1" },
    loading: false,
  }),
}));

vi.mock("../../app/providers/ToastProvider", () => ({
  useToast: () => ({
    showToast: vi.fn(),
  }),
}));

vi.mock("../../features/users/api", () => ({
  createUser: vi.fn(),
  deleteUser: vi.fn(),
  getAllUsers,
  setUserDisabled: vi.fn(),
  updateMyPassword: vi.fn(),
  updateUserPassword: vi.fn(),
}));

describe("UsersPage", () => {
  it("renders the control module and user table module", async () => {
    const queryClient = new QueryClient({
      defaultOptions: {
        queries: { retry: false },
        mutations: { retry: false },
      },
    });

    render(
      <QueryClientProvider client={queryClient}>
        <UsersPage />
      </QueryClientProvider>,
    );

    expect(screen.getByRole("heading", { name: "Пользователи" })).toBeInTheDocument();
    expect(screen.getByText("Создание пользователя")).toBeInTheDocument();
    expect(await screen.findByRole("columnheader", { name: "Статус" })).toBeInTheDocument();
  });
});
```

- [ ] **Step 2: Run the users page test and verify it fails**

Run:

```bash
cd /opt/survey-app-redesign/frontend
npx vitest run src/pages/UsersPage/UsersPage.test.tsx
```

Expected: FAIL because the page does not render `Создание пользователя` as a dedicated module yet.

- [ ] **Step 3: Implement the modular users layout**

Update `frontend/src/pages/UsersPage/UsersPage.tsx`:

```tsx
  return (
    <div className="dashboard-page dashboard-shell users-page-shell">
      <section className="card users-page-hero">
        <p className="page-kicker">Администрирование</p>
        <h1 className="responses-page-title">Пользователи</h1>
      </section>

      <div className="users-page-grid">
        <section className="card users-control-card">
          <h2>Создание пользователя</h2>
          <div className="users-control-fields">
            <input value={newUser.name} onChange={(e) => setNewUser((prev) => ({ ...prev, name: e.target.value }))} placeholder="Имя" />
            <input value={newUser.email} onChange={(e) => setNewUser((prev) => ({ ...prev, email: e.target.value }))} placeholder="Email" />
            <input
              type="password"
              value={newUser.password}
              onChange={(e) => setNewUser((prev) => ({ ...prev, password: e.target.value }))}
              placeholder="Пароль (минимум 8 символов)"
            />
            <select value={newUser.role} onChange={(e) => setNewUser((prev) => ({ ...prev, role: e.target.value as UserRole }))}>
              <option value="user">user</option>
              <option value="admin">admin</option>
            </select>
          </div>
          <div className="users-control-actions">
            <button onClick={() => void onCreateUser()} disabled={createUserMutation.isPending || !isPasswordValid}>
              Создать пользователя
            </button>
            <button onClick={() => openPasswordModal(user?.id ?? "", "Смена моего пароля", true)} disabled={!user}>
              Сменить мой пароль
            </button>
          </div>
        </section>

        <section className="card users-table-card">
          <h2>Список пользователей</h2>
          {isAuthLoading || usersQuery.isLoading ? (
            <p className="dashboard-loading-text">Загрузка пользователей...</p>
          ) : !user ? (
            <p className="inline-feedback inline-feedback-error">Требуется авторизация для просмотра пользователей.</p>
          ) : usersQuery.isError ? (
            <div className="inline-feedback inline-feedback-error">
              <p style={{ margin: 0 }}>{getErrorMessage(usersQuery.error, "Не удалось загрузить пользователей")}</p>
              <button onClick={() => void usersQuery.refetch()} style={{ marginTop: 8 }}>
                Повторить
              </button>
            </div>
          ) : (
            <div className="responses-page-table-wrapper">
              <table className="responses-table">
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
                <tbody>
                  {(usersQuery.data ?? []).map((profile) => {
                    const isOwnUser = profile.id === user?.id;

                    return (
                      <tr key={profile.id}>
                        <td>{profile.name || "—"}</td>
                        <td>{profile.email}</td>
                        <td>{profile.role}</td>
                        <td>
                          <span className={profile.is_disabled ? "user-status-disabled" : "user-status-active"}>
                            {profile.is_disabled ? "Отключён" : "Активен"}
                          </span>
                        </td>
                        <td>{profile.created_at ? new Date(profile.created_at).toLocaleString("ru-RU") : "—"}</td>
                        <td>
                          <div className="users-row-actions">
                            <button
                              onClick={() =>
                                openPasswordModal(
                                  profile.id,
                                  isOwnUser ? "Смена моего пароля" : `Смена пароля: ${profile.name || profile.email}`,
                                  isOwnUser,
                                )
                              }
                            >
                              Сменить пароль
                            </button>
                            <button
                              onClick={() =>
                                void setUserDisabledMutation.mutateAsync({
                                  userId: profile.id,
                                  disabled: !profile.is_disabled,
                                })
                              }
                              disabled={setUserDisabledMutation.isPending || isOwnUser}
                            >
                              {profile.is_disabled ? "Включить" : "Отключить"}
                            </button>
                            <button
                              onClick={() =>
                                setDeleteUserModal({
                                  userId: profile.id,
                                  userName: profile.name || profile.email,
                                })
                              }
                              disabled={deleteUserMutation.isPending || isOwnUser}
                            >
                              Удалить
                            </button>
                          </div>
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          )}
        </section>
      </div>
```

Add the users-specific layout styles in `frontend/src/app.css`:

```css
.users-page-shell {
  gap: 18px;
}

.users-page-grid {
  display: grid;
  grid-template-columns: minmax(280px, 360px) minmax(0, 1fr);
  gap: 18px;
}

.users-control-card,
.users-table-card,
.users-page-hero {
  padding: 20px;
  background: var(--surface-strong);
}

.users-control-fields {
  display: grid;
  gap: 10px;
  margin: 16px 0;
}

.users-control-actions {
  display: flex;
  flex-wrap: wrap;
  gap: 10px;
}

.users-row-actions {
  display: flex;
  flex-wrap: wrap;
  gap: 8px;
}
```

- [ ] **Step 4: Run the users page test and make sure it passes**

Run:

```bash
cd /opt/survey-app-redesign/frontend
npx vitest run src/pages/UsersPage/UsersPage.test.tsx
```

Expected: PASS.

- [ ] **Step 5: Commit the users page redesign**

Run:

```bash
cd /opt/survey-app-redesign
git add frontend/src/pages/UsersPage/UsersPage.tsx frontend/src/pages/UsersPage/UsersPage.test.tsx frontend/src/app.css
git commit -m "feat: redesign users admin screen"
```

---

### Task 7: Polish the Builder Shell Without Touching Survey Creator Behavior

**Files:**
- Create: `frontend/src/pages/BuilderPage/BuilderPage.test.tsx`
- Modify: `frontend/src/pages/BuilderPage/BuilderPage.tsx`
- Modify: `frontend/src/app.css`
- Test: `frontend/src/pages/BuilderPage/BuilderPage.test.tsx`

- [ ] **Step 1: Write the failing builder shell test**

Create `frontend/src/pages/BuilderPage/BuilderPage.test.tsx`:

```tsx
import { render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import BuilderPage from "./BuilderPage";

vi.mock("react-router-dom", async () => {
  const actual = await vi.importActual<typeof import("react-router-dom")>("react-router-dom");
  return {
    ...actual,
    useParams: () => ({ id: "form-1" }),
  };
});

vi.mock("../../widgets/SurveyBuilder/SurveyBuilder", () => ({
  SurveyBuilder: () => <div data-testid="survey-builder">Survey builder stub</div>,
}));

describe("BuilderPage", () => {
  it("renders the builder intro shell above the builder host", () => {
    render(<BuilderPage />);

    expect(screen.getByRole("heading", { name: "Редактирование формы" })).toBeInTheDocument();
    expect(screen.getByText("Соберите структуру, проверьте preview и публикуйте форму после проверки.")).toBeInTheDocument();
    expect(screen.getByTestId("survey-builder")).toBeInTheDocument();
  });
});
```

- [ ] **Step 2: Run the builder shell test and verify it fails**

Run:

```bash
cd /opt/survey-app-redesign/frontend
npx vitest run src/pages/BuilderPage/BuilderPage.test.tsx
```

Expected: FAIL because the builder intro shell is not rendered yet.

- [ ] **Step 3: Implement the builder intro shell and warm scoped builder polish**

Update `frontend/src/pages/BuilderPage/BuilderPage.tsx`:

```tsx
export default function BuilderPage() {
  const { id } = useParams();

  return (
    <div className="builder-page builder-page-shell">
      <section className="card builder-intro-card">
        <p className="page-kicker">Конструктор</p>
        <h1 className="builder-intro-title">{id ? "Редактирование формы" : "Новая форма"}</h1>
        <p className="builder-intro-subtitle">
          Соберите структуру, проверьте preview и публикуйте форму после проверки.
        </p>
      </section>

      <div className="builder-container">
        <SurveyBuilder formId={id} />
      </div>
    </div>
  );
}
```

Retune only the scoped builder rules in `frontend/src/app.css`:

```css
.builder-page-shell {
  gap: 18px;
}

.builder-intro-card {
  padding: 20px 24px;
  background: var(--surface-strong);
}

.builder-creator-shell .svc-creator {
  --sjs-primary-backcolor: #c26738;
  --sjs-primary-backcolor-dark: #a94b20;
  --sjs-primary-backcolor-light: rgba(194, 103, 56, 0.14);
  --sjs-general-backcolor: #fffaf5;
  --sjs-general-backcolor-dim: #f6ede3;
  --sjs-general-backcolor-dim-light: #fbf5ee;
  --sjs-general-backcolor-dark: #eadbcf;
  --sjs-general-forecolor: #2b2118;
  --sjs-general-forecolor-light: #6d5d4d;
  background:
    radial-gradient(circle at top right, rgba(251, 191, 36, 0.16), transparent 24%),
    radial-gradient(circle at top left, rgba(251, 113, 133, 0.1), transparent 28%),
    linear-gradient(180deg, #fffaf5 0%, #f6ede3 100%);
}
```

- [ ] **Step 4: Run the builder shell test and make sure it passes**

Run:

```bash
cd /opt/survey-app-redesign/frontend
npx vitest run src/pages/BuilderPage/BuilderPage.test.tsx
```

Expected: PASS.

- [ ] **Step 5: Commit the builder shell polish**

Run:

```bash
cd /opt/survey-app-redesign
git add frontend/src/pages/BuilderPage/BuilderPage.tsx frontend/src/pages/BuilderPage/BuilderPage.test.tsx frontend/src/app.css
git commit -m "feat: polish builder shell safely"
```

---

### Task 8: Run Full Regression and Finish the Redesign Branch

**Files:**
- Create: none
- Modify: none unless regression fixes are required
- Test: all focused redesign tests plus a production build

- [ ] **Step 1: Run the focused redesign test suite**

Run:

```bash
cd /opt/survey-app-redesign/frontend
npx vitest run \
  src/widgets/Sidebar/Sidebar.test.tsx \
  src/pages/LoginPage/LoginPage.test.tsx \
  src/pages/DashboardPage/DashboardPage.test.tsx \
  src/pages/SurveyPage/SurveyPage.test.tsx \
  src/features/render-form/SurveyFormRenderer.test.tsx \
  src/pages/FormResponsesPage/FormResponsesPage.test.tsx \
  src/pages/UsersPage/UsersPage.test.tsx \
  src/pages/BuilderPage/BuilderPage.test.tsx
```

Expected: PASS.

- [ ] **Step 2: Run a production build**

Run:

```bash
cd /opt/survey-app-redesign/frontend
npm run build
```

Expected: build succeeds with no TypeScript or bundling regressions.

- [ ] **Step 3: Do the manual visual verification checklist**

Check these flows in the browser:

```text
1. Dashboard shows Command Center hero, KPI row, nearest deadlines, recent forms, and a non-striped forms workspace.
2. Forms table keeps copy-link, duplicate, rename, edit, export, deadline, delete, and open behavior.
3. Login page uses the new editorial shell and still handles failed login messaging.
4. Public survey page shows the new shell and still submits, previews, uploads files, and shows completion.
5. Users page keeps create/change-password/enable-disable/delete flows.
6. Responses page keeps refresh/export and renders the redesigned summary shell.
7. Builder opens, toolbox works, preview works, and Survey Creator remains fully interactive.
```

Expected: all visual and interaction checks pass without SurveyJS regressions.

- [ ] **Step 4: Commit only if regression fixes were required**

Run only if you had to patch files during the regression pass:

```bash
cd /opt/survey-app-redesign
git add frontend/src/app.css frontend/src/pages frontend/src/widgets frontend/src/features
git commit -m "fix: finish redesign regression cleanup"
```

---

## Self-Review Notes

### Spec Coverage

- `Editorial Warm` tokens and shell: Tasks 1-7
- `Command Center` dashboard: Task 3
- remove zebra striping: Task 3 plus Task 5 shared table styles
- full-site scope including login/public/admin/builder: Tasks 2-7
- SurveyJS safety: Task 4 and Task 7 scoped CSS changes

### Placeholder Scan

- No `TODO`, `TBD`, or “follow existing pattern” placeholders remain.
- Each task lists exact files and exact commands.
- Each code-changing step includes concrete code snippets.

### Type Consistency

- Shared shell naming stays consistent across tasks: `page-shell`, `page-kicker`, `inline-feedback`, `survey-inline-feedback`.
- Dashboard naming stays consistent: `command-center-page`, `dashboard-module`, `dashboard-priority-list`.
- Builder and SurveyJS scoping stays consistent: `.builder-creator-shell`, `.survey-page-card`.
