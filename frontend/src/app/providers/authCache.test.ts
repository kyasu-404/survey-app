import { QueryClient } from "@tanstack/react-query";
import { describe, expect, it, vi } from "vitest";
import { createAuthCacheGuard, refreshAuthDependentQueries } from "./authCache";
import { clearUsersPageSessionState } from "../../pages/UsersPage/usersPageSessionState";

vi.mock("../../pages/UsersPage/usersPageSessionState", () => ({
  clearUsersPageSessionState: vi.fn(),
}));

describe("refreshAuthDependentQueries", () => {
  it("invalidates guards for imperative cache writes only when the auth session changes", () => {
    const client = new QueryClient();
    const isCurrentUser = createAuthCacheGuard(client);
    expect(isCurrentUser()).toBe(true);
    refreshAuthDependentQueries(client);
    expect(isCurrentUser()).toBe(false);
    expect(createAuthCacheGuard(client)()).toBe(true);
  });
  it("drops every private query including future roots while preserving public branding", () => {
    const client = new QueryClient();
    const privateRoots = ["users", "builder-templates", "form", "survey-form", "form-responses",
      "education-organizations", "office-documents", "office-document", "office-results", "office-editor-config",
      "office-template-sources", "form-mail-activity", "mail-batch-jobs", "mail-batch", "mail-composition",
      "form-personal-links", "storage-cleanup-overview", "smtp-settings", "onlyoffice-settings", "embedding-settings",
      "dashboard-form-summaries", "dashboard-form-stats", "template-form-summaries", "future-private-query"];
    for (const root of [...privateRoots, "app-branding", "app-favicon"]) client.setQueryData([root, "nested"], { previousUser: true });

    refreshAuthDependentQueries(client);

    for (const root of privateRoots) expect(client.getQueryData([root, "nested"]), root).toBeUndefined();
    expect(client.getQueryData(["app-branding", "nested"])).toEqual({ previousUser: true });
    expect(client.getQueryData(["app-favicon", "nested"])).toEqual({ previousUser: true });
    expect(clearUsersPageSessionState).toHaveBeenCalledWith(client);
  });

  it("cancels an in-flight private request and discards its late result", async () => {
    const client = new QueryClient();
    let resolve!: (value: unknown) => void;
    let signal!: AbortSignal;
    const request = client.fetchQuery({ queryKey: ["office-documents", "form"], queryFn: context => {
      signal = context.signal;
      return new Promise(done => { resolve = done; });
    } }).catch(() => undefined);

    refreshAuthDependentQueries(client);
    expect(signal.aborted).toBe(true);
    resolve({ secretFromPreviousUser: true });
    await request;
    expect(client.getQueryData(["office-documents", "form"])).toBeUndefined();
  });
});
