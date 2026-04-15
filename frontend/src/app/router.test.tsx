import { describe, expect, it, vi } from "vitest";
import { routes } from "./routes";

const pageLoads = vi.hoisted(() => ({
  builder: 0,
  dashboard: 0,
  responses: 0,
  responsesHtml: 0,
  survey: 0,
  templates: 0,
  users: 0,
}));

vi.mock("../pages/BuilderPage/BuilderPage", () => {
  pageLoads.builder += 1;
  return { default: () => null };
});

vi.mock("../pages/DashboardPage/DashboardPage", () => {
  pageLoads.dashboard += 1;
  return { default: () => null };
});

vi.mock("../pages/FormResponsesPage/FormResponsesPage", () => {
  pageLoads.responses += 1;
  return { default: () => null };
});

vi.mock("../pages/FormResponsesHtmlPage/FormResponsesHtmlPage", () => {
  pageLoads.responsesHtml += 1;
  return { default: () => null };
});

vi.mock("../pages/SurveyPage/SurveyPage", () => {
  pageLoads.survey += 1;
  return { default: () => null };
});

vi.mock("../pages/TemplatesPage/TemplatesPage", () => {
  pageLoads.templates += 1;
  return { default: () => null };
});

vi.mock("../pages/UsersPage/UsersPage", () => {
  pageLoads.users += 1;
  return { default: () => null };
});

vi.mock("./layout/AppLayout", () => ({
  AppLayout: () => null,
}));

vi.mock("./router/AdminRoute", () => ({
  AdminRoute: ({ children }: { children: unknown }) => children,
}));

vi.mock("./router/ProtectedRoute", () => ({
  ProtectedRoute: ({ children }: { children: unknown }) => children,
}));

describe("router", () => {
  it("registers the expected routes and keeps page imports eager for preview compatibility", async () => {
    const { router } = await import("./router");
    const rootRoute = router.routes[0];
    const childPaths = (rootRoute.children ?? []).map((route) => route.path);

    expect(childPaths).toEqual(
      expect.arrayContaining([
        routes.home,
        routes.dashboardMy,
        routes.dashboardAll,
        routes.templates,
        routes.formResponsesById,
        routes.formResponsesHtmlById,
        routes.surveyById,
        routes.legacySurveyById,
        routes.builder,
        routes.builderById,
        routes.users,
        routes.login,
        "*",
      ]),
    );

    expect(pageLoads.builder).toBe(1);
    expect(pageLoads.dashboard).toBe(1);
    expect(pageLoads.responses).toBe(1);
    expect(pageLoads.responsesHtml).toBe(1);
    expect(pageLoads.survey).toBe(1);
    expect(pageLoads.templates).toBe(1);
    expect(pageLoads.users).toBe(1);
  });
});
