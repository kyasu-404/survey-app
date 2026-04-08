import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { act, render, waitFor } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { AuthProvider } from "./AuthProvider";
import { apiClient } from "../../shared/api";

const { getCurrentSession, onAuthStateChange, from } = vi.hoisted(() => ({
  getCurrentSession: vi.fn(),
  onAuthStateChange: vi.fn(),
  from: vi.fn(),
}));

vi.mock("../../shared/api", () => ({
  apiClient: {
    auth: {
      getCurrentSession,
      onAuthStateChange,
    },
    from,
  },
}));

describe("AuthProvider", () => {
  it("does not clear the full react-query cache on auth user changes", async () => {
    const single = vi.fn().mockResolvedValue({
      data: {
        id: "user-2",
        name: "User 2",
        email: "user-2@example.com",
        role: "user",
        is_disabled: false,
        created_at: "2026-04-08T10:00:00.000Z",
      },
      error: null,
    });
    const eq = vi.fn(() => ({ single }));
    const select = vi.fn(() => ({ eq }));
    let authListener: ((event: string, session: { user: { id: string } } | null) => Promise<void>) | undefined;

    getCurrentSession.mockResolvedValue({ data: { session: null } });
    onAuthStateChange.mockImplementation((listener) => {
      authListener = listener;

      return {
        data: {
          subscription: {
            unsubscribe: vi.fn(),
          },
        },
      };
    });
    from.mockReturnValue({ select });

    const queryClient = new QueryClient({
      defaultOptions: {
        queries: { retry: false },
      },
    });
    const clearSpy = vi.spyOn(queryClient, "clear");

    render(
      <QueryClientProvider client={queryClient}>
        <AuthProvider>
          <div>Auth child</div>
        </AuthProvider>
      </QueryClientProvider>,
    );

    await waitFor(() => {
      expect(getCurrentSession).toHaveBeenCalled();
    });

    await act(async () => {
      await authListener?.("SIGNED_IN", { user: { id: "user-2" } });
    });

    expect(clearSpy).not.toHaveBeenCalled();
  });
});
