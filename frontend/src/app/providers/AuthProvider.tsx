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
import { refreshAuthDependentQueries } from "./authCache";

type AuthContextValue = {
  user: User | null;
  profile: UserProfile | null;
  loading: boolean;
  profileLoading: boolean;
  refreshProfile: () => Promise<void>;
};

const AuthContext = createContext<AuthContextValue>({
  user: null,
  profile: null,
  loading: true,
  profileLoading: false,
  refreshProfile: async () => undefined,
});

export function AuthProvider({ children }: PropsWithChildren) {
  const [user, setUser] = useState<User | null>(null);
  const [profile, setProfile] = useState<UserProfile | null>(null);
  const [loading, setLoading] = useState(true);
  const [profileLoading, setProfileLoading] = useState(false);
  const queryClient = useQueryClient();
  const previousUserIdRef = useRef<string | null>(null);
  const profileRequestIdRef = useRef(0);

  const clearProfile = useCallback(() => {
    profileRequestIdRef.current += 1;
    setProfile(null);
    setProfileLoading(false);
  }, []);

  const loadProfile = useCallback(async (userId: string, preserveOnTransientError = false) => {
    const requestId = profileRequestIdRef.current + 1;
    profileRequestIdRef.current = requestId;
    if (!preserveOnTransientError) {
      setProfileLoading(true);
    }

    try {
      const { data, error } = await runRequest(
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
          const { error: logoutError } = await apiClient.auth.logout();
          if (logoutError) {
            console.error(logoutError);
          }
        } else if (!preserveOnTransientError) {
          setProfile(null);
        }
        return;
      }

      const nextProfile = data as UserProfile;
      if (nextProfile.is_disabled) {
        setProfile(null);
        const { error: logoutError } = await apiClient.auth.logout();
        if (logoutError) {
          console.error(logoutError);
        }
        return;
      }

      setProfile(nextProfile);
    } catch (error) {
      if (profileRequestIdRef.current === requestId) {
        console.error(error);
        if (!preserveOnTransientError) {
          setProfile(null);
        }
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
    let receivedAuthEvent = false;
    let initialized = false;

    const applySession = (sessionUser: User | null, initial = false) => {
      if (!mounted) return;
      const nextUserId = sessionUser?.id ?? null;
      const changed = previousUserIdRef.current !== nextUserId;
      if (changed) {
        previousUserIdRef.current = nextUserId;
        clearProfile();
        if (initialized || !initial) refreshAuthDependentQueries(queryClient);
      }
      setObservabilityUser(nextUserId);
      setUser(sessionUser);
      setLoading(false);
      // INITIAL_SESSION and getSession can describe the same restoration.
      const isBackgroundRefresh = initialized && !changed && !initial;
      const shouldLoad = !initialized || changed || !initial;
      initialized = true;
      if (sessionUser?.id) {
        if (shouldLoad) void loadProfile(sessionUser.id, isBackgroundRefresh);
      } else {
        clearProfile();
      }
    };

    runRequest("auth.getCurrentSession", () => apiClient.auth.getCurrentSession())
      .then(async ({ data }) => {
        if (!receivedAuthEvent) applySession(data.session?.user ?? null, true);
      })
      .catch((error) => {
        if (!mounted || receivedAuthEvent) return;

        console.error(error);
        previousUserIdRef.current = null;
        setObservabilityUser(null);
        setUser(null);
        clearProfile();
        setLoading(false);
      });

    const { data: listener } = apiClient.auth.onAuthStateChange(async (event, session) => {
      receivedAuthEvent = true;
      applySession(session?.user ?? null, event === "INITIAL_SESSION");
    });

    return () => {
      mounted = false;
      profileRequestIdRef.current += 1;
      setObservabilityUser(null);
      listener.subscription.unsubscribe();
    };
  }, [clearProfile, loadProfile, queryClient]);

  const value = useMemo(
    () => ({ user, profile, loading, profileLoading, refreshProfile }),
    [user, profile, loading, profileLoading, refreshProfile],
  );

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth() {
  return useContext(AuthContext);
}
