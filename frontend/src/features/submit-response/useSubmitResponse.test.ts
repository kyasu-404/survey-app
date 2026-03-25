import { describe, expect, it, vi } from "vitest";
import { submitResponse } from "./useSubmitResponse";
import { createResponse } from "../../entities/response/api";

vi.mock("../../entities/response/api", () => ({
  createResponse: vi.fn(),
}));

describe("submitResponse", () => {
  it("passes form id and payload to api", async () => {
    vi.mocked(createResponse).mockResolvedValue({ id: "response-1" } as never);

    const payload = { q1: "yes" };
    await submitResponse("form-1", payload);

    expect(createResponse).toHaveBeenCalledWith("form-1", payload);
  });
});
