import { createClient } from "https://esm.sh/@supabase/supabase-js@2.100.0";

type FormAdminAction = {
  action: "delete";
  formId: string;
};

type SupabaseAdminClient = ReturnType<typeof createClient>;

const defaultAllowedOrigins = ["http://localhost:5173", "http://127.0.0.1:5173"];
const storageBucket = Deno.env.get("SURVEY_FILES_BUCKET") ?? "survey-files";

const baseCorsHeaders = {
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
  "Vary": "Origin",
};

const supabaseUrl = Deno.env.get("SUPABASE_URL") ?? "";
const supabaseAnonKey = Deno.env.get("SUPABASE_ANON_KEY") ?? "";
const supabaseServiceRoleKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "";

function getAllowedOrigins() {
  const configuredOrigins = Deno.env.get("FORM_ADMIN_ALLOWED_ORIGINS")
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

function isUuid(value: unknown): value is string {
  return (
    typeof value === "string" &&
    /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(value)
  );
}

function parseStorageObjectName(value: unknown) {
  if (typeof value !== "string") {
    return null;
  }

  const parts = value.split("/");

  if (parts.length < 3) {
    return null;
  }

  return {
    name: value,
    formId: parts[1],
  };
}

async function removeStorageObjectsForForm(adminClient: SupabaseAdminClient, formId: string) {
  let removedCount = 0;

  for (;;) {
    const { data, error } = await adminClient
      .schema("storage")
      .from("objects")
      .select("name")
      .eq("bucket_id", storageBucket)
      .like("name", `%/${formId}/%`)
      .limit(1000);

    if (error) {
      return { removedCount, error };
    }

    const names = (data ?? [])
      .map((item: { name?: unknown }) => parseStorageObjectName(item.name))
      .filter((item): item is { name: string; formId: string } => item?.formId === formId)
      .map((item) => item.name);

    if (names.length === 0) {
      return { removedCount, error: null };
    }

    const { error: removeError } = await adminClient.storage.from(storageBucket).remove(names);

    if (removeError) {
      return { removedCount, error: removeError };
    }

    removedCount += names.length;
  }
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

  let payload: FormAdminAction;
  try {
    payload = (await req.json()) as FormAdminAction;
  } catch {
    return jsonResponse(req, 400, { error: "Invalid JSON payload" });
  }

  if (payload.action !== "delete" || !isUuid(payload.formId)) {
    return jsonResponse(req, 400, { error: "Invalid delete payload" });
  }

  const { data: form, error: formError } = await adminClient
    .from("forms")
    .select("id, author_id")
    .eq("id", payload.formId)
    .single();

  if (formError || !form) {
    return jsonResponse(req, 404, { error: "Form not found" });
  }

  const { data: requesterProfile, error: requesterProfileError } = await adminClient
    .from("profiles")
    .select("role")
    .eq("id", requester.id)
    .single();

  if (
    form.author_id !== requester.id &&
    (requesterProfileError || requesterProfile?.role !== "admin")
  ) {
    return jsonResponse(req, 403, { error: "Forbidden" });
  }

  const { removedCount, error: storageError } = await removeStorageObjectsForForm(adminClient, payload.formId);

  if (storageError) {
    return jsonResponse(req, 400, { error: storageError.message });
  }

  const { error: deleteError } = await adminClient
    .from("forms")
    .delete()
    .eq("id", form.id);

  if (deleteError) {
    return jsonResponse(req, 400, { error: deleteError.message });
  }

  return jsonResponse(req, 200, { success: true, removedFiles: removedCount });
});
