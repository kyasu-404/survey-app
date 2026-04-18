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

const defaultAllowedOrigins = ["http://localhost:5173", "http://127.0.0.1:5173"];

const baseCorsHeaders = {
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
  "Vary": "Origin",
};

const supabaseUrl = Deno.env.get("SUPABASE_URL") ?? "";
const supabaseAnonKey = Deno.env.get("SUPABASE_ANON_KEY") ?? "";
const supabaseServiceRoleKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "";

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

function jsonResponse(req: Request, status: number, body: Record<string, unknown>) {
  return new Response(JSON.stringify(body), {
    status,
    headers: {
      ...buildCorsHeaders(req),
      "Content-Type": "application/json",
    },
  });
}

function isUserRole(value: unknown): value is UserRole {
  return value === "admin" || value === "user";
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") {
    if (!isOriginAllowed(req.headers.get("Origin"))) {
      return new Response("Origin not allowed", { status: 403, headers: buildCorsHeaders(req) });
    }

    return new Response("ok", { headers: buildCorsHeaders(req) });
  }

  if (!isOriginAllowed(req.headers.get("Origin"))) {
    return jsonResponse(req, 403, { error: "Origin not allowed" });
  }

  if (req.method !== "POST") {
    return jsonResponse(req, 405, { error: "Method not allowed" });
  }

  if (!supabaseUrl || !supabaseAnonKey || !supabaseServiceRoleKey) {
    return jsonResponse(req, 500, { error: "Supabase env vars are not configured" });
  }

  const authHeader = req.headers.get("Authorization");
  if (!authHeader) {
    return jsonResponse(req, 401, { error: "Missing Authorization header" });
  }

  const jwt = authHeader.replace(/^Bearer\s+/i, "").trim();
  if (!jwt) {
    return jsonResponse(req, 401, { error: "Invalid Authorization header" });
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
    return jsonResponse(req, 401, { error: "Unauthorized" });
  }

  const { data: requesterProfile, error: requesterProfileError } = await adminClient
    .from("profiles")
    .select("role")
    .eq("id", requester.id)
    .single();

  if (requesterProfileError || requesterProfile?.role !== "admin") {
    return jsonResponse(req, 403, { error: "Forbidden" });
  }

  let payload: UserAdminAction;
  try {
    payload = (await req.json()) as UserAdminAction;
  } catch {
    return jsonResponse(req, 400, { error: "Invalid JSON payload" });
  }

  switch (payload.action) {
    case "list": {
      // Source of truth for Users page is `profiles`.
      // Do not depend on auth.admin.listUsers() for table rendering.
      const { data: profileUsers, error: profilesError } = await adminClient
        .from("profiles")
        .select("id, name, email, role, is_disabled, created_at")
        .order("created_at", { ascending: false });

      if (profilesError) {
        return jsonResponse(req, 400, { error: profilesError.message });
      }

      return jsonResponse(req, 200, { users: profileUsers ?? [] });
    }

    case "create": {
      if (!payload.name?.trim() || !payload.email?.trim() || payload.password.length < 8 || !isUserRole(payload.role)) {
        return jsonResponse(req, 400, { error: "Invalid create payload" });
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
        return jsonResponse(req, 400, { error: error.message });
      }

      const createdUserId = data.user?.id;
      if (!createdUserId) {
        return jsonResponse(req, 500, { error: "User was created without an id" });
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
          return jsonResponse(req, 500, {
            error: `User was partially created: profile update failed (${profileError.message}) and cleanup failed (${rollbackError.message})`,
          });
        }

        return jsonResponse(req, 400, {
          error: `User creation failed and was rolled back: ${profileError.message}`,
        });
      }

      return jsonResponse(req, 200, { userId: createdUserId });
    }

    case "delete": {
      if (!payload.userId) {
        return jsonResponse(req, 400, { error: "userId is required" });
      }

      if (payload.userId === requester.id) {
        return jsonResponse(req, 400, { error: "You cannot delete yourself" });
      }

      const { error } = await adminClient.auth.admin.deleteUser(payload.userId);
      if (error) {
        return jsonResponse(req, 400, { error: error.message });
      }

      return jsonResponse(req, 200, { success: true });
    }

    case "updatePassword": {
      if (!payload.userId || payload.password.length < 8) {
        return jsonResponse(req, 400, { error: "Invalid password update payload" });
      }

      const { error } = await adminClient.auth.admin.updateUserById(payload.userId, {
        password: payload.password,
      });

      if (error) {
        return jsonResponse(req, 400, { error: error.message });
      }

      return jsonResponse(req, 200, { success: true });
    }

    case "setDisabled": {
      if (!payload.userId) {
        return jsonResponse(req, 400, { error: "userId is required" });
      }

      if (payload.userId === requester.id) {
        return jsonResponse(req, 400, { error: "You cannot disable yourself" });
      }

      const { error: authError } = await adminClient.auth.admin.updateUserById(payload.userId, {
        ban_duration: payload.disabled ? "876000h" : "none",
      });

      if (authError) {
        return jsonResponse(req, 400, { error: authError.message });
      }

      const { error: profileError } = await adminClient
        .from("profiles")
        .update({ is_disabled: payload.disabled })
        .eq("id", payload.userId);

      if (profileError) {
        return jsonResponse(req, 400, { error: profileError.message });
      }

      return jsonResponse(req, 200, { success: true });
    }

    case "updateRole": {
      if (!payload.userId || !isUserRole(payload.role)) {
        return jsonResponse(req, 400, { error: "Invalid role update payload" });
      }

      if (payload.userId === requester.id) {
        return jsonResponse(req, 400, { error: "You cannot change your own role" });
      }

      const { data: updatedProfile, error } = await adminClient
        .from("profiles")
        .update({ role: payload.role })
        .eq("id", payload.userId)
        .select("id")
        .maybeSingle();

      if (error) {
        return jsonResponse(req, 400, { error: error.message });
      }

      if (!updatedProfile) {
        return jsonResponse(req, 404, { error: "User profile not found" });
      }

      return jsonResponse(req, 200, { success: true });
    }

    default:
      return jsonResponse(req, 400, { error: "Unsupported action" });
  }
});
