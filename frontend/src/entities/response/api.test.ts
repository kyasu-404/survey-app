import { beforeEach, describe, expect, it, vi } from "vitest";
import { deleteResponses as deleteResponsesRequest } from "../../shared/api";
import { deleteResponses } from "./api";

vi.mock("../../shared/api", () => ({ deleteResponses: vi.fn() }));

describe("deleting responses from the full list", () => {
  beforeEach(() => vi.resetAllMocks());

  it("deletes 200 selected answers in bounded sequential batches", async () => {
    const ids = Array.from({ length: 200 }, (_, index) => String(index));
    let completeFirst!: () => void;
    vi.mocked(deleteResponsesRequest).mockImplementationOnce(() => new Promise<void>((resolve) => { completeFirst = resolve; }));
    const result = deleteResponses("form-1", ids);
    expect(deleteResponsesRequest).toHaveBeenCalledTimes(1);
    completeFirst();
    await result;
    expect(vi.mocked(deleteResponsesRequest).mock.calls).toEqual([
      ["form-1", ids.slice(0, 100)], ["form-1", ids.slice(100)],
    ]);
  });

  it("stops on a failed batch", async () => {
    vi.mocked(deleteResponsesRequest).mockRejectedValueOnce(new Error("failed"));
    await expect(deleteResponses("form-1", Array.from({ length: 200 }, (_, index) => String(index)))).rejects.toThrow("failed");
    expect(deleteResponsesRequest).toHaveBeenCalledOnce();
  });
});
