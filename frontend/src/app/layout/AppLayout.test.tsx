import { render, screen } from "@testing-library/react";
import { MemoryRouter, Route, Routes } from "react-router-dom";
import { describe, expect, it, vi } from "vitest";
import { AppLayout } from "./AppLayout";
import { routes } from "../routes";

vi.mock("../providers/ToastProvider", () => ({
  useToast: () => ({
    showToast: vi.fn(),
  }),
}));

vi.mock("../../widgets/Sidebar/Sidebar", () => ({
  Sidebar: () => <aside data-testid="app-sidebar">Все формы</aside>,
}));

function renderLayout(pathname: string) {
  return render(
    <MemoryRouter initialEntries={[pathname]}>
      <Routes>
        <Route element={<AppLayout />}>
          <Route path={routes.builder} element={<div>Конструктор</div>} />
          <Route path={routes.builderById} element={<div>Конструктор</div>} />
          <Route path={routes.dashboardMy} element={<div>Мои формы</div>} />
        </Route>
      </Routes>
    </MemoryRouter>,
  );
}

describe("AppLayout", () => {
  it.each([routes.builder, routes.builderEdit("form-42")])(
    "keeps the app sidebar on builder route %s by default",
    (pathname) => {
      renderLayout(pathname);

      expect(screen.getByTestId("app-sidebar")).toBeInTheDocument();
      expect(screen.getByRole("main")).not.toHaveClass("app-main-builder");
      expect(screen.getByRole("main")).not.toHaveClass("app-main-login");
      expect(screen.getByText("Конструктор")).toBeInTheDocument();
    },
  );

  it("keeps the app sidebar on dashboard routes", () => {
    renderLayout(routes.dashboardMy);

    expect(screen.getByTestId("app-sidebar")).toBeInTheDocument();
    expect(screen.getByRole("main")).not.toHaveClass("app-main-builder");
  });
});
