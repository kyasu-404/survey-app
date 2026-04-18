import * as Sentry from "@sentry/react";

type LogAttributes = Record<string, unknown>;

export type RequestTraceContext = {
  operation: string;
  requestId: string;
  traceId: string;
  spanId: string;
  traceparent: string;
  release: string;
  headers: Record<string, string>;
  attributes: LogAttributes;
};

const SENSITIVE_KEY_PATTERN = /authorization|password|secret|token|apikey|api_key|anonkey|access.?token|refresh.?token/i;
const DEFAULT_RELEASE = "unknown";

let activeRequestTraceContext: RequestTraceContext | null = null;
let sentryInitialized = false;
let currentUserId: string | null = null;

function readEnv(name: string) {
  const value = import.meta.env[name];
  return typeof value === "string" ? value.trim() : "";
}

function parseSampleRate(value: string) {
  if (!value) {
    return undefined;
  }

  const parsed = Number(value);
  if (!Number.isFinite(parsed)) {
    return undefined;
  }

  return Math.min(1, Math.max(0, parsed));
}

export const OBSERVABILITY_RELEASE =
  readEnv("VITE_APP_RELEASE") || readEnv("VITE_RELEASE") || readEnv("VITE_GIT_SHA") || DEFAULT_RELEASE;

export const OBSERVABILITY_ENVIRONMENT =
  readEnv("VITE_SENTRY_ENVIRONMENT") || readEnv("VITE_APP_ENV") || import.meta.env.MODE || "production";

function getRandomBytes(length: number) {
  const bytes = new Uint8Array(Math.max(length, 16));

  if (typeof crypto !== "undefined" && typeof crypto.getRandomValues === "function") {
    crypto.getRandomValues(bytes);
    return bytes.slice(0, length);
  }

  const fallbackBytes = new Uint8Array(length);
  for (let index = 0; index < fallbackBytes.length; index += 1) {
    fallbackBytes[index] = Math.floor(Math.random() * 256);
  }

  return fallbackBytes;
}

function randomHex(byteLength: number) {
  return Array.from(getRandomBytes(byteLength), (byte) => byte.toString(16).padStart(2, "0")).join("");
}

function createRequestId() {
  if (typeof crypto !== "undefined" && typeof crypto.randomUUID === "function") {
    return crypto.randomUUID();
  }

  return `${Date.now().toString(16)}-${randomHex(8)}`;
}

function sanitizeValue(value: unknown, depth = 0): unknown {
  if (depth > 4) {
    return "[truncated]";
  }

  if (value instanceof Error) {
    return {
      name: value.name,
      message: value.message,
    };
  }

  if (Array.isArray(value)) {
    return value.slice(0, 25).map((item) => sanitizeValue(item, depth + 1));
  }

  if (value && typeof value === "object") {
    return sanitizeAttributes(value as LogAttributes, depth + 1);
  }

  if (typeof value === "bigint") {
    return value.toString();
  }

  if (typeof value === "function") {
    return "[function]";
  }

  return value;
}

function sanitizeAttributes(attributes: LogAttributes = {}, depth = 0): LogAttributes {
  return Object.fromEntries(
    Object.entries(attributes).map(([key, value]) => [
      key,
      SENSITIVE_KEY_PATTERN.test(key) ? "[redacted]" : sanitizeValue(value, depth),
    ]),
  );
}

function buildLogAttributes(attributes: LogAttributes = {}) {
  return sanitizeAttributes({
    release: OBSERVABILITY_RELEASE,
    userId: currentUserId,
    ...attributes,
  });
}

function toError(error: unknown) {
  if (error instanceof Error) {
    return error;
  }

  if (typeof error === "string") {
    return new Error(error);
  }

  return new Error("Non-error exception captured");
}

export function initializeObservability() {
  if (sentryInitialized) {
    return;
  }

  const dsn = readEnv("VITE_SENTRY_DSN");
  if (!dsn) {
    return;
  }

  const tracesSampleRate = parseSampleRate(readEnv("VITE_SENTRY_TRACES_SAMPLE_RATE"));
  const integrations = tracesSampleRate && tracesSampleRate > 0 ? [Sentry.browserTracingIntegration()] : undefined;

  Sentry.init({
    dsn,
    environment: OBSERVABILITY_ENVIRONMENT,
    release: OBSERVABILITY_RELEASE === DEFAULT_RELEASE ? undefined : OBSERVABILITY_RELEASE,
    sendDefaultPii: false,
    ...(typeof tracesSampleRate === "number" ? { tracesSampleRate } : {}),
    ...(integrations ? { integrations } : {}),
  });

  sentryInitialized = true;

  if (currentUserId) {
    Sentry.setUser({ id: currentUserId });
  }
}

export function setObservabilityUser(userId: string | null) {
  currentUserId = userId;

  if (!sentryInitialized) {
    return;
  }

  Sentry.setUser(userId ? { id: userId } : null);
}

export function captureException(error: unknown, attributes: LogAttributes = {}) {
  if (!sentryInitialized) {
    return;
  }

  const safeAttributes = buildLogAttributes(attributes);

  Sentry.withScope((scope) => {
    if (typeof safeAttributes.operation === "string") {
      scope.setTag("operation", safeAttributes.operation);
    }

    if (typeof safeAttributes.requestId === "string") {
      scope.setTag("request_id", safeAttributes.requestId);
    }

    if (typeof safeAttributes.traceId === "string") {
      scope.setTag("trace_id", safeAttributes.traceId);
    }

    scope.setContext("diagnostics", safeAttributes);
    Sentry.captureException(toError(error));
  });
}

export function captureMessage(message: string, attributes: LogAttributes = {}) {
  if (!sentryInitialized) {
    return;
  }

  const safeAttributes = buildLogAttributes(attributes);

  Sentry.withScope((scope) => {
    if (typeof safeAttributes.operation === "string") {
      scope.setTag("operation", safeAttributes.operation);
    }

    scope.setContext("diagnostics", safeAttributes);
    Sentry.captureMessage(message, "warning");
  });
}

export function logInfo(message: string, attributes: LogAttributes = {}) {
  console.info(message, buildLogAttributes(attributes));
}

export function logWarning(message: string, attributes: LogAttributes = {}, options: { report?: boolean } = {}) {
  const safeAttributes = buildLogAttributes(attributes);
  console.warn(message, safeAttributes);

  if (options.report) {
    captureMessage(message, safeAttributes);
  }
}

export function logError(message: string, error: unknown, attributes: LogAttributes = {}) {
  const safeAttributes = buildLogAttributes(attributes);
  console.error(message, safeAttributes, error);
  captureException(error, safeAttributes);
}

export function createRequestTraceContext(operation: string, attributes: LogAttributes = {}): RequestTraceContext {
  const requestId = createRequestId();
  const traceId = randomHex(16);
  const spanId = randomHex(8);
  const traceparent = `00-${traceId}-${spanId}-01`;

  return {
    operation,
    requestId,
    traceId,
    spanId,
    traceparent,
    release: OBSERVABILITY_RELEASE,
    attributes: sanitizeAttributes(attributes),
    headers: {
      "x-request-id": requestId,
      "x-trace-id": traceId,
      "x-client-release": OBSERVABILITY_RELEASE,
      traceparent,
    },
  };
}

export function withActiveRequestTraceContext<T>(context: RequestTraceContext, callback: () => T): T {
  const previousContext = activeRequestTraceContext;
  activeRequestTraceContext = context;

  try {
    return callback();
  } finally {
    activeRequestTraceContext = previousContext;
  }
}

export function getActiveRequestTraceContext() {
  return activeRequestTraceContext;
}

export function createObservedFetch(fetchImpl: typeof fetch = (...args) => globalThis.fetch(...args)) {
  return (input: RequestInfo | URL, init?: RequestInit) => {
    const context = getActiveRequestTraceContext();

    if (!context) {
      return fetchImpl(input, init);
    }

    const headers = new Headers(init?.headers ?? (input instanceof Request ? input.headers : undefined));

    for (const [name, value] of Object.entries(context.headers)) {
      headers.set(name, value);
    }

    return fetchImpl(input, {
      ...init,
      headers,
    });
  };
}
