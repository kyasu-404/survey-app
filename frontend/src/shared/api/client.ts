import { createClient } from "@supabase/supabase-js";
import { SUPABASE_ANON_KEY, SUPABASE_URL } from "../config/env";
import { createObservedFetch } from "../lib/observability";

const observedFetch = createObservedFetch();

export const supabaseClient = createClient(SUPABASE_URL, SUPABASE_ANON_KEY, {
  auth: {
    persistSession: true,
    autoRefreshToken: true,
    detectSessionInUrl: true,
  },
  global: {
    fetch: observedFetch,
  },
});

// Stateless public client for routes that should remain accessible even if the
// current browser auth state is stale or absent.
export const publicSupabaseClient = createClient(SUPABASE_URL, SUPABASE_ANON_KEY, {
  auth: {
    storageKey: "sb-public-form-client",
    persistSession: false,
    autoRefreshToken: false,
    detectSessionInUrl: false,
  },
  global: {
    fetch: observedFetch,
  },
});

export const apiClient = {
  auth: {
    getCurrentUser: () => supabaseClient.auth.getUser(),
    getCurrentSession: () => supabaseClient.auth.getSession(),
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
    onAuthStateChange: (callback: Parameters<typeof supabaseClient.auth.onAuthStateChange>[0]) =>
      supabaseClient.auth.onAuthStateChange(callback),
  },
  from: <TTable extends string>(table: TTable) => supabaseClient.from(table),
  rpc: (functionName: string, args?: Record<string, unknown>, options?: { get?: boolean }) =>
    supabaseClient.rpc(functionName as never, args as never, options),
};

export const publicApiClient = {
  from: <TTable extends string>(table: TTable) => publicSupabaseClient.from(table),
};
