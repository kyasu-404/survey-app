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

  const loadProfile = useCallback(async (userId: string) => {
    const requestId = profileRequestIdRef.current + 1;
    profileRequestIdRef.current = requestId;
    setProfileLoading(true);

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
        setProfile(null);
        if ((error as { code?: string }).code === "PGRST116") {
          const { error: logoutError } = await apiClient.auth.logout();
          if (logoutError) {
            console.error(logoutError);
          }
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
        setProfile(null);
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

    await loadProfile(user.id);
  }, [clearProfile, loadProfile, user?.id]);

  useEffect(() => {
    let mounted = true;

    runRequest("auth.getCurrentSession", () => apiClient.auth.getCurrentSession())
      .then(async ({ data }) => {
        if (!mounted) return;

        const currentUser = data.session?.user ?? null;
        previousUserIdRef.current = currentUser?.id ?? null;
        setObservabilityUser(currentUser?.id ?? null);
        setUser(currentUser);
        setLoading(false);

        if (currentUser?.id) {
          void loadProfile(currentUser.id);
          return;
        }

        clearProfile();
      })
      .catch((error) => {
        if (!mounted) return;

        console.error(error);
        previousUserIdRef.current = null;
        setObservabilityUser(null);
        setUser(null);
        clearProfile();
        setLoading(false);
      });

    const { data: listener } = apiClient.auth.onAuthStateChange(async (_event, session) => {
      const sessionUser = session?.user ?? null;
      const nextUserId = sessionUser?.id ?? null;

      if (previousUserIdRef.current !== nextUserId) {
        previousUserIdRef.current = nextUserId;
        refreshAuthDependentQueries(queryClient);
      }

      setObservabilityUser(nextUserId);
      setUser(sessionUser);
      setLoading(false);

      if (sessionUser?.id) {
        void loadProfile(sessionUser.id);
        return;
      }

      clearProfile();
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
