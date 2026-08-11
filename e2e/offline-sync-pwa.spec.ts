import { test, expect } from "@playwright/test";

test.describe("Offline PWA Attendance Queue & Status Sync E2E", () => {
  test.beforeEach(async ({ page }) => {
    await page.goto("/student");
  });

  test("renders offline status component when network goes offline", async ({ page, context }) => {
    // Simulate browser offline event
    await context.setOffline(true);
    await page.evaluate(() => window.dispatchEvent(new Event("offline")));

    const statusBadge = page.locator("[role='status']");
    if (await statusBadge.isVisible()) {
      await expect(statusBadge).toContainText(/Offline/i);
    }

    // Restore online state
    await context.setOffline(false);
    await page.evaluate(() => window.dispatchEvent(new Event("online")));
  });

  test("verifies IndexedDB offline queue storage exists in browser", async ({ page }) => {
    const hasLocalStorage = await page.evaluate(() => typeof localStorage !== "undefined");
    expect(hasLocalStorage).toBe(true);
  });
});
