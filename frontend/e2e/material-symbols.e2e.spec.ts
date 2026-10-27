import { expect, test } from "@playwright/test";
import symbols from "../src/shared/ui/materialSymbols.json";
import { openSurveyApp } from "./fixtures/surveyApp";

for (const theme of ["sand", "graphite"]) {
  test(`${theme}: local Material Symbols render real glyphs and animate selection`, async ({ page }, testInfo) => {
    await page.setViewportSize({ width: 1440, height: 1000 });
    await page.addInitScript(id => localStorage.setItem("survey-app:theme", id), theme);
    const remoteFonts: string[] = [];
    const fontResponses: Array<{ url: string; status: number }> = [];
    page.on("request", request => {
      if (/fonts\.(?:googleapis|gstatic)\.com/.test(request.url())) remoteFonts.push(request.url());
    });
    page.on("response", response => {
      if (response.url().endsWith(".woff2")) fontResponses.push({ url: response.url(), status: response.status() });
    });
    const app = await openSurveyApp(page, { responseCount: 0 });
    await page.evaluate(() => document.fonts.ready);
    expect(fontResponses.filter(font => font.url.includes("material-symbols-outlined"))).toHaveLength(1);
    expect(fontResponses.some(font => font.url.includes("roboto-cyrillic-normal"))).toBe(true);
    expect(fontResponses.some(font => font.url.includes("roboto-latin-normal"))).toBe(true);
    for (const font of fontResponses) {
      expect(font.status).toBe(200);
      expect(new URL(font.url).origin).toBe(new URL(page.url()).origin);
    }
    expect(remoteFonts).toEqual([]);
    expect(await page.locator(".dashboard-page-header h1").evaluate(el => getComputedStyle(el).fontFamily)).toContain("Roboto");

    // Check every supported codepoint against Chrome's actual font renderer,
    // not just document.fonts.check(), which also accepts fallback glyphs.
    await page.evaluate(map => {
      const board = document.createElement("div");
      board.id = "icon-font-probe";
      board.style.cssText = "position:fixed;inset:20px;z-index:9999;display:grid;grid-template-columns:repeat(7,1fr);align-content:start;gap:18px;padding:24px;background:var(--theme-card-background);color:var(--theme-text)";
      for (const [name, codepoint] of Object.entries(map)) {
        const cell = document.createElement("div");
        const glyph = document.createElement("span");
        glyph.className = "material-symbols-outlined";
        glyph.dataset.icon = name;
        glyph.style.cssText = "--icon-size:24px;--icon-optical-size:24";
        glyph.textContent = String.fromCodePoint(Number.parseInt(codepoint, 16));
        const label = document.createElement("div");
        label.style.cssText = "font:12px var(--app-font-family);margin-top:8px";
        label.textContent = name;
        cell.append(glyph, label); board.append(cell);
      }
      document.body.append(board);
    }, symbols);
    const cdp = await page.context().newCDPSession(page);
    try {
      await cdp.send("DOM.enable");
      await cdp.send("CSS.enable");
      const { root } = await cdp.send("DOM.getDocument");
      const heading = await cdp.send("DOM.querySelector", { nodeId: root.nodeId, selector: ".dashboard-page-header h1" });
      const actualText = await cdp.send("CSS.getPlatformFontsForNode", { nodeId: heading.nodeId });
      expect(actualText.fonts.length).toBeGreaterThan(0);
      for (const font of actualText.fonts) expect(font).toMatchObject({ familyName: "Roboto", isCustomFont: true });
      const { nodeIds } = await cdp.send("DOM.querySelectorAll", { nodeId: root.nodeId, selector: "#icon-font-probe .material-symbols-outlined" });
      expect(nodeIds).toHaveLength(Object.keys(symbols).length);
      for (const nodeId of nodeIds) {
        const { fonts } = await cdp.send("CSS.getPlatformFontsForNode", { nodeId });
        expect(fonts, `Missing official glyph at DOM node ${nodeId}`).toEqual([
          expect.objectContaining({ familyName: "Material Symbols Outlined", isCustomFont: true, glyphCount: 1 }),
        ]);
      }
    } finally { await cdp.detach(); }
    await page.locator("#icon-font-probe").screenshot({ path: testInfo.outputPath(`glyphs-${theme}.png`) });
    await page.locator("#icon-font-probe").evaluate(el => el.remove());

    await page.getByRole("link", { name: "Все формы", exact: true }).click();
    const folder = page.getByRole("link", { name: "Мои формы", exact: true }).locator('[data-icon="folder"]');
    await expect(folder).toHaveAttribute("aria-hidden", "true");
    await expect.poll(() => folder.evaluate(el => getComputedStyle(el).fontVariationSettings)).toContain('"FILL" 0');
    const fills = await folder.evaluate(async el => {
      const values: number[] = [];
      el.closest<HTMLAnchorElement>("a")!.click();
      for (let frame = 0; frame < 15; frame++) {
        await new Promise(requestAnimationFrame);
        values.push(Number(getComputedStyle(el).fontVariationSettings.match(/"FILL" ([\d.]+)/)?.[1]));
      }
      return values;
    });
    expect(fills.some(value => value > 0 && value < 1)).toBe(true);
    expect(fills.at(-1)).toBe(1);

    const template = { ...app.form, id: "40000000-0000-4000-8000-000000000001", title: "Шаблон проверки", form_type: "template" };
    await page.route("**/list_forms_keyset*", route => route.fulfill({ json: [template] }));
    await page.route("**/rest/v1/forms?*", route => route.fulfill({ json: template }));
    await page.goto("/templates");
    const pin = page.getByRole("button", { name: "Закрепить шаблон Шаблон проверки", exact: true });
    await expect(pin).toHaveAttribute("aria-pressed", "false");
    await pin.click();
    const pinned = page.getByRole("button", { name: "Открепить шаблон Шаблон проверки", exact: true });
    await expect(pinned).toHaveAttribute("aria-pressed", "true");
    await expect.poll(() => pinned.locator('[data-icon="bookmark"]').evaluate(el => getComputedStyle(el).fontVariationSettings)).toContain('"FILL" 1');
    await page.screenshot({ path: testInfo.outputPath(`templates-${theme}.png`) });
    await page.emulateMedia({ reducedMotion: "reduce" });
    expect(await pinned.locator('[data-icon="bookmark"]').evaluate(el => Number.parseFloat(getComputedStyle(el).transitionDuration))).toBeLessThanOrEqual(.00001);
    expect(app.pageErrors).toEqual([]);
    expect(remoteFonts).toEqual([]);
  });
}
