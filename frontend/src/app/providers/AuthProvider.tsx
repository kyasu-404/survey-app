import {
  createContext,
  useContext,
  useEffect,
  useMemo,
  useState,
  type PropsWithChildren,
} from "react";
import type { User } from "@supabase/supabase-js";
import { apiClient } from "../../shared/api";
import type { UserProfile } from "../../entities/user/types";

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

  const loadProfile = async (userId: string) => {
    const { data, error } = await apiClient
      .from("profiles")
      .select("id, name, email, role, is_disabled, created_at")
      .eq("id", userId)
      .single();

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

    apiClient.auth.getCurrentUser().then(async ({ data }) => {
      if (!mounted) return;

      const currentUser = data.user ?? null;
      setUser(currentUser);

      if (currentUser?.id) {
        await loadProfile(currentUser.id);
      }

      setLoading(false);
    });

    const { data: listener } = apiClient.auth.onAuthStateChange(async (_event, session) => {
      const sessionUser = session?.user ?? null;
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
  }, []);

  const value = useMemo(() => ({ user, profile, loading, refreshProfile }), [user, profile, loading]);

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth() {
  return useContext(AuthContext);
}
