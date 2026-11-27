import { createClient, navigatorLock, type AuthChangeEvent, type Session, type User } from "@supabase/supabase-js";
import { SUPABASE_ANON_KEY, SUPABASE_URL } from "../config/env";
import { createObservedFetch } from "../lib/observability";
import { authReadError, createSessionFetch, createSessionRecovery, isTokenFailure, sameSession, SessionError } from "./session";

const observedFetch = createObservedFetch();
const locks = typeof navigator !== "undefined" ? navigator.locks : undefined;
const sessionLockName = `survey-auth:${SUPABASE_URL}`;
let sessionQueue = Promise.resolve<unknown>(undefined);

async function withSessionLock<T>(work: () => Promise<T>): Promise<T> {
  if (locks) return locks.request(sessionLockName, work);
  const next = sessionQueue.then(work);
  sessionQueue = next.catch(() => undefined);
  return next;
}

// Keep Supabase's proactive refresh and storage operations on a shared lock.
// A waiting tab never steals a lock from an in-flight refresh.
function authLock<T>(name: string, timeout: number, work: () => Promise<T>): Promise<T> {
  return navigatorLock(name, timeout === 0 ? 0 : -1, work);
}

async function readSession(): Promise<Session | null> {
  const { data, error } = await supabaseClient.auth.getSession();
  if (error) throw authReadError(error);
  return data.session;
}

export const sessionRecovery = createSessionRecovery({
  read: readSession,
  async refresh() {
    const { data, error } = await supabaseClient.auth.refreshSession();
    if (error) throw authReadError(error);
    return data.session;
  },
  async verify(token): Promise<User> {
    // A stateless client validates the JWT without clearing a session that
    // may have been replaced in the authenticated client while awaiting Auth.
    const { data, error } = await publicSupabaseClient.auth.getUser(token);
    if (error) throw authReadError(error);
    if (!data.user) throw new SessionError("rejected");
    return data.user;
  },
  async invalidate() {
    await supabaseClient.auth.signOut({ scope: "local" });
  },
  lock: withSessionLock,
});

export const sessionFetch = createSessionFetch(observedFetch, {
  supabaseUrl: SUPABASE_URL,
  officeOrigin: typeof window === "undefined" ? new URL(SUPABASE_URL).origin : window.location.origin,
  anonKey: SUPABASE_ANON_KEY,
  recovery: sessionRecovery,
});

export async function verifiedSession(initial?: Session) {
  const session = initial ?? await sessionRecovery.ensureSession();
  const user = await sessionRecovery.verify(session.access_token);
  const current = await sessionRecovery.ensureSession(user.id);
  if (!sameSession(current, session.access_token)) throw new SessionError("changed");
  return { session: current, user };
}

async function restoreSession() {
  const session = await readSession();
  return session ? (await verifiedSession(session)).user : null;
}

export const supabaseClient = createClient(SUPABASE_URL, SUPABASE_ANON_KEY, {
  auth: {
    persistSession: true,
    autoRefreshToken: true,
    detectSessionInUrl: true,
    ...(locks ? { lock: authLock } : {}),
  },
  global: {
    fetch: sessionFetch,
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
    fetch: (input, init) => {
      const url = new URL(String(input));
      return url.pathname.endsWith("/auth/v1/user")
        ? sessionFetch(input, init)
        : observedFetch(input, init);
    },
  },
});

export const apiClient = {
  auth: {
    getCurrentUser: async () => ({ data: { user: (await verifiedSession()).user }, error: null }),
    getCurrentSession: async () => ({ data: { session: await sessionRecovery.ensureSession() }, error: null }),
    restoreSession,
    onSessionEnd: sessionRecovery.subscribe,
    login: (email: string, password: string) =>
      withSessionLock(() => supabaseClient.auth.signInWithPassword({ email, password })),
    register: (email: string, password: string, metadata?: Record<string, unknown>) =>
      withSessionLock(() => supabaseClient.auth.signUp({
        email,
        password,
        options: {
          data: metadata,
        },
      })),
    updateCurrentUserPassword: async (currentPassword: string, password: string) => {
      const { session } = await verifiedSession();
      return withSessionLock(async () => {
        const latest = await sessionRecovery.ensureSession(session.user.id);
        if (!sameSession(latest, session.access_token)) throw new SessionError("changed");
        const result = await supabaseClient.auth.updateUser({ current_password: currentPassword, password });
        return { result, token: latest.access_token };
      }).then(async ({ result, token }) => {
        if (result.error) {
          const failure = authReadError(result.error);
          if (isTokenFailure(failure.kind)) {
            await sessionRecovery.recover(token, failure.kind);
            throw new SessionError("restored");
          }
        }
        return result;
      });
    },
    logout: (userId?: string, scope: "local" | "global" = "global") => withSessionLock(async () => {
      if (userId) await sessionRecovery.ensureSession(userId);
      return supabaseClient.auth.signOut({ scope });
    }),
    onAuthStateChange: (callback: (event: AuthChangeEvent, session: Session | null) => void) =>
      supabaseClient.auth.onAuthStateChange(callback),
  },
  from: <TTable extends string>(table: TTable) => supabaseClient.from(table),
  rpc: (functionName: string, args?: Record<string, unknown>, options?: { get?: boolean }) =>
    supabaseClient.rpc(functionName as never, args as never, options),
};

export const publicApiClient = {
  rpc: (functionName: string, args?: Record<string, unknown>) => publicSupabaseClient.rpc(functionName as never, args as never),
  from: <TTable extends string>(table: TTable) => publicSupabaseClient.from(table),
};
