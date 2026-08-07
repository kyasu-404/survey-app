import { beforeEach, describe, expect, it, vi } from "vitest";

const { apiClient, invoke, range, pages } = vi.hoisted(() => {
  const pages: Array<{ data: unknown[]; error: null }> = [];
  const range = vi.fn();
  const builder: Record<string, ReturnType<typeof vi.fn>> = {};
  for (const method of ["select", "eq", "order", "range"]) {
    builder[method] = vi.fn((...args: unknown[]) => {
      if (method === "range") range(...args);
      return builder;
    });
  }
  builder.abortSignal = vi.fn(() => Promise.resolve(pages.shift() ?? { data: [], error: null }));
  return {
    pages,
    range,
    invoke: vi.fn(),
    apiClient: { from: vi.fn(() => builder), auth: { getCurrentSession: vi.fn() } },
  };
});

vi.mock("../../shared/api", () => ({
  apiClient,
  supabaseClient: { functions: { invoke } },
}));

import { getMailJobs, getSmtpSettings } from "./api";

describe("mail api", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    pages.length = 0;
  });

  it("loads every delivery status when a batch exceeds the PostgREST row limit", async () => {
    pages.push(
      { data: Array.from({ length: 1000 }, (_, index) => ({ id: `job-${index}` })), error: null },
      { data: [{ id: "job-1000" }], error: null },
    );

    const jobs = await getMailJobs("batch-1");

    expect(jobs).toHaveLength(1001);
    expect(range).toHaveBeenNthCalledWith(1, 0, 999);
    expect(range).toHaveBeenNthCalledWith(2, 1000, 1999);
  });

  it("explains how to fix a missing mail-admin function", async () => {
    apiClient.auth.getCurrentSession.mockResolvedValue({
      data: { session: { access_token: "test-token" } },
      error: null,
    });
    invoke.mockResolvedValue({
      data: null,
      error: new Error("Edge Function returned a non-2xx status code"),
      response: new Response(JSON.stringify({ code: "NOT_FOUND", message: "Function not found" }), { status: 404 }),
    });

    await expect(getSmtpSettings()).rejects.toThrow(
      "Почтовый модуль mail-admin не развёрнут в Supabase. Установите миграцию и модуль по инструкции в README.",
    );
  });
});
