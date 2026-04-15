import { render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { AppErrorBoundary } from "./AppErrorBoundary";

function CrashOnRender(): never {
  throw new Error("render failed");
}

describe("AppErrorBoundary", () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("renders children while there is no error", () => {
    render(
      <AppErrorBoundary>
        <div>healthy content</div>
      </AppErrorBoundary>,
    );

    expect(screen.getByText("healthy content")).toBeInTheDocument();
  });

  it("shows the fallback UI and logs the error when a child crashes", () => {
    const consoleErrorSpy = vi.spyOn(console, "error").mockImplementation(() => undefined);

    render(
      <AppErrorBoundary>
        <CrashOnRender />
      </AppErrorBoundary>,
    );

    expect(screen.getByRole("heading", { name: "Что-то пошло не так" })).toBeInTheDocument();
    expect(
      consoleErrorSpy.mock.calls.some(([message]) => message === "Unexpected UI error"),
    ).toBe(true);
  });
});
