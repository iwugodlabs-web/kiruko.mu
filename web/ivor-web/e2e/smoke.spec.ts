import { test, expect } from "@playwright/test";

/**
 * Smoke tests — catch build/runtime breakage and the auth guard without needing
 * credentials. These run unauthenticated; deeper flows (payslip drawer naming,
 * Start-payroll wizard staying open) need a logged-in storageState — see
 * playwright.config.ts. Adding those is the natural next step.
 */
test.describe("smoke", () => {
  test("login page renders", async ({ page }) => {
    await page.goto("/");
    // App shell compiled + rendered: the login form is present.
    await expect(page.locator('input[type="password"]')).toBeVisible();
  });

  test("protected route bounces unauthenticated users to login", async ({ page }) => {
    await page.goto("/dashboard/payroll/runs");
    await expect(page).toHaveURL(/localhost:3000\/?$/); // redirected to the landing/login
    await expect(page.locator('input[type="password"]')).toBeVisible();
  });
});
