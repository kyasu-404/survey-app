const DEFAULT_REQUEST_TIMEOUT_MS = 12_000;

type RequestOptions = {
  timeoutMs?: number;
  context?: Record<string, unknown>;
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

export async function runRequest<T>(
  operation: string,
  request: () => Promise<T>,
  options: RequestOptions = {},
): Promise<T> {
  const timeoutMs = options.timeoutMs ?? DEFAULT_REQUEST_TIMEOUT_MS;
  const startedAt = Date.now();
  let timeoutId: ReturnType<typeof setTimeout> | undefined;

  console.info(`[api] start ${operation}`, {
    timeoutMs,
    ...options.context,
  });

  try {
    const result = await Promise.race([
      request(),
      new Promise<T>((_, reject) => {
        timeoutId = setTimeout(() => {
          reject(new RequestTimeoutError(operation, timeoutMs));
        }, timeoutMs);
      }),
    ]);

    console.info(`[api] success ${operation}`, {
      durationMs: getDurationMs(startedAt),
      ...options.context,
    });

    return result;
  } catch (error) {
    const eventName = error instanceof RequestTimeoutError ? "timeout" : "error";

    console.error(`[api] ${eventName} ${operation}`, {
      durationMs: getDurationMs(startedAt),
      error,
      ...options.context,
    });

    throw error;
  } finally {
    if (timeoutId) {
      clearTimeout(timeoutId);
    }
  }
}
