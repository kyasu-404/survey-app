import { act, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { ToastProvider, useToast } from "./ToastProvider";

function ToastHarness() {
  const { showToast } = useToast();

  return (
    <>
      <button type="button" onClick={() => showToast("Сбой сохранения", "error")}>
        error toast
      </button>
      <button type="button" onClick={() => showToast("Сохранено", "success")}>
        success toast
      </button>
      <button type="button" onClick={() => showToast("Удалено", "success", { durationMs: 10_000, action: {
        label: "Отменить удаление", run: async () => true,
      } })}>
        undo toast
      </button>
    </>
  );
}

describe("ToastProvider", () => {
  afterEach(() => {
    vi.useRealTimers();
    vi.restoreAllMocks();
  });

  it("deduplicates identical toasts shown within one second", async () => {
    vi.useFakeTimers();

    render(
      <ToastProvider>
        <ToastHarness />
      </ToastProvider>,
    );

    fireEvent.click(screen.getByRole("button", { name: "error toast" }));
    fireEvent.click(screen.getByRole("button", { name: "error toast" }));

    expect(screen.getAllByText("Сбой сохранения")).toHaveLength(1);

    await act(async () => {
      await vi.advanceTimersByTimeAsync(1001);
    });

    fireEvent.click(screen.getByRole("button", { name: "error toast" }));

    expect(screen.getAllByText("Сбой сохранения")).toHaveLength(2);
  });

  it("auto-hides a toast after three seconds", async () => {
    vi.useFakeTimers();

    render(
      <ToastProvider>
        <ToastHarness />
      </ToastProvider>,
    );

    fireEvent.click(screen.getByRole("button", { name: "success toast" }));
    expect(screen.getByText("Сохранено")).toBeInTheDocument();

    await act(async () => {
      await vi.advanceTimersByTimeAsync(3000);
    });

    expect(screen.queryByText("Сохранено")).not.toBeInTheDocument();
  });

  it("preserves distinct undo actions and expires them after the ten-second undo window", async () => {
    vi.useFakeTimers();
    render(<ToastProvider><ToastHarness /></ToastProvider>);
    fireEvent.click(screen.getByRole("button", { name: "undo toast" }));
    fireEvent.click(screen.getByRole("button", { name: "undo toast" }));
    const actions = screen.getAllByRole("button", { name: "Отменить удаление" });
    expect(actions).toHaveLength(2);

    await act(async () => { await vi.advanceTimersByTimeAsync(9_999); });
    expect(actions[0]).toBeEnabled();
    await act(async () => { fireEvent.click(actions[0]); });
    expect(screen.getByRole("button", { name: "Отменить удаление" })).toBe(actions[1]);

    await act(async () => { await vi.advanceTimersByTimeAsync(181); });
    expect(screen.queryByRole("button", { name: "Отменить удаление" })).not.toBeInTheDocument();
  });

  it("clears pending timeouts on unmount", () => {
    vi.useFakeTimers();

    const { unmount } = render(
      <ToastProvider>
        <ToastHarness />
      </ToastProvider>,
    );

    fireEvent.click(screen.getByRole("button", { name: "error toast" }));
    fireEvent.click(screen.getByRole("button", { name: "success toast" }));

    unmount();

    expect(vi.getTimerCount()).toBe(0);
  });
});
