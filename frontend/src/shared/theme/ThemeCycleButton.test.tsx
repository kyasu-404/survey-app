import { render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it } from "vitest";
import { ThemeCycleButton } from "./ThemeCycleButton";
import { ThemeProvider } from "./ThemeProvider";
import { THEME_STORAGE_KEY } from "./themeRegistry";

describe("ThemeCycleButton", () => {
  beforeEach(() => {
    window.localStorage.clear();
    delete document.documentElement.dataset.theme;
  });

  it("opens the theme menu and applies the selected theme", async () => {
    render(
      <ThemeProvider>
        <ThemeCycleButton />
      </ThemeProvider>,
    );

    const user = userEvent.setup();
    const button = screen.getByRole("button", { name: /Сменить тему/i });
    const icon = button.querySelector(".theme-cycle-button-icon");

    expect(icon).toBeInTheDocument();
    expect(icon).toHaveAttribute("src", expect.stringContaining("switch_theme.svg"));
    expect(button).toHaveAttribute("data-theme-id", "sand");
    expect(button).toHaveAttribute("aria-label", expect.stringContaining("Сейчас Графит"));
    expect(button).toHaveAttribute("aria-expanded", "false");
    expect(button).toHaveAttribute("data-menu-open", "false");
    expect(document.documentElement.dataset.theme).toBe("sand");
    expect(screen.queryByRole("menu", { name: "Выбор темы" })).not.toBeInTheDocument();

    await user.click(button);

    const menu = screen.getByRole("menu", { name: "Выбор темы" });

    expect(button).toHaveAttribute("aria-expanded", "true");
    expect(button).toHaveAttribute("data-menu-open", "true");
    expect(within(menu).getByRole("menuitemradio", { name: "Графит" })).toHaveAttribute("aria-checked", "true");

    await user.click(within(menu).getByRole("menuitemradio", { name: "Бирюза" }));

    expect(button).toHaveAttribute("data-theme-id", "teal");
    expect(button).toHaveAttribute("aria-label", expect.stringContaining("Сейчас Бирюза"));
    expect(button).toHaveAttribute("aria-expanded", "false");
    expect(button).toHaveAttribute("data-menu-open", "false");
    expect(document.documentElement.dataset.theme).toBe("teal");
    expect(window.localStorage.getItem(THEME_STORAGE_KEY)).toBe("teal");
    expect(screen.queryByRole("menu", { name: "Выбор темы" })).not.toBeInTheDocument();
  });

  it("can open the theme menu upward for footer placements", async () => {
    render(
      <ThemeProvider>
        <ThemeCycleButton menuPlacement="top-left" className="sidebar-theme-button" />
      </ThemeProvider>,
    );

    const user = userEvent.setup();
    const button = screen.getByRole("button", { name: /Сменить тему/i });

    await user.click(button);

    expect(screen.getByRole("menu", { name: "Выбор темы" })).toHaveAttribute("data-menu-placement", "top-left");
  });

  it("exposes palette tokens for each theme option", async () => {
    render(
      <ThemeProvider>
        <ThemeCycleButton />
      </ThemeProvider>,
    );

    const user = userEvent.setup();

    await user.click(screen.getByRole("button", { name: /Сменить тему/i }));

    const graphiteOption = screen.getByRole("menuitemradio", { name: "Графит" });
    const skyOption = screen.getByRole("menuitemradio", { name: "Небо" });
    const tealOption = screen.getByRole("menuitemradio", { name: "Бирюза" });

    expect(graphiteOption).toHaveStyle("--theme-option-accent: #2b2f36");
    expect(graphiteOption).toHaveStyle("--theme-option-surface: #eceff3");
    expect(skyOption).toHaveStyle("--theme-option-accent: #2563eb");
    expect(skyOption).toHaveStyle("--theme-option-surface: #e9eff7");
    expect(tealOption).toHaveStyle("--theme-option-accent: #207a53");
    expect(tealOption).toHaveStyle("--theme-option-surface: #e9f0eb");
  });
});
