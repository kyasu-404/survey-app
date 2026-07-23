import { useState, type PropsWithChildren } from "react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";

export const DEFAULT_QUERY_STALE_TIME_MS = 30_000;

export function createQueryClient() {
  return new QueryClient({
    defaultOptions: {
      queries: {
        retry: (failureCount, error) => {
          const errorMessage = error instanceof Error ? error.message.toLowerCase() : "";
          const shouldStopRetry =
            errorMessage.includes("not authorized") ||
            errorMessage.includes("не авторизован") ||
            errorMessage.includes("jwt");

          if (shouldStopRetry) {
            return false;
          }

          return failureCount < 2;
        },
        staleTime: DEFAULT_QUERY_STALE_TIME_MS,
        gcTime: 5 * 60_000,
        refetchOnMount: false,
        refetchOnReconnect: true,
        refetchOnWindowFocus: false,
      },
    },
  });
}

export function QueryProvider({ children }: PropsWithChildren) {
  const [queryClient] = useState(createQueryClient);

  return <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>;
}
