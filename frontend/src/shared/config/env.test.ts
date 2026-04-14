import { describe, expect, it } from "vitest";
import { resolveSupabaseUrl } from "./env";

describe("resolveSupabaseUrl", () => {
  it("rewrites localhost Supabase URL to the current dev host for remote Vite sessions", () => {
    expect(resolveSupabaseUrl("http://localhost:8000", "http://172.17.104.13:5173/form/abc", true)).toBe(
      "http://172.17.104.13:8000",
    );
  });

  it("keeps localhost when the page itself is opened on localhost", () => {
    expect(resolveSupabaseUrl("http://localhost:8000", "http://localhost:5173/form/abc", true)).toBe(
      "http://localhost:8000",
    );
  });

  it("does not rewrite non-localhost configured URLs", () => {
    expect(resolveSupabaseUrl("https://supabase.example.com", "http://172.17.104.13:5173/form/abc", true)).toBe(
      "https://supabase.example.com",
    );
  });

  it("does not rewrite in production mode", () => {
    expect(resolveSupabaseUrl("http://localhost:8000", "http://172.17.104.13:5173/form/abc", false)).toBe(
      "http://localhost:8000",
    );
  });
});
