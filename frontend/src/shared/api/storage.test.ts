import { afterEach, describe, expect, it, vi } from "vitest";
import { AuthApiError, AuthSessionMissingError } from "@supabase/supabase-js";
import {
  getStoragePathFromSurveyFileValue,
  removeFileFromStorage,
  resolveSurveyFileValueContent,
  uploadFileToStorage,
} from "./storage";
import { publicSupabaseClient, supabaseClient } from "./client";

vi.mock("./client", () => ({
  supabaseClient: {
    auth: {
      getUser: vi.fn(),
    },
    storage: {
      from: vi.fn(),
    },
  },
  publicSupabaseClient: {
    functions: {
      invoke: vi.fn(),
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
    vi.unstubAllGlobals();
    vi.useRealTimers();
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
    vi.mocked(supabaseClient.auth.getUser).mockResolvedValue({
      data: { user: null },
      error: new AuthSessionMissingError(),
    } as never);
    vi.mocked(publicSupabaseClient.storage.from).mockReturnValue({ upload } as never);

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

  it("falls back to getRandomValues when randomUUID is unavailable", async () => {
    const upload = vi.fn().mockResolvedValue({ error: null });
    const getRandomValues = vi.fn((buffer: Uint8Array) => {
      buffer.set([
        0x00, 0x00, 0x00, 0x00,
        0x00, 0x00,
        0x40, 0x00,
        0x80, 0x00,
        0x00, 0x00, 0x00, 0x00, 0x00, 0x00,
      ]);
      return buffer;
    });

    vi.stubGlobal("crypto", {
      ...crypto,
      randomUUID: undefined,
      getRandomValues,
    });
    vi.mocked(supabaseClient.auth.getUser).mockResolvedValue({
      data: { user: null },
      error: new AuthSessionMissingError(),
    } as never);
    vi.mocked(publicSupabaseClient.storage.from).mockReturnValue({ upload } as never);

    const result = await uploadFileToStorage(
      "form-1",
      new File(["hello"], "answer.txt", { type: "text/plain" }),
      { allowAnonymous: true },
    );

    expect(getRandomValues).toHaveBeenCalled();
    expect(upload).toHaveBeenCalledWith(`public/form-1/${fileId}.txt`, expect.any(File), { upsert: false });
    expect(result).toEqual(
      expect.objectContaining({
        path: `public/form-1/${fileId}.txt`,
      }),
    );
  });

  it("uses public storage without waiting for a stalled dashboard auth session", async () => {
    const upload = vi.fn().mockResolvedValue({ error: null });

    vi.spyOn(crypto, "randomUUID").mockReturnValue(fileId);
    vi.mocked(supabaseClient.auth.getUser).mockImplementation(() => new Promise(() => {}));
    vi.mocked(publicSupabaseClient.storage.from).mockReturnValue({ upload } as never);

    const result = await uploadFileToStorage(
      "form-1",
      new File(["hello"], "answer.txt", { type: "text/plain" }),
      { allowAnonymous: true },
    );

    expect(upload).toHaveBeenCalledWith(`public/form-1/${fileId}.txt`, expect.any(File), { upsert: false });
    expect(supabaseClient.auth.getUser).not.toHaveBeenCalled();
    expect(result).toEqual(
      expect.objectContaining({
        path: `public/form-1/${fileId}.txt`,
      }),
    );
  });

  it("allows deletion of a known anonymous upload only within the same form prefix", async () => {
    vi.mocked(supabaseClient.auth.getUser).mockResolvedValue({
      data: { user: null },
      error: new AuthApiError("Invalid Refresh Token: Refresh Token Not Found", 400, "invalid_refresh_token"),
    } as never);
    vi.mocked(publicSupabaseClient.functions.invoke).mockResolvedValue({ data: { success: true }, error: null } as never);

    await removeFileFromStorage("public/form-1/file-id.txt", {
      allowAnonymous: true,
      formId: "form-1",
    });
    expect(publicSupabaseClient.functions.invoke).toHaveBeenCalledWith("form-admin", {
      body: { action: "delete-upload", formId: "form-1", path: "public/form-1/file-id.txt" },
    });
    expect(supabaseClient.auth.getUser).not.toHaveBeenCalled();

    await expect(
      removeFileFromStorage("public/form-2/file-id.txt", { allowAnonymous: true, formId: "form-1" }),
    ).rejects.toThrow("Нельзя удалить публичный файл другой формы");
  });

  it("extracts raw storage paths from file values stored in responses", () => {
    const formId = "10000000-0000-4000-8000-000000000000";
    expect(getStoragePathFromSurveyFileValue(`public/${formId}/file-id.txt`)).toBe(`public/${formId}/file-id.txt`);
    expect(getStoragePathFromSurveyFileValue({ content: `public/${formId}/file-id.txt` })).toBe(
      `public/${formId}/file-id.txt`,
    );
  });

  it("rejects external URLs and malformed paths from stored response data", async () => {
    expect(getStoragePathFromSurveyFileValue("https://attacker.test/object/sign/survey-files/public/form/file.txt")).toBeNull();
    expect(getStoragePathFromSurveyFileValue({ storagePath: "../private/file.txt" })).toBeNull();
    await expect(resolveSurveyFileValueContent({ content: "https://attacker.test/tracker" })).rejects.toThrow(
      "Не удалось определить содержимое файла",
    );
  });

  it("creates a fresh signed URL when a response stores only the storage path", async () => {
    const createSignedUrl = vi.fn().mockResolvedValue({
      data: { signedUrl: "https://storage.local/object/sign/survey-files/public/form-1/file-id.txt?token=fresh" },
      error: null,
    });

    vi.mocked(supabaseClient.storage.from).mockReturnValue({ createSignedUrl } as never);
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue(new Response("hello", { headers: { "Content-Type": "text/plain" } })),
    );

    await expect(resolveSurveyFileValueContent({ content: "public/10000000-0000-4000-8000-000000000000/file-id.txt" })).resolves.toBe(
      "data:text/plain;base64,aGVsbG8=",
    );
    expect(createSignedUrl).toHaveBeenCalledWith("public/10000000-0000-4000-8000-000000000000/file-id.txt", expect.any(Number));
  });

  it("returns storage files as data URLs so SurveyJS downloads keep binary bytes intact", async () => {
    const createSignedUrl = vi.fn().mockResolvedValue({
      data: { signedUrl: "https://storage.local/object/sign/survey-files/public/form-1/file-id.xlsx?token=fresh" },
      error: null,
    });
    const bytes = new Uint8Array([0x50, 0x4b, 0x03, 0x04, 0x00, 0xff]);

    vi.mocked(supabaseClient.storage.from).mockReturnValue({ createSignedUrl } as never);
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue(
        new Response(bytes, {
          status: 200,
          headers: { "Content-Type": "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet" },
        }),
      ),
    );

    await expect(resolveSurveyFileValueContent({ content: "public/10000000-0000-4000-8000-000000000000/file-id.xlsx" })).resolves.toBe(
      "data:application/vnd.openxmlformats-officedocument.spreadsheetml.sheet;base64,UEsDBAD/",
    );
  });

  it("allows a slow upload to finish after the ordinary API timeout", async () => {
    vi.useFakeTimers();
    const upload = vi.fn(() => new Promise(resolve => setTimeout(() => resolve({ error: null }), 20_000)));
    vi.mocked(publicSupabaseClient.storage.from).mockReturnValue({ upload } as never);
    const pending = uploadFileToStorage("form-1", new File(["hello"], "answer.txt"), { allowAnonymous: true });
    const result = expect(pending).resolves.toMatchObject({ path: expect.stringMatching(/^public\/form-1\//) });
    await vi.advanceTimersByTimeAsync(20_000);
    await result;
  });

  it("times out a stalled upload so the respondent can retry", async () => {
    vi.useFakeTimers();
    vi.mocked(publicSupabaseClient.storage.from).mockReturnValue({ upload: vi.fn(() => new Promise(() => {})) } as never);
    const pending = uploadFileToStorage("form-1", new File(["hello"], "answer.txt"), { allowAnonymous: true });
    const result = expect(pending).rejects.toThrow("таймаут");
    await vi.advanceTimersByTimeAsync(60_000);
    await result;
  });

  it("uses public preview URLs and aborts a stalled response body after headers arrive", async () => {
    vi.useFakeTimers();
    const createSignedUrl = vi.fn().mockResolvedValue({ data: { signedUrl: "https://storage.local/preview" }, error: null });
    vi.mocked(publicSupabaseClient.storage.from).mockReturnValue({ createSignedUrl } as never);
    const fetchMock = vi.fn().mockResolvedValue({ ok: true, blob: () => new Promise(() => {}) });
    vi.stubGlobal("fetch", fetchMock);
    const pending = resolveSurveyFileValueContent({ content: "public/10000000-0000-4000-8000-000000000000/file.txt" }, { allowAnonymous: true });
    const result = expect(pending).rejects.toThrow("таймаут");
    await vi.advanceTimersByTimeAsync(60_000);
    await result;
    expect(supabaseClient.storage.from).not.toHaveBeenCalled();
    expect(fetchMock.mock.calls[0][1].signal.aborted).toBe(true);
  });

  it("rejects deletion outside the current user's storage prefix", async () => {
    vi.mocked(supabaseClient.auth.getUser).mockResolvedValue({ data: { user: { id: "user-1" } }, error: null } as never);

    await expect(removeFileFromStorage("other-user/form-1/file-id.txt")).rejects.toThrow(
      "Нельзя удалить файл другого пользователя",
    );
  });
});
