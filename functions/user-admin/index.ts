import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

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
    };

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

const supabaseUrl = Deno.env.get("SUPABASE_URL") ?? "";
const supabaseAnonKey = Deno.env.get("SUPABASE_ANON_KEY") ?? "";
const supabaseServiceRoleKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "";

function jsonResponse(status: number, body: Record<string, unknown>) {
  return new Response(JSON.stringify(body), {
    status,
    headers: {
      ...corsHeaders,
      "Content-Type": "application/json",
    },
  });
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: corsHeaders });
  }

  if (req.method !== "POST") {
    return jsonResponse(405, { error: "Method not allowed" });
  }

  if (!supabaseUrl || !supabaseAnonKey || !supabaseServiceRoleKey) {
    return jsonResponse(500, { error: "Supabase env vars are not configured" });
  }

  const authHeader = req.headers.get("Authorization");
  if (!authHeader) {
    return jsonResponse(401, { error: "Missing Authorization header" });
  }

  const jwt = authHeader.replace(/^Bearer\s+/i, "").trim();
  if (!jwt) {
    return jsonResponse(401, { error: "Invalid Authorization header" });
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
    return jsonResponse(401, { error: "Unauthorized" });
  }

  const { data: requesterProfile, error: requesterProfileError } = await adminClient
    .from("profiles")
    .select("role")
    .eq("id", requester.id)
    .single();

  if (requesterProfileError || requesterProfile?.role !== "admin") {
    return jsonResponse(403, { error: "Forbidden" });
  }

  let payload: UserAdminAction;
  try {
    payload = (await req.json()) as UserAdminAction;
  } catch {
    return jsonResponse(400, { error: "Invalid JSON payload" });
  }

  switch (payload.action) {
    case "list": {
      const { data: profiles, error: profilesError } = await adminClient
        .from("profiles")
        .select("id, name, email, role, is_disabled, created_at")
        .order("created_at", { ascending: false });

      if (profilesError) {
        return jsonResponse(400, { error: profilesError.message });
      }

      const { data: authUsersData, error: authUsersError } = await adminClient.auth.admin.listUsers({
        page: 1,
        perPage: 1000,
      });

      if (authUsersError) {
        return jsonResponse(400, { error: authUsersError.message });
      }

      const profilesById = new Map((profiles ?? []).map((profile) => [profile.id, profile]));
      const mergedUsers = (authUsersData?.users ?? []).map((authUser) => {
        const profile = profilesById.get(authUser.id);
        const userMetadata = authUser.user_metadata ?? {};

        return {
          id: authUser.id,
          name:
            profile?.name ??
            (typeof userMetadata.name === "string" ? userMetadata.name : null),
          email: profile?.email ?? authUser.email ?? "",
          role:
            profile?.role ??
            (userMetadata.role === "admin" || userMetadata.role === "user" ? userMetadata.role : "user"),
          is_disabled: profile?.is_disabled ?? Boolean(authUser.banned_until),
          created_at: profile?.created_at ?? authUser.created_at,
        };
      });

      mergedUsers.sort((a, b) => {
        const first = a.created_at ? new Date(a.created_at).getTime() : 0;
        const second = b.created_at ? new Date(b.created_at).getTime() : 0;
        return second - first;
      });

      return jsonResponse(200, { users: mergedUsers });
    }

    case "create": {
      if (!payload.name?.trim() || !payload.email?.trim() || payload.password.length < 8) {
        return jsonResponse(400, { error: "Invalid create payload" });
      }

      const { data, error } = await adminClient.auth.admin.createUser({
        email: payload.email.trim(),
        password: payload.password,
        user_metadata: {
          name: payload.name.trim(),
          role: payload.role,
        },
        email_confirm: true,
      });

      if (error) {
        return jsonResponse(400, { error: error.message });
      }

      if (data.user?.id) {
        const { error: profileError } = await adminClient.from("profiles").upsert(
          {
            id: data.user.id,
            name: payload.name.trim(),
            email: payload.email.trim(),
            role: payload.role,
            is_disabled: false,
          },
          { onConflict: "id" }
        );

        if (profileError) {
          return jsonResponse(400, { error: profileError.message });
        }
      }

      return jsonResponse(200, { userId: data.user?.id ?? null });
    }

    case "delete": {
      if (!payload.userId) {
        return jsonResponse(400, { error: "userId is required" });
      }

      if (payload.userId === requester.id) {
        return jsonResponse(400, { error: "You cannot delete yourself" });
      }

      const { error } = await adminClient.auth.admin.deleteUser(payload.userId);
      if (error) {
        return jsonResponse(400, { error: error.message });
      }

      return jsonResponse(200, { success: true });
    }

    case "updatePassword": {
      if (!payload.userId || payload.password.length < 8) {
        return jsonResponse(400, { error: "Invalid password update payload" });
      }

      const { error } = await adminClient.auth.admin.updateUserById(payload.userId, {
        password: payload.password,
      });

      if (error) {
        return jsonResponse(400, { error: error.message });
      }

      return jsonResponse(200, { success: true });
    }

    case "setDisabled": {
      if (!payload.userId) {
        return jsonResponse(400, { error: "userId is required" });
      }

      if (payload.userId === requester.id) {
        return jsonResponse(400, { error: "You cannot disable yourself" });
      }

      const { error: authError } = await adminClient.auth.admin.updateUserById(payload.userId, {
        ban_duration: payload.disabled ? "876000h" : "none",
      });

      if (authError) {
        return jsonResponse(400, { error: authError.message });
      }

      const { error: profileError } = await adminClient
        .from("profiles")
        .update({ is_disabled: payload.disabled })
        .eq("id", payload.userId);

      if (profileError) {
        return jsonResponse(400, { error: profileError.message });
      }

      return jsonResponse(200, { success: true });
    }

    default:
      return jsonResponse(400, { error: "Unsupported action" });
  }
});
