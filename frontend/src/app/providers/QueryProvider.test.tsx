import { describe, expect, it } from "vitest";
import { createQueryClient } from "./QueryProvider";

describe("createQueryClient", () => {
  it("uses calmer default query refetch settings", () => {
    const queryClient = createQueryClient();
    const defaults = queryClient.getDefaultOptions().queries;

    expect(defaults?.staleTime).toBe(30_000);
    expect(defaults?.refetchOnMount).toBe(false);
    expect(defaults?.refetchOnWindowFocus).toBe(false);
    expect(defaults?.refetchOnReconnect).toBe(true);
  });
});
