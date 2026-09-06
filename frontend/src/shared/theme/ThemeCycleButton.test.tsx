import { render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { beforeEach, describe, expect, it } from "vitest";
import { ThemeCycleButton } from "./ThemeCycleButton";
import { ThemeProvider } from "./ThemeProvider";
import { creatorThemes, THEME_STORAGE_KEY, themes } from "./themeRegistry";

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
    const source = readFileSync(join(process.cwd(), "src/shared/theme/ThemeCycleButton.tsx"), "utf8");

    expect(icon).toBeInTheDocument();
    expect(icon).toHaveAttribute("src");
    expect(source).toContain('import settingsIcon from "../../img/SettingsBlack.svg";');
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

    await user.click(button);
    await user.click(screen.getByRole("menuitemradio", { name: "Тёмная" }));

    expect(button).toHaveAttribute("data-theme-id", "graphite");
    expect(button).toHaveAttribute("aria-label", expect.stringContaining("Сейчас Тёмная"));
    expect(document.documentElement.dataset.theme).toBe("graphite");
    expect(window.localStorage.getItem(THEME_STORAGE_KEY)).toBe("graphite");
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

  it("keeps the saved theme until an authenticated application enables it", () => {
    window.localStorage.setItem(THEME_STORAGE_KEY, "graphite");

    const { rerender } = render(
      <ThemeProvider isThemeApplied={false}>
        <ThemeCycleButton />
      </ThemeProvider>,
    );

    expect(document.documentElement.dataset.theme).toBeUndefined();
    expect(window.localStorage.getItem(THEME_STORAGE_KEY)).toBe("graphite");

    rerender(
      <ThemeProvider isThemeApplied>
        <ThemeCycleButton />
      </ThemeProvider>,
    );

    expect(document.documentElement.dataset.theme).toBe("graphite");
  });

  it("opens the footer menu into the page and rotates the settings icon by a half turn", () => {
    const css = readFileSync(join(process.cwd(), "src/app.css"), "utf8");

    expect(css).toMatch(/\.theme-cycle-button-shell\[data-menu-placement="top-right"\]\s+\.theme-cycle-menu\s*\{[^}]*inset:\s*auto auto calc\(100% \+ 10px\) 0;/s);
    expect(css).toMatch(/\.theme-cycle-button\[data-menu-open="true"\]\s+\.theme-cycle-button-icon\s*\{[^}]*transform:\s*rotate\(180deg\);/s);
  });

  it("keeps theme names readable and uses neutral hover layers", () => {
    const css = readFileSync(join(process.cwd(), "src/app.css"), "utf8");

    expect(css).toMatch(/\.theme-cycle-menu-item\s*\{[^}]*color:\s*var\(--theme-text\);/s);
    expect(css).toMatch(/\.theme-cycle-menu-item:hover\s*\{[^}]*background:\s*var\(--theme-surface-light\)\s*!important;[^}]*transform:\s*translateX\(2px\);/s);
    expect(css).toMatch(/\.theme-cycle-menu-item-active\s*\{[^}]*background:\s*var\(--theme-container-high\)\s*!important;[^}]*color:\s*var\(--theme-text\);/s);
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
    const graphiteOption = screen.getByRole("menuitemradio", { name: "Тёмная" });

    expect(sandOption).toHaveStyle("--theme-option-accent: #985036");
    expect(sandOption).toHaveStyle("--theme-option-surface: #e7ddd3");
    expect(skyOption).toHaveStyle("--theme-option-accent: #4863b6");
    expect(skyOption).toHaveStyle("--theme-option-surface: #dde4ed");
    expect(tealOption).toHaveStyle("--theme-option-accent: #277052");
    expect(tealOption).toHaveStyle("--theme-option-surface: #dce8df");
    expect(graphiteOption).toHaveStyle("--theme-option-accent: #f2f2f2");
    expect(graphiteOption).toHaveStyle("--theme-option-surface: #363636");
  });

  it("uses scheme surfaces for nested application panels", () => {
    const css = readFileSync(join(process.cwd(), "src/app.css"), "utf8");
    const surfaceOverrides = css.slice(css.indexOf("Keep every application scheme inside one color temperature"));

    expect(css).toMatch(/:root\[data-theme="sky"\][^{]*\{[^}]*--theme-surface-muted:[^;]+;[^}]*--theme-control-background:[^;]+;/s);
    expect(css).toMatch(/:root\[data-theme="teal"\][^{]*\{[^}]*--theme-surface-muted:[^;]+;[^}]*--theme-control-background:[^;]+;/s);
    expect(css).toMatch(/:root\[data-theme="graphite"\][^{]*\{[^}]*color-scheme:\s*dark;[^}]*--theme-panel-background:\s*#222222;[^}]*--theme-popover-background:\s*#3a3a3a;/s);
    expect(css).toMatch(/:root\[data-theme="sky"\][^{]*\{[^}]*--sidebar-bg:\s*rgba\(237,\s*241,\s*247,\s*0\.98\);[^}]*--theme-form-card-background:\s*#ffffff;/s);
    expect(css).toMatch(/:root\[data-theme="teal"\][^{]*\{[^}]*--sidebar-bg:\s*rgba\(234,\s*241,\s*236,\s*0\.98\);[^}]*--theme-form-card-background:\s*#ffffff;/s);
    expect(css).toMatch(/:root\[data-theme="sky"\][^{]*\{[^}]*--theme-card-background:\s*#fbfcfe;/s);
    expect(css).toMatch(/:root\[data-theme="teal"\][^{]*\{[^}]*--theme-card-background:\s*#fbfdfb;/s);
    expect(surfaceOverrides).toMatch(/\.dashboard-main-card,[^{]+\{[^}]*background:\s*var\(--theme-page-surface\);/s);
    expect(surfaceOverrides).toMatch(/\.dashboard-form-card\s*\{[^}]*background:\s*var\(--theme-form-card-background\);/s);
    expect(surfaceOverrides).toMatch(/\.responses-table th\s*\{[^}]*background:\s*var\(--theme-surface\);/s);
    expect(surfaceOverrides).toMatch(/\.responses-table tbody td\s*\{[^}]*background:\s*var\(--theme-surface-light\);/s);
    expect(css).toMatch(/:root\[data-theme="graphite"\] \.organizations-table tbody td,[^{]+\.users-table tbody td,[^{]+\.responses-page-table-shell \.responses-table tbody td,[^{]+\{[^}]*color:\s*#202020;[^}]*background:\s*#e2e2e2;/s);
    expect(css).toMatch(/:root\[data-theme="graphite"\] \.organizations-table tbody tr:hover td,[^{]+\.users-table tbody tr:hover td,[^{]+\{[^}]*background:\s*#d4d4d4;/s);
    expect(surfaceOverrides).toMatch(/\.dashboard-toolbar input,[^{]+\{[^}]*background:\s*var\(--theme-control-background\);/s);
    expect(surfaceOverrides).toMatch(/\.dashboard-toolbar select option,[^{]+\{[^}]*background:\s*var\(--theme-popover-background\);/s);
    expect(surfaceOverrides).toMatch(/\.dashboard-info-button,[^{]+\{[^}]*background:\s*var\(--theme-surface-light\);/s);
    expect(surfaceOverrides).toMatch(/\.users-page-controls \.app-button,[^{]+button\.responses-report-button:disabled\s*\{[^}]*border-color:\s*var\(--theme-border\);[^}]*background:\s*var\(--theme-control-background\);/s);
    expect(surfaceOverrides).toMatch(/\.dashboard-stats-popover\s*\{[^}]*background:\s*var\(--theme-popover-background\);/s);
    expect(surfaceOverrides).toMatch(/\.dashboard-stats-item span,[^{]+\{[^}]*color:\s*var\(--theme-text\);/s);
    expect(surfaceOverrides).toMatch(/\.form-menu-trigger,[^{]+\{[^}]*border:\s*1px solid var\(--theme-border\);[^}]*background:\s*var\(--theme-surface-light\);/s);
    expect(surfaceOverrides).toMatch(/\.form-menu-trigger:hover,\s*\.form-menu-trigger:focus-visible\s*\{[^}]*transform:\s*translateY\(-2px\);[^}]*box-shadow:\s*0 12px 24px var\(--theme-shadow-color\);/s);
    expect(surfaceOverrides).toMatch(/\.organizations-row-actions \.organization-edit-button,[^{]+\{[^}]*color:\s*var\(--theme-text\);[^}]*background:\s*var\(--theme-surface-light\);/s);
    expect(surfaceOverrides).toMatch(/\.organizations-row-actions \.organization-delete-button,[^{]+\{[^}]*color:\s*#7f1d1d;[^}]*background:\s*rgba\(239,\s*68,\s*68,\s*0\.16\);/s);
    expect(surfaceOverrides).toMatch(/\.theme-cycle-button,[^{]+\{[^}]*border:\s*1px solid var\(--theme-border\);[^}]*background:\s*var\(--theme-surface-light\);/s);
    expect(css).toMatch(/:root\[data-theme="sand"\][^{]*\{[^}]*--creator-toolbar:\s*#fcfaf7;[^}]*--creator-workspace:\s*#e3e0dc;[^}]*--creator-accent:\s*#985036;/s);
    expect(css).toMatch(/:root\[data-theme="sky"\][^{]*\{[^}]*--creator-panel:\s*#f3f5f9;[^}]*--creator-workspace:\s*#e2e6ed;[^}]*--creator-accent:\s*#4863b6;/s);
    expect(css).toMatch(/:root\[data-theme="teal"\][^{]*\{[^}]*--creator-panel:\s*#f1f5f2;[^}]*--creator-workspace:\s*#e0e6e2;[^}]*--creator-accent:\s*#277052;/s);
    expect(css).toMatch(/:root\[data-theme="graphite"\][^{]*\{[^}]*--creator-panel:\s*#303030;[^}]*--creator-workspace:\s*#242424;[^}]*--creator-accent:\s*#f2f2f2;/s);
    expect(css).toMatch(/:root\[data-theme="graphite"\][^{]*\{[^}]*--theme-accent:\s*#f2f2f2;[^}]*--theme-accent-gradient:\s*linear-gradient\(180deg,\s*#ffffff,\s*#e7e7e7\);/s);
    expect(surfaceOverrides).toMatch(/\.builder-creator-shell \.svc-creator\s*\{[^}]*--sjs-primary-backcolor:\s*var\(--creator-accent\)\s*!important;[^}]*--sjs-general-backcolor:\s*var\(--creator-control\)\s*!important;[^}]*--ctr-surface-background-color:\s*var\(--creator-workspace\)\s*!important;/s);
    expect(surfaceOverrides).toMatch(/\.builder-creator-shell \.svc-tabbed-menu\s*\{[^}]*background:\s*var\(--creator-toolbar\)\s*!important;/s);
    expect(surfaceOverrides).toMatch(/\.builder-creator-shell \.svc-side-bar,[^{]+\{[^}]*background:\s*var\(--creator-panel\)\s*!important;/s);
    expect(surfaceOverrides).toMatch(/\.builder-creator-shell svc-tab-designer,[^{]+\{[^}]*background:\s*var\(--creator-workspace\)\s*!important;/s);
    expect(creatorThemes.graphite.isLight).toBe(false);
    expect(themes.graphite.survey.colorPalette).toBe("dark");
    expect(themes.graphite.survey.cssVariables?.["--sjs-font-pagetitle-color"]).toBe("#f5f5f5");
    expect(themes.graphite.survey.cssVariables?.["--sjs-editor-background"]).toBe("#2c2c2c");
  });
});
