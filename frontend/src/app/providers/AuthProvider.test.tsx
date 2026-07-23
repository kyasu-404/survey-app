import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { act, render, screen, waitFor } from "@testing-library/react";
import type { ReactNode } from "react";
import { describe, expect, it, vi } from "vitest";
import { AuthProvider, useAuth } from "./AuthProvider";

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

function createDeferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (reason?: unknown) => void;

  const promise = new Promise<T>((res, rej) => {
    resolve = res;
    reject = rej;
  });

  return { promise, resolve, reject };
}

function AuthStateProbe() {
  const { loading, profile, user } = useAuth();

  return (
    <div data-testid="auth-state">
      {loading ? "loading" : "ready"}:{user?.id ?? "anonymous"}:{profile?.role ?? "no-profile"}
    </div>
  );
}

function renderWithAuthProvider(children: ReactNode, queryClient = new QueryClient({
  defaultOptions: {
    queries: { retry: false },
  },
})) {
  return {
    queryClient,
    ...render(
      <QueryClientProvider client={queryClient}>
        <AuthProvider>{children}</AuthProvider>
      </QueryClientProvider>,
    ),
  };
}

describe("AuthProvider", () => {
  it("marks auth as ready after session restoration before the profile request resolves", async () => {
    const profileRequest = createDeferred<{
      data: {
        id: string;
        name: string;
        email: string;
        role: string;
        is_disabled: boolean;
        created_at: string;
      };
      error: null;
    }>();
    const single = vi.fn(() => profileRequest.promise);
    const eq = vi.fn(() => ({ single }));
    const select = vi.fn(() => ({ eq }));

    getCurrentSession.mockResolvedValue({ data: { session: { user: { id: "user-1" } } } });
    onAuthStateChange.mockReturnValue({
      data: {
        subscription: {
          unsubscribe: vi.fn(),
        },
      },
    });
    from.mockReturnValue({ select });

    renderWithAuthProvider(<AuthStateProbe />);

    await waitFor(() => {
      expect(screen.getByTestId("auth-state")).toHaveTextContent("ready:user-1:no-profile");
    });

    expect(single).toHaveBeenCalled();

    profileRequest.resolve({
      data: {
        id: "user-1",
        name: "User 1",
        email: "user-1@example.com",
        role: "admin",
        is_disabled: false,
        created_at: "2026-04-08T10:00:00.000Z",
      },
      error: null,
    });

    await waitFor(() => {
      expect(screen.getByTestId("auth-state")).toHaveTextContent("ready:user-1:admin");
    });
  });

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

    renderWithAuthProvider(<div>Auth child</div>, queryClient);

    await waitFor(() => {
      expect(getCurrentSession).toHaveBeenCalled();
    });

    await act(async () => {
      await authListener?.("SIGNED_IN", { user: { id: "user-2" } });
    });

    expect(clearSpy).not.toHaveBeenCalled();
  });
});
