import { request, type FullConfig } from "@playwright/test";
import { writeFileSync, mkdirSync } from "fs";
import { dirname } from "path";

/**
 * Logs in via the real /api/v1/user/login (same endpoint the app uses) to
 * capture the auth cookies, then writes a storageState that also forces
 * next-themes into dark mode. Authenticated specs reuse this (see the
 * "authed-dark" project in playwright.config.ts).
 *
 * Credentials come from env with a local-dev default (the seeded ABC PLC admin).
 * Provision with: UPDATE users SET password_hash=... (see scripts).
 */
export const AUTH_DARK_STATE = "e2e/.auth/dark.json";

export default async function globalSetup(_config: FullConfig) {
  const base = process.env.E2E_BASE_URL ?? "http://localhost:3000";
  const identifier = process.env.E2E_USER ?? "iwugodjoshua+test2@gmail.com";
  const password = process.env.E2E_PASSWORD ?? "e2e-Test-Pass-1234";

  const ctx = await request.newContext({ baseURL: base });
  const res = await ctx.post("/api/v1/user/login", {
    headers: { "X-Client-Platform": "web" },
    data: { identifier, password },
  });
  if (!res.ok()) {
    throw new Error(`e2e login failed (${res.status()}): ${await res.text()}`);
  }

  const state = await ctx.storageState();
  await ctx.dispose();

  // The app's AuthContext gates on a client-side `auth_hint` localStorage flag
  // (set on real login); without it the client redirects to /login even with a
  // valid cookie. Also force dark mode (next-themes reads localStorage 'theme').
  const extra = [
    { name: "auth_hint", value: "1" },
    { name: "theme", value: "dark" },
  ];
  const origin = state.origins.find((o) => o.origin === base);
  if (origin) {
    const keep = origin.localStorage.filter((e) => !extra.some((x) => x.name === e.name));
    origin.localStorage = [...keep, ...extra];
  } else {
    state.origins.push({ origin: base, localStorage: extra });
  }

  mkdirSync(dirname(AUTH_DARK_STATE), { recursive: true });
  writeFileSync(AUTH_DARK_STATE, JSON.stringify(state, null, 2));
}
