import { beforeEach, describe, expect, it, vi } from "vitest";
import { RequestTimeoutError } from "../../shared/api/request";
import { changeOwnPassword, login } from "./api";

const { authLogin, fromProfiles, updateCurrentUserPassword } = vi.hoisted(() => ({
  authLogin: vi.fn(),
  fromProfiles: vi.fn(),
  updateCurrentUserPassword: vi.fn(),
}));

vi.mock("../../shared/api", () => ({
  apiClient: {
    auth: {
      login: authLogin,
      updateCurrentUserPassword,
    },
    from: fromProfiles,
  },
}));

describe("login", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("returns the current profile name after authentication", async () => {
    authLogin.mockResolvedValue({
      data: { user: { id: "user-1", user_metadata: { name: "Старое имя" } } },
      error: null,
    });
    const query = {
      select: vi.fn(() => query),
      eq: vi.fn(() => query),
      maybeSingle: vi.fn(() => Promise.resolve({ data: { name: "Анна Иванова" }, error: null })),
    };
    fromProfiles.mockReturnValue(query);

    await expect(login("anna@example.test", "password"))
      .resolves.toBe("Анна Иванова");
    expect(fromProfiles).toHaveBeenCalledWith("profiles");
    expect(query.select).toHaveBeenCalledWith("name");
    expect(query.eq).toHaveBeenCalledWith("id", "user-1");
  });

  it("falls back to trusted user metadata if the profile cannot be loaded", async () => {
    authLogin.mockResolvedValue({
      data: { user: { id: "user-1", user_metadata: { name: "Анна" } } },
      error: null,
    });
    const query = {
      select: vi.fn(() => query),
      eq: vi.fn(() => query),
      maybeSingle: vi.fn(() => Promise.reject(new Error("offline"))),
    };
    fromProfiles.mockReturnValue(query);

    await expect(login("anna@example.test", "password"))
      .resolves.toBe("Анна");
  });
});

describe("changeOwnPassword", () => {
  it("times out an auth request that never settles", async () => {
    vi.useFakeTimers();
    try {
      updateCurrentUserPassword.mockReturnValueOnce(new Promise(() => {}));
      const settled = vi.fn();
      void changeOwnPassword("current-password", "new-password").then(settled, settled);
      await vi.advanceTimersByTimeAsync(12_000);
      expect(settled).toHaveBeenCalledWith(expect.any(RequestTimeoutError));
    } finally {
      vi.useRealTimers();
    }
  });
});
