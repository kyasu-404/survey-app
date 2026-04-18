import { createClient } from "https://esm.sh/@supabase/supabase-js@2.100.0";

type UserRole = "admin" | "user";

type UserAdminAction =
  | {
      action: "list";
    }
  | {
      action: "create";
      name: string;
      email: string;
      password: string;
      role: UserRole;
    }
  | {
      action: "delete";
      userId: string;
    }
  | {
      action: "updatePassword";
      userId: string;
      password: string;
    }
  | {
      action: "setDisabled";
      userId: string;
      disabled: boolean;
    }
  | {
      action: "updateRole";
      userId: string;
      role: UserRole;
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

  return new Set(configuredOrigins?.length ? configuredOrigins : defaultAllowedOrigins);
}

function isOriginAllowed(origin: string | null) {
  return !origin || getAllowedOrigins().has(origin);
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

function getTargetUserId(payload: UserAdminAction) {
  return "userId" in payload ? payload.userId : undefined;
}

function isUserRole(value: unknown): value is UserRole {
  return value === "admin" || value === "user";
}

Deno.serve(async (req) => {
  const requestLogContext = createRequestLogContext(req);

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
    .select("role")
    .eq("id", requester.id)
    .single();

  if (requesterProfileError || requesterProfile?.role !== "admin") {
    return errorResponse(req, 403, "Forbidden", { ...requestLogContext, userId: requester.id });
  }

  let payload: UserAdminAction;
  try {
    payload = (await req.json()) as UserAdminAction;
  } catch {
    return errorResponse(req, 400, "Invalid JSON payload", { ...requestLogContext, userId: requester.id });
  }

  const actionLogContext: RequestLogContext = {
    ...requestLogContext,
    operation: `user-admin.${payload.action}`,
    userId: requester.id,
    targetUserId: getTargetUserId(payload),
  };

  console.info("user-admin action started", actionLogContext);

  switch (payload.action) {
    case "list": {
      // Source of truth for Users page is `profiles`.
      // Do not depend on auth.admin.listUsers() for table rendering.
      const { data: profileUsers, error: profilesError } = await adminClient
        .from("profiles")
        .select("id, name, email, role, is_disabled, created_at")
        .order("created_at", { ascending: false });

      if (profilesError) {
        return errorResponse(req, 400, profilesError.message, actionLogContext);
      }

      console.info("user-admin action completed", {
        ...actionLogContext,
        resultCount: profileUsers?.length ?? 0,
      });

      return jsonResponse(req, 200, { users: profileUsers ?? [] }, actionLogContext);
    }

    case "create": {
      if (!payload.name?.trim() || !payload.email?.trim() || payload.password.length < 8 || !isUserRole(payload.role)) {
        return errorResponse(req, 400, "Invalid create payload", actionLogContext);
      }

      const name = payload.name.trim();
      const email = payload.email.trim();

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
      if (!payload.userId) {
        return errorResponse(req, 400, "userId is required", actionLogContext);
      }

      if (payload.userId === requester.id) {
        return errorResponse(req, 400, "You cannot delete yourself", actionLogContext);
      }

      const { error } = await adminClient.auth.admin.deleteUser(payload.userId);
      if (error) {
        return errorResponse(req, 400, error.message, actionLogContext);
      }

      console.info("user-admin action completed", actionLogContext);

      return jsonResponse(req, 200, { success: true }, actionLogContext);
    }

    case "updatePassword": {
      if (!payload.userId || payload.password.length < 8) {
        return errorResponse(req, 400, "Invalid password update payload", actionLogContext);
      }

      const { error } = await adminClient.auth.admin.updateUserById(payload.userId, {
        password: payload.password,
      });

      if (error) {
        return errorResponse(req, 400, error.message, actionLogContext);
      }

      console.info("user-admin action completed", actionLogContext);

      return jsonResponse(req, 200, { success: true }, actionLogContext);
    }

    case "setDisabled": {
      if (!payload.userId) {
        return errorResponse(req, 400, "userId is required", actionLogContext);
      }

      if (payload.userId === requester.id) {
        return errorResponse(req, 400, "You cannot disable yourself", actionLogContext);
      }

      const { error: authError } = await adminClient.auth.admin.updateUserById(payload.userId, {
        ban_duration: payload.disabled ? "876000h" : "none",
      });

      if (authError) {
        return errorResponse(req, 400, authError.message, actionLogContext);
      }

      const { error: profileError } = await adminClient
        .from("profiles")
        .update({ is_disabled: payload.disabled })
        .eq("id", payload.userId);

      if (profileError) {
        return errorResponse(req, 400, profileError.message, actionLogContext);
      }

      console.info("user-admin action completed", {
        ...actionLogContext,
        disabled: payload.disabled,
      });

      return jsonResponse(req, 200, { success: true }, actionLogContext);
    }

    case "updateRole": {
      if (!payload.userId || !isUserRole(payload.role)) {
        return errorResponse(req, 400, "Invalid role update payload", actionLogContext);
      }

      if (payload.userId === requester.id) {
        return errorResponse(req, 400, "You cannot change your own role", actionLogContext);
      }

      const { data: updatedProfile, error } = await adminClient
        .from("profiles")
        .update({ role: payload.role })
        .eq("id", payload.userId)
        .select("id")
        .maybeSingle();

      if (error) {
        return errorResponse(req, 400, error.message, actionLogContext);
      }

      if (!updatedProfile) {
        return errorResponse(req, 404, "User profile not found", actionLogContext);
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
});
