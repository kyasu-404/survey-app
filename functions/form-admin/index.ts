import { createClient } from "https://esm.sh/@supabase/supabase-js@2.100.0";
import { analyzeSchemaCompatibility } from "./schemaCompatibility.mjs";

type FormAdminAction =
  | { action: "delete"; formId: string }
  | { action: "delete-responses"; formId: string; responseIds: string[] }
  | { action: "delete-upload"; formId: string; path: string }
  | { action: "get-cleanup-status" }
  | { action: "cleanup-orphans" }
  | {
      action: "update-schema";
      formId: string;
      schema: unknown;
      theme: unknown;
      title: string;
      allowResponseEditing: boolean;
      organizationTypes: unknown;
      confirmWarnings?: boolean;
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
const defaultAllowedDevelopmentPorts = new Set(["3000", "4173", "5173", "8000"]);
function readFixedBucket(variableName: string, expected: string) {
  const configured = Deno.env.get(variableName)?.trim() || expected;
  if (configured !== expected) throw new Error(`${variableName} must be ${expected}`);
  return configured;
}

const storageBucket = readFixedBucket("SURVEY_FILES_BUCKET", "survey-files");
const surveyAssetsBucket = readFixedBucket("SURVEY_ASSETS_BUCKET", "survey-assets");
const storageCleanupRetentionHours = 7 * 24;
const storageCleanupBatchLimit = 500;
const allowedOrganizationTypes = new Set(["school", "kindergarten", "odo", "udod"]);

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

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function getSchemaUpdatePayload(payload: FormAdminAction) {
  if (
    payload.action !== "update-schema"
    || !isUuid(payload.formId)
    || !isRecord(payload.schema)
    || !Array.isArray(payload.schema.pages)
    || !isRecord(payload.theme)
    || typeof payload.title !== "string"
    || payload.title.trim().length === 0
    || payload.title.trim().length > 500
    || typeof payload.allowResponseEditing !== "boolean"
    || !Array.isArray(payload.organizationTypes)
    || payload.organizationTypes.length === 0
    || payload.organizationTypes.length > allowedOrganizationTypes.size
    || !payload.organizationTypes.every((value) => typeof value === "string" && allowedOrganizationTypes.has(value))
  ) {
    return null;
  }

  const organizationTypes = [...new Set(payload.organizationTypes as string[])];
  if (organizationTypes.length !== payload.organizationTypes.length) {
    return null;
  }

  try {
    if (JSON.stringify(payload.schema).length > 262_144 || JSON.stringify(payload.theme).length > 131_072) {
      return null;
    }
  } catch {
    return null;
  }

  return {
    formId: payload.formId,
    schema: payload.schema,
    theme: payload.theme,
    title: payload.title.trim(),
    allowResponseEditing: payload.allowResponseEditing,
    organizationTypes,
    confirmWarnings: payload.confirmWarnings === true,
  };
}

function getUniqueResponseIds(value: unknown) {
  if (!Array.isArray(value) || value.length === 0 || value.length > 100 || !value.every(isUuid)) {
    return null;
  }

  return [...new Set(value)];
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

async function listStorageObjectPathsForForm(adminClient: SupabaseAdminClient, formId: string) {
  const { data, error } = await adminClient
    .from("response_file_references")
    .select("object_path")
    .eq("form_id", formId);

  if (error) return { names: [] as string[], error };

  const names = [...new Set(
    (data ?? [])
      .map((item: { object_path?: unknown }) => item.object_path)
      .filter((path: unknown): path is string => typeof path === "string" && path.length > 0),
  )];
  return { names, error: null };
}

async function removeStorageObjectPaths(adminClient: SupabaseAdminClient, names: string[]) {
  let removedCount = 0;
  for (let index = 0; index < names.length; index += 100) {
    const batch = names.slice(index, index + 100);
    const { error } = await adminClient.storage.from(storageBucket).remove(batch);
    if (error) return { removedCount, error };
    removedCount += batch.length;
  }
  return { removedCount, error: null };
}

type StorageCleanupRunRow = {
  id: string;
  trigger_type: "scheduled" | "manual";
  status: "running" | "succeeded" | "failed";
  retention_hours: number;
  removed_files: number;
  removed_assets: number;
  error: string | null;
  started_at: string;
  finished_at: string | null;
};

function serializeStorageCleanupRun(run: StorageCleanupRunRow | null) {
  if (!run) return null;
  return {
    id: run.id,
    triggerType: run.trigger_type,
    status: run.status,
    retentionHours: run.retention_hours,
    removedFiles: run.removed_files,
    removedAssets: run.removed_assets,
    error: run.error,
    startedAt: run.started_at,
    finishedAt: run.finished_at,
  };
}

function getStorageObjectNames(rows: unknown) {
  if (!Array.isArray(rows)) return [];
  return rows
    .map((row: { name?: unknown }) => row.name)
    .filter((name: unknown): name is string => typeof name === "string" && name.length > 0);
}

async function listConfirmedOrphanPaths(
  adminClient: SupabaseAdminClient,
  listFunction: "list_orphan_survey_files" | "list_orphan_survey_assets",
  confirmFunction: "confirm_orphan_survey_files" | "confirm_orphan_survey_assets",
  cutoff: string,
) {
  const { data: candidateRows, error: listError } = await adminClient.rpc(listFunction, {
    cutoff,
    batch_limit: storageCleanupBatchLimit,
  });
  if (listError) return { names: [] as string[], error: listError };

  const candidates = getStorageObjectNames(candidateRows);
  if (candidates.length === 0) return { names: [] as string[], error: null };

  const { data: confirmedRows, error: confirmError } = await adminClient.rpc(confirmFunction, {
    cutoff,
    object_names: candidates,
  });
  return { names: getStorageObjectNames(confirmedRows), error: confirmError };
}

async function getLatestStorageCleanupRun(adminClient: SupabaseAdminClient) {
  const { data, error } = await adminClient
    .from("storage_cleanup_runs")
    .select("id, trigger_type, status, retention_hours, removed_files, removed_assets, error, started_at, finished_at")
    .order("started_at", { ascending: false })
    .limit(1)
    .maybeSingle();
  return { run: (data ?? null) as StorageCleanupRunRow | null, error };
}

type ListedStorageEntry = {
  id?: string | null;
  name?: string;
  created_at?: string | null;
};

function isSafeStorageEntryName(value: unknown): value is string {
  return typeof value === "string" && value.length > 0 && value !== "." && value !== ".." && !value.includes("/");
}

function isListedStorageFile(entry: ListedStorageEntry) {
  return typeof entry.id === "string" && entry.id.length > 0;
}

function joinStoragePath(parent: string, name: string) {
  return parent ? `${parent}/${name}` : name;
}

async function listStorageEntries(adminClient: SupabaseAdminClient, bucketName: string, path: string) {
  const bucket = adminClient.storage.from(bucketName);
  const entries: ListedStorageEntry[] = [];
  let offset = 0;

  for (;;) {
    const { data, error } = await bucket.list(path, {
      limit: 1000,
      offset,
      sortBy: { column: "name", order: "asc" },
    });
    if (error) return { entries, error };

    const page = (data ?? []) as ListedStorageEntry[];
    entries.push(...page);
    if (page.length < 1000) return { entries, error: null };
    offset += page.length;
  }
}

async function removeStorageTree(
  adminClient: SupabaseAdminClient,
  bucketName: string,
  path: string,
  depth = 0,
): Promise<{ removedCount: number; error: Error | null }> {
  if (depth > 8) return { removedCount: 0, error: new Error("Storage folder nesting is too deep") };

  const { entries, error } = await listStorageEntries(adminClient, bucketName, path);
  if (error) return { removedCount: 0, error };

  let removedCount = 0;
  const files: string[] = [];

  for (const entry of entries) {
    if (!isSafeStorageEntryName(entry.name)) continue;
    const entryPath = joinStoragePath(path, entry.name);
    if (isListedStorageFile(entry)) {
      files.push(entryPath);
      continue;
    }

    const nestedResult = await removeStorageTree(adminClient, bucketName, entryPath, depth + 1);
    if (nestedResult.error) return { removedCount, error: nestedResult.error };
    removedCount += nestedResult.removedCount;
  }

  for (let index = 0; index < files.length; index += 100) {
    const batch = files.slice(index, index + 100);
    const { error: removeError } = await adminClient.storage.from(bucketName).remove(batch);
    if (removeError) return { removedCount, error: removeError };
    removedCount += batch.length;
  }

  return { removedCount, error: null };
}

async function removeSurveyAssetsForForm(adminClient: SupabaseAdminClient, formId: string) {
  return removeStorageTree(adminClient, surveyAssetsBucket, `forms/${formId}`);
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

  if (payload.action === "update-schema") {
    const actionLogContext: RequestLogContext = {
      ...requestLogContext,
      operation: "form-admin.update-schema",
      userId: requester.id,
      formId: payload.formId,
    };
    const updatePayload = getSchemaUpdatePayload(payload);
    if (!updatePayload) {
      return errorResponse(req, 400, "Некорректные данные формы", actionLogContext);
    }

    for (let attempt = 0; attempt < 2; attempt += 1) {
      const { data: form, error: formError } = await adminClient
        .from("forms")
        .select("id, author_id, schema, responses_count, organization_types, revision")
        .eq("id", updatePayload.formId)
        .single();

      if (formError || !form) {
        return errorResponse(req, 404, "Form not found", actionLogContext);
      }

      if (form.author_id !== requester.id && requesterProfile.role !== "admin") {
        return errorResponse(req, 403, "Forbidden", actionLogContext);
      }

      let compatibility = { safeChanges: [], warnings: [], breakingChanges: [] };
      if (Number(form.responses_count ?? 0) > 0) {
        try {
          compatibility = analyzeSchemaCompatibility(
            form.schema,
            updatePayload.schema,
            form.organization_types,
            updatePayload.organizationTypes,
          );
        } catch (error) {
          const message = error instanceof Error ? error.message : "Не удалось проверить совместимость схемы";
          return errorResponse(req, 400, message, actionLogContext);
        }

        if (compatibility.breakingChanges.length > 0) {
          return jsonResponse(req, 200, {
            status: "blocked",
            ...compatibility,
          }, actionLogContext);
        }

        if (compatibility.warnings.length > 0 && !updatePayload.confirmWarnings) {
          return jsonResponse(req, 200, {
            status: "confirmation_required",
            ...compatibility,
          }, actionLogContext);
        }
      }

      const responsesCount = Number(form.responses_count ?? 0);
      const revision = Number(form.revision ?? 0);
      const { data: updatedForm, error: updateError } = await adminClient
        .from("forms")
        .update({
          schema: updatePayload.schema,
          theme: updatePayload.theme,
          title: updatePayload.title,
          allow_response_editing: updatePayload.allowResponseEditing,
          organization_types: updatePayload.organizationTypes,
        })
        .eq("id", updatePayload.formId)
        .eq("responses_count", responsesCount)
        .eq("revision", revision)
        .select("id")
        .maybeSingle();

      if (updateError) {
        return errorResponse(req, 400, updateError.message, actionLogContext);
      }

      if (updatedForm) {
        console.info("form-admin action completed", {
          ...actionLogContext,
          responsesCount,
          warningsConfirmed: updatePayload.confirmWarnings,
        });
        return jsonResponse(req, 200, {
          status: "updated",
          ...compatibility,
        }, actionLogContext);
      }
    }

    return errorResponse(
      req,
      409,
      "Форма изменилась во время сохранения. Повторите попытку.",
      actionLogContext,
    );
  }

  if (payload.action === "get-cleanup-status") {
    const actionLogContext = {
      ...requestLogContext,
      operation: "form-admin.get-cleanup-status",
      userId: requester.id,
    };
    if (requesterProfile.role !== "admin") {
      return errorResponse(req, 403, "Forbidden", actionLogContext);
    }

    const { run, error } = await getLatestStorageCleanupRun(adminClient);
    if (error) return errorResponse(req, 400, error.message, actionLogContext);

    return jsonResponse(req, 200, {
      retentionHours: storageCleanupRetentionHours,
      lastRun: serializeStorageCleanupRun(run),
    }, actionLogContext);
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

    const workerId = `form-admin:${requestLogContext.requestId}`;
    const { data: startedRuns, error: startError } = await adminClient.rpc("begin_storage_cleanup_run", {
      p_trigger_type: "manual",
      p_worker_id: workerId,
      p_retention_hours: storageCleanupRetentionHours,
      p_requested_by: requester.id,
      p_min_interval_hours: 0,
    });
    if (startError) return errorResponse(req, 400, startError.message, actionLogContext);

    const run = Array.isArray(startedRuns) ? startedRuns[0] as StorageCleanupRunRow | undefined : undefined;
    if (!run) {
      return errorResponse(req, 409, "Очистка уже выполняется", actionLogContext);
    }

    const cutoff = new Date(Date.now() - storageCleanupRetentionHours * 60 * 60 * 1000).toISOString();
    let removedFiles = 0;
    let removedAssets = 0;
    let cleanupError: { message: string } | null = null;

    const orphanFiles = await listConfirmedOrphanPaths(
      adminClient,
      "list_orphan_survey_files",
      "confirm_orphan_survey_files",
      cutoff,
    );
    if (orphanFiles.error) {
      cleanupError = orphanFiles.error;
    } else if (orphanFiles.names.length > 0) {
      const result = await adminClient.storage.from(storageBucket).remove(orphanFiles.names);
      if (result.error) cleanupError = result.error;
      else removedFiles = orphanFiles.names.length;
    }

    if (!cleanupError) {
      const orphanAssets = await listConfirmedOrphanPaths(
        adminClient,
        "list_orphan_survey_assets",
        "confirm_orphan_survey_assets",
        cutoff,
      );
      if (orphanAssets.error) {
        cleanupError = orphanAssets.error;
      } else if (orphanAssets.names.length > 0) {
        const result = await adminClient.storage.from(surveyAssetsBucket).remove(orphanAssets.names);
        if (result.error) cleanupError = result.error;
        else removedAssets = orphanAssets.names.length;
      }
    }

    const { data: finishedRuns, error: finishError } = await adminClient.rpc("finish_storage_cleanup_run", {
      p_run_id: run.id,
      p_worker_id: workerId,
      p_success: !cleanupError,
      p_removed_files: removedFiles,
      p_removed_assets: removedAssets,
      p_error: cleanupError?.message ?? null,
    });
    if (finishError) return errorResponse(req, 400, finishError.message, actionLogContext);

    const finishedRun = Array.isArray(finishedRuns)
      ? finishedRuns[0] as StorageCleanupRunRow | undefined
      : undefined;
    if (cleanupError) return errorResponse(req, 400, cleanupError.message, actionLogContext);
    if (!finishedRun) return errorResponse(req, 409, "Не удалось завершить очистку", actionLogContext);

    console.info("form-admin action completed", {
      ...actionLogContext,
      removedFiles,
      removedAssets,
    });
    return jsonResponse(
      req,
      200,
      { success: true, run: serializeStorageCleanupRun(finishedRun) },
      actionLogContext,
    );
  }

  if (payload.action === "delete-responses") {
    const responseIds = getUniqueResponseIds(payload.responseIds);
    const actionLogContext: RequestLogContext = {
      ...requestLogContext,
      operation: "form-admin.delete-responses",
      userId: requester.id,
      formId: payload.formId,
    };

    if (!isUuid(payload.formId) || !responseIds) {
      return errorResponse(req, 400, "Invalid delete responses payload", actionLogContext);
    }

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

    const { data: responses, error: responsesError } = await adminClient
      .from("responses")
      .select("id")
      .eq("form_id", payload.formId)
      .in("id", responseIds);

    if (responsesError) {
      return errorResponse(req, 400, responsesError.message, actionLogContext);
    }

    const existingResponseIds = (responses ?? [])
      .map((response: { id?: unknown }) => response.id)
      .filter((id: unknown): id is string => typeof id === "string");

    if (existingResponseIds.length === 0) {
      return jsonResponse(req, 200, { success: true, deletedResponses: 0, removedFiles: 0 }, actionLogContext);
    }

    const { data: fileReferences, error: referencesError } = await adminClient
      .from("response_file_references")
      .select("object_path")
      .eq("form_id", payload.formId)
      .in("response_id", existingResponseIds);

    if (referencesError) {
      return errorResponse(req, 400, referencesError.message, actionLogContext);
    }

    const referencedObjectPaths = [...new Set(
      (fileReferences ?? [])
        .map((reference: { object_path?: unknown }) => reference.object_path)
        .filter((path: unknown): path is string => typeof path === "string"),
    )];
    const selectedResponseIdSet = new Set(existingResponseIds);
    const objectPaths: string[] = [];

    for (let index = 0; index < referencedObjectPaths.length; index += 100) {
      const pathBatch = referencedObjectPaths.slice(index, index + 100);
      const { data: allReferences, error: allReferencesError } = await adminClient
        .from("response_file_references")
        .select("response_id, object_path")
        .in("object_path", pathBatch);

      if (allReferencesError) {
        return errorResponse(req, 400, allReferencesError.message, actionLogContext);
      }

      const sharedPaths = new Set(
        (allReferences ?? [])
          .filter((reference: { response_id?: unknown }) =>
            typeof reference.response_id === "string" && !selectedResponseIdSet.has(reference.response_id),
          )
          .map((reference: { object_path?: unknown }) => reference.object_path)
          .filter((path: unknown): path is string => typeof path === "string"),
      );
      objectPaths.push(...pathBatch.filter((path) => !sharedPaths.has(path)));
    }

    const { error: deleteError } = await adminClient
      .from("responses")
      .delete()
      .eq("form_id", payload.formId)
      .in("id", existingResponseIds);

    if (deleteError) {
      return errorResponse(req, 400, deleteError.message, actionLogContext);
    }

    const { removedCount, error: removeError } = await removeStorageObjectPaths(adminClient, objectPaths);
    if (removeError) {
      console.warn("form-admin storage cleanup deferred", { ...actionLogContext, error: removeError.message });
    }

    console.info("form-admin action completed", {
      ...actionLogContext,
      deletedResponses: existingResponseIds.length,
      removedFiles: removedCount,
      cleanupPending: Boolean(removeError),
    });

    return jsonResponse(req, 200, {
      success: true,
      deletedResponses: existingResponseIds.length,
      removedFiles: removedCount,
      cleanupPending: Boolean(removeError),
    }, actionLogContext);
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

  const { names: responseObjectPaths, error: listStorageError } = await listStorageObjectPathsForForm(
    adminClient,
    payload.formId,
  );
  if (listStorageError) {
    return errorResponse(req, 400, listStorageError.message, actionLogContext);
  }

  const { error: deleteError } = await adminClient
    .from("forms")
    .delete()
    .eq("id", form.id);

  if (deleteError) {
    return errorResponse(req, 400, deleteError.message, actionLogContext);
  }

  const { removedCount, error: storageError } = await removeStorageObjectPaths(adminClient, responseObjectPaths);
  const { removedCount: removedAssetCount, error: assetStorageError } = await removeSurveyAssetsForForm(
    adminClient,
    payload.formId,
  );
  const cleanupPending = Boolean(storageError || assetStorageError);
  if (cleanupPending) {
    console.warn("form-admin storage cleanup deferred", {
      ...actionLogContext,
      responseFilesError: storageError?.message ?? null,
      assetsError: assetStorageError?.message ?? null,
    });
  }

  console.info("form-admin action completed", {
    ...actionLogContext,
    removedFiles: removedCount,
    removedAssets: removedAssetCount,
    cleanupPending,
  });

  return jsonResponse(
    req,
    200,
    { success: true, removedFiles: removedCount, removedAssets: removedAssetCount, cleanupPending },
    actionLogContext,
  );
});
