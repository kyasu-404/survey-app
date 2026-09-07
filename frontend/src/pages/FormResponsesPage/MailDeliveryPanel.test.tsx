import { act, render, screen } from "@testing-library/react";
import { QueryClientProvider } from "@tanstack/react-query";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { createQueryClient } from "../../app/providers/QueryProvider";
import { MailDeliveryPanel } from "./MailDeliveryPanel";

const mock = vi.hoisted(() => ({
  activity: vi.fn(), jobs: vi.fn(),
  change: undefined as undefined | ((payload: { eventType: string; new: Record<string, unknown>; old: Record<string, unknown> }) => void),
  status: undefined as undefined | ((status: string) => void),
}));
vi.mock("../../entities/mail/api", () => ({ getFormMailActivity: mock.activity, getMailJobs: mock.jobs }));
vi.mock("../../shared/api", () => ({ supabaseClient: {
  channel: () => {
    const channel = {
      on: (_type: string, _filter: unknown, handler: typeof mock.change) => { mock.change = handler; return channel; },
      subscribe: (handler: typeof mock.status) => { mock.status = handler; return channel; },
    };
    return channel;
  }, removeChannel: vi.fn(),
} }));

const clients: ReturnType<typeof createQueryClient>[] = [];
const batch = { id: "batch-1", total_count: 200, created_at: "2026-09-07T00:00:00Z" };
const jobs = [{ id: "mail-1", batch_id: "batch-1", status: "queued", recipient_name: "Школа", recipient_email: "test@example.test" }];
beforeEach(() => {
  vi.useFakeTimers();
  mock.activity.mockResolvedValue({ batches: [batch], jobs: [] });
  mock.jobs.mockResolvedValue(jobs);
});
afterEach(() => {
  clients.splice(0).forEach((client) => client.clear());
  vi.useRealTimers();
  vi.resetAllMocks();
});
function mount(cached = false) {
  const client = createQueryClient();
  clients.push(client);
  if (cached) client.setQueryData(["form-mail-activity", "form-1"], { batches: [{ ...batch, total_count: 1 }] });
  return render(<QueryClientProvider client={client}><MailDeliveryPanel formId="form-1" preferredBatchId="batch-1" onClose={() => {}} /></QueryClientProvider>);
}
async function tick(ms = 1) { await act(async () => { await vi.advanceTimersByTimeAsync(ms); }); }
function emit(eventType = "UPDATE", batchId = "batch-1") {
  mock.change?.({ eventType, new: { batch_id: batchId }, old: {} });
}

it("refreshes a fresh cached activity list when the panel opens again", async () => {
  mount(true);
  await tick();
  expect(mock.activity).toHaveBeenCalledOnce();
  expect(screen.getByText("200")).toBeInTheDocument();
});

it("coalesces 200 delivery changes into one jobs read without reloading the batch list", async () => {
  mount();
  await tick();
  act(() => mock.status?.("SUBSCRIBED"));
  await tick(501);
  mock.jobs.mockClear(); mock.activity.mockClear();
  act(() => { for (let i = 0; i < 200; i++) emit(); });
  await tick(501);
  expect(mock.jobs).toHaveBeenCalledOnce();
  expect(mock.activity).not.toHaveBeenCalled();
  await tick(30_000);
  expect(mock.jobs).toHaveBeenCalledOnce();
});

it("polls while disconnected and reconciles once on reconnect", async () => {
  mount(); await tick();
  act(() => mock.status?.("CHANNEL_ERROR"));
  mock.jobs.mockClear();
  await tick(5001);
  expect(mock.jobs).toHaveBeenCalledOnce();
  act(() => mock.status?.("SUBSCRIBED"));
  await tick(501);
  expect(mock.jobs).toHaveBeenCalledTimes(2);
  expect(mock.activity).toHaveBeenCalledTimes(2);
});

it("ignores changes in another batch, refreshes new batches, and cancels pending work on close", async () => {
  const { unmount } = mount(); await tick();
  mock.jobs.mockClear(); mock.activity.mockClear();
  act(() => emit("UPDATE", "other")); await tick(1001);
  expect(mock.jobs).not.toHaveBeenCalled();
  expect(mock.activity).not.toHaveBeenCalled();
  act(() => emit("INSERT", "other")); await tick(501);
  expect(mock.activity).toHaveBeenCalledOnce();
  expect(mock.jobs).not.toHaveBeenCalled();
  act(() => emit()); unmount(); await tick(1001);
  expect(mock.jobs).not.toHaveBeenCalled();
});
