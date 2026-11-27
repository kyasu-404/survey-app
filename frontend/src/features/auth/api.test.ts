import { beforeEach, describe, expect, it, vi } from "vitest";
import { RequestTimeoutError } from "../../shared/api/request";
import { changeOwnPassword, login } from "./api";

const { authLogin, authLogout, fromProfiles, updateCurrentUserPassword } = vi.hoisted(() => ({
  authLogin: vi.fn(),
  authLogout: vi.fn(),
  fromProfiles: vi.fn(),
  updateCurrentUserPassword: vi.fn(),
}));

vi.mock("../../shared/api", () => ({
  apiClient: {
    auth: {
      login: authLogin,
      logout: authLogout,
      updateCurrentUserPassword,
    },
    from: fromProfiles,
  },
}));

describe("login", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    authLogout.mockResolvedValue({ error: null });
  });

  it("returns the current profile name after authentication and trims email without altering password", async () => {
    authLogin.mockResolvedValue({
      data: { user: { id: "user-1", user_metadata: { name: "Старое имя" } } },
      error: null,
    });
    const query = {
      select: vi.fn(() => query),
      eq: vi.fn(() => query),
      maybeSingle: vi.fn(() => Promise.resolve({ data: { name: "Анна Иванова", is_disabled: false }, error: null })),
    };
    fromProfiles.mockReturnValue(query);

    await expect(login("  anna@example.test  ", "  password  "))
      .resolves.toEqual({ displayName: "Анна Иванова", userId: "user-1" });
    expect(authLogin).toHaveBeenCalledWith("anna@example.test", "  password  ");
    expect(fromProfiles).toHaveBeenCalledWith("profiles");
    expect(query.select).toHaveBeenCalledWith("name, is_disabled");
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
      .resolves.toEqual({ displayName: "Анна", userId: "user-1" });
  });

  it("signs out and rejects when the profile is marked disabled", async () => {
    authLogin.mockResolvedValue({
      data: { user: { id: "user-2", user_metadata: { name: "Павел" } } },
      error: null,
    });
    const query = {
      select: vi.fn(() => query),
      eq: vi.fn(() => query),
      maybeSingle: vi.fn(() => Promise.resolve({ data: { name: "Павел", is_disabled: true }, error: null })),
    };
    fromProfiles.mockReturnValue(query);

    await expect(login("pavel@example.test", "password")).rejects.toMatchObject({
      code: "user_banned",
    });
    expect(authLogout).toHaveBeenCalledTimes(1);
  });

  it("times out a sign-in request that never settles", async () => {
    vi.useFakeTimers();
    try {
      authLogin.mockReturnValueOnce(new Promise(() => {}));
      const settled = vi.fn();
      void login("anna@example.test", "password").then(settled, settled);
      await vi.advanceTimersByTimeAsync(12_000);
      expect(settled).toHaveBeenCalledWith(expect.any(RequestTimeoutError));
    } finally {
      vi.useRealTimers();
    }
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
