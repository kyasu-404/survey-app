import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createRealtimeRecovery } from "./realtimeRecovery";

describe("realtime recovery", () => {
  let recovery: ReturnType<typeof createRealtimeRecovery>;
  const refresh = vi.fn(), notify = vi.fn();
  beforeEach(() => { vi.useFakeTimers(); refresh.mockClear(); notify.mockClear(); recovery = createRealtimeRecovery(refresh, notify); });
  afterEach(() => { recovery.dispose(); vi.useRealTimers(); });
  it("silently resynchronizes a brief reconnect and normal subscription", () => {
    recovery.status("SUBSCRIBED"); recovery.status("CHANNEL_ERROR");
    vi.advanceTimersByTime(1000); recovery.status("SUBSCRIBED"); vi.advanceTimersByTime(30_000);
    expect(refresh).toHaveBeenCalledTimes(2); expect(notify).not.toHaveBeenCalled();
  });
  it("warns once, polls during an outage, and stops polling on recovery", () => {
    recovery.status("CHANNEL_ERROR"); vi.advanceTimersByTime(3000); recovery.status("CLOSED");
    vi.advanceTimersByTime(2000);
    expect(notify).toHaveBeenCalledTimes(1); expect(notify).toHaveBeenLastCalledWith(expect.stringContaining("15 секунд"), "warning");
    expect(refresh).toHaveBeenCalledTimes(1);
    recovery.status("TIMED_OUT"); vi.advanceTimersByTime(30_000);
    expect(refresh).toHaveBeenCalledTimes(3); expect(notify).toHaveBeenCalledTimes(1);
    recovery.status("SUBSCRIBED");
    expect(notify).toHaveBeenLastCalledWith(expect.stringContaining("восстановлено"), "success");
    vi.advanceTimersByTime(30_000); expect(refresh).toHaveBeenCalledTimes(4);
  });
  it("cleans up timers and ignores channel closure after navigation", () => {
    recovery.status("CHANNEL_ERROR"); recovery.dispose(); recovery.status("CLOSED");
    window.dispatchEvent(new Event("offline")); vi.advanceTimersByTime(60_000);
    expect(refresh).not.toHaveBeenCalled(); expect(notify).not.toHaveBeenCalled(); expect(vi.getTimerCount()).toBe(0);
  });
  it("starts fallback when the browser goes offline and catches up when online", () => {
    window.dispatchEvent(new Event("offline")); vi.advanceTimersByTime(5000);
    expect(notify).toHaveBeenCalledOnce();
    window.dispatchEvent(new Event("online")); expect(refresh).toHaveBeenCalledTimes(2);
    recovery.dispose(); expect(vi.getTimerCount()).toBe(0);
  });
});
