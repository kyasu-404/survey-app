import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { ThemeProvider, useTheme } from "./ThemeProvider";
import { creatorThemes, isThemeId, THEME_STORAGE_KEY, themeOptions, themes } from "./themeRegistry";

function ThemeControls() {
  const { setTheme, themeId } = useTheme();
  return <>
    <output aria-label="Текущая тема">{themeId}</output>
    {themeOptions.map(option => <button key={option.id} onClick={() => setTheme(option.id)}>{option.label}</button>)}
  </>;
}

describe("ThemeProvider", () => {
  beforeEach(() => {
    localStorage.clear();
    delete document.documentElement.dataset.theme;
  });

  afterEach(() => vi.restoreAllMocks());

  it.each(["getter", "getItem", "setItem"])("continues with an in-memory theme when storage %s is blocked", async method => {
    const blocked = () => { throw new DOMException("Blocked", "SecurityError"); };
    if (method === "getter") vi.spyOn(window, "localStorage", "get").mockImplementation(blocked);
    else vi.spyOn(Storage.prototype, method as "getItem" | "setItem").mockImplementation(blocked);
    render(<ThemeProvider><ThemeControls /></ThemeProvider>);
    expect(document.documentElement).toHaveAttribute("data-theme", "sand");
    await userEvent.click(screen.getByRole("button", { name: "Тёмная" }));
    expect(document.documentElement).toHaveAttribute("data-theme", "graphite");
  });

  it("offers only light and dark palettes to the app and Creator", () => {
    expect(themeOptions).toEqual([{ id: "sand", label: "Светлая" }, { id: "graphite", label: "Тёмная" }]);
    expect(Object.keys(themes)).toEqual(["sand", "graphite"]);
    expect(Object.keys(creatorThemes)).toEqual(["sand", "graphite"]);
    expect(themes.sand.survey.colorPalette).toBe("light");
    expect(themes.graphite.survey.colorPalette).toBe("dark");
    expect(creatorThemes.graphite.isLight).toBe(false);
    expect(themes.graphite.app.accent).toBe("#a8c7fa");
  });

  it.each(["sky", "teal", "unknown"])("replaces an unsupported saved theme %s with light", saved => {
    localStorage.setItem(THEME_STORAGE_KEY, saved);
    render(<ThemeProvider><ThemeControls /></ThemeProvider>);
    expect(isThemeId(saved)).toBe(false);
    expect(document.documentElement).toHaveAttribute("data-theme", "sand");
    expect(localStorage.getItem(THEME_STORAGE_KEY)).toBe("sand");
  });

  it("persists both choices and restores dark on a later mount", async () => {
    const user = userEvent.setup();
    const first = render(<ThemeProvider><ThemeControls /></ThemeProvider>);
    await user.click(screen.getByRole("button", { name: "Тёмная" }));
    expect(document.documentElement).toHaveAttribute("data-theme", "graphite");
    expect(localStorage.getItem(THEME_STORAGE_KEY)).toBe("graphite");
    await user.click(screen.getByRole("button", { name: "Светлая" }));
    expect(localStorage.getItem(THEME_STORAGE_KEY)).toBe("sand");
    await user.click(screen.getByRole("button", { name: "Тёмная" }));
    first.unmount();
    render(<ThemeProvider><ThemeControls /></ThemeProvider>);
    expect(screen.getByLabelText("Текущая тема")).toHaveTextContent("graphite");
  });

  it("keeps a saved choice while the login page uses its own appearance", () => {
    localStorage.setItem(THEME_STORAGE_KEY, "graphite");
    const { rerender } = render(<ThemeProvider isThemeApplied={false}><ThemeControls /></ThemeProvider>);
    expect(document.documentElement.dataset.theme).toBeUndefined();
    expect(localStorage.getItem(THEME_STORAGE_KEY)).toBe("graphite");
    rerender(<ThemeProvider><ThemeControls /></ThemeProvider>);
    expect(document.documentElement).toHaveAttribute("data-theme", "graphite");
  });
});
