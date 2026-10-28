import { describe, expect, it, vi } from "vitest";
import { routes } from "./routes";

const pageLoads = vi.hoisted(() => ({
  builder: 0,
  dashboard: 0,
  responses: 0,
  responsesHtml: 0,
  survey: 0,
  templates: 0,
  organizations: 0,
  users: 0,
  settings: 0,
  login: 0,
  layout: 0,
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

vi.mock("../pages/OrganizationsPage/OrganizationsPage", () => {
  pageLoads.organizations += 1;
  return { default: () => null };
});

vi.mock("../pages/UsersPage/UsersPage", () => {
  pageLoads.users += 1;
  return { default: () => null };
});

vi.mock("../pages/SettingsPage/SettingsPage", () => {
  pageLoads.settings += 1;
  return { default: () => null };
});

vi.mock("./layout/AppLayout", () => { pageLoads.layout += 1; return { AppLayout: () => null }; });
vi.mock("../pages/LoginPage/LoginPage", () => { pageLoads.login += 1; return { default: () => null }; });

vi.mock("./router/AdminRoute", () => ({
  AdminRoute: ({ children }: { children: unknown }) => children,
}));

vi.mock("./router/ProtectedRoute", () => ({
  ProtectedRoute: ({ children }: { children: unknown }) => children,
}));

describe("router", () => {
  it("loads public forms without loading the dashboard, login or private layout", async () => {
    window.history.replaceState(null, "", "/form/public-test");
    const { router } = await import("./router");
    const childRoutes = router.routes.flatMap(route => route.children ?? []);
    const childPaths = childRoutes.map((route) => route.path);
    const routeByPath = new Map(childRoutes.map((route) => [route.path, route]));

    expect(childPaths).toEqual(
      expect.arrayContaining([
        routes.home,
        routes.dashboardMy,
        routes.dashboardAll,
        routes.templates,
        routes.organizations,
        routes.formResponsesById,
        routes.formResponsesHtmlById,
        routes.surveyById,
        routes.legacySurveyById,
        routes.builder,
        routes.builderById,
        routes.users,
        routes.settings,
        routes.login,
        "*",
      ]),
    );

    expect(routeByPath.get(routes.builder)?.lazy).toBeTypeOf("function");
    expect(routeByPath.get(routes.builderById)?.lazy).toBeTypeOf("function");
    expect(routeByPath.get(routes.formResponsesById)?.lazy).toBeTypeOf("function");
    expect(routeByPath.get(routes.formResponsesHtmlById)?.lazy).toBeTypeOf("function");
    expect(routeByPath.get(routes.surveyById)?.lazy).toBeTypeOf("function");
    expect(routeByPath.get(routes.templates)?.lazy).toBeTypeOf("function");
    expect(routeByPath.get(routes.organizations)?.lazy).toBeTypeOf("function");
    expect(routeByPath.get(routes.users)?.lazy).toBeTypeOf("function");
    expect(routeByPath.get(routes.settings)?.lazy).toBeTypeOf("function");

    expect(routeByPath.get(routes.dashboardMy)?.lazy).toBeTypeOf("function");
    expect(routeByPath.get(routes.dashboardAll)?.lazy).toBeTypeOf("function");
    expect(routeByPath.get(routes.login)?.lazy).toBeTypeOf("function");
    const surveyRoute = routeByPath.get(routes.surveyById)!;
    if (typeof surveyRoute.lazy === "function") await surveyRoute.lazy();

    expect(pageLoads.builder).toBe(0);
    expect(pageLoads.dashboard).toBe(0);
    expect(pageLoads.login).toBe(0);
    expect(pageLoads.layout).toBe(0);
    expect(pageLoads.responses).toBe(0);
    expect(pageLoads.responsesHtml).toBe(0);
    expect(pageLoads.survey).toBe(1);
    expect(pageLoads.templates).toBe(0);
    expect(pageLoads.organizations).toBe(0);
    expect(pageLoads.users).toBe(0);
    expect(pageLoads.settings).toBe(0);
    router.dispose();
    window.history.replaceState(null, "", "/");
  }, 15_000);
});
