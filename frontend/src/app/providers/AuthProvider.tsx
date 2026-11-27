import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
  type PropsWithChildren,
} from "react";
import type { User } from "@supabase/supabase-js";
import { useQueryClient } from "@tanstack/react-query";
import { apiClient } from "../../shared/api";
import type { UserProfile } from "../../entities/user/types";
import { runRequest } from "../../shared/api/request";
import { setObservabilityUser } from "../../shared/lib/observability";
import { isTerminalSessionError, SessionError } from "../../shared/api/session";
import { refreshAuthDependentQueries } from "./authCache";

type AuthContextValue = {
  user: User | null;
  profile: UserProfile | null;
  loading: boolean;
  profileLoading: boolean;
  profileIssue: string | null;
  refreshProfile: () => Promise<void>;
  sessionIssue: Error | null;
  previousUserId: string | null;
  retrySession: () => void;
};

const AuthContext = createContext<AuthContextValue>({
  user: null,
  profile: null,
  loading: true,
  profileLoading: false,
  profileIssue: null,
  refreshProfile: async () => undefined,
  sessionIssue: null,
  previousUserId: null,
  retrySession: () => undefined,
});

export function AuthProvider({ children }: PropsWithChildren) {
  const [user, setUser] = useState<User | null>(null);
  const [profile, setProfile] = useState<UserProfile | null>(null);
  const [loading, setLoading] = useState(true);
  const [profileLoading, setProfileLoading] = useState(false);
  const [profileIssue, setProfileIssue] = useState<string | null>(null);
  const [sessionIssue, setSessionIssue] = useState<Error | null>(null);
  const [previousUserId, setPreviousUserId] = useState<string | null>(null);
  const retrySessionRef = useRef<() => void>(() => undefined);
  const retrySession = useCallback(() => retrySessionRef.current(), []);
  const queryClient = useQueryClient();
  const previousUserIdRef = useRef<string | null>(null);
  const profileRequestIdRef = useRef(0);

  const clearProfile = useCallback(() => {
    profileRequestIdRef.current += 1;
    setProfile(null);
    setProfileLoading(false);
    setProfileIssue(null);
  }, []);

  const loadProfile = useCallback(async (userId: string, preserveOnTransientError = false) => {
    const requestId = profileRequestIdRef.current + 1;
    profileRequestIdRef.current = requestId;
    if (!preserveOnTransientError) setProfileLoading(true);

    try {
      const { data, error, status } = await runRequest(
        "profiles.load",
        () =>
          apiClient
            .from("profiles")
            .select("id, name, email, role, is_disabled, created_at")
            .eq("id", userId)
            .single(),
        { context: { userId } },
      );

      if (profileRequestIdRef.current !== requestId) {
        return;
      }

      if (error) {
        if ((error as { code?: string }).code === "PGRST116") {
          setProfile(null);
          const { error: logoutError } = await apiClient.auth.logout(userId, "local");
          if (logoutError) {
            console.error(logoutError);
          }
        } else if (status === 401 || status === 403 || error.code === "42501") {
          setProfile(null);
          setProfileIssue(null);
        } else {
          setProfileIssue("Не удалось проверить права доступа. Повторите проверку.");
          if (!preserveOnTransientError) setProfile(null);
        }
        return;
      }

      const nextProfile = data as UserProfile;
      if (nextProfile.is_disabled) {
        setProfile(null);
        const { error: logoutError } = await apiClient.auth.logout(userId, "local");
        if (logoutError) {
          console.error(logoutError);
        }
        return;
      }

      setProfile(nextProfile);
      setProfileIssue(null);
    } catch (error) {
      if (profileRequestIdRef.current === requestId) {
        console.error(error);
        if (isTerminalSessionError(error)) return;
        const forbidden = error instanceof SessionError && error.kind === "forbidden";
        if (!preserveOnTransientError || forbidden) setProfile(null);
        setProfileIssue(forbidden ? null : "Не удалось проверить права доступа. Повторите проверку.");
      }
    } finally {
      if (profileRequestIdRef.current === requestId) {
        setProfileLoading(false);
      }
    }
  }, []);

  const refreshProfile = useCallback(async () => {
    if (!user?.id) {
      clearProfile();
      return;
    }

    await loadProfile(user.id, true);
  }, [clearProfile, loadProfile, user?.id]);

  useEffect(() => {
    let mounted = true;
    let initialized = false;
    let restoring = false;
    let latestSignIn: string | null = null;
    let signedOut = false;
    let restoreFailed = false;

    const applySession = (sessionUser: User | null, initial = false) => {
      if (!mounted) return;
      const nextUserId = sessionUser?.id ?? null;
      const changed = previousUserIdRef.current !== nextUserId;
      if (changed) {
        setPreviousUserId(nextUserId ?? previousUserIdRef.current);
        previousUserIdRef.current = nextUserId;
        clearProfile();
        if (initialized || !initial) refreshAuthDependentQueries(queryClient);
      }
      if (sessionUser) setSessionIssue(null);
      setObservabilityUser(nextUserId);
      setUser(sessionUser);
      setLoading(false);
      const background = initialized && !changed;
      initialized = true;
      if (nextUserId) {
        queueMicrotask(() => {
          if (mounted && previousUserIdRef.current === nextUserId) void loadProfile(nextUserId, background);
        });
      }
    };

    const restore = async () => {
      if (restoring || !mounted) return;
      restoring = true;
      setLoading(true);
      try {
        const restored = await runRequest("auth.restoreSession", apiClient.auth.restoreSession);
        if (latestSignIn && latestSignIn !== restored?.id) {
          latestSignIn = null;
          queueMicrotask(() => void restore());
          return;
        }
        if (mounted) {
          restoreFailed = false;
          setSessionIssue(null);
          applySession(signedOut ? null : restored, true);
        }
      } catch (error) {
        if (!mounted) return;
        if (error instanceof SessionError && error.kind === "changed") {
          latestSignIn = null;
          queueMicrotask(() => void restore());
          return;
        }
        if (isTerminalSessionError(error) && error.ownerId) setPreviousUserId(error.ownerId);
        restoreFailed = !isTerminalSessionError(error);
        setSessionIssue(error instanceof Error ? error : new SessionError("unavailable"));
        applySession(null, true);
      } finally {
        restoring = false;
      }
    };

    const stopListening = apiClient.auth.onSessionEnd(error => {
      if (error.ownerId) setPreviousUserId(error.ownerId);
      restoreFailed = false;
      setSessionIssue(current => error.kind === "missing" && isTerminalSessionError(current) ? current : error);
      applySession(null);
    });
    const { data: listener } = apiClient.auth.onAuthStateChange((event, session) => {
      // INITIAL_SESSION can be null on a transient refresh failure. The
      // explicit restore above preserves the failure and validates the JWT.
      if (event === "INITIAL_SESSION") return;
      if (event === "SIGNED_IN" || event === "SIGNED_OUT") {
        latestSignIn = session?.user.id ?? null;
        signedOut = event === "SIGNED_OUT";
      }
      if (!initialized || restoring) return;
      if (restoreFailed && session) {
        queueMicrotask(() => void restore());
        return;
      }
      applySession(session?.user ?? null);
    });
    retrySessionRef.current = () => void restore();
    void restore();

    const online = () => {
      if (restoreFailed) void restore();
    };
    window.addEventListener("online", online);

    return () => {
      mounted = false;
      profileRequestIdRef.current += 1;
      setObservabilityUser(null);
      stopListening();
      listener.subscription.unsubscribe();
      window.removeEventListener("online", online);
    };
  }, [clearProfile, loadProfile, queryClient]);

  const value = useMemo(
    () => ({ user, profile, loading, profileLoading, profileIssue, refreshProfile, sessionIssue, previousUserId, retrySession }),
    [user, profile, loading, profileLoading, profileIssue, refreshProfile, sessionIssue, previousUserId, retrySession],
  );

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth() {
  return useContext(AuthContext);
}
