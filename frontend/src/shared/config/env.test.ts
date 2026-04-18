import { afterEach, describe, expect, it, vi } from "vitest";

const TEST_SUPABASE_URL = "https://survey-app.supabase.co";
const TEST_SUPABASE_ANON_KEY = "test-anon-key";

async function importEnv(supabaseUrl: string | undefined, supabaseAnonKey: string | undefined) {
  vi.resetModules();
  vi.stubEnv("VITE_SUPABASE_URL", supabaseUrl);
  vi.stubEnv("VITE_SUPABASE_ANON_KEY", supabaseAnonKey);
  return import("./env");
}

afterEach(() => {
  vi.unstubAllEnvs();
  vi.resetModules();
});

describe("required Supabase env", () => {
  it("throws a clear error when VITE_SUPABASE_URL is missing", async () => {
    await expect(importEnv(undefined, TEST_SUPABASE_ANON_KEY)).rejects.toThrow(/VITE_SUPABASE_URL/);
  });

  it("throws a clear error when VITE_SUPABASE_ANON_KEY is missing", async () => {
    await expect(importEnv(TEST_SUPABASE_URL, undefined)).rejects.toThrow(/VITE_SUPABASE_ANON_KEY/);
  });

  it("exports configured Supabase env values", async () => {
    const { SUPABASE_ANON_KEY, SUPABASE_URL } = await importEnv(TEST_SUPABASE_URL, TEST_SUPABASE_ANON_KEY);

    expect(SUPABASE_URL).toBe(TEST_SUPABASE_URL);
    expect(SUPABASE_ANON_KEY).toBe(TEST_SUPABASE_ANON_KEY);
  });
});

describe("resolveSupabaseUrl", () => {
  it("rewrites localhost Supabase URL to the current dev host for remote Vite sessions", async () => {
    const { resolveSupabaseUrl } = await importEnv(TEST_SUPABASE_URL, TEST_SUPABASE_ANON_KEY);

    expect(resolveSupabaseUrl("http://localhost:8000", "http://172.17.104.13:5173/form/abc", true)).toBe(
      "http://172.17.104.13:8000",
    );
  });

  it("keeps localhost when the page itself is opened on localhost", async () => {
    const { resolveSupabaseUrl } = await importEnv(TEST_SUPABASE_URL, TEST_SUPABASE_ANON_KEY);

    expect(resolveSupabaseUrl("http://localhost:8000", "http://localhost:5173/form/abc", true)).toBe(
      "http://localhost:8000",
    );
  });

  it("does not rewrite non-localhost configured URLs", async () => {
    const { resolveSupabaseUrl } = await importEnv(TEST_SUPABASE_URL, TEST_SUPABASE_ANON_KEY);

    expect(resolveSupabaseUrl("https://supabase.example.com", "http://172.17.104.13:5173/form/abc", true)).toBe(
      "https://supabase.example.com",
    );
  });

  it("does not rewrite in production mode", async () => {
    const { resolveSupabaseUrl } = await importEnv(TEST_SUPABASE_URL, TEST_SUPABASE_ANON_KEY);

    expect(resolveSupabaseUrl("http://localhost:8000", "http://172.17.104.13:5173/form/abc", false)).toBe(
      "http://localhost:8000",
    );
  });
});
