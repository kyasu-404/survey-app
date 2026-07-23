import { createClient } from "https://esm.sh/@supabase/supabase-js@2.100.0";

type FormAdminAction =
  | { action: "delete"; formId: string }
  | { action: "delete-upload"; formId: string; path: string }
  | { action: "cleanup-orphans"; olderThanHours?: number };

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
const defaultAllowedDevelopmentPorts = new Set(["3000", "4173", "5173", "8000"]);
const storageBucket = Deno.env.get("SURVEY_FILES_BUCKET") ?? "survey-files";
const surveyAssetsBucket = Deno.env.get("SURVEY_ASSETS_BUCKET") ?? "survey-assets";

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

function isPrivateNetworkHostname(hostname: string) {
  return (
    /^10\./.test(hostname) ||
    /^192\.168\./.test(hostname) ||
    /^172\.(1[6-9]|2\d|3[0-1])\./.test(hostname)
  );
}

function isDefaultLocalDevelopmentOrigin(origin: string) {
  try {
    const url = new URL(origin);
    if (url.protocol !== "http:" && url.protocol !== "https:") {
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
  return !origin || getAllowedOrigins().has(origin) || isDefaultLocalDevelopmentOrigin(origin);
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

function isAnonymousUploadPath(path: unknown, formId: string) {
  if (typeof path !== "string") {
    return false;
  }

  const escapedFormId = formId.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  return new RegExp(
    `^public/${escapedFormId}/[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}(?:\\.[a-z0-9]{1,16})?$`,
    "i",
  ).test(path);
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

async function removeSurveyAssetsForForm(adminClient: SupabaseAdminClient, formId: string) {
  let removedCount = 0;
  const prefix = `forms/${formId}/`;

  for (;;) {
    const { data, error } = await adminClient
      .schema("storage")
      .from("objects")
      .select("name")
      .eq("bucket_id", surveyAssetsBucket)
      .like("name", `${prefix}%`)
      .limit(1000);

    if (error) return { removedCount, error };

    const names = (data ?? [])
      .map((item: { name?: unknown }) => item.name)
      .filter((name: unknown): name is string => typeof name === "string" && name.startsWith(prefix));

    if (names.length === 0) return { removedCount, error: null };

    const { error: removeError } = await adminClient.storage.from(surveyAssetsBucket).remove(names);
    if (removeError) return { removedCount, error: removeError };
    removedCount += names.length;
  }
}

function parseSurveyAssetObjectName(value: unknown) {
  if (typeof value !== "string") return null;
  const parts = value.split("/");
  if (parts.length !== 4 || parts[0] !== "forms" || !isUuid(parts[1])) return null;
  return { name: value, formId: parts[1] };
}

async function removeStaleDraftSurveyAssets(adminClient: SupabaseAdminClient, cutoff: string) {
  const { data, error } = await adminClient
    .schema("storage")
    .from("objects")
    .select("name")
    .eq("bucket_id", surveyAssetsBucket)
    .like("name", "forms/%")
    .lt("created_at", cutoff)
    .limit(500);

  if (error) return { removedCount: 0, error };

  const candidates = (data ?? [])
    .map((item: { name?: unknown }) => parseSurveyAssetObjectName(item.name))
    .filter((item): item is { name: string; formId: string } => item !== null);
  const formIds = [...new Set(candidates.map((item) => item.formId))];
  if (formIds.length === 0) return { removedCount: 0, error: null };

  const { data: forms, error: formsError } = await adminClient
    .from("forms")
    .select("id")
    .in("id", formIds);
  if (formsError) return { removedCount: 0, error: formsError };

  const existingFormIds = new Set(
    (forms ?? [])
      .map((form: { id?: unknown }) => form.id)
      .filter((id: unknown): id is string => typeof id === "string"),
  );
  const names = candidates
    .filter((item) => !existingFormIds.has(item.formId))
    .map((item) => item.name);
  if (names.length === 0) return { removedCount: 0, error: null };

  const { error: removeError } = await adminClient.storage.from(surveyAssetsBucket).remove(names);
  return { removedCount: removeError ? 0 : names.length, error: removeError };
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

  let payload: FormAdminAction;
  try {
    payload = (await req.json()) as FormAdminAction;
  } catch {
    return errorResponse(req, 400, "Invalid JSON payload", requestLogContext);
  }

  const adminClient = createClient(supabaseUrl, supabaseServiceRoleKey, {
    auth: { persistSession: false, autoRefreshToken: false },
  });

  if (payload.action === "delete-upload") {
    const actionLogContext = {
      ...requestLogContext,
      operation: "form-admin.delete-upload",
      formId: payload.formId,
    };
    if (!isUuid(payload.formId) || !isAnonymousUploadPath(payload.path, payload.formId)) {
      return errorResponse(req, 400, "Invalid upload path", actionLogContext);
    }

    const { data: activeForm, error: formError } = await adminClient
      .from("forms")
      .select("id")
      .eq("id", payload.formId)
      .eq("is_public", true)
      .or(`deadline_at.is.null,deadline_at.gt.${new Date().toISOString()}`)
      .maybeSingle();
    if (formError || !activeForm) {
      return errorResponse(req, 403, "Form is not active", actionLogContext);
    }

    const { data: isReferenced, error: referenceError } = await adminClient.rpc("is_survey_file_referenced", {
      object_name: payload.path,
    });
    if (referenceError || isReferenced !== false) {
      return errorResponse(req, 409, "Upload is already attached to a response", actionLogContext);
    }

    const { error: removeError } = await adminClient.storage.from(storageBucket).remove([payload.path]);
    if (removeError) {
      return errorResponse(req, 400, removeError.message, actionLogContext);
    }

    console.info("form-admin action completed", { ...actionLogContext, removedFiles: 1 });
    return jsonResponse(req, 200, { success: true, removedFiles: 1 }, actionLogContext);
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

  if (requesterProfileError || requesterProfile?.is_disabled) {
    return errorResponse(req, 403, "Forbidden", { ...requestLogContext, userId: requester.id });
  }

  if (payload.action === "cleanup-orphans") {
    const actionLogContext = {
      ...requestLogContext,
      operation: "form-admin.cleanup-orphans",
      userId: requester.id,
    };
    if (requesterProfile.role !== "admin") {
      return errorResponse(req, 403, "Forbidden", actionLogContext);
    }

    const requestedHours = Number(payload.olderThanHours ?? 24);
    const olderThanHours = Math.min(720, Math.max(24, Number.isFinite(requestedHours) ? requestedHours : 24));
    const cutoff = new Date(Date.now() - olderThanHours * 60 * 60 * 1000).toISOString();
    const { data: orphanRows, error: orphanError } = await adminClient.rpc("list_orphan_survey_files", {
      cutoff,
      batch_limit: 500,
    });
    if (orphanError) {
      return errorResponse(req, 400, orphanError.message, actionLogContext);
    }

    const names = (orphanRows ?? [])
      .map((row: { name?: unknown }) => row.name)
      .filter((name: unknown): name is string => typeof name === "string");
    const { error: removeError } = names.length > 0
      ? await adminClient.storage.from(storageBucket).remove(names)
      : { error: null };
    if (removeError) {
      return errorResponse(req, 400, removeError.message, actionLogContext);
    }

    const { removedCount: removedAssetCount, error: assetCleanupError } = await removeStaleDraftSurveyAssets(
      adminClient,
      cutoff,
    );
    if (assetCleanupError) {
      return errorResponse(req, 400, assetCleanupError.message, actionLogContext);
    }

    console.info("form-admin action completed", {
      ...actionLogContext,
      removedFiles: names.length,
      removedAssets: removedAssetCount,
    });
    return jsonResponse(
      req,
      200,
      { success: true, removedFiles: names.length, removedAssets: removedAssetCount },
      actionLogContext,
    );
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

  if (form.author_id !== requester.id && requesterProfile.role !== "admin") {
    return errorResponse(req, 403, "Forbidden", actionLogContext);
  }

  const { removedCount, error: storageError } = await removeStorageObjectsForForm(adminClient, payload.formId);

  if (storageError) {
    return errorResponse(req, 400, storageError.message, actionLogContext);
  }

  const { removedCount: removedAssetCount, error: assetStorageError } = await removeSurveyAssetsForForm(
    adminClient,
    payload.formId,
  );

  if (assetStorageError) {
    return errorResponse(req, 400, assetStorageError.message, actionLogContext);
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
    removedAssets: removedAssetCount,
  });

  return jsonResponse(
    req,
    200,
    { success: true, removedFiles: removedCount, removedAssets: removedAssetCount },
    actionLogContext,
  );
});
