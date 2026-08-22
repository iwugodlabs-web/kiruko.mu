# RLS Production Flip — Runbook

How to turn on Row-Level Security enforcement in production. Everything is built,
deployed (via migrations), and validated locally; this is the deliberate,
reversible "turn it on" step.

> **Mental model.** The RLS policies are guards posted at every tenant table, but
> they only stop a connection that *can't* bypass them. Today the app connects
> with a **bypass-capable** account, so the guards wave it through (dormant). The
> flip = switch the app to connect as **`kiruko_app`** (NOBYPASSRLS). The instant
> it does, the per-request `app.company_id` / `app.private_user_id` the app
> already sets makes the guards enforce. **There is no flag** — it's purely which
> DB account the app logs in as. (An earlier plan mentioned an `app.rls_enabled`
> kill-switch; that design was dropped — ignore it.)

---

## 0. Pre-flight checks (verify only — change nothing)

Run as the DB **owner/admin** account (e.g. `doadmin`) in the DO console:

```sql
-- (a) migrations are fully applied (head should be rls_april_tables_fix or later)
SELECT version_num FROM alembic_version;

-- (b) RLS coverage is complete: expect ~39 rows, and the 2nd query MUST be empty
SELECT count(*) AS rls_tables
FROM pg_class WHERE relrowsecurity AND relkind='r' AND relnamespace='public'::regnamespace;

SELECT c.relname AS deny_all_tables          -- must return ZERO rows
FROM pg_class c
WHERE c.relrowsecurity AND c.relkind='r' AND c.relnamespace='public'::regnamespace
  AND NOT EXISTS (SELECT 1 FROM pg_policy p WHERE p.polrelid=c.oid);

-- (c) kiruko_app exists and HAS grants (must be true)
SELECT has_table_privilege('kiruko_app','users','SELECT'),
       has_table_privilege('kiruko_app','payslips','SELECT');

-- (d) what the app connects as TODAY — confirm it currently bypasses (dormant)
SELECT current_user, rolsuper, rolbypassrls
FROM pg_roles WHERE rolname = current_user;

-- (e) the super admin can bypass RLS (platform_admin -> '*')
SELECT 1 FROM users u
  JOIN user_platform_roles upr ON upr.user_id=u.user_id
  JOIN platform_roles pr ON pr.role_id=upr.role_id
WHERE u.email='iwugodlabs@gmail.com' AND pr.name='platform_admin';
```

**Do not proceed unless:** head is at/after `rls_april_tables_fix`, `deny_all_tables`
is empty, `has_table_privilege` is `t`/`t`, and (e) returns a row. If `deny_all_tables`
is non-empty, a table would refuse ALL rows — stop and fix first.

---

## 1. Give `kiruko_app` a login — via the seeder (automated)

`kiruko_app` is `NOLOGIN` by design. Connect the app **directly** as it — do **not**
use a separate member role (Postgres 15 membership-inheritance was unreliable in
testing; `kiruko_app` holds the grants directly).

This is handled by a **seeder** (same pattern as the super-admin seeder — the
password comes from env, never the repo). Set **one secret** in DO:

```
KIRUKO_APP_PASSWORD = <a-strong-secret>
```

…and `scripts/seed_all.py` (run in your owner-connected migrate+seed phase) will
`ALTER ROLE kiruko_app LOGIN PASSWORD <that secret>` for you — idempotent, and a
no-op while the var is unset (so it's safe to ship before you flip). Or run it
directly: `KIRUKO_APP_PASSWORD=… python3 backend/scripts/seed_kiruko_app_role.py`.

> Must run as the **owner** (`doadmin`): granting LOGIN needs CREATEROLE. That's
> why it lives in the migrate+seed phase, before the runtime switches in Stage 2.
> The plain manual equivalent is `ALTER ROLE kiruko_app LOGIN PASSWORD '…';`.

---

## 2. Keep migrations on the owner; point only the RUNTIME at `kiruko_app`

⚠️ **Migrations must keep running as the owner** (`doadmin`). `kiruko_app` is not a
table owner and **cannot** `ALTER TABLE` / `CREATE POLICY`, so if your deploy runs
`alembic upgrade head` on the runtime URL it will break.

- If the deploy's migration step and the app share one `DATABASE_URL`: add a
  separate **`MIGRATION_DATABASE_URL`** (owner) for the migration job, or run
  migrations as a one-off owner job, **before** switching the runtime URL.
- Then set the **runtime** `DATABASE_URL` to the restricted role:

```
DATABASE_URL = postgresql://kiruko_app:<secret>@<host>:25060/<db>?sslmode=require
```

Redeploy / restart the backend so the connection pool reconnects as `kiruko_app`.
Enforcement is now **live**.

> DO managed pool: if you use it, transaction mode is fine — the per-request tenant
> uses `SET LOCAL`, which is pool-safe.

---

## 3. Validate (5 minutes)

- **Normal company user** logs in → sees only their own company's employees /
  payroll / payslips / documents. Nothing from another company.
- **Super admin** (`iwugodlabs@gmail.com`) logs in → sees everything (RLS `'*'`
  bypass via `platform_admin`).
- **Smoke the core flows:** dashboard, employee list, a payroll run, leave, the
  worker's personal-finance screens. No "permission denied" and no empty-where-data
  -should-be.
- Spot-check a worker's personal finance is **not** visible to their employer.

If anything looks wrong → **roll back immediately** (next section), then diagnose.

---

## 4. Rollback (instant, reversible)

Point the runtime back at the owner account and redeploy:

```
DATABASE_URL = postgresql://doadmin:<secret>@<host>:25060/<db>?sslmode=require
```

The app is bypass-capable again; RLS is dormant. Nothing else to undo. (Optionally
`ALTER ROLE kiruko_app NOLOGIN;` to re-lock the role.)

---

## 5. Things to know after the flip

- **Re-login required for personal finance.** Access tokens issued *before* this
  deploy don't carry the `private_user_id` claim, so a worker's loans/budget/etc.
  (person-scoped, no permissive-unset) stay hidden until they log in again. Fine
  for the pilot; everyone re-authenticates.
- **Background jobs / crons are safe** — audited. Company-scoped policies are
  permissive when no tenant is set, so system jobs that span all companies work;
  the two that touch sensitive data already use `bypass_tenant_guard`.
- **Deferred — company/employer-loan visibility.** Loans are personal/private now.
  When that feature is built, `payroll_engine` (which reads `loan_type='employer'`
  loans) will need `bypass_tenant_guard` or an admin-gated branch; until then there
  are no employer loans, so nothing breaks.
- **New tables:** any future tenant table needs its own policy + `ENABLE/FORCE RLS`
  in its migration, and (because of default privileges) `kiruko_app` is granted
  automatically. Re-run the §0 `deny_all_tables` check after big migrations.
```
