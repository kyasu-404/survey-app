import { beforeEach, describe, expect, it, vi } from "vitest";
import { login } from "./api";

const { authLogin, fromProfiles } = vi.hoisted(() => ({
  authLogin: vi.fn(),
  fromProfiles: vi.fn(),
}));

vi.mock("../../shared/api", () => ({
  apiClient: {
    auth: {
      login: authLogin,
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
