import { readFileSync } from "node:fs";
import { join } from "node:path";
import { runInNewContext } from "node:vm";
import ts from "typescript";
import { describe, expect, it, vi } from "vitest";

const source = readFileSync(join(process.cwd(), "../functions/user-admin/index.ts"), "utf8");
const code = ts.transpile(source.replace(/^import .*;\s*/m, ""), { target: ts.ScriptTarget.ES2022 });

async function listUsers(failSecondPage = false) {
  const profiles = Array.from({ length: 1005 }, (_, index) => ({ id: String(index), name: `User ${index}` }));
  const query = {
    select: () => query, eq: () => query, order: () => query,
    single: async () => ({ data: { role: "admin", is_disabled: false }, error: null }),
    range: vi.fn(async (from: number, to: number) => from > 0 && failSecondPage
      ? { data: null, error: { message: "page unavailable" } }
      : { data: profiles.slice(from, to + 1), error: null }),
  };
  let handler!: (request: Request) => Promise<Response>;
  runInNewContext(code, {
    Deno: {
      env: { get: () => "test-value" },
      serve: (callback: typeof handler) => { handler = callback; },
    },
    createClient: () => ({ auth: { getUser: async () => ({ data: { user: { id: "admin" } }, error: null }) }, from: () => query }),
    URL, Headers, Request, Response, crypto,
    console: { info: vi.fn(), error: vi.fn() },
  });
  const response = await handler(new Request("http://localhost/user-admin", {
    method: "POST", headers: { Authorization: "Bearer test-token", "Content-Type": "application/json" },
    body: JSON.stringify({ action: "list" }),
  }));
  return { response, query, profiles };
}

describe("user-admin list action", () => {
  it("returns users beyond PostgREST's 1000-row cap", async () => {
    const { response, query, profiles } = await listUsers();
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ users: profiles });
    expect(query.range.mock.calls).toEqual([[0, 999], [1000, 1999]]);
  });

  it("returns an error instead of an apparently complete truncated list", async () => {
    const { response } = await listUsers(true);
    expect(response.status).toBe(400);
    expect(await response.json()).toMatchObject({ error: "page unavailable" });
  });
});
