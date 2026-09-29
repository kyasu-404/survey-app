import { fireEvent, render, screen } from "@testing-library/react";
import { MemoryRouter, Route, Routes, useLocation } from "react-router-dom";
import { afterEach, describe, expect, it, vi } from "vitest";
import { AdminRoute } from "./AdminRoute";
import { ProtectedRoute } from "./ProtectedRoute";
import { routes } from "../routes";

const { useAuth } = vi.hoisted(() => ({
  useAuth: vi.fn(),
}));

vi.mock("../providers/AuthProvider", () => ({
  useAuth,
}));

function LoginLocationProbe() {
  const location = useLocation();
  const fromPathname = (location.state as { from?: { pathname?: string } } | null)?.from?.pathname ?? "";

  return (
    <div data-testid="login-location">
      {location.pathname}|{fromPathname}
    </div>
  );
}

describe("route guards", () => {
  afterEach(() => {
    vi.resetAllMocks();
  });

  it("shows the auth check message while a protected route is loading", () => {
    useAuth.mockReturnValue({
      user: null,
      loading: true,
    });

    render(
      <MemoryRouter initialEntries={[routes.dashboardMy]}>
        <ProtectedRoute>
          <div>private content</div>
        </ProtectedRoute>
      </MemoryRouter>,
    );

    expect(screen.getByText("Проверка авторизации...")).toBeInTheDocument();
    expect(screen.queryByText("private content")).not.toBeInTheDocument();
  });

  it("redirects anonymous users to login and keeps the original location in state", () => {
    useAuth.mockReturnValue({
      user: null,
      loading: false,
    });

    render(
      <MemoryRouter initialEntries={[routes.dashboardMy]}>
        <Routes>
          <Route
            path={routes.dashboardMy}
            element={
              <ProtectedRoute>
                <div>private content</div>
              </ProtectedRoute>
            }
          />
          <Route path={routes.login} element={<LoginLocationProbe />} />
        </Routes>
      </MemoryRouter>,
    );

    expect(screen.getByTestId("login-location")).toHaveTextContent(`${routes.login}|${routes.dashboardMy}`);
  });

  it("renders children for an authenticated protected route", () => {
    useAuth.mockReturnValue({
      user: { id: "user-1" },
      loading: false,
    });

    render(
      <MemoryRouter initialEntries={[routes.dashboardMy]}>
        <ProtectedRoute>
          <div>private content</div>
        </ProtectedRoute>
      </MemoryRouter>,
    );

    expect(screen.getByText("private content")).toBeInTheDocument();
  });

  it("shows the admin access check while the admin route is loading", () => {
    useAuth.mockReturnValue({
      loading: true,
      profileLoading: false,
      profile: null,
    });

    render(
      <MemoryRouter initialEntries={[routes.users]}>
        <AdminRoute>
          <div>admin content</div>
        </AdminRoute>
      </MemoryRouter>,
    );

    expect(screen.getByText("Проверка прав доступа...")).toBeInTheDocument();
    expect(screen.queryByText("admin content")).not.toBeInTheDocument();
  });

  it("keeps the admin route pending while the profile is still loading", () => {
    useAuth.mockReturnValue({
      loading: false,
      profileLoading: true,
      profile: null,
    });

    render(
      <MemoryRouter initialEntries={[routes.users]}>
        <AdminRoute>
          <div>admin content</div>
        </AdminRoute>
      </MemoryRouter>,
    );

    expect(screen.getByText("Проверка прав доступа...")).toBeInTheDocument();
    expect(screen.queryByText("admin content")).not.toBeInTheDocument();
  });

  it("redirects a non-admin user back to the dashboard", () => {
    useAuth.mockReturnValue({
      user: { id: "user-1" },
      loading: false,
      profileLoading: false,
      profile: { id: "user-1", role: "user" },
    });

    render(
      <MemoryRouter initialEntries={[routes.users]}>
        <Routes>
          <Route
            path={routes.users}
            element={
              <AdminRoute>
                <div>admin content</div>
              </AdminRoute>
            }
          />
          <Route path={routes.dashboardMy} element={<div>dashboard content</div>} />
        </Routes>
      </MemoryRouter>,
    );

    expect(screen.getByText("dashboard content")).toBeInTheDocument();
  });

  it("renders children for admin profiles", () => {
    useAuth.mockReturnValue({
      user: { id: "user-1" },
      loading: false,
      profileLoading: false,
      profile: { id: "user-1", role: "admin" },
    });

    render(
      <MemoryRouter initialEntries={[routes.users]}>
        <AdminRoute>
          <div>admin content</div>
        </AdminRoute>
      </MemoryRouter>,
    );

    expect(screen.getByText("admin content")).toBeInTheDocument();
  });

  it("preserves unsaved input while refreshing the same administrator's profile", () => {
    const auth = {
      user: { id: "user-1" }, loading: false, profileLoading: false,
      profile: { id: "user-1", role: "admin" },
    };
    useAuth.mockReturnValue(auth);
    const content = <MemoryRouter><AdminRoute><input aria-label="Draft" defaultValue="" /></AdminRoute></MemoryRouter>;
    const { rerender } = render(content);
    const input = screen.getByRole("textbox", { name: "Draft" });
    fireEvent.change(input, { target: { value: "Unsaved settings" } });

    for (const profileLoading of [true, false]) {
      useAuth.mockReturnValue({ ...auth, profileLoading });
      rerender(<MemoryRouter><AdminRoute><input aria-label="Draft" defaultValue="" /></AdminRoute></MemoryRouter>);
      expect(screen.getByRole("textbox", { name: "Draft" })).toBe(input);
      expect(input).toHaveValue("Unsaved settings");
    }
  });

  it("does not reuse the previous administrator's profile when the account changes", () => {
    useAuth.mockReturnValue({
      user: { id: "user-2" }, loading: false, profileLoading: true,
      profile: { id: "user-1", role: "admin" },
    });
    render(<MemoryRouter><AdminRoute><div>admin content</div></AdminRoute></MemoryRouter>);
    expect(screen.getByText("Проверка прав доступа...")).toBeInTheDocument();
    expect(screen.queryByText("admin content")).not.toBeInTheDocument();
  });

  it.each([
    { id: "user-1", role: "user", is_disabled: false },
    { id: "user-1", role: "admin", is_disabled: true },
    null,
  ])("removes admin content when a refreshed profile loses access: %j", (profile) => {
    const auth = { user: { id: "user-1" }, loading: false, profileLoading: false };
    useAuth.mockReturnValue({ ...auth, profile: { id: "user-1", role: "admin" } });
    const content = () => (
      <MemoryRouter initialEntries={[routes.settings]}>
        <Routes>
          <Route path={routes.settings} element={<AdminRoute><div>admin content</div></AdminRoute>} />
          <Route path={routes.dashboardMy} element={<div>dashboard content</div>} />
        </Routes>
      </MemoryRouter>
    );
    const { rerender } = render(content());
    expect(screen.getByText("admin content")).toBeInTheDocument();
    useAuth.mockReturnValue({ ...auth, profile });
    rerender(content());
    expect(screen.queryByText("admin content")).not.toBeInTheDocument();
    expect(screen.getByText("dashboard content")).toBeInTheDocument();
  });
});
