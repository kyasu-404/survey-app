import { act, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { ToastProvider, useToast } from "./ToastProvider";

function ToastHarness({ undo = async () => true }: { undo?: () => Promise<boolean> }) {
  const { showToast } = useToast();

  return (
    <>
      <button type="button" onClick={() => showToast("Сбой сохранения", "error")}>
        error toast
      </button>
      <button type="button" onClick={() => showToast("Сохранено", "success")}>
        success toast
      </button>
      <button type="button" onClick={event => showToast("Удалено", "success", { durationMs: 10_000, action: {
        label: "Отменить удаление", run: undo, focusFrom: event.currentTarget,
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

  it.each([true, false])("pauses expiration during undo and handles a settled result of %s", async (completed) => {
    vi.useFakeTimers();
    let resolveUndo!: (result: boolean) => void;
    const undo = vi.fn(() => new Promise<boolean>(resolve => { resolveUndo = resolve; }));
    render(<ToastProvider><ToastHarness undo={undo} /></ToastProvider>);

    const trigger = screen.getByRole("button", { name: "undo toast" });
    trigger.focus();
    fireEvent.click(trigger);
    const action = screen.getByRole("button", { name: "Отменить удаление" });
    expect(action).toHaveFocus();
    await act(async () => { await vi.advanceTimersByTimeAsync(9_900); });
    fireEvent.click(action);
    await act(async () => { await vi.advanceTimersByTimeAsync(500); });
    expect(action).toHaveAttribute("aria-disabled", "true");
    expect(action).toHaveFocus();
    expect(vi.getTimerCount()).toBe(0);

    await act(async () => resolveUndo(completed));
    if (completed) {
      expect(action).not.toBeInTheDocument();
      expect(trigger).toHaveFocus();
    } else {
      expect(action).not.toHaveAttribute("aria-disabled", "true");
      await act(async () => { await vi.advanceTimersByTimeAsync(100); });
      expect(action).toHaveAttribute("aria-disabled", "true");
      expect(trigger).toHaveFocus();
      await act(async () => { await vi.advanceTimersByTimeAsync(180); });
      expect(action).not.toBeInTheDocument();
    }
  });

  it("clears the expiration timers as soon as undo succeeds", async () => {
    vi.useFakeTimers();
    render(<ToastProvider><ToastHarness /></ToastProvider>);
    fireEvent.click(screen.getByRole("button", { name: "undo toast" }));
    await act(async () => { fireEvent.click(screen.getByRole("button", { name: "Отменить удаление" })); });
    expect(vi.getTimerCount()).toBe(0);
  });

  it("rejects an undo click during the leave animation after the system clock moves backwards", async () => {
    vi.useFakeTimers();
    const undo = vi.fn(async () => true);
    render(<ToastProvider><ToastHarness undo={undo} /></ToastProvider>);
    fireEvent.click(screen.getByRole("button", { name: "undo toast" }));
    await act(async () => { await vi.advanceTimersByTimeAsync(10_000); });
    const action = screen.getByRole("button", { name: "Отменить удаление" });
    expect(action).toHaveAttribute("aria-disabled", "true");

    vi.setSystemTime(Date.now() - 2_000);
    await act(async () => { fireEvent.click(action); });
    expect(undo).not.toHaveBeenCalled();
  });

  it("focuses the new action when it replaces another toast in the same update", async () => {
    vi.useFakeTimers();
    function ReplacementHarness() {
      const { showToast } = useToast();
      return <button type="button" onClick={({ currentTarget }) => showToast("Первое", "success", {
        action: {
          label: "Первое действие",
          run: async () => {
            showToast("Второе", "success", { action: {
              label: "Второе действие", focusFrom: currentTarget, run: async () => true,
            } });
            return true;
          },
        },
      })}>Показать</button>;
    }
    render(<ToastProvider><ReplacementHarness /></ToastProvider>);
    const trigger = screen.getByRole("button", { name: "Показать" });
    trigger.focus();
    fireEvent.click(trigger);
    await act(async () => { fireEvent.click(screen.getByRole("button", { name: "Первое действие" })); });
    expect(screen.queryByText("Первое")).not.toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Второе действие" })).toHaveFocus();
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
