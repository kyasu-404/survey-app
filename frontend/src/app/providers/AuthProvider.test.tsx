import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { act, render, screen, waitFor } from "@testing-library/react";
import type { ReactNode } from "react";
import { describe, expect, it, vi } from "vitest";
import { SessionError } from "../../shared/api/session";
import { AuthProvider, useAuth } from "./AuthProvider";
import { loadSurveyBuilderDraft, saveSurveyBuilderDraft } from "../../widgets/SurveyBuilder/builderDraft";

const { getCurrentSession, onAuthStateChange, onSessionEnd, from } = vi.hoisted(() => ({
  getCurrentSession: vi.fn(),
  onAuthStateChange: vi.fn(),
  onSessionEnd: vi.fn(() => () => undefined),
  from: vi.fn(),
}));

vi.mock("../../shared/api", () => ({
  apiClient: {
    auth: {
      restoreSession: async () => (await getCurrentSession()).data.session?.user ?? null,
      onSessionEnd,
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
  it.each(["session", "event"])("loads a restored profile once when %s arrives first", async first => {
    const sessionRequest = createDeferred<{ data: { session: { user: { id: string } } } }>();
    const profileRequest = createDeferred<{ data: { id: string; role: string; is_disabled: boolean }; error: null }>();
    const single = vi.fn(() => profileRequest.promise);
    const session = { user: { id: "restored-user" } };
    let listener!: (event: string, nextSession: typeof session | null) => Promise<void>;
    getCurrentSession.mockReturnValue(sessionRequest.promise);
    onAuthStateChange.mockImplementation(callback => {
      listener = callback;
      return { data: { subscription: { unsubscribe: vi.fn() } } };
    });
    from.mockReturnValue({ select: () => ({ eq: () => ({ single }) }) });
    renderWithAuthProvider(<AuthStateProbe />);
    if (first === "session") {
      await act(async () => { sessionRequest.resolve({ data: { session } }); });
      await act(async () => { await listener("INITIAL_SESSION", session); });
    } else {
      await act(async () => { await listener("INITIAL_SESSION", session); });
      await act(async () => { sessionRequest.resolve({ data: { session } }); });
    }
    expect(single).toHaveBeenCalledTimes(1);
    await act(async () => { profileRequest.resolve({ data: { id: "restored-user", role: "user", is_disabled: false }, error: null }); });
    expect(screen.getByTestId("auth-state")).toHaveTextContent("ready:restored-user:user");
  });

  it("ignores a stale restored session after a sign-out event", async () => {
    const sessionRequest = createDeferred<{ data: { session: { user: { id: string } } } }>();
    let listener!: (event: string, session: null) => Promise<void>;
    getCurrentSession.mockReturnValue(sessionRequest.promise);
    onAuthStateChange.mockImplementation(callback => {
      listener = callback;
      return { data: { subscription: { unsubscribe: vi.fn() } } };
    });
    renderWithAuthProvider(<AuthStateProbe />);
    await act(async () => { await listener("SIGNED_OUT", null); });
    await act(async () => { sessionRequest.resolve({ data: { session: { user: { id: "stale-user" } } } }); });
    expect(screen.getByTestId("auth-state")).toHaveTextContent("ready:anonymous:no-profile");
  });
  it("keeps the protected route in a retryable state when startup cannot contact Auth", async () => {
    getCurrentSession.mockRejectedValueOnce(new SessionError("unavailable"));
    onAuthStateChange.mockImplementation(() => ({ data: { subscription: { unsubscribe: vi.fn() } } }));
    function Probe() {
      const { sessionIssue, retrySession } = useAuth();
      return <button onClick={retrySession}>{sessionIssue?.message ?? "Проверка сессии"}</button>;
    }
    renderWithAuthProvider(<Probe />);
    expect(await screen.findByText(/Сервис авторизации временно недоступен/)).toBeInTheDocument();
  });

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

  it.each(["SIGNED_IN", "USER_UPDATED"])("clears the previous profile and private cache before loading another user on %s", async event => {
    let authListener: ((event: string, session: { user: { id: string } } | null) => Promise<void>) | undefined;
    const nextProfile = createDeferred<{ data: { id: string; role: string; is_disabled: boolean }; error: null }>();
    const single = vi.fn().mockResolvedValue({ data: { id: "admin", role: "admin", is_disabled: false }, error: null });
    from.mockReturnValue({ select: () => ({ eq: () => ({ single }) }) });
    getCurrentSession.mockResolvedValue({ data: { session: { user: { id: "admin" } } } });
    onAuthStateChange.mockImplementation(listener => {
      authListener = listener;
      return { data: { subscription: { unsubscribe: vi.fn() } } };
    });
    const { queryClient } = renderWithAuthProvider(<AuthStateProbe />);
    await waitFor(() => expect(screen.getByTestId("auth-state")).toHaveTextContent("ready:admin:admin"));
    queryClient.setQueryData(["office-documents", "private"], { document: "previous user's data" });
    single.mockReturnValueOnce(nextProfile.promise);

    await act(async () => { await authListener?.(event, { user: { id: "employee" } }); });
    expect(screen.getByTestId("auth-state")).toHaveTextContent("ready:employee:no-profile");
    expect(queryClient.getQueryData(["office-documents", "private"])).toBeUndefined();
    await act(async () => { nextProfile.resolve({ data: { id: "employee", role: "user", is_disabled: false }, error: null }); });
    await waitFor(() => expect(screen.getByTestId("auth-state")).toHaveTextContent("ready:employee:user"));
  });
  it("drops a verified profile after an explicit authorization error but keeps it through a network error", async () => {
    const session = { user: { id: "admin" } };
    const single = vi.fn().mockResolvedValue({ data: { id: "admin", role: "admin", is_disabled: false }, error: null });
    let listener!: (event: string, nextSession: typeof session) => Promise<void>;
    getCurrentSession.mockResolvedValue({ data: { session } });
    onAuthStateChange.mockImplementation(callback => {
      listener = callback;
      return { data: { subscription: { unsubscribe: vi.fn() } } };
    });
    from.mockReturnValue({ select: () => ({ eq: () => ({ single }) }) });
    renderWithAuthProvider(<AuthStateProbe />);
    await waitFor(() => expect(screen.getByTestId("auth-state")).toHaveTextContent("ready:admin:admin"));

    single.mockRejectedValueOnce(new Error("Temporary network outage"));
    await act(async () => { await listener("TOKEN_REFRESHED", session); });
    expect(screen.getByTestId("auth-state")).toHaveTextContent("ready:admin:admin");

    single.mockResolvedValueOnce({ data: null, error: { code: "42501", message: "Forbidden" }, status: 403 });
    await act(async () => { await listener("TOKEN_REFRESHED", session); });
    expect(screen.getByTestId("auth-state")).toHaveTextContent("ready:admin:no-profile");
  });

  it("preserves scoped constructor drafts when an expired or revoked session signs out", async () => {
    const session = { user: { id: "signed-in" } };
    const single = vi.fn().mockResolvedValue({ data: { id: "signed-in", role: "user", is_disabled: false }, error: null });
    let listener!: (event: string, nextSession: typeof session | null) => Promise<void>;
    getCurrentSession.mockResolvedValue({ data: { session } });
    onAuthStateChange.mockImplementation(callback => {
      listener = callback;
      return { data: { subscription: { unsubscribe: vi.fn() } } };
    });
    from.mockReturnValue({ select: () => ({ eq: () => ({ single }) }) });
    renderWithAuthProvider(<AuthStateProbe />);
    await waitFor(() => expect(screen.getByTestId("auth-state")).toHaveTextContent("ready:signed-in:user"));
    localStorage.clear();
    saveSurveyBuilderDraft("signed-in", undefined, { title: "Новая", pages: [] });
    saveSurveyBuilderDraft("signed-in", "saved", { title: "Существующая", pages: [] });
    saveSurveyBuilderDraft("another", undefined, { title: "Чужая", pages: [] });
    try {
      await act(async () => { await listener("SIGNED_OUT", null); });
      expect(loadSurveyBuilderDraft("signed-in")).not.toBeNull();
      expect(loadSurveyBuilderDraft("signed-in", "saved")).not.toBeNull();
      expect(loadSurveyBuilderDraft("another")).not.toBeNull();
    } finally {
      localStorage.clear();
    }
  });

});
