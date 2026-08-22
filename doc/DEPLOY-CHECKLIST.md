# Production Deploy Checklist (DigitalOcean App Platform)

Run **top to bottom**. Order matters: **env → migrate → deploy → verify**. Skipping
the env step (esp. `RUN_SEEDER`) or the migration ships a broken or data-wiped prod.

> Legend: 🔴 = destructive/breaks launch if wrong · ✅ = already done this session

---

## 1. Backend env vars (DigitalOcean → App → **backend** component → Environment)

- [ ] 🔴 **`RUN_SEEDER`** — UNSET, or `false`. It boots with `drop_tables=True` and **wipes sector data on every deploy**. Verify it is not present/true.
- [ ] 🔴 **`STORAGE_TYPE=s3`** + DO Spaces (App Platform disk is ephemeral — uploads/PDFs vanish on redeploy otherwise):
  - [ ] `AWS_S3_ENDPOINT_URL` = your Spaces endpoint (e.g. `https://blr1.digitaloceanspaces.com`)
  - [ ] `AWS_REGION` = e.g. `blr1`
  - [ ] `S3_BUCKET_NAME` = your Space name
  - [ ] `AWS_ACCESS_KEY_ID` / `AWS_SECRET_ACCESS_KEY` = Spaces keys
- [ ] 🔴 **`POSTGRES_SSLMODE=require`** — code defaults to `disable` (TLS off) on DO.
- [ ] 🔴 **`JWT_SECRET`** = strong (≥16 chars), **byte-for-byte identical to the web component's**. (App now fails closed in prod if missing/weak.)
- [ ] **`ENVIRONMENT=production`** — engages the JWT fail-closed guard + prod settings.
- [ ] **`CORS_ORIGINS=https://app.kiruko.mu,https://kiruko.mu`** — else the web app is CORS-blocked.
- [ ] **`COOKIE_SECURE=true`** — secure auth cookies over HTTPS.
- [ ] ✅ `FRONTEND_URL=https://app.kiruko.mu` (set — claim/invite email links)
- [ ] ✅ Brevo SMTP: `SMTP_HOST`, `SMTP_PORT`, `SMTP_USER`, `SMTP_PASS`, `SMTP_FROM_EMAIL=hello@kiruko.mu` (email confirmed working)
- [ ] `EMAIL_WORKER_ENABLED` not set to `false`.

## 2. Web env vars (App → **web** component → Environment)

- [ ] 🔴 **`JWT_SECRET`** = **same value as backend** (mismatch ⇒ everyone locked out of /dashboard).
- [ ] **`BACKEND_URL=https://api.kiruko.mu`** (https — proxy forwards auth headers).
- [ ] **`NEXT_PUBLIC_SITE_URL=https://app.kiruko.mu`**

## 3. Database migrations (run BEFORE/with the deploy)

Alembic head this session = **`payslip_adj_uq_20260621`** (adds payslip adjustment
columns + relaxed unique index). Without it the **correction features 500 on prod**.

- [ ] Run against the **prod** database (or wire as the app's pre-deploy job):
  ```bash
  cd backend && alembic -c alembic.ini upgrade head
  ```
- [ ] Confirm: `alembic -c alembic.ini current` shows `payslip_adj_uq_20260621`.

## 4. Deploy

- [ ] Confirm `origin/main` is the commit you intend (currently `ce8288be`, suite 603 green).
- [ ] Trigger deploy: App Platform **Deploy** button, or `doctl apps create-deployment <APP_ID>`, or push-to-`main` auto-deploy (Apps → Activity).
- [ ] Watch the build logs to green.

## 5. Smoke test (prod) — the go/no-go

- [ ] **Signup → verify email → login** on `app.kiruko.mu` (proves Brevo + JWT + CORS + cookies).
- [ ] **Import 1 employee** (your own +alias email) → set-up email arrives with an `https://app.kiruko.mu/claim?...` link → claim → login as that worker.
- [ ] Open **Reports → Statutory remittance** for a finalized month → table loads, CSV + PDF download.
- [ ] Open a finalized payroll run → a payslip → confirm it renders (migration applied).

## 6. If something's wrong — rollback

- [ ] App Platform → Activity → **roll back** to the previous deployment.
- [ ] Migrations are additive (new columns/index) — safe to leave; the relaxed unique
      index is backward-compatible with the old code.

---

### One-line summary
**Set env (RUN_SEEDER off!) → `alembic upgrade head` on prod → deploy `main` → smoke-test signup + import + remittance.**
