import { defineConfig, devices } from "@playwright/test";
import { AUTH_DARK_STATE } from "./e2e/global-setup";

/**
 * Playwright config for the web app's smoke + dark-mode contrast tests.
 *
 * Reuses a dev server already running on :3000 (starts one if absent). The
 * `authed-dark` project logs in once (global-setup) and runs in dark mode, so
 * it can assert that money figures are actually visible — the regression guard
 * for the text-*-900-without-dark-variant bugs. The backend must be running for
 * the authed project (login hits /api/v1/user/login).
 */
export default defineConfig({
  testDir: "./e2e",
  timeout: 30_000,
  expect: { timeout: 10_000 },
  fullyParallel: true,
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 1 : 0,
  reporter: "list",
  globalSetup: "./e2e/global-setup.ts",
  use: {
    baseURL: process.env.E2E_BASE_URL ?? "http://localhost:3000",
    trace: "on-first-retry",
  },
  projects: [
    {
      name: "smoke",
      testMatch: /smoke\.spec\.ts/,
      use: { ...devices["Desktop Chrome"] },
    },
    {
      name: "authed-dark",
      testMatch: /dark-contrast\.spec\.ts/,
      use: {
        ...devices["Desktop Chrome"],
        colorScheme: "dark",
        storageState: AUTH_DARK_STATE,
      },
    },
  ],
  webServer: {
    command: "npm run dev",
    url: "http://localhost:3000",
    reuseExistingServer: true,
    timeout: 120_000,
  },
});
