import { describe, expect, it, vi } from "vitest";
import type { Session } from "@supabase/supabase-js";
import { createSessionRecovery, createSessionFetch, authReadError } from "./session";

function token(user = "author", session = "session", version = 1) {
  return "header." + btoa(JSON.stringify({ sub: user, session_id: session, version })) + ".signature";
}

function session(access_token = token()): Session {
  return { access_token, user: { id: "author" }, refresh_token: "refresh" } as Session;
}

function setup() {
  const old = session();
  const fresh = session(token("author", "session", 2));
  let saved: Session | null = old;
  const read = vi.fn(async () => saved);
  const refresh = vi.fn(async () => { saved = fresh; return fresh; });
  const verify = vi.fn(async () => old.user);
  const invalidate = vi.fn(async () => { saved = null; });
  let queue: Promise<unknown> = Promise.resolve();
  const lock = <T>(work: () => Promise<T>) => {
    const result = queue.then(work);
    queue = result.catch(() => undefined);
    return result;
  };
  const auth = { read, refresh, verify, invalidate, lock };
  const recovery = createSessionRecovery(auth);
  const network = vi.fn<typeof fetch>().mockImplementation(async (_input, init) =>
    new Headers(init?.headers).get("authorization") === "Bearer " + old.access_token
      ? Response.json({ code: "PGRST303", message: "JWT expired" }, { status: 401 })
      : Response.json({ items: [] }));
  const wrap = (coordinator = recovery) => createSessionFetch(network, {
    supabaseUrl: "https://supabase.test",
    officeOrigin: "https://app.test",
    anonKey: "anon",
    recovery: coordinator,
  });
  const request = (method = "GET", path = "https://supabase.test/rest/v1/profiles", fetcher = wrap()) =>
    fetcher(path, { method, headers: { Authorization: "Bearer " + old.access_token } });
  return { auth, network, request, wrap, set: (value: Session | null) => { saved = value; } };
}

describe("session recovery", () => {
  it("replays a read-only export POST once with the rotated token", async () => {
    const { request, auth, network } = setup();
    expect((await request("POST", "https://supabase.test/rest/v1/rpc/export_form_responses")).status).toBe(200);
    expect(auth.refresh).toHaveBeenCalledTimes(1);
    expect(network).toHaveBeenCalledTimes(2);
    expect(network.mock.calls[1][1]?.cache).toBe("no-store");
  });

  it("rotates the token, but never replays an authenticated mutation", async () => {
    const { request, auth, network } = setup();
    expect(await (await request("POST")).json()).toMatchObject({ code: "survey_session_restored" });
    expect(auth.refresh).toHaveBeenCalledTimes(1);
    expect(network).toHaveBeenCalledTimes(1);
  });

  it("coordinates callers sharing storage, including other tabs", async () => {
    const { request, auth, wrap } = setup();
    const anotherTab = wrap(createSessionRecovery(auth));
    const results = await Promise.all([request(), request(), request("GET", undefined, anotherTab)]);
    expect(results.map(result => result.status)).toEqual([200, 200, 200]);
    expect(auth.refresh).toHaveBeenCalledTimes(1);
  });

  it("does not replay with a replacement session after account changes", async () => {
    const { request, auth, network, set } = setup();
    set({ ...session(token("another", "different")), user: { id: "another" } } as Session);
    expect(await (await request()).json()).toMatchObject({ code: "survey_session_changed" });
    expect(auth.refresh).not.toHaveBeenCalled();
    expect(auth.invalidate).not.toHaveBeenCalled();
    expect(network).toHaveBeenCalledTimes(1);
  });

  it("distinguishes revocation from a permissions denial", async () => {
    const { request, auth, network } = setup();
    network.mockResolvedValueOnce(Response.json({ code: "42501" }, { status: 403 }));
    expect((await request()).status).toBe(403);
    expect(auth.refresh).not.toHaveBeenCalled();
    expect(auth.invalidate).not.toHaveBeenCalled();
    network.mockResolvedValueOnce(Response.json({ code: "session_not_found" }, { status: 403 }));
    expect(await (await request()).json()).toMatchObject({ code: "survey_session_revoked" });
    expect(auth.invalidate).toHaveBeenCalledTimes(1);
  });

  it("keeps credentials when Auth is unavailable during refresh", async () => {
    const { request, auth, network } = setup();
    auth.refresh.mockRejectedValueOnce(authReadError({ status: 503 }));
    expect(await (await request()).json()).toMatchObject({ code: "survey_session_unavailable" });
    expect(auth.invalidate).not.toHaveBeenCalled();
    expect(network).toHaveBeenCalledTimes(1);
  });

  it("signs out when refresh confirms revocation and never repeats the request", async () => {
    const { request, auth, network } = setup();
    auth.refresh.mockRejectedValueOnce(authReadError({ status: 400, code: "refresh_token_not_found" }));
    expect(await (await request()).json()).toMatchObject({ code: "survey_session_revoked" });
    expect(auth.invalidate).toHaveBeenCalledTimes(1);
    expect(network).toHaveBeenCalledTimes(1);
  });

  it("does not loop when the resource rejects the rotated access token", async () => {
    const { request, auth, network } = setup();
    network.mockImplementation(async () => Response.json({ code: "PGRST301" }, { status: 401 }));
    expect(await (await request()).json()).toMatchObject({ code: "survey_session_rejected" });
    expect(auth.refresh).toHaveBeenCalledTimes(1);
    expect(network).toHaveBeenCalledTimes(2);
  });

  it("keeps the current session when a generic 401 does not identify a token error", async () => {
    const { request, auth, network } = setup();
    network.mockResolvedValueOnce(Response.json({ message: "Unauthorized" }, { status: 401 }));
    expect((await request()).status).toBe(401);
    expect(auth.refresh).not.toHaveBeenCalled();
    expect(auth.invalidate).not.toHaveBeenCalled();
  });

  it("does not refresh on a failed network request or a server 503", async () => {
    const { request, auth, network } = setup();
    network.mockRejectedValueOnce(new TypeError("Failed to fetch"));
    await expect(request()).rejects.toThrow("Failed to fetch");
    network.mockResolvedValueOnce(Response.json({}, { status: 503 }));
    expect((await request()).status).toBe(503);
    expect(auth.refresh).not.toHaveBeenCalled();
  });
});
