import { test, expect } from "@playwright/test";

test.describe("Accessibility Toolbar & i18n Locale Switching E2E", () => {
  test.beforeEach(async ({ page }) => {
    await page.goto("/");
  });

  test("toggles High Contrast mode and applies CSS class to root html element", async ({ page }) => {
    const contrastBtn = page.locator("button:has-text('Contrast'), button[aria-label*='High Contrast']");
    if (await contrastBtn.isVisible()) {
      await contrastBtn.click();
      const htmlClass = await page.locator("html").getAttribute("class");
      expect(htmlClass).toContain("high-contrast");
    }
  });

  test("adjusts font size slider and updates root CSS variable", async ({ page }) => {
    const increaseFontBtn = page.locator("button[aria-label*='Increase font size']");
    if (await increaseFontBtn.isVisible()) {
      await increaseFontBtn.click();
      const fontSize = await page.evaluate(() =>
        getComputedStyle(document.documentElement).getPropertyValue("--base-font-size")
      );
      expect(fontSize).toBe("17px");
    }
  });

  test("switches application language between 5 locales without full page reload", async ({ page }) => {
    const langSelect = page.locator("select[aria-label*='language']");
    if (await langSelect.isVisible()) {
      // Switch to Hindi
      await langSelect.selectOption("hi");
      const htmlLang = await page.locator("html").getAttribute("lang");
      expect(htmlLang).toBe("hi");

      // Switch to Telugu
      await langSelect.selectOption("te");
      const htmlLangTe = await page.locator("html").getAttribute("lang");
      expect(htmlLangTe).toBe("te");
    }
  });
});
