import { act, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { Presence } from "./Presence";

describe("Presence", () => {
  afterEach(() => { vi.useRealTimers(); vi.restoreAllMocks(); vi.unstubAllGlobals(); });

  it("retains closing content but removes it from navigation and accessibility immediately", () => {
    vi.useFakeTimers();
    const { rerender, container } = render(<Presence><button>Action</button></Presence>);
    screen.getByRole("button").focus();
    rerender(<Presence>{false}</Presence>);
    expect(screen.queryByRole("button")).toBeNull();
    expect(screen.getByText("Action")).toBeInTheDocument();
    expect(container.querySelector<HTMLElement>(".motion-presence")?.inert).toBe(true);
    expect(screen.getByText("Action")).not.toHaveFocus();
    act(() => vi.advanceTimersByTime(180));
    expect(screen.queryByText("Action")).toBeNull();
  });

  it("cancels an exit when reopened, uses current handlers, and clears timers on unmount", () => {
    vi.useFakeTimers();
    const oldAction = vi.fn(), newAction = vi.fn();
    const { rerender, unmount } = render(<Presence><button onClick={oldAction}>Old</button></Presence>);
    rerender(<Presence>{false}</Presence>);
    act(() => vi.advanceTimersByTime(60));
    rerender(<Presence><button onClick={newAction}>New</button></Presence>);
    act(() => vi.advanceTimersByTime(200));
    fireEvent.click(screen.getByRole("button", { name: "New" }));
    expect(newAction).toHaveBeenCalledOnce();
    expect(oldAction).not.toHaveBeenCalled();
    rerender(<Presence>{false}</Presence>);
    unmount();
    expect(vi.getTimerCount()).toBe(0);
  });

  it("removes menus immediately, including during rapid reopen and close", () => {
    vi.useFakeTimers();
    const { rerender } = render(<Presence kind="menu"><button>Old</button></Presence>);
    rerender(<Presence kind="menu">{false}</Presence>);
    expect(screen.queryByText("Old")).toBeNull();
    rerender(<Presence kind="menu"><button>New</button></Presence>);
    act(() => vi.runAllTimers());
    expect(screen.getByRole("button", { name: "New" })).toBeVisible();
    rerender(<Presence kind="menu">{false}</Presence>);
    expect(screen.queryByText("New")).toBeNull();
  });

  it("does not retain content when reduced motion is requested", () => {
    vi.stubGlobal("matchMedia", vi.fn(() => ({ matches: true })));
    const { rerender } = render(<Presence><button>Action</button></Presence>);
    rerender(<Presence>{false}</Presence>);
    expect(screen.queryByText("Action")).toBeNull();
  });
});
