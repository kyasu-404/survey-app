import { createClient } from "@supabase/supabase-js";
import { SUPABASE_ANON_KEY, SUPABASE_URL } from "../config/env";

export const supabaseClient = createClient(SUPABASE_URL, SUPABASE_ANON_KEY);

export const apiClient = {
  auth: {
    getCurrentUser: () => supabaseClient.auth.getUser(),
    login: (email: string, password: string) =>
      supabaseClient.auth.signInWithPassword({ email, password }),
    register: (email: string, password: string) =>
      supabaseClient.auth.signUp({ email, password }),
    updateCurrentUserPassword: (password: string) =>
      supabaseClient.auth.updateUser({ password }),
    logout: () => supabaseClient.auth.signOut(),
    onAuthStateChange: supabaseClient.auth.onAuthStateChange.bind(supabaseClient.auth),
  },
  from: <TTable extends string>(table: TTable) => supabaseClient.from(table),
};
