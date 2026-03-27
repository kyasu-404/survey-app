import type { PropsWithChildren } from "react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";

const queryClient = new QueryClient({
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
      staleTime: 30_000,
      gcTime: 5 * 60_000,
      refetchOnMount: true,
      refetchOnReconnect: true,
      refetchOnWindowFocus: false,
    },
  },
});

export function QueryProvider({ children }: PropsWithChildren) {
  return <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>;
}
