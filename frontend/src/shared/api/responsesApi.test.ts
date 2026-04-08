import { afterEach, describe, expect, it, vi } from "vitest";
import { insertResponse } from "./responsesApi";
import { apiClient } from "./client";

vi.mock("./client", () => ({
  apiClient: {
    from: vi.fn(),
  },
}));

function createHangingInsert() {
  return {
    then: vi.fn(() => undefined),
  };
}

describe("insertResponse", () => {
  afterEach(() => {
    vi.useRealTimers();
    vi.clearAllMocks();
  });

  it("fails with timeout instead of leaving submit pending forever", async () => {
    vi.useFakeTimers();
    vi.mocked(apiClient.from).mockReturnValue({
      insert: vi.fn(() => createHangingInsert()),
    } as never);

    const mutationStatePromise = Promise.race([
      insertResponse("form-1", { q1: "yes" }).then(
        () => "resolved",
        () => "rejected",
      ),
      new Promise<string>((resolve) => {
        setTimeout(() => resolve("test-timeout"), 20_000);
      }),
    ]);

    await vi.advanceTimersByTimeAsync(20_000);

    await expect(mutationStatePromise).resolves.toBe("rejected");
  });
});
