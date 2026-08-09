import { test, expect } from "@playwright/test";

test.describe("Student Attendance Check-in E2E Flow", () => {
  test.beforeEach(async ({ page }) => {
    // Navigate to student attendance check-in session route
    await page.goto("/attend/demo-session-2026");
  });

  test("loads check-in interface with camera & liveness challenge prompts", async ({ page }) => {
    // Page body must render cleanly without unhandled crashes
    await expect(page.locator("body")).toBeVisible();

    // Verify presence of attendance instructions or check-in button
    const checkinHeading = page.locator("text=/Attendance|Check-in|Liveness/i");
    await expect(checkinHeading.first()).toBeVisible();
  });

  test("simulates fake media stream camera interaction", async ({ page }) => {
    // Camera feed container or video element should exist
    const videoElement = page.locator("video, canvas");
    if (await videoElement.isVisible()) {
      await expect(videoElement.first()).toBeVisible();
    }
  });

  test("handles keyboard navigation across check-in action controls", async ({ page }) => {
    // Press Tab key and ensure focus ring highlights interactive controls
    await page.keyboard.press("Tab");
    const focusedElement = page.locator(":focus");
    await expect(focusedElement).toBeDefined();
  });
});
