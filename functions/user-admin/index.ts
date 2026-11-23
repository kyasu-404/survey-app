import { createClient } from "npm:@supabase/supabase-js@2.110.7";

type UserRole = "admin" | "user";
type ListedUser = {
  id: string;
  name: string;
  email: string;
  role: UserRole;
  is_disabled: boolean;
  created_at: string;
};

type RequestLogContext = {
  requestId: string;
  traceparent: string | null;
  traceId: string | null;
  release: string | null;
  operation: string;
  userId?: string;
  targetUserId?: string;
};

const defaultAllowedOrigins = ["http://localhost:5173", "http://127.0.0.1:5173"];
const defaultAllowedDevelopmentPorts = new Set(["3000", "4173", "5173", "8000"]);
const minimumPasswordLength = 12;
const maximumPasswordBytes = 72;

const baseCorsHeaders = {
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type, x-request-id, x-trace-id, x-client-release, traceparent",
  "Access-Control-Expose-Headers": "x-request-id",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
  "Vary": "Origin",
};

const supabaseUrl = Deno.env.get("SUPABASE_URL") ?? "";
const supabaseAnonKey = Deno.env.get("SUPABASE_ANON_KEY") ?? "";
const supabaseServiceRoleKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "";

function createRequestLogContext(req: Request, operation = "user-admin"): RequestLogContext {
  const traceparent = req.headers.get("traceparent");
  const traceId = req.headers.get("x-trace-id") ?? traceparent?.split("-")[1] ?? null;

  return {
    requestId: req.headers.get("x-request-id") ?? crypto.randomUUID(),
    traceparent: req.headers.get("traceparent"),
    traceId,
    release: req.headers.get("x-client-release"),
    operation,
  };
}

function getAllowedOrigins() {
  const configuredOrigins = Deno.env.get("USER_ADMIN_ALLOWED_ORIGINS")
    ?.split(",")
    .map((origin) => origin.trim())
    .filter(Boolean);

  return new Set(configuredOrigins ?? defaultAllowedOrigins);
}

function isPrivateNetworkHostname(hostname: string) {
  const octets = hostname.split(".");
  if (octets.length !== 4 || octets.some((part) => !/^\d{1,3}$/.test(part) || Number(part) > 255)) return false;
  const [first, second] = octets.map(Number);
  return first === 10 || (first === 192 && second === 168) || (first === 172 && second >= 16 && second <= 31);
}

function isDefaultLocalDevelopmentOrigin(origin: string) {
  try {
    const url = new URL(origin);
    if (url.origin !== origin || (url.protocol !== "http:" && url.protocol !== "https:")) {
      return false;
    }

    const hostname = url.hostname.replace(/^\[|\]$/g, "");
    const isLoopbackHostname = hostname === "localhost" || hostname === "127.0.0.1" || hostname === "::1";

    return (
      defaultAllowedDevelopmentPorts.has(url.port) &&
      (isLoopbackHostname || isPrivateNetworkHostname(hostname))
    );
  } catch {
    return false;
  }
}

function isOriginAllowed(origin: string | null) {
  return !origin || getAllowedOrigins().has(origin)
    || (Deno.env.get("USER_ADMIN_ALLOWED_ORIGINS") === undefined && isDefaultLocalDevelopmentOrigin(origin));
}

function buildCorsHeaders(req: Request) {
  const origin = req.headers.get("Origin");
  const headers: Record<string, string> = { ...baseCorsHeaders };

  if (origin && isOriginAllowed(origin)) {
    headers["Access-Control-Allow-Origin"] = origin;
  }

  return headers;
}

function jsonResponse(
  req: Request,
  status: number,
  body: Record<string, unknown>,
  requestLogContext = createRequestLogContext(req),
) {
  return new Response(JSON.stringify(body), {
    status,
    headers: {
      ...buildCorsHeaders(req),
      "Content-Type": "application/json",
      "x-request-id": requestLogContext.requestId,
    },
  });
}

function errorResponse(req: Request, status: number, error: string, requestLogContext: RequestLogContext) {
  console.error("user-admin action failed", {
    ...requestLogContext,
    status,
    error,
  });

  return jsonResponse(req, status, { error }, requestLogContext);
}

function isUserRole(value: unknown): value is UserRole {
  return value === "admin" || value === "user";
}

function getTargetUserId(value: unknown) {
  if (typeof value !== "string") return undefined;
  const id = value.trim().toLowerCase();
  return /^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/.test(id) ? id : undefined;
}

function isValidPassword(value: unknown): value is string {
  return typeof value === "string" && value.length <= maximumPasswordBytes
    && Array.from(value).length >= minimumPasswordLength
    && new TextEncoder().encode(value).length <= maximumPasswordBytes;
}

Deno.serve(async (req) => {
  const requestLogContext = createRequestLogContext(req);
  try {
    return await handleRequest(req, requestLogContext);
  } catch (error) {
    console.error("user-admin action failed", {
      ...requestLogContext,
      status: 500,
      error: error instanceof Error ? error.message : "Unknown error",
    });
    return errorResponse(req, 500, "Internal server error", requestLogContext);
  }
});

async function handleRequest(req: Request, requestLogContext: RequestLogContext) {
  if (req.method === "OPTIONS") {
    if (!isOriginAllowed(req.headers.get("Origin"))) {
      return new Response("Origin not allowed", { status: 403, headers: buildCorsHeaders(req) });
    }

    return new Response("ok", { headers: buildCorsHeaders(req) });
  }

  if (!isOriginAllowed(req.headers.get("Origin"))) {
    return errorResponse(req, 403, "Origin not allowed", requestLogContext);
  }

  if (req.method !== "POST") {
    return errorResponse(req, 405, "Method not allowed", requestLogContext);
  }

  if (!supabaseUrl || !supabaseAnonKey || !supabaseServiceRoleKey) {
    return errorResponse(req, 500, "Supabase env vars are not configured", requestLogContext);
  }

  const authHeader = req.headers.get("Authorization");
  if (!authHeader) {
    return errorResponse(req, 401, "Missing Authorization header", requestLogContext);
  }

  const jwt = authHeader.replace(/^Bearer\s+/i, "").trim();
  if (!jwt) {
    return errorResponse(req, 401, "Invalid Authorization header", requestLogContext);
  }

  const authClient = createClient(supabaseUrl, supabaseAnonKey, {
    global: { headers: { Authorization: `Bearer ${jwt}` } },
    auth: { persistSession: false, autoRefreshToken: false },
  });

  const adminClient = createClient(supabaseUrl, supabaseServiceRoleKey, {
    auth: { persistSession: false, autoRefreshToken: false },
  });

  const {
    data: { user: requester },
    error: requesterError,
  } = await authClient.auth.getUser(jwt);

  if (requesterError || !requester) {
    return errorResponse(req, 401, "Unauthorized", requestLogContext);
  }

  const { data: requesterProfile, error: requesterProfileError } = await adminClient
    .from("profiles")
    .select("role, is_disabled")
    .eq("id", requester.id)
    .single();

  if (requesterProfileError || requesterProfile?.role !== "admin" || requesterProfile?.is_disabled === true) {
    return errorResponse(req, 403, "Forbidden", { ...requestLogContext, userId: requester.id });
  }

  let payload: Record<string, unknown> & { action: string };
  try {
    const body: unknown = await req.json();
    if (body === null || typeof body !== "object" || Array.isArray(body)
      || !("action" in body) || typeof body.action !== "string") {
      throw new TypeError("Expected a JSON object with an action");
    }
    payload = body as typeof payload;
  } catch {
    return errorResponse(req, 400, "Invalid JSON payload", { ...requestLogContext, userId: requester.id });
  }

  const targetUserId = getTargetUserId(payload.userId);
  const isSelfRequest = targetUserId === requester.id.toLowerCase();
  const actionLogContext: RequestLogContext = {
    ...requestLogContext,
    operation: `user-admin.${payload.action}`,
    userId: requester.id,
    targetUserId,
  };

  console.info("user-admin action started", actionLogContext);

  switch (payload.action) {
    case "list": {
      // Source of truth for Users page is `profiles`.
      // Do not depend on auth.admin.listUsers() for table rendering.
      const profileUsers: ListedUser[] = [];
      const pageSize = 1000;
      for (let offset = 0; ; offset += pageSize) {
        const { data, error } = await adminClient
          .from("profiles")
          .select("id, name, email, role, is_disabled, created_at")
          .order("created_at", { ascending: false })
          .order("id", { ascending: false })
          .range(offset, offset + pageSize - 1);

        if (error) {
          return errorResponse(req, 400, error.message, actionLogContext);
        }
        const page = (data ?? []) as ListedUser[];
        profileUsers.push(...page);
        if (page.length < pageSize) break;
      }

      console.info("user-admin action completed", {
        ...actionLogContext,
        resultCount: profileUsers?.length ?? 0,
      });

      return jsonResponse(req, 200, { users: profileUsers ?? [] }, actionLogContext);
    }

    case "create": {
      const name = typeof payload.name === "string" ? payload.name.trim() : "";
      const email = typeof payload.email === "string" ? payload.email.trim().toLowerCase() : "";
      if (!name || name.length > 200 || /[\x00-\x1f\x7f]/.test(name)
        || !email || email.length > 320 || /[\x00-\x1f\x7f\s]/.test(email) || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)
        || !isValidPassword(payload.password) || !isUserRole(payload.role)) {
        return errorResponse(req, 400, "Invalid create payload", actionLogContext);
      }

      const { data, error } = await adminClient.auth.admin.createUser({
        email,
        password: payload.password,
        user_metadata: {
          name,
        },
        email_confirm: true,
      });

      if (error) {
        return errorResponse(req, 400, error.message, actionLogContext);
      }

      const createdUserId = data.user?.id;
      if (!createdUserId) {
        return errorResponse(req, 500, "User was created without an id", actionLogContext);
      }

      const { error: profileError } = await adminClient.from("profiles").upsert(
        {
          id: createdUserId,
          name,
          email,
          role: payload.role,
          is_disabled: false,
        },
        { onConflict: "id" }
      );

      if (profileError) {
        const { error: rollbackError } = await adminClient.auth.admin.deleteUser(createdUserId);

        if (rollbackError) {
          return errorResponse(
            req,
            500,
            `User was partially created: profile update failed (${profileError.message}) and cleanup failed (${rollbackError.message})`,
            { ...actionLogContext, targetUserId: createdUserId },
          );
        }

        return errorResponse(
          req,
          400,
          `User creation failed and was rolled back: ${profileError.message}`,
          { ...actionLogContext, targetUserId: createdUserId },
        );
      }

      console.info("user-admin action completed", {
        ...actionLogContext,
        targetUserId: createdUserId,
      });

      return jsonResponse(req, 200, { userId: createdUserId }, { ...actionLogContext, targetUserId: createdUserId });
    }

    case "delete": {
      if (!targetUserId) {
        return errorResponse(req, 400, "userId is required", actionLogContext);
      }

      if (isSelfRequest) {
        return errorResponse(req, 400, "You cannot delete yourself", actionLogContext);
      }

      const { data: canDelete, error: guardError } = await adminClient.rpc("assert_can_delete_employee", {
        p_user_id: targetUserId,
        p_actor_id: requester.id,
      });
      if (guardError) {
        const status = guardError.code === "42501" ? 403 : guardError.code === "P0002" ? 404 : 400;
        return errorResponse(req, status, guardError.message, actionLogContext);
      }
      if (canDelete !== true) {
        return errorResponse(req, 503, "Invalid delete guard result", actionLogContext);
      }

      const { error } = await adminClient.auth.admin.deleteUser(targetUserId);
      if (error) {
        return errorResponse(req, 400, error.message, actionLogContext);
      }

      console.info("user-admin action completed", actionLogContext);

      return jsonResponse(req, 200, { success: true }, actionLogContext);
    }

    case "updatePassword": {
      if (!targetUserId || !isValidPassword(payload.password)) {
        return errorResponse(req, 400, "Invalid password update payload", actionLogContext);
      }
      if (isSelfRequest) {
        return errorResponse(req, 403, "Смените свой пароль во вкладке «Безопасность» личных настроек", actionLogContext);
      }

      const { error } = await adminClient.auth.admin.updateUserById(targetUserId, {
        password: payload.password,
      });

      if (error) {
        return errorResponse(req, 400, error.message, actionLogContext);
      }

      if (typeof adminClient.auth.admin.signOut === "function") {
        const { error: signOutError } = await adminClient.auth.admin.signOut(targetUserId, "global");
        if (signOutError) {
          console.warn("user-admin global signOut after password reset failed", {
            ...actionLogContext,
            error: signOutError.message,
          });
        }
      }

      console.info("user-admin action completed", actionLogContext);

      return jsonResponse(req, 200, { success: true }, actionLogContext);
    }

    case "setDisabled": {
      if (!targetUserId || typeof payload.disabled !== "boolean") {
        return errorResponse(req, 400, "userId and boolean disabled are required", actionLogContext);
      }

      if (isSelfRequest) {
        return errorResponse(req, 400, "You cannot disable yourself", actionLogContext);
      }

      const { data: changed, error } = await adminClient.rpc("set_employee_disabled", {
        p_user_id: targetUserId,
        p_disabled: payload.disabled,
        p_actor_id: requester.id,
      });
      if (error) {
        const status = error.code === "42501" ? 403 : error.code === "P0002" ? 404 : 400;
        return errorResponse(req, status, error.message, actionLogContext);
      }
      if (changed !== true) return errorResponse(req, 503, "Invalid status update result", actionLogContext);

      console.info("user-admin action completed", {
        ...actionLogContext,
        disabled: payload.disabled,
      });

      return jsonResponse(req, 200, { success: true }, actionLogContext);
    }

    case "updateRole": {
      if (!targetUserId || !isUserRole(payload.role)) {
        return errorResponse(req, 400, "Invalid role update payload", actionLogContext);
      }

      if (isSelfRequest) {
        return errorResponse(req, 400, "You cannot change your own role", actionLogContext);
      }

      const { data: changed, error } = await adminClient.rpc("set_employee_role", {
        p_user_id: targetUserId,
        p_role: payload.role,
        p_actor_id: requester.id,
      });

      if (error) {
        const status = error.code === "42501" ? 403 : error.code === "P0002" ? 404 : 400;
        return errorResponse(req, status, error.message, actionLogContext);
      }

      if (changed !== true) {
        return errorResponse(req, 503, "Invalid role update result", actionLogContext);
      }

      console.info("user-admin action completed", {
        ...actionLogContext,
        role: payload.role,
      });

      return jsonResponse(req, 200, { success: true }, actionLogContext);
    }

    default:
      return errorResponse(req, 400, "Unsupported action", actionLogContext);
  }
}
