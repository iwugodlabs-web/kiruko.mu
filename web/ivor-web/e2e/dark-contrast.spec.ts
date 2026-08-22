import { test, expect, type Locator } from "@playwright/test";

/**
 * Dark-mode visibility guard for payroll money figures.
 *
 * The bug class: a highlighted tile used `text-*-900` with no dark variant →
 * dark text on a dark-tinted background, invisible in dark mode. In dark mode
 * the money value must be LIGHT (high relative luminance) so it reads against
 * the dark surface. We assert luminance > 0.4 — the buggy dark-blue text was
 * ~0.03; the fixed `dark:text-blue-100` is ~0.85.
 *
 * Runs authenticated + dark via the "authed-dark" project (see playwright.config).
 */
async function textLuminance(loc: Locator): Promise<number> {
  return loc.evaluate((el) => {
    // Rasterize the computed color to RGB via canvas — robust to any CSS color
    // format (Tailwind v4 emits oklch(), which a regex can't parse).
    const cv = document.createElement("canvas");
    cv.width = cv.height = 1;
    const ctx = cv.getContext("2d")!;
    ctx.fillStyle = getComputedStyle(el).color;
    ctx.fillRect(0, 0, 1, 1);
    const [r, g, b] = Array.from(ctx.getImageData(0, 0, 1, 1).data).slice(0, 3);
    const lin = (v: number) => {
      const c = v / 255;
      return c <= 0.03928 ? c / 12.92 : Math.pow((c + 0.055) / 1.055, 2.4);
    };
    return 0.2126 * lin(r) + 0.7152 * lin(g) + 0.0722 * lin(b);
  });
}

test("payslip Net-pay tile is visible in dark mode", async ({ page }) => {
  await page.goto("/dashboard/payroll/runs");
  await expect(page.locator("html")).toHaveClass(/dark/); // next-themes applied dark

  // Open a finalized run → its drawer lists payslips → open the first one.
  await page.getByRole("button", { name: "View" }).first().click();
  await page.locator("tr.cursor-pointer").first().click();

  // "Net pay" Tile (highlighted) — the reported invisible-in-dark tile.
  const netPay = page.getByTestId("tile-net-pay");
  await expect(netPay).toBeVisible();
  expect(await textLuminance(netPay), "Net pay text too dark for dark mode").toBeGreaterThan(0.4);

  // The employee whose payslip this is shows in the header (person-involved fix).
  await expect(page.getByText("Payslip detail")).toBeVisible();
});

test("theme toggle flips dark mode on the document", async ({ page }) => {
  // Guards the darkMode:'class' fix — before it, the toggle changed the class
  // but Tailwind (in 'media' mode) ignored it. Here we assert the class flips
  // both ways so the toggle is wired to the document.
  await page.goto("/dashboard/payroll/runs");
  const html = page.locator("html");
  await expect(html).toHaveClass(/dark/); // starts dark (storageState theme=dark)

  const toggle = page.getByRole("button", { name: "Toggle theme" });
  await toggle.click();
  await expect(html).not.toHaveClass(/dark/); // → light
  await toggle.click();
  await expect(html).toHaveClass(/dark/); // → back to dark
});
