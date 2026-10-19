import { test, expect } from "@playwright/test";

/**
 * Smoke guard for the Field Sales web admin (batch-2 UI).
 *
 * The regression class this catches: a runtime error in the Sales tab leaves
 * the page blank (the "broken page" we shipped once). It asserts the tab
 * renders and the new controls — manual entry, filters, export, bulk review,
 * clawback/ERP adjustments — are present. Runs authenticated via the
 * "authed-dark" project as a company owner whose company has field_sales on
 * (E2E_USER/E2E_PASSWORD env; see global-setup).
 */
test("field-sales Sales tab renders the new controls without runtime errors", async ({ page }) => {
  const errors: string[] = [];
  page.on("pageerror", (e) => errors.push(e.message));

  await page.goto("/dashboard/field-sales");
  await expect(page.getByRole("heading", { name: "Field Sales & Commissions" })).toBeVisible();

  await page.locator('button[title="Step 3: Sales"]').click();

  await expect(page.getByText("Pending approval")).toBeVisible();
  await expect(page.getByRole("button", { name: "Record a sale" })).toBeVisible();
  await expect(page.getByRole("button", { name: "Export CSV" })).toBeVisible();
  await expect(page.getByPlaceholder("Search product or notes…")).toBeVisible();
  await expect(page.getByRole("heading", { name: "Outlets" })).toBeVisible();

  expect(errors, `page threw: ${errors.join("; ")}`).toHaveLength(0);
});

test("field-sales Runs tab exposes adjustments (clawback + ERP reconcile)", async ({ page }) => {
  await page.goto("/dashboard/field-sales");
  await page.locator('button[title="Step 4: Runs"]').click();

  await expect(page.getByText("Adjustments & data sync")).toBeVisible();
  await page.getByText("Adjustments & data sync").click();
  await expect(page.getByRole("heading", { name: "Clawback" })).toBeVisible();
  await expect(page.getByRole("heading", { name: "ERP reconcile" })).toBeVisible();
});
