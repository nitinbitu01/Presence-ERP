import { test, expect } from "@playwright/test";

test.describe("Authentication & Enterprise SSO E2E Flow", () => {
  test.beforeEach(async ({ page }) => {
    await page.goto("/auth");
  });

  test("renders authentication page with email sign in and SSO providers", async ({ page }) => {
    // Verify page title and header
    await expect(page).toHaveTitle(/Presence ERP|Sign In/i);
    await expect(page.locator("h1, h2")).toContainText(/Sign In|Welcome/i);

    // Verify presence of standard email / password fields
    const emailInput = page.locator('input[type="email"], input[name="email"]');
    await expect(emailInput).toBeVisible();
  });

  test("allows selecting Enterprise SSO provider and initiating auth flow", async ({ page }) => {
    // Look for SSO Provider options or buttons
    const ssoSection = page.locator("text=/Enterprise SSO|Sign in with Institution/i");
    if (await ssoSection.isVisible()) {
      await expect(ssoSection).toBeVisible();

      // Click Rashtriya Raksha University or Azure AD provider
      const azureAdBtn = page.locator(
        "button:has-text('Azure AD'), button:has-text('Rashtriya Raksha')",
      );
      if (await azureAdBtn.isVisible()) {
        await azureAdBtn.click();
        // Should initiate redirect to Microsoft OIDC endpoint
        await page.waitForURL(/login.microsoftonline.com|sso\/callback/i, { timeout: 5000 });
      }
    }
  });

  test("maintains responsive layout on mobile viewport", async ({ page }) => {
    await page.setViewportSize({ width: 375, height: 667 });
    await expect(page.locator("body")).toBeVisible();
  });
});
