import { act, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { RefreshButton } from "./RefreshButton";

describe("RefreshButton", () => {
  afterEach(() => {
    vi.useRealTimers();
    vi.restoreAllMocks();
  });

  it("renders the last updated time above the button", () => {
    render(
      <RefreshButton
        isRefreshing={false}
        lastUpdatedAt={new Date(2026, 3, 15, 13, 14, 15).getTime()}
        onClick={() => undefined}
      />,
    );

    expect(screen.getByText("Обновлено 13:14:15")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Обновить" })).toBeInTheDocument();
  });

  it("shows a short updated state after a successful manual refresh", async () => {
    vi.useFakeTimers();
    const onClick = vi.fn();
    const { rerender } = render(<RefreshButton isRefreshing={false} lastUpdatedAt={0} onClick={onClick} />);

    fireEvent.click(screen.getByRole("button", { name: "Обновить" }));

    expect(onClick).toHaveBeenCalledTimes(1);

    rerender(<RefreshButton isRefreshing lastUpdatedAt={0} onClick={onClick} />);
    expect(screen.getByRole("button", { name: "Обновляется..." })).toBeInTheDocument();

    rerender(
      <RefreshButton
        isRefreshing={false}
        lastUpdatedAt={new Date(2026, 3, 15, 13, 14, 18).getTime()}
        onClick={onClick}
      />,
    );

    expect(screen.getByRole("button", { name: "Обновлено" })).toBeInTheDocument();
    expect(screen.getByText("Обновлено 13:14:18")).toBeInTheDocument();

    await act(async () => {
      await vi.advanceTimersByTimeAsync(1500);
    });

    expect(screen.getByRole("button", { name: "Обновить" })).toBeInTheDocument();
  });

  it("keeps the button idle while a background sync is running", () => {
    render(
      <RefreshButton
        isRefreshing={false}
        isSyncing
        lastUpdatedAt={new Date(2026, 3, 15, 13, 14, 15).getTime()}
        onClick={() => undefined}
      />,
    );

    const refreshButton = screen.getByRole("button", { name: "Обновить" });

    expect(screen.getByText("Обновлено 13:14:15, синхронизация...")).toBeInTheDocument();
    expect(refreshButton.querySelector("img.toolbar-icon")).toBeInTheDocument();
    expect(refreshButton.querySelector(".inline-spinner")).not.toBeInTheDocument();
  });
});
