import { render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { readFileSync } from "node:fs";
import { join } from "node:path";
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
    expect(icon).toHaveAttribute("src");
    expect(button).toHaveAttribute("data-theme-id", "sand");
    expect(button).toHaveAttribute("aria-label", expect.stringContaining("Сейчас Бежевая"));
    expect(button).toHaveAttribute("aria-expanded", "false");
    expect(button).toHaveAttribute("data-menu-open", "false");
    expect(document.documentElement.dataset.theme).toBe("sand");
    expect(screen.queryByRole("menu", { name: "Выбор темы" })).not.toBeInTheDocument();

    await user.click(button);

    const menu = screen.getByRole("menu", { name: "Выбор темы" });

    expect(button).toHaveAttribute("aria-expanded", "true");
    expect(button).toHaveAttribute("data-menu-open", "true");
    expect(within(menu).getByRole("menuitemradio", { name: "Бежевая" })).toHaveAttribute("aria-checked", "true");

    await user.click(within(menu).getByRole("menuitemradio", { name: "Зелёная" }));

    expect(button).toHaveAttribute("data-theme-id", "teal");
    expect(button).toHaveAttribute("aria-label", expect.stringContaining("Сейчас Зелёная"));
    expect(button).toHaveAttribute("aria-expanded", "false");
    expect(button).toHaveAttribute("data-menu-open", "false");
    expect(document.documentElement.dataset.theme).toBe("teal");
    expect(window.localStorage.getItem(THEME_STORAGE_KEY)).toBe("teal");
    expect(screen.queryByRole("menu", { name: "Выбор темы" })).not.toBeInTheDocument();
  });

  it("can open the theme menu upward for footer placements", async () => {
    render(
      <ThemeProvider>
        <ThemeCycleButton menuPlacement="top-right" className="sidebar-theme-button" />
      </ThemeProvider>,
    );

    const user = userEvent.setup();
    const button = screen.getByRole("button", { name: /Сменить тему/i });

    await user.click(button);

    expect(screen.getByRole("menu", { name: "Выбор темы" })).toHaveAttribute("data-menu-placement", "top-right");
  });

  it("opens the footer menu into the page and rotates the settings icon by a half turn", () => {
    const css = readFileSync(join(process.cwd(), "src/app.css"), "utf8");

    expect(css).toMatch(/\.theme-cycle-button-shell\[data-menu-placement="top-right"\]\s+\.theme-cycle-menu\s*\{[^}]*inset:\s*auto auto calc\(100% \+ 10px\) 0;/s);
    expect(css).toMatch(/\.theme-cycle-button\[data-menu-open="true"\]\s+\.theme-cycle-button-icon\s*\{[^}]*transform:\s*rotate\(180deg\);/s);
  });

  it("exposes palette tokens for each theme option", async () => {
    render(
      <ThemeProvider>
        <ThemeCycleButton />
      </ThemeProvider>,
    );

    const user = userEvent.setup();

    await user.click(screen.getByRole("button", { name: /Сменить тему/i }));

    const sandOption = screen.getByRole("menuitemradio", { name: "Бежевая" });
    const skyOption = screen.getByRole("menuitemradio", { name: "Голубая" });
    const tealOption = screen.getByRole("menuitemradio", { name: "Зелёная" });

    expect(sandOption).toHaveStyle("--theme-option-accent: #6f5137");
    expect(sandOption).toHaveStyle("--theme-option-surface: #eadfce");
    expect(skyOption).toHaveStyle("--theme-option-accent: #397fbd");
    expect(skyOption).toHaveStyle("--theme-option-surface: #d9eaf7");
    expect(tealOption).toHaveStyle("--theme-option-accent: #3c805b");
    expect(tealOption).toHaveStyle("--theme-option-surface: #d9ebdd");
  });
});
