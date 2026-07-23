import { render, screen } from "@testing-library/react";
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
      loading: false,
      profileLoading: false,
      profile: { role: "user" },
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
      loading: false,
      profileLoading: false,
      profile: { role: "admin" },
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
});
