import { useState, type PropsWithChildren } from "react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";

function createQueryClient() {
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
        staleTime: 5_000,
        gcTime: 5 * 60_000,
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
