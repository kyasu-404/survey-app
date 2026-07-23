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

  it("clears pending timeouts on unmount", () => {
    vi.useFakeTimers();
    const clearTimeoutSpy = vi.spyOn(window, "clearTimeout");

    const { unmount } = render(
      <ToastProvider>
        <ToastHarness />
      </ToastProvider>,
    );

    fireEvent.click(screen.getByRole("button", { name: "error toast" }));
    fireEvent.click(screen.getByRole("button", { name: "success toast" }));

    unmount();

    expect(clearTimeoutSpy).toHaveBeenCalledTimes(2);
  });
});
