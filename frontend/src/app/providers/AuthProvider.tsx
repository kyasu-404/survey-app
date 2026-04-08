import {
  createContext,
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
import { refreshAuthDependentQueries } from "./authCache";

type AuthContextValue = {
  user: User | null;
  profile: UserProfile | null;
  loading: boolean;
  refreshProfile: () => Promise<void>;
};

const AuthContext = createContext<AuthContextValue>({
  user: null,
  profile: null,
  loading: true,
  refreshProfile: async () => undefined,
});

export function AuthProvider({ children }: PropsWithChildren) {
  const [user, setUser] = useState<User | null>(null);
  const [profile, setProfile] = useState<UserProfile | null>(null);
  const [loading, setLoading] = useState(true);
  const queryClient = useQueryClient();
  const previousUserIdRef = useRef<string | null>(null);

  const loadProfile = async (userId: string) => {
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

    if (error) {
      setProfile(null);
      return;
    }

    setProfile(data as UserProfile);
  };

  const refreshProfile = async () => {
    if (!user?.id) {
      setProfile(null);
      return;
    }

    await loadProfile(user.id);
  };

  useEffect(() => {
    let mounted = true;

    runRequest("auth.getCurrentSession", () => apiClient.auth.getCurrentSession())
      .then(async ({ data }) => {
        if (!mounted) return;

        const currentUser = data.session?.user ?? null;
        previousUserIdRef.current = currentUser?.id ?? null;
        setUser(currentUser);

        if (currentUser?.id) {
          await loadProfile(currentUser.id);
          return;
        }

        setProfile(null);
      })
      .finally(() => {
        if (!mounted) return;
        setLoading(false);
      });

    const { data: listener } = apiClient.auth.onAuthStateChange(async (_event, session) => {
      const sessionUser = session?.user ?? null;
      const nextUserId = sessionUser?.id ?? null;

      if (previousUserIdRef.current !== nextUserId) {
        previousUserIdRef.current = nextUserId;
        refreshAuthDependentQueries(queryClient);
      }

      setUser(sessionUser);

      if (sessionUser?.id) {
        await loadProfile(sessionUser.id);
        return;
      }

      setProfile(null);
    });

    return () => {
      mounted = false;
      listener.subscription.unsubscribe();
    };
  }, [queryClient]);

  const value = useMemo(() => ({ user, profile, loading, refreshProfile }), [user, profile, loading]);

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth() {
  return useContext(AuthContext);
}
