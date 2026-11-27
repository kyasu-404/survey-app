import type { Session, User } from "@supabase/supabase-js";

const failures = {
  expired: [401, "Срок действия сессии истёк. Войдите снова."],
  revoked: [401, "Сессия отозвана. Войдите снова."],
  invalid: [401, "Сессия недействительна. Войдите снова."],
  tokenExpired: [401, "Истёк срок действия токена."],
  forbidden: [403, "Недостаточно прав для этой операции."],
  missing: [401, "Требуется вход в систему."],
  changed: [401, "Сессия аккаунта изменилась. Повторите действие в текущем аккаунте."],
  unavailable: [503, "Сервис авторизации временно недоступен. Попробуйте ещё раз."],
  restored: [401, "Сессия восстановлена. Повторите действие."],
  rejected: [401, "Сервер отклонил токен авторизации. Попробуйте ещё раз."],
} as const;

type FailureKind = keyof typeof failures;
type TerminalKind = "expired" | "revoked" | "missing" | "invalid";
type TokenFailure = "rejected" | "tokenExpired" | "expired" | "revoked" | "invalid";
export function isTokenFailure(kind: FailureKind): kind is TokenFailure {
  return ["rejected", "tokenExpired", "expired", "revoked", "invalid"].includes(kind);
}
const prefix = "survey_session_";

export class SessionError extends Error {
  readonly code: string;
  readonly status: number;
  constructor(readonly kind: FailureKind, readonly ownerId?: string) {
    super(failures[kind][1]);
    this.name = "SessionError";
    this.code = prefix + kind;
    this.status = failures[kind][0];
  }
}

export function isTerminalSessionError(error: unknown): error is SessionError & { kind: TerminalKind } {
  return error instanceof SessionError && (
    ["expired", "revoked", "missing", "invalid"].includes(error.kind)
  );
}

export function canRetryRead(failureCount: number, error: Error, attempts = 1) {
  if (error instanceof SessionError) return false;
  const details = error as { message?: string; code?: string; status?: number } | null;
  if (details?.code === "42501" || details?.status === 401 || details?.status === 403) return false;
  const message = details?.message?.toLowerCase() ?? "";
  return failureCount < attempts && !["not authorized", "не авторизован", "jwt"].some(value => message.includes(value));
}

type ErrorData = { code?: string; error_code?: string; error?: string; msg?: string; message?: string; status?: number };

export function sessionErrorFromCode(code: unknown) {
  if (typeof code !== "string" || !code.startsWith(prefix)) return;
  const kind = code.slice(prefix.length);
  if (Object.prototype.hasOwnProperty.call(failures, kind)) return new SessionError(kind as FailureKind);
}

function tokenFailure(error: ErrorData, status = error.status): TokenFailure | undefined {
  if (status !== 400 && status !== 401 && status !== 403) return;
  const code = String(error.code ?? error.error_code ?? error.error ?? "");
  const message = String(error.message ?? error.msg ?? error.error ?? "").toLowerCase();
  if (["session_not_found", "refresh_token_not_found", "refresh_token_already_used", "user_not_found",
    "session_revoked"].includes(code)) return "revoked";
  if (code === "session_expired") return "expired";
  if (["jwt_expired", "token_expired"].includes(code) ||
    /\b(jwt|token) (?:is |has )?expired\b|\binvalid claim: exp\b/.test(message)) return "tokenExpired";
  if (["bad_jwt", "invalid_jwt", "pgrst301", "pgrst303", "token_rejected", "invalidjwt"].includes(code.toLowerCase()) ||
    (status === 401 && /^(invalid jwt|invalid token)(?:[.:]|$)/.test(message))) return "rejected";
}

function identity(token: string) {
  try {
    const claims = JSON.parse(atob(token.split(".")[1].replace(/-/g, "+").replace(/_/g, "/")));
    return { userId: typeof claims.sub === "string" ? claims.sub : undefined,
      sessionId: typeof claims.session_id === "string" ? claims.session_id : undefined };
  } catch {
    return {};
  }
}

// Claims only bind a retry to the same session. The API still verifies the JWT.
export function sameSession(session: Session, token: string) {
  if (session.access_token === token) return true;
  const previous = identity(token);
  const current = identity(session.access_token);
  return previous.userId === session.user.id && Boolean(previous.sessionId) && previous.sessionId === current.sessionId;
}

export function authReadError(error: ErrorData & { name?: string }) {
  if (error.name === "AuthSessionMissingError") return new SessionError("revoked");
  return new SessionError(tokenFailure(error) ?? (error.status === 403 ? "forbidden" : "unavailable"));
}

type AuthAccess = {
  read(): Promise<Session | null>;
  refresh(): Promise<Session | null>;
  verify(token: string): Promise<User>;
  invalidate(): Promise<void>;
  lock<T>(work: () => Promise<T>): Promise<T>;
};

export function createSessionRecovery(auth: AuthAccess) {
  const pending = new Map<string, Promise<Session>>();
  const listeners = new Set<(error: SessionError) => void>();

  const end = (kind: TerminalKind, ownerId?: string) => {
    const error = new SessionError(kind, ownerId);
    listeners.forEach(listener => listener(error));
    return error;
  };

  function recover(token: string, failure: TokenFailure) {
    const key = (failure === "tokenExpired" || failure === "rejected" ? "refresh" : failure) + ":" + token;
    const existing = pending.get(key);
    if (existing) return existing;

    const operation = auth.lock(async () => {
      const ownerId = identity(token).userId;
      const stop = async (kind: TerminalKind) => {
        const error = end(kind, ownerId);
        await auth.invalidate().catch(() => undefined);
        throw error;
      };

      let current: Session | null;
      try {
        current = await auth.read();
      } catch (error) {
        if (isTerminalSessionError(error)) throw end(error.kind, ownerId);
        throw error;
      }
      if (!current) throw end(failure === "tokenExpired" || failure === "rejected" ? "missing" : failure, ownerId);
      if (!sameSession(current, token)) throw new SessionError("changed");
      if (failure !== "tokenExpired" && failure !== "rejected") return stop(failure);
      if (current.access_token !== token) return current;

      let updated: Session | null;
      try {
        // The SDK reads its current refresh token under its own storage lock.
        updated = await auth.refresh();
      } catch (error) {
        if (isTerminalSessionError(error)) return stop(error.kind === "expired" ? "expired" : "revoked");
        throw error;
      }
      if (!updated) return stop("invalid");
      if (!sameSession(updated, token)) throw new SessionError("changed");
      return updated;
    }).finally(() => pending.delete(key));
    pending.set(key, operation);
    return operation;
  }

  async function ensureSession(ownerId?: string) {
    let current: Session | null;
    try {
      current = await auth.read();
    } catch (error) {
      if (isTerminalSessionError(error)) throw end(error.kind, ownerId);
      throw error;
    }
    if (!current) throw end("missing", ownerId);
    if (ownerId && current.user.id !== ownerId) throw new SessionError("changed");
    return current;
  }

  async function verify(token: string) {
    try {
      return await auth.verify(token);
    } catch (error) {
      if (error instanceof SessionError && (error.kind === "revoked" || error.kind === "expired")) {
        await recover(token, error.kind);
      }
      if (!(error instanceof SessionError) || (error.kind !== "tokenExpired" && error.kind !== "rejected")) throw error;
      const current = await recover(token, error.kind);
      try {
        return await auth.verify(current.access_token);
      } catch (retryError) {
        if (retryError instanceof SessionError && isTokenFailure(retryError.kind)) {
          const kind = retryError.kind === "tokenExpired" || retryError.kind === "rejected" ? "invalid" : retryError.kind;
          await recover(current.access_token, kind);
        }
        throw retryError;
      }
    }
  }

  return {
    recover,
    ensureSession,
    verify,
    subscribe(listener: (error: SessionError) => void) {
      listeners.add(listener);
      return () => { listeners.delete(listener); };
    },
    async confirmLegacyFailure(token: string) {
      try {
        await auth.verify(token);
      } catch (error) {
        if (error instanceof SessionError && (error.kind === "expired" || error.kind === "revoked" || error.kind === "rejected" || error.kind === "tokenExpired")) {
          return error.kind;
        }
        throw error;
      }
    },
  };
}

const readRpcs = new Set([
  "automation_form_fields", "export_form_responses", "get_dashboard_forms_stats", "get_form_personal_links",
  "get_form_response_status", "list_admin_announcements", "list_announcement_prompts", "list_form_organizations",
  "list_forms_sorted", "list_notification_feed", "list_notification_group_items", "list_saved_form_organizations",
  "notification_unread_count",
]);

const edgeReads: Record<string, readonly string[]> = {
  "form-admin": ["get-cleanup-status"],
  "mail-admin": ["get-settings", "prepare-mail", "preview-mail"],
  "user-admin": ["list"],
};

function isSafeReplay(path: string, method: string, body: BodyInit | null | undefined) {
  if (method === "GET" || method === "HEAD") {
    return !path.endsWith("/editor-config") && !path.startsWith("/api/office/response-archives/");
  }
  if (method !== "POST") return false;
  const rpc = path.match(/^\/rest\/v1\/rpc\/([^/]+)$/)?.[1];
  if (rpc) return readRpcs.has(rpc);
  if (path.startsWith("/storage/v1/object/sign/")) return true;
  const edge = path.match(/^\/functions\/v1\/([^/]+)$/)?.[1];
  if (!edge || !Object.prototype.hasOwnProperty.call(edgeReads, edge) || typeof body !== "string") return false;
  try {
    return edgeReads[edge].includes(JSON.parse(body)?.action);
  } catch {
    return false;
  }
}

function failureResponse(error: SessionError) {
  const { status, code, message } = error;
  return Response.json({ statusCode: String(status), code, message, error: message }, { status });
}

async function readFailure(response: Response) {
  return await response.clone().json().catch(() => null) as ErrorData | null;
}

function isLegacyAuthFailure(path: string, body: ErrorData) {
  return (path.startsWith("/api/office/") && body.message === "Сессия истекла. Войдите снова.") ||
    (path.startsWith("/functions/v1/") && (body.error === "Unauthorized" || body.error === "Сессия недействительна"));
}

export function createSessionFetch(fetcher: typeof fetch, options: {
  supabaseUrl: string;
  officeOrigin: string;
  anonKey: string;
  recovery: ReturnType<typeof createSessionRecovery>;
}): typeof fetch {
  const base = new URL(options.supabaseUrl);
  const prefixPath = base.pathname.replace(/\/$/, "");
  const { recovery } = options;

  return async (input, init) => {
    const request = input instanceof Request ? input : undefined;
    const url = new URL(request?.url ?? String(input), options.officeOrigin);
    const path = url.origin === base.origin && url.pathname.startsWith(prefixPath + "/")
      ? url.pathname.slice(prefixPath.length) : "";
    const office = url.origin === options.officeOrigin && url.pathname.startsWith("/api/office/");
    if (!office && !/^\/(rest|storage|functions|auth)\/v1\//.test(path)) return fetcher(input, init);
    if (path.startsWith("/auth/v1/")) {
      // Map transient refresh errors to an SDK retryable status so credentials
      // survive gateway throttling or unavailable upstreams.
      const deadline = AbortSignal.timeout(10_000);
      const signal = init?.signal ? AbortSignal.any([deadline, init.signal]) : deadline;
      const response = await fetcher(input, { ...init, signal, cache: "no-store" });
      return path === "/auth/v1/token" && url.searchParams.get("grant_type") === "refresh_token" &&
        (response.status === 408 || response.status === 429 || response.status >= 500) &&
        ![500, 501, 502, 503, 504].includes(response.status)
        ? failureResponse(new SessionError("unavailable")) : response;
    }

    const endpoint = office ? url.pathname : path;
    const headers = new Headers(init?.headers ?? request?.headers);
    const signal = init?.signal ?? request?.signal;
    const method = (init?.method ?? request?.method ?? "GET").toUpperCase();
    let token = headers.get("Authorization")?.match(/^Bearer (.+)$/i)?.[1];

    try {
      signal?.throwIfAborted();
      if (!token || token === options.anonKey) {
        token = (await recovery.ensureSession()).access_token;
      }
      signal?.throwIfAborted();
      const send = (accessToken: string) => {
        const attemptHeaders = new Headers(headers);
        attemptHeaders.set("Authorization", "Bearer " + accessToken);
        return fetcher(input, { ...init, headers: attemptHeaders, cache: "no-store" });
      };
      const first = await send(token);
      if (first.status !== 401 && first.status !== 403 && first.status !== 400) return first;
      const body = await readFailure(first);
      if (!body) return first;

      const legacy = first.status === 401 && isLegacyAuthFailure(endpoint, body);
      const failure = tokenFailure(body, first.status) ?? (legacy ? await recovery.confirmLegacyFailure(token) : undefined);
      if (!failure) return legacy ? failureResponse(new SessionError("unavailable")) : first;

      const latest = await recovery.recover(token, failure);
      signal?.throwIfAborted();
      if (!isSafeReplay(endpoint, method, init?.body) || (request && request.body)) {
        return failureResponse(new SessionError("restored"));
      }
      const second = await send(latest.access_token);
      if ([400, 401, 403].includes(second.status)) {
        const retryBody = await readFailure(second);
        if (retryBody) {
          const retryFailure = tokenFailure(retryBody, second.status) ??
            (second.status === 401 && isLegacyAuthFailure(endpoint, retryBody)
              ? await recovery.confirmLegacyFailure(latest.access_token) : undefined);
          if (retryFailure === "revoked" || retryFailure === "expired") await recovery.recover(latest.access_token, retryFailure);
          if (retryFailure) return failureResponse(new SessionError("rejected"));
        }
      }
      return second;
    } catch (error) {
      if (error instanceof SessionError) return failureResponse(error);
      throw error;
    }
  };
}
