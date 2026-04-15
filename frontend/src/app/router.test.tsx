import { describe, expect, it, vi } from "vitest";

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
  it("defers loading route modules until the route is rendered", async () => {
    await import("./router");

    expect(pageLoads.builder).toBe(0);
    expect(pageLoads.dashboard).toBe(0);
    expect(pageLoads.responses).toBe(0);
    expect(pageLoads.responsesHtml).toBe(0);
    expect(pageLoads.survey).toBe(0);
    expect(pageLoads.templates).toBe(0);
    expect(pageLoads.users).toBe(0);
  });
});
