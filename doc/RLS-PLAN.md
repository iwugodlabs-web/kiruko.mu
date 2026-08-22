# Postgres Row-Level Security (RLS) — M5b Scope & Plan

**Status:** scoping (not started) · **Author:** scoped 2026-06-24 · **Prereq:** app-layer IDOR closure (batches 1–3) — DONE

## 1. Why (threat model)

The app-layer IDOR fixes (batches 1–3) close every *known* by-id cross-tenant
hole by asserting `company_id` ownership in the route. RLS is the **defence in
depth**: it enforces tenant isolation at the database, so a *future* route that
forgets the check — or a raw query, a background job, an ORM relationship load —
**cannot** read or write another company's rows. It converts tenant isolation
from "every developer must remember" into "the database refuses."

This is the comprehensive version of what `core/tenant_guard.py` does today in
**log mode** (it only warns on unscoped multi-tenant queries; it never blocks).

## 2. Current state (what exists, what's missing)

| Piece | State |
|---|---|
| Tenant identity per request | Python **`ContextVar`** (`core/tenant_context.py`) |
| GUC bridge (ContextVar → `SET LOCAL app.company_id`) | **Already built + installed** — `install_session_listener()` (an `after_begin` hook) is called from `core/config.py:58`. Uses `'*'` as the bypass sentinel. |
| `tenant_guard` SQL listener | Installed, **log mode** (advisory); `raise` mode used in CI |
| App-layer ownership checks | `assert_company_access` / `assert_company_permission` on routes (batches 1–3) |
| RLS policies | **None** |
| DB role | App connects as **`postgres` (superuser)** → superusers **bypass RLS even with FORCE**. Non-owner role is the keystone Phase 0 task. |
| Connection pool | SQLAlchemy `QueuePool` (size 10/50), reused across requests → use `SET LOCAL` (txn-scoped); the installed bridge already does. |

**Verified 2026-06-24** (`tests/integration/test_rls_mechanism.py`, runs against
real Postgres in a rolled-back savepoint): a non-owner role + ENABLE/FORCE RLS +
a GUC-keyed policy isolates perfectly — own company visible, other companies
hidden, cross-company write refused by `WITH CHECK`, `'*'` bypass sees all. The
mechanism is **proven**; the remaining work is coverage + role + policies.

### Two policy-design lessons (already encoded in the test)
1. **Compare the tenant key as TEXT, never cast the GUC to int.** A naive
   `... OR company_id = current_setting('app.company_id')::int` can raise
   *"invalid input syntax for integer: \*"* because Postgres may evaluate the
   cast even when the `= '*'` bypass branch is true. Use
   `company_id::text = current_setting('app.company_id', true)`.
2. The app connecting as **superuser** is the single biggest blocker — RLS is a
   no-op until a non-superuser, non-owner role is in use.

### The real gap: tenant-resolution COVERAGE
The bridge sets `app.company_id` from the ContextVar — but the ContextVar is set
**only** by `require_company_scope` / `require_company_read_access` (a minority of
routes). Routes using plain `get_current_user` (most of them, including the ones
hardened in IDOR batches 1–3) never set it → the bridge writes nothing → with RLS
on, **those routes would see zero rows**. Closing this — resolving the tenant on
*every* authenticated request (set it in `get_current_user`, ideally from a
`company_id` claim baked into the JWT at login) — is the gating prerequisite
before any policy is enabled.

**Tenant tables** (from `tenant_guard.py`): **13 direct** (have `company_id`),
**24 indirect** (reach `company_id` only by joining through `jobs`,
`private_users`, `payroll_runs`, `time_logs`, etc.).

## 3. Design

### 3.1 Bridge the tenant into Postgres (the keystone)
RLS policies read `current_setting('app.company_id')`. We must set that GUC at
the start of **every request transaction**, from the same resolved company the
app already computes.

- Use **`SET LOCAL app.company_id = :cid`** — *transaction-scoped*, so it auto-
  resets at commit/rollback and **cannot leak across pooled connections** (this
  is why `SET LOCAL`, not `SET`). Pooler-safe even if DO runs PgBouncer in
  transaction mode.
- Wire it in **one place**: a SQLAlchemy `after_begin` event (or a FastAPI
  dependency that opens the txn), reading `tenant_context.get_current_tenant()`.
  The ContextVar plumbing already exists — we feed it into the GUC.
- Platform/bypass context → set a sentinel (`app.company_id = '0'` or a
  dedicated `app.bypass = 'on'`) that policies treat as "see all".

### 3.2 Policies
- Direct tables: `USING (company_id = current_setting('app.company_id')::int)`
  for `SELECT/UPDATE/DELETE`, `WITH CHECK (...)` for `INSERT/UPDATE`.
- A bypass branch in each policy: `OR current_setting('app.bypass', true) = 'on'`
  for platform admins / migrations / cron.
- **`FORCE ROW LEVEL SECURITY`** on each table so the table owner is also subject
  to policies (otherwise the app's DB user, if it owns the tables, bypasses RLS).

### 3.3 A non-owner application role
RLS is ignored for superusers and (without FORCE) table owners. Create a
`kiruko_app` role that is **not** superuser and **not** the table owner, grant
it DML, and point the app's `DATABASE_URL` at it. Migrations/seeds keep using the
owner role. (Don't hardcode the role name — derive it from the app's
`DATABASE_URL` user so there's a single source of truth.)

### 3.4 The hard part — indirect tables (24)
Two options per table:

- **(A) Denormalize `company_id`** onto the table + backfill + trigger to keep it
  in sync, then a simple direct policy. Fast reads, simple policy; costs a
  migration + a write-path trigger.
- **(B) Subquery policy**: `USING (EXISTS (SELECT 1 FROM jobs j WHERE
  j.job_id = time_logs.job_id AND j.company_id = current_setting(...)::int))`.
  No schema change; **per-row subquery cost** on hot tables (`time_logs`,
  `break_logs`, `payslips`).

**Recommendation:** (A) for hot/large tables (`time_logs`, `break_logs`,
`payslips`, `salaries`, `leaves`), (B) for low-volume ones. The audit column also
makes the `tenant_guard` indirect list collapse into the direct list.

### 3.5 Bypass paths that must keep working
- **Platform admin** (`act_on_behalf_of_company`, `read_any_company_data`) → bypass GUC.
- **Concern portal** — case-scoped JWT, **no company**; its tables are reached
  by a token, not a company. Either exempt those tables from RLS or give the
  portal txn an explicit company context.
- **Auth/login** (pre-tenant): reads `users` before a company is resolved →
  `users` stays a reference table (already is), not under company RLS.
- **Cron / outbox / push workers** → run with bypass context.

## 4. Phased plan

### Phase 0 — Foundation (no policies yet, zero risk)
- [x] ~~GUC bridge from the ContextVar~~ — already built + installed (`install_session_listener`, `core/config.py:58`).
- [x] Test harness proving DB-level isolation — `tests/integration/test_rls_mechanism.py` (PASSES).
- [x] **Tenant-resolution coverage on every request, across transactions**: `company_id` baked into the access token at login; a GLOBAL async dependency (`core/dependencies.bind_tenant_context`, registered on the `/api/v1` router) reads the JWT (no DB lookup) and sets the tenant via `push_request_tenant`. Because it runs in the request's ASYNC context, the ContextVar PROPAGATES to the (threadpool) route, so the existing `after_begin` bridge re-applies `app.company_id` on EVERY transaction — including after a mid-handler commit. Reset in the dependency's `finally` (no cross-request leak). Platform admins → `'*'`; unauthenticated → no tenant. Verified end-to-end (`tests/integration/test_rls_request_binding.py`): role-holder binds `'7'` and survives a commit; admin binds `'*'`; anonymous binds `''`; no leak between requests. 149 auth/IDOR/RLS tests pass. Still inert (no policies).
- [ ] Create the non-owner `kiruko_app` role (name derived from the app `DATABASE_URL` user, not hardcoded); add an app-only `DATABASE_URL` for it (migrations/seeds keep the owner role). Confirm DO managed-PG allows role creation.
- [ ] Enumerate non-request DB entry points (cron, push outbox, scripts) that must run under bypass.

### Phase 1 — Direct tables behind a flag
- [x] Migration `rls_direct_tables_20260624`: creates the non-login `kiruko_app` role; `ENABLE` + `FORCE ROW LEVEL SECURITY` + a `rls_tenant_isolation` policy on **11** direct tables (the curated 13 minus `companies`/`private_users` — see below). Applied to dev; app unaffected (inert).
- [x] Enforcement gated by a **GUC kill-switch** inside every policy: `current_setting('app.rls_enabled') IS DISTINCT FROM 'on'` ⇒ allow all. So the migration is inert until the flag is set — regardless of connecting role. (Cleaner than an app env flag: the switch lives in the DB with the policies.)
- [x] Nullable-`company_id` tables (`jobs`, `job_history`) also allow `company_id IS NULL` so unclaimed/awaiting-verification rows stay reachable.
- [x] Enforcement lane `tests/integration/test_rls_enforcement.py`: flag-off inert; flag-on isolates (own visible, other hidden, NULL visible); cross-company INSERT refused by `WITH CHECK`; `'*'` bypass sees all. 186 tests pass.
- [ ] **Batch 1b**: bespoke policies for `companies` + `private_users` (signup INSERTs a company anonymously; auth self-fetches a private_user — naive policies would break both).

### How to flip (two-stage, reversible)
RLS only enforces when BOTH hold (so each stage is independently verifiable):
1. **Connect as a non-superuser.** Create a LOGIN role on the DB host, `GRANT kiruko_app TO <login_role>`, point the app's `DATABASE_URL` at it. (DO managed PG: confirm the app user is not superuser; the default `doadmin` is not.) Migrations/seeds keep using the owner role. App should work unchanged — still inert (flag off).
2. **Throw the switch:** `ALTER DATABASE <db> SET app.rls_enabled = 'on';` (applies to new connections). Now policies enforce. Roll back with `ALTER DATABASE <db> RESET app.rls_enabled;`.

### Phase 2 — Indirect tables (24)
- [ ] Denormalize `company_id` onto the 5 hot tables (migration + backfill + sync trigger).
- [ ] Subquery policies for the remaining low-volume indirect tables.
- [ ] Extend the integration lane to cover them; load-test `time_logs`/`payslips` read paths.

### Phase 3 — Flip & retire
- [ ] Turn `RLS_ENABLED` on in staging, run full suite + manual cross-tenant probes.
- [ ] Turn on in prod; switch `tenant_guard` from `log` → `raise` in CI as a backstop.
- [ ] Document the bypass contract; add a guardrail test that every tenant table has RLS enabled.

## 5. Risks & honest assessment

- **Silent over-blocking** is the top risk: a missing `SET LOCAL` on some code
  path (a cron, a raw engine connection, a relationship lazy-load outside a
  request) → that path sees **zero rows** and breaks quietly. Mitigation: flag-
  gated rollout, the bypass sentinel, and the visibility test harness in Phase 0.
- **PgBouncer mode** (DO managed PG): if a *session*-mode GUC were used it would
  leak; `SET LOCAL` avoids this, but we must confirm DO's pool mode and that no
  code sets a session GUC.
- **Performance** on `time_logs`/`break_logs`/`payslips` if we used subquery
  policies — hence denormalize the hot ones.
- **The concern portal** and any other non-company-scoped surface need explicit
  exemption or they'll break.

**Plan quality: ~70%.** The design is sound and the seam already exists
(`tenant_context` ContextVar + the M5a/M5b table split). The two unknowns that
keep it from 90% are (1) DO's actual connection-pool mode, and (2) an exhaustive
list of non-request DB entry points (crons, workers, scripts) that need the
bypass context — both answerable in Phase 0 before any policy ships.

## 6. Recommendation

**Not required for the kiosk pilot.** The app-layer IDOR closure (batches 1–3)
plus the `tenant_guard` advisory layer is an appropriate bar for a small,
trusted pilot. RLS is a **post-launch hardening** item — schedule Phase 0 right
after go-live, because it's zero-risk (no policies, just wiring + a role + a test
harness) and de-risks the unknowns above before any enforcement ships.
