import { afterEach, describe, expect, it, vi } from "vitest";
import { removeFileFromStorage, uploadFileToStorage } from "./storage";
import { supabaseClient } from "./client";

vi.mock("./client", () => ({
  supabaseClient: {
    auth: {
      getUser: vi.fn(),
    },
    storage: {
      from: vi.fn(),
    },
  },
}));

describe("storage api", () => {
  const fileId = "00000000-0000-4000-8000-000000000000";

  afterEach(() => {
    vi.restoreAllMocks();
    vi.clearAllMocks();
  });

  it("uploads files under the current user's prefix and returns a signed URL", async () => {
    const upload = vi.fn().mockResolvedValue({ error: null });
    const createSignedUrl = vi.fn().mockResolvedValue({
      data: { signedUrl: "https://storage.local/object/sign/survey-files/user-1/form-1/file-id.txt?token=abc" },
      error: null,
    });

    vi.spyOn(crypto, "randomUUID").mockReturnValue(fileId);
    vi.mocked(supabaseClient.auth.getUser).mockResolvedValue({ data: { user: { id: "user-1" } }, error: null } as never);
    vi.mocked(supabaseClient.storage.from).mockReturnValue({ upload, createSignedUrl } as never);

    const result = await uploadFileToStorage("form-1", new File(["hello"], "answer.txt", { type: "text/plain" }));

    expect(upload).toHaveBeenCalledWith(`user-1/form-1/${fileId}.txt`, expect.any(File), { upsert: false });
    expect(createSignedUrl).toHaveBeenCalledWith(`user-1/form-1/${fileId}.txt`, expect.any(Number));
    expect(result).toEqual(
      expect.objectContaining({
        path: `user-1/form-1/${fileId}.txt`,
        url: "https://storage.local/object/sign/survey-files/user-1/form-1/file-id.txt?token=abc",
      }),
    );
  });

  it("rejects deletion outside the current user's storage prefix", async () => {
    vi.mocked(supabaseClient.auth.getUser).mockResolvedValue({ data: { user: { id: "user-1" } }, error: null } as never);

    await expect(removeFileFromStorage("other-user/form-1/file-id.txt")).rejects.toThrow(
      "Нельзя удалить файл другого пользователя",
    );
  });
});
