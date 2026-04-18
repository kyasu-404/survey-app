import { createClient } from "https://esm.sh/@supabase/supabase-js@2.100.0";

type FormAdminAction = {
  action: "delete";
  formId: string;
};

type SupabaseAdminClient = ReturnType<typeof createClient>;
type RequestLogContext = {
  requestId: string;
  traceparent: string | null;
  traceId: string | null;
  release: string | null;
  operation: string;
  userId?: string;
  formId?: string;
};

const defaultAllowedOrigins = ["http://localhost:5173", "http://127.0.0.1:5173"];
const storageBucket = Deno.env.get("SURVEY_FILES_BUCKET") ?? "survey-files";

const baseCorsHeaders = {
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type, x-request-id, x-trace-id, x-client-release, traceparent",
  "Access-Control-Expose-Headers": "x-request-id",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
  "Vary": "Origin",
};

const supabaseUrl = Deno.env.get("SUPABASE_URL") ?? "";
const supabaseAnonKey = Deno.env.get("SUPABASE_ANON_KEY") ?? "";
const supabaseServiceRoleKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "";

function createRequestLogContext(req: Request, operation = "form-admin"): RequestLogContext {
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
  console.error("form-admin action failed", {
    ...requestLogContext,
    status,
    error,
  });

  return jsonResponse(req, status, { error }, requestLogContext);
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

  let payload: FormAdminAction;
  try {
    payload = (await req.json()) as FormAdminAction;
  } catch {
    return errorResponse(req, 400, "Invalid JSON payload", { ...requestLogContext, userId: requester.id });
  }

  if (payload.action !== "delete" || !isUuid(payload.formId)) {
    return errorResponse(req, 400, "Invalid delete payload", { ...requestLogContext, userId: requester.id });
  }

  const actionLogContext: RequestLogContext = {
    ...requestLogContext,
    operation: "form-admin.delete",
    userId: requester.id,
    formId: payload.formId,
  };

  console.info("form-admin action started", actionLogContext);

  const { data: form, error: formError } = await adminClient
    .from("forms")
    .select("id, author_id")
    .eq("id", payload.formId)
    .single();

  if (formError || !form) {
    return errorResponse(req, 404, "Form not found", actionLogContext);
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
    return errorResponse(req, 403, "Forbidden", actionLogContext);
  }

  const { removedCount, error: storageError } = await removeStorageObjectsForForm(adminClient, payload.formId);

  if (storageError) {
    return errorResponse(req, 400, storageError.message, actionLogContext);
  }

  const { error: deleteError } = await adminClient
    .from("forms")
    .delete()
    .eq("id", form.id);

  if (deleteError) {
    return errorResponse(req, 400, deleteError.message, actionLogContext);
  }

  console.info("form-admin action completed", {
    ...actionLogContext,
    removedFiles: removedCount,
  });

  return jsonResponse(req, 200, { success: true, removedFiles: removedCount }, actionLogContext);
});
