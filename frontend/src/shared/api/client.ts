import { createClient } from "@supabase/supabase-js";
import { SUPABASE_ANON_KEY, SUPABASE_URL } from "../config/env";

export const supabaseClient = createClient(SUPABASE_URL, SUPABASE_ANON_KEY, {
  auth: {
    persistSession: true,
    autoRefreshToken: true,
    detectSessionInUrl: true,
  },
});

export const apiClient = {
  auth: {
    getCurrentUser: () => supabaseClient.auth.getUser(),
    login: (email: string, password: string) =>
      supabaseClient.auth.signInWithPassword({ email, password }),
    register: (email: string, password: string, metadata?: Record<string, unknown>) =>
      supabaseClient.auth.signUp({
        email,
        password,
        options: {
          data: metadata,
        },
      }),
    updateCurrentUserPassword: (password: string) =>
      supabaseClient.auth.updateUser({ password }),
    logout: () => supabaseClient.auth.signOut(),
    onAuthStateChange: supabaseClient.auth.onAuthStateChange.bind(supabaseClient.auth),
  },
  from: <TTable extends string>(table: TTable) => supabaseClient.from(table),
};
