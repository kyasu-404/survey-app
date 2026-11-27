import { beforeEach, describe, expect, it, vi } from "vitest";
import { apiClient } from "../../shared/api/client";
import { deleteReadNotifications, hideAnnouncement } from "./api";

vi.mock("../../shared/api/client", () => ({
  apiClient: { auth: { getCurrentSession: vi.fn() }, rpc: vi.fn() },
}));

const currentSession = vi.mocked(apiClient.auth.getCurrentSession);

function mockSession(id: string) {
  currentSession.mockResolvedValue({
    data: { session: { access_token: "fixture-session-token", user: { id } } },
    error: null,
  } as Awaited<ReturnType<typeof apiClient.auth.getCurrentSession>>);
}

describe("notification removal account binding", () => {
  beforeEach(() => vi.resetAllMocks());

  it("rejects bulk removal from a page for an account whose session changed", async () => {
    mockSession("other-user");

    await expect(deleteReadNotifications("viewer", "response_received")).rejects.toThrow();
    expect(apiClient.rpc).not.toHaveBeenCalled();
  });

  it("pins the verified account token to the announcement hide request", async () => {
    mockSession("viewer");
    const request = {
      setHeader: vi.fn(() => request),
      abortSignal: vi.fn(() => request),
      then: (resolve: (value: { data: boolean; error: null }) => unknown) => Promise.resolve(resolve({ data: true, error: null })),
    };
    vi.mocked(apiClient.rpc).mockReturnValue(request as unknown as ReturnType<typeof apiClient.rpc>);

    await expect(hideAnnouncement("viewer", "announcement-id")).resolves.toBe(true);
    expect(apiClient.rpc).toHaveBeenCalledExactlyOnceWith("hide_announcement", { p_id: "announcement-id" });
    expect(request.setHeader).toHaveBeenCalledWith("Authorization", "Bearer fixture-session-token");
  });
});
