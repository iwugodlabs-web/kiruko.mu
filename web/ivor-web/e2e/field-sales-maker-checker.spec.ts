import { test, expect, request, type Page } from "@playwright/test";

/**
 * End-to-end maker-checker walk for the Field Sales admin, driving the real UI
 * with two *different* admins:
 *
 *   1. owner flips the maker-checker toggle on (header control);
 *   2. owner creates a plan + a price — both land `pending`;
 *   3. owner's own Activate/Approve is refused (segregation of duties);
 *   4. a second admin activates the plan and approves the price in the UI.
 *
 * Assertions are on the *HTTP responses the UI triggers* (deterministic) plus
 * structural UI state, not on transient toasts. Company 3 (demo) must have
 * >= 2 active admins; the flag and rows created here are restored at the end.
 */

const BASE = process.env.E2E_BASE_URL ?? "http://localhost:3000";
const CID = Number(process.env.E2E_COMPANY_ID ?? 3);

const OWNER = {
  id: process.env.E2E_OWNER_USER ?? "ivortanyan@gmail.com",
  pw: process.env.E2E_OWNER_PASSWORD ?? "password",
};
const CHECKER = {
  id: process.env.E2E_CHECKER_USER ?? "mc-e2e-admin@kiruko.mu",
  pw: process.env.E2E_CHECKER_PASSWORD ?? "e2e-Test-Pass-1234",
};

type Creds = { id: string; pw: string };

async function login(creds: Creds) {
  const ctx = await request.newContext({ baseURL: BASE });
  const res = await ctx.post("/api/v1/user/login", {
    headers: { "X-Client-Platform": "web" },
    data: { identifier: creds.id, password: creds.pw },
  });
  if (!res.ok()) throw new Error(`login failed for ${creds.id} (${res.status()})`);
  const json = (await res.json()) as { access_token: string };
  const state = (await ctx.storageState()) as {
    cookies: unknown[];
    origins: Array<{ origin: string; localStorage: Array<{ name: string; value: string }> }>;
  };
  await ctx.dispose();
  const extra = [
    { name: "auth_hint", value: "1" },
    { name: "theme", value: "dark" },
  ];
  let origin = state.origins.find((o) => o.origin === BASE);
  if (!origin) {
    origin = { origin: BASE, localStorage: [] };
    state.origins.push(origin);
  }
  origin.localStorage = [
    ...origin.localStorage.filter((e) => !extra.some((x) => x.name === e.name)),
    ...extra,
  ];
  return { token: json.access_token, state };
}

async function api(token: string, method: string, path: string, data?: unknown) {
  const ctx = await request.newContext({
    baseURL: BASE,
    extraHTTPHeaders: { Authorization: `Bearer ${token}` },
  });
  const res = await ctx.fetch(path, { method, data: data as never });
  const status = res.status();
  const json = await res.json().catch(() => null);
  await ctx.dispose();
  return { status, json };
}

/** POST/activate/etc. URL match for the response the UI fires. */
function resp(page: Page, urlPart: string) {
  return page.waitForResponse(
    (r) => r.url().includes(urlPart) && ["POST", "PUT", "PATCH", "DELETE"].includes(r.request().method()),
  );
}

test("maker-checker: pending plan/price approved by a second admin", async ({ browser }) => {
  test.setTimeout(120_000);
  const owner = await login(OWNER);
  const checker = await login(CHECKER);

  const base = `/api/v1/companies/${CID}`;
  const initial = (await api(owner.token, "GET", `${base}/field-sales/settings`)).json as {
    maker_checker: boolean;
  };
  const initialFlag = initial.maker_checker;

  // Deterministic start: maker-checker OFF.
  await api(owner.token, "PUT", `${base}/field-sales/settings`, { maker_checker: false });

  const stamp = Date.now();
  const planName = `MC E2E ${stamp}`;
  const sku = `MCE2E${String(stamp).slice(-6)}`;
  const productName = `MC E2E Product ${sku}`;
  let planId: number | undefined;
  let productId: number | undefined;

  const ownerCtx = await browser.newContext({ baseURL: BASE, colorScheme: "dark", storageState: owner.state as never });
  const checkerCtx = await browser.newContext({ baseURL: BASE, colorScheme: "dark", storageState: checker.state as never });
  const ownerPage = await ownerCtx.newPage();
  const checkerPage = await checkerCtx.newPage();

  try {
    // 1. Owner flips the toggle on via the UI.
    await ownerPage.goto("/dashboard/field-sales");
    await expect(ownerPage.getByRole("heading", { name: "Field Sales & Commissions" })).toBeVisible();

    const toggle = ownerPage.locator('label:has-text("Maker-checker") input[type="checkbox"]');
    await expect(toggle).toBeEnabled();
    await expect(toggle).not.toBeChecked();

    const putSettings = resp(ownerPage, "/field-sales/settings");
    await toggle.click();
    expect((await putSettings).status()).toBe(200);
    await expect(toggle).toBeChecked();
    expect(((await api(owner.token, "GET", `${base}/field-sales/settings`)).json as { maker_checker: boolean }).maker_checker).toBe(true);

    // 2. Plan created by the owner lands pending.
    const plan = await api(owner.token, "POST", `${base}/commission-plans`, {
      name: planName,
      trigger: "on_sale",
      rules: [{ rule_type: "flat_percent", params: { percent: "3.00" } }],
    });
    expect(plan.status).toBe(201);
    expect((plan.json as { status: string }).status).toBe("pending");
    planId = (plan.json as { id: number }).id;

    await ownerPage.locator('button[title="Step 2: Plans"]').click();
    const ownerRow = ownerPage.locator("li").filter({ hasText: planName }).first();
    await expect(ownerRow).toBeVisible();
    await expect(ownerRow.getByText("pending")).toBeVisible();
    await ownerRow.getByRole("button", { name: /Versions/ }).click();
    await expect(ownerPage.getByText(/different admin/)).toBeVisible();

    // 3. Self-activation refused (UI fires the call -> 403).
    const selfActivate = resp(ownerPage, `/commission-plans/${planId}/activate`);
    await ownerPage.getByRole("button", { name: /Activate/ }).first().click();
    expect((await selfActivate).status()).toBe(403);
    await expect(ownerPage.getByRole("button", { name: /Activate/ }).first()).toBeVisible();

    // 4. Second admin activates it via the UI.
    await checkerPage.goto("/dashboard/field-sales");
    await checkerPage.locator('button[title="Step 2: Plans"]').click();
    const checkerRow = checkerPage.locator("li").filter({ hasText: planName }).first();
    await checkerRow.getByRole("button", { name: /Versions/ }).click();
    const checkerActivate = resp(checkerPage, `/commission-plans/${planId}/activate`);
    await checkerPage.getByRole("button", { name: /Activate/ }).first().click();
    expect((await checkerActivate).status()).toBe(200);
    await expect(checkerPage.getByRole("button", { name: /Activate/ })).toHaveCount(0);

    // 5. Price created by the owner lands pending.
    const product = await api(owner.token, "POST", `${base}/products`, {
      name: productName,
      category: "Beverages",
      default_variant: { sku, unit_price: "100.00" },
    });
    expect(product.status).toBe(201);
    productId = (product.json as { id: number }).id;
    const variantId = (product.json as { variants: Array<{ id: number }> }).variants[0].id;

    const price = await api(owner.token, "POST", `${base}/product-prices`, {
      variant_id: variantId,
      amount: "50.00",
      effective_from: "2026-11-01",
    });
    expect(price.status).toBe(201);
    expect((price.json as { status: string }).status).toBe("pending");
    const priceId = (price.json as { id: number }).id;

    await ownerPage.locator('button[title="Step 1: Catalog"]').click();
    await ownerPage.getByPlaceholder("Search products or SKU…").fill(sku);
    await ownerPage.locator('button[title="Effective-dated prices"]').first().click();
    await expect(ownerPage.getByText("pending", { exact: true })).toBeVisible();

    // 6. Self-approval refused, then the second admin approves.
    const selfApprove = resp(ownerPage, `/product-prices/${priceId}/approve`);
    await ownerPage.getByRole("button", { name: "Approve" }).click();
    expect((await selfApprove).status()).toBe(403);
    await ownerPage.locator('button[aria-label="Close"]').click({ position: { x: 5, y: 5 } });

    await checkerPage.locator('button[title="Step 1: Catalog"]').click();
    await checkerPage.getByPlaceholder("Search products or SKU…").fill(sku);
    await checkerPage.locator('button[title="Effective-dated prices"]').first().click();
    const checkerApprove = resp(checkerPage, `/product-prices/${priceId}/approve`);
    await checkerPage.getByRole("button", { name: "Approve" }).click();
    expect((await checkerApprove).status()).toBe(200);
    await expect(checkerPage.getByRole("button", { name: "Approve" })).toHaveCount(0);
  } finally {
    if (planId) await api(owner.token, "POST", `${base}/commission-plans/${planId}/archive`);
    if (productId) await api(owner.token, "DELETE", `${base}/products/${productId}`);
    await api(owner.token, "PUT", `${base}/field-sales/settings`, { maker_checker: initialFlag });
    await ownerCtx.close();
    await checkerCtx.close();
  }
});
