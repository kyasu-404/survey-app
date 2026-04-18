import {
  createRequestTraceContext,
  logError,
  logInfo,
  type RequestTraceContext,
  withActiveRequestTraceContext,
} from "../lib/observability";

const DEFAULT_REQUEST_TIMEOUT_MS = 12_000;

type RequestOptions = {
  timeoutMs?: number;
  context?: Record<string, unknown>;
  signal?: AbortSignal;
};

type HeaderAwareRequest = {
  setHeader?: (name: string, value: string) => unknown;
};

export class RequestTimeoutError extends Error {
  constructor(operation: string, timeoutMs: number) {
    super(`Запрос "${operation}" превысил таймаут ${Math.round(timeoutMs / 1000)} сек.`);
    this.name = "RequestTimeoutError";
  }
}

function getDurationMs(startedAt: number) {
  return Date.now() - startedAt;
}

function attachCorrelationHeaders<T>(result: T, traceContext: RequestTraceContext): T {
  const headerAwareRequest = result as HeaderAwareRequest | null;

  if (!headerAwareRequest || typeof headerAwareRequest.setHeader !== "function") {
    return result;
  }

  for (const [name, value] of Object.entries(traceContext.headers)) {
    headerAwareRequest.setHeader(name, value);
  }

  return result;
}

export async function runRequest<T>(
  operation: string,
  request: (signal: AbortSignal, traceContext: RequestTraceContext) => PromiseLike<T> | T,
  options: RequestOptions = {},
): Promise<T> {
  const timeoutMs = options.timeoutMs ?? DEFAULT_REQUEST_TIMEOUT_MS;
  const startedAt = Date.now();
  const traceContext = createRequestTraceContext(operation, options.context);
  const abortController = new AbortController();
  const forwardAbort = () => abortController.abort();
  let timeoutId: ReturnType<typeof setTimeout> | undefined;

  if (options.signal?.aborted) {
    abortController.abort();
  } else {
    options.signal?.addEventListener("abort", forwardAbort, { once: true });
  }

  logInfo(`[api] start ${operation}`, {
    operation,
    requestId: traceContext.requestId,
    traceId: traceContext.traceId,
    timeoutMs,
    ...traceContext.attributes,
  });

  try {
    const result = await Promise.race([
      withActiveRequestTraceContext(traceContext, () =>
        Promise.resolve(attachCorrelationHeaders(request(abortController.signal, traceContext), traceContext)),
      ),
      new Promise<T>((_, reject) => {
        timeoutId = setTimeout(() => {
          abortController.abort();
          reject(new RequestTimeoutError(operation, timeoutMs));
        }, timeoutMs);
      }),
    ]);

    logInfo(`[api] success ${operation}`, {
      operation,
      requestId: traceContext.requestId,
      traceId: traceContext.traceId,
      durationMs: getDurationMs(startedAt),
      ...traceContext.attributes,
    });

    return result;
  } catch (error) {
    const eventName = error instanceof RequestTimeoutError ? "timeout" : "error";

    logError(`[api] ${eventName} ${operation}`, error, {
      operation,
      requestId: traceContext.requestId,
      traceId: traceContext.traceId,
      durationMs: getDurationMs(startedAt),
      ...traceContext.attributes,
    });

    throw error;
  } finally {
    if (timeoutId) {
      clearTimeout(timeoutId);
    }
    options.signal?.removeEventListener("abort", forwardAbort);
  }
}
