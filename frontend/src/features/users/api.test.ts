import { beforeEach, describe, expect, it, vi } from "vitest";
import { updateUserRole } from "./api";

const { getSession, invoke, updateCurrentUserPassword } = vi.hoisted(() => ({
  getSession: vi.fn(),
  invoke: vi.fn(),
  updateCurrentUserPassword: vi.fn(),
}));

vi.mock("../../shared/api/supabase", () => ({
  supabase: {
    auth: {
      getSession,
    },
    functions: {
      invoke,
    },
  },
}));

vi.mock("../../shared/api", () => ({
  apiClient: {
    auth: {
      updateCurrentUserPassword,
    },
  },
}));

describe("users api", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    getSession.mockResolvedValue({
      data: {
        session: {
          access_token: "access-token",
        },
      },
    });
  });

  it("sends role updates to the user-admin Edge Function", async () => {
    invoke.mockResolvedValue({
      data: { success: true },
      error: null,
      response: new Response(JSON.stringify({ success: true }), { status: 200 }),
    });

    await updateUserRole("user-2", "admin");

    expect(invoke).toHaveBeenCalledWith(
      "user-admin",
      expect.objectContaining({
        body: {
          action: "updateRole",
          userId: "user-2",
          role: "admin",
        },
        headers: expect.objectContaining({
          Authorization: "Bearer access-token",
        }),
      }),
    );
  });

  it("throws the Edge Function JSON error message when role update fails", async () => {
    const response = new Response(JSON.stringify({ error: "Unsupported action" }), {
      status: 400,
      headers: {
        "Content-Type": "application/json",
      },
    });
    const functionError = Object.assign(new Error("Edge Function returned a non-2xx status code"), {
      context: response,
    });
    invoke.mockResolvedValue({
      data: null,
      error: functionError,
      response,
    });

    await expect(updateUserRole("user-2", "admin")).rejects.toThrow("Unsupported action");
  });
});
