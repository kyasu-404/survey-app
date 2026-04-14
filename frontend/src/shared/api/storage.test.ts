import { afterEach, describe, expect, it, vi } from "vitest";
import {
  getStoragePathFromSurveyFileValue,
  removeFileFromStorage,
  resolveSurveyFileValueContent,
  uploadFileToStorage,
} from "./storage";
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

  it("uploads files under the current user's prefix and stores the storage path", async () => {
    const upload = vi.fn().mockResolvedValue({ error: null });

    vi.spyOn(crypto, "randomUUID").mockReturnValue(fileId);
    vi.mocked(supabaseClient.auth.getUser).mockResolvedValue({ data: { user: { id: "user-1" } }, error: null } as never);
    vi.mocked(supabaseClient.storage.from).mockReturnValue({ upload } as never);

    const result = await uploadFileToStorage("form-1", new File(["hello"], "answer.txt", { type: "text/plain" }));

    expect(upload).toHaveBeenCalledWith(`user-1/form-1/${fileId}.txt`, expect.any(File), { upsert: false });
    expect(result).toEqual(
      expect.objectContaining({
        path: `user-1/form-1/${fileId}.txt`,
      }),
    );
  });

  it("uploads files for public forms without auth into the public form prefix", async () => {
    const upload = vi.fn().mockResolvedValue({ error: null });

    vi.spyOn(crypto, "randomUUID").mockReturnValue(fileId);
    vi.mocked(supabaseClient.auth.getUser).mockResolvedValue({ data: { user: null }, error: null } as never);
    vi.mocked(supabaseClient.storage.from).mockReturnValue({ upload } as never);

    const result = await uploadFileToStorage(
      "form-1",
      new File(["hello"], "answer.txt", { type: "text/plain" }),
      { allowAnonymous: true },
    );

    expect(upload).toHaveBeenCalledWith(`public/form-1/${fileId}.txt`, expect.any(File), { upsert: false });
    expect(result).toEqual(
      expect.objectContaining({
        path: `public/form-1/${fileId}.txt`,
      }),
    );
  });

  it("extracts raw storage paths from file values stored in responses", () => {
    expect(getStoragePathFromSurveyFileValue("public/form-1/file-id.txt")).toBe("public/form-1/file-id.txt");
    expect(getStoragePathFromSurveyFileValue({ content: "public/form-1/file-id.txt" })).toBe(
      "public/form-1/file-id.txt",
    );
  });

  it("creates a fresh signed URL when a response stores only the storage path", async () => {
    const createSignedUrl = vi.fn().mockResolvedValue({
      data: { signedUrl: "https://storage.local/object/sign/survey-files/public/form-1/file-id.txt?token=fresh" },
      error: null,
    });

    vi.mocked(supabaseClient.storage.from).mockReturnValue({ createSignedUrl } as never);

    await expect(resolveSurveyFileValueContent({ content: "public/form-1/file-id.txt" })).resolves.toBe(
      "https://storage.local/object/sign/survey-files/public/form-1/file-id.txt?token=fresh",
    );
    expect(createSignedUrl).toHaveBeenCalledWith("public/form-1/file-id.txt", expect.any(Number));
  });

  it("rejects deletion outside the current user's storage prefix", async () => {
    vi.mocked(supabaseClient.auth.getUser).mockResolvedValue({ data: { user: { id: "user-1" } }, error: null } as never);

    await expect(removeFileFromStorage("other-user/form-1/file-id.txt")).rejects.toThrow(
      "Нельзя удалить файл другого пользователя",
    );
  });
});
