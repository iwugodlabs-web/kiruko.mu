# Kontokaz Milestones — Implementation Tracker

Companion to the full architecture plan at `/Users/iwugod/.claude/plans/go-into-this-project-peaceful-wombat.md`.


### How to read a milestone

Each milestone follows the same compact format:

- **Summary** — one or two sentences in plain English: what changes for users / the system after this lands.
- **Why now** — why this milestone earns its slot in the sequence.
- **Effort** — **S** ≤ 1 day · **M** 2–4 days · **L** 1–2 weeks.
- **Depends on** — milestones that must ship first.
- **Unblocks** — milestones this one enables.
- **Deliverables** — checklist of concrete things to build.
- **Files** — primary paths the work touches.
- **Done when** — a single acceptance criterion.

### Dependency map (read top → down)

```
M0 (pytest harness) ─┐
                     ├─→  Phase 1 hardening ──────────────────────────────┐
M1 (formula engine) ─┘                                                    │
   │                                                                      │
   └─→  M4 (statutory bases) ────┐                                        │
                                  │                                        │
M2 (Dept+Role+Grade scope) ──→ M3 (assignment snapshot) ──┐               │
                                                           │               │
M5a (ORM tenant guard) ──┬──→ M5b (RLS on top-10 sensitive tables) ──┤   │
                          │                                              │   │
M6 (idempotency keys) ────────────────────────────────────┤               │
M7 (2FA on finalize) ─────────────────────────────────────┘               │
                                                                          │
═══════════ HARDENING GATE ═══════════════════════════════════════════════╪══
                                                                          │
M8 (API wrappers, web + mobile) ──┬──→ Web admin (M9, M10, M11, M12, M13, M14)
                                  └──→ Mobile employee (M15, M16, M17)
                                                  │
                              after stable UI ────┴──→ M18 (web i18n) → M19 (mobile MG)

Independent backend slices (sequence flexible):
   M20 (part-time fields) ──→ M21 (PDF generation)  [also depends on M15]
   M22 (doc vault hardening — Module 6)
   M23 (bonus provisions + cron)
   M24 (payroll calendar enforcement)
   M25 (CI gate — wire pytest into PR checks)
```

### Quick-reference table

| # | Milestone | Effort | Depends on | Unblocks |
|---|---|---|---|---|
| M0 | Pytest harness setup | S | — | M1–M7 verification |
| M1 | Salary formula engine | M | M0 | M4, M10 |
| M2 | Dept + Role + Grade scoping | S | — | M3, M10 |
| M3 | Snapshot structure on assignment | S | M2 | M10 |
| M4 | Statutory base mapping per component | S | M1 | M10 |
| M5a | ORM tenant guard (app-layer isolation) | S | M0 | M5b, all UI work |
| M5b | Postgres RLS on top-10 sensitive tables | M | M5a | — (defense in depth) |
| M6 | Idempotency keys on POSTs | S | — | M9, M11 |
| M7 | 2FA on payroll finalize | S | — | M9, M11 |
| — | **Hardening gate** | — | M0–M7 | M8 |
| M8 | API service wrappers (web + mobile) | M | M0–M7 | M9–M17 |
| M9 | Payroll Run Wizard (web) | M | M8, M7 | — |
| M10 | Salary Structures editor + preview (web) | M | M8, M1, M2, M3, M4 | M14 |
| M11 | Country Rules timeline (web) | M | M8, M7 | — |
| M12 | Leave Types catalog (web) | S | M8 | M16 |
| M13 | Profile Lock toggle + wire `require_unlocked_or_admin` | S | M8 | M17 |
| M14 | One-off Allowance scheduler (web) | S | M8, M10 | — |
| M15 | Payslip viewer (mobile) | M | M8 | M21 |
| M16 | Leave balance display (mobile) | S | M8, M12 | — |
| M17 | Locked-fields display (mobile) | S | M8, M13 | — |
| M18 | Web i18n scaffold + `users.preferred_locale` | L | M9–M14 stable | M19 |
| M19 | Mobile Malagasy strings + EN/FR backfill | M | M18 | — |
| M20 | Module 4: Part-time fields + engine branching | M | M5a | M21 |
| M21 | PDF generation for payslips | M | M20, M15 | — |
| M22 | Doc vault hardening (Module 6) | M | — | — |
| M23 | Bonus provisions + monthly accrual cron | S | — | — |
| M24 | Payroll calendar enforcement | S | — | — |
| M25 | CI gate — pytest on every PR | M | M0 | — |

### Phase 0 — Already shipped ✅

- [x] **Backend MVP** — 7 Alembic migrations, 6 services, 6 admin routers, MU seed data, smoke tests pass against dev DB. See "Status (2026-04-27)" section above for full inventory.

### Phase 1 — Production hardening (gates UI work)

#### M0 — Pytest harness setup
- **Summary**: Convert the ad-hoc smoke scripts into a pytest test suite with shared fixtures (`db`, `test_company`, `test_employee`, `seed_mu_rules`). Until this exists, hardening milestones can't be verified properly.
- **Why now**: M1–M7 each ship with a `pytest tests/test_*.py` verification step. They need a working test harness first.
- **Effort**: S
- **Depends on**: nothing
- **Unblocks**: M1–M7 verification, M25 (CI gate)
- **Deliverables**:
  - [ ] `backend/tests/conftest.py` with the four core fixtures
  - [ ] `backend/tests/test_smoke.py` — port the existing smoke scripts to pytest (PAYE math, supersede flow, EOY bonus)
  - [ ] `pytest.ini` or `pyproject.toml` config; `pytest backend/tests/` runs green locally
- **Files**: `backend/tests/`, `backend/pytest.ini`
- **Done when**: `pytest backend/tests/` exits 0 with the smoke scenarios green.
- **Decisions locked (2026-04-28)**:
  - Test DB is a **separate** Postgres database (`kontokaz_test`) — not the dev DB with rollback. Conftest creates + migrates + seeds it on first test run. Fully isolated; safe for a payroll system.

---

#### M1 — Salary formula engine
- **Summary**: Companies can write expressions like `transport = basic * 0.10` or `housing = max(basic * 0.25, 8000)` on structure lines. The resolver evaluates a dependency DAG of components instead of skipping formulas as it does today.
- **Why now**: Without formulas, "configurable salary structures" is hollow — every percent-based allowance, overtime rate, or capped benefit must be hand-typed per employee. Promoted from Phase 2 because A1 in the readiness review flags this as a blocker.
- **Effort**: M
- **Depends on**: M0
- **Unblocks**: M4 (statutory bases compute on resolved values), M10 (web UI exposes the formula editor)
- **Deliverables**:
  - [ ] `services/formula_evaluator.py` using `simpleeval`, with `min`/`max`/`round`/`abs` whitelist and rejection of `__`, attribute access, subscripts, function calls outside the whitelist
  - [ ] DAG topological sort over component `code` references with cycle detection
  - [ ] `salary_resolver.resolve_components` calls the evaluator instead of skipping
  - [ ] Validation at structure-save time (`POST /salary-structures`) so cycles fail at write, not at resolve
- **Files**: `backend/services/formula_evaluator.py` (new), `backend/services/salary_resolver.py`, `backend/api/v1/salary_structures.py`
- **Done when**: a structure with `BASIC=30000`, `TRANSPORT=basic*0.10`, `HOUSING=max(basic*0.25, 5000)` resolves correctly; cycle `A=B+1, B=A+1` rejected at save; `__import__('os')` rejected.

---

#### M2 — Department + Role + Grade scoping
- **Summary**: Salary structures can target a default department, role, and grade. The onboarding UI auto-suggests the right structure for a new employee instead of admins manually picking one each time.
- **Why now**: A 200-employee company can't realistically maintain one structure per employee. This is the "configurable per company, per department, per grade" you asked about.
- **Effort**: S
- **Depends on**: nothing (existing `departments` and `sector_grades` tables already in place)
- **Unblocks**: M3 (snapshot includes the new fields), M10 (UI shows the auto-suggestion)
- **Deliverables**:
  - [ ] Migration adding `default_for_department_id`, `default_for_role`, `default_for_sector_grade_id` to `salary_structures` + index
  - [ ] `services/salary_resolver.suggest_structure_for(employee)` with the documented 9-priority match table (exact triple → dept+role → dept+grade → … → company default → none)
  - [ ] `GET /companies/{cid}/salary-structures/suggest?private_user_id=X` endpoint
  - [ ] Validation that referenced dept/grade belongs to the same company
- **Files**: `backend/core/model.py`, `backend/schema/salary_structure_schema.py`, `backend/services/salary_resolver.py`, `backend/api/v1/salary_structures.py`, new migration
- **Done when**: three structures with different scopes; suggest endpoint returns the right one at every priority level (covered by `tests/test_salary_scoping.py`).

---

#### M3 — Snapshot structure on assignment
- **Summary**: When an employee is assigned to a structure, that structure's lines are frozen into a JSONB snapshot on the assignment row. Editing the live structure later doesn't retroactively change existing employees' salaries.
- **Why now**: Without this, "what was Jane earning in March 2026?" returns whatever the structure says today, not what she was actually paid. Salary history is unreliable.
- **Effort**: S
- **Depends on**: M2 (snapshot must include the new scope columns)
- **Unblocks**: M10 (preview UI relies on stable salary history)
- **Deliverables**:
  - [ ] Migration adding `employee_salary_assignments.structure_snapshot JSONB`
  - [ ] On assignment create, copy structure lines (with component metadata embedded) into the snapshot
  - [ ] `salary_resolver.resolve_components` reads from the snapshot instead of joining live structure tables
  - [ ] `scripts/backfill_assignment_snapshots.py` populates existing assignments
- **Files**: `backend/core/model.py`, `backend/api/v1/salary_structures.py`, `backend/services/salary_resolver.py`, new migration, new backfill script
- **Done when**: edit Grade A's BASIC from 30k → 35k after assignment; resolver still returns 30k for the assignment; new assignment to Grade A picks up 35k.

---

#### M4 — Statutory base mapping per component
- **Summary**: Each salary component declares which deductions it contributes to (e.g. `["PAYE","CSG_EE","CSG_ER"]`). The engine builds per-deduction bases instead of using one global gross. Fixes incorrect CSG/NSF for any non-trivial salary structure.
- **Why now**: In Mauritius, several allowances are excluded from CSG base by law. The current engine inflates them — this is a compliance bug today.
- **Effort**: S
- **Depends on**: M1 (formula evaluation must produce final amounts before bases are summed)
- **Unblocks**: M10 (UI exposes the per-component statutory mapping)
- **Deliverables**:
  - [ ] Migration adding `salary_components.statutory_base_codes JSONB DEFAULT '[]'`
  - [ ] `payroll_rules.compute_statutory` looks up the deduction `code` directly in a `bases_by_code` dict instead of `taxable_base` enum
  - [ ] `payroll_engine.compute_for_resolved` builds `bases_by_code` by summing components per their `statutory_base_codes`
  - [ ] Seed update: BASIC → all bases; ALLOWANCE → PAYE+CSG only; bonus → PAYE only (defaults — flag for accountant)
- **Files**: `backend/core/model.py`, `backend/services/payroll_rules.py`, `backend/services/payroll_engine.py`, `backend/scripts/seed_mu_payroll_rules.py`, new migration
- **Done when**: TRANSPORT=1000 with `["PAYE"]` only excluded from CSG base; CSG = 1.5% × (basic + non-transport allowances), not × full gross.

---

#### M5a — ORM tenant guard (app-layer isolation)
- **Summary**: SQLAlchemy session-level tenant context set per request. An event listener on `Session.before_execute` asserts that every query touching a multi-tenant table includes a `company_id` filter (or its denormalized equivalent). Catches "forgot to filter" bugs at the app layer.
- **Why now**: 80% of the multi-tenant safety at ~10% of the effort of full RLS. Deliverable in 2 days; unblocks UI quickly.
- **Effort**: S (~2 days)
- **Depends on**: M0
- **Unblocks**: M5b, all UI work
- **Deliverables**:
  - [ ] `backend/core/tenant_context.py` — context manager + FastAPI dependency `set_tenant(company_id)` chained from `get_current_user`. Platform admins set a sentinel that bypasses the guard.
  - [ ] SQLAlchemy event listener (`before_execute` or compiled-SQL inspection) that walks the FROM clause and asserts every multi-tenant table has a matching filter.
  - [ ] Whitelist of multi-tenant tables (`MULTI_TENANT_TABLES = {...}`). Reference tables (countries, sectors, public_holidays, country_*, tax_*, statutory_*) are excluded.
  - [ ] Behavior: in `dev` and tests → raise `TenantIsolationError`; in prod → log structured warning + reject query (configurable per env).
  - [ ] Platform-admin sentinel uses an explicit `with bypass_tenant_guard("reason"):` context so escapes are auditable.
- **Files**: `backend/core/tenant_context.py` (new), `backend/core/dependencies.py` (chain in), every existing router (add `Depends(set_tenant(...))` once), `backend/tests/test_tenant_guard.py` (new).
- **Done when**: a query touching `payslips` without a `company_id` filter raises `TenantIsolationError` in tests; with a filter, the query succeeds.

---

#### M5b — Postgres RLS on sensitive tables (DB-layer isolation, top 10 tables)
- **Summary**: Postgres Row-Level Security on the 10 highest-stakes tables (anything touching money, audit, or PII). Each request sets `SET LOCAL app.company_id = X`; policies gate every query at the DB layer. Even raw SQL via `text()` can't bypass it. Reference data and lower-stakes tables (departments, schedules, notifications) stay protected by M5a only — they can be promoted to RLS later, one at a time, without it being scary.
- **Why now**: For a payroll system handling money, the genuinely sensitive tables warrant a second isolation layer below the app. Staged rollout means we get the strongest protection on the riskiest data without the full 40-table lift.
- **Effort**: M (~5 days) — denormalization migrations + policies + rollout per table
- **Depends on**: M5a (ORM guard ships first; RLS layers on top)
- **Unblocks**: nothing functionally; this is defense in depth on top of M5a
- **Tables in scope (the 10)**: `payslips`, `payroll_runs`, `salaries`, `employee_salary_assignments`, `employee_salary_overrides`, `employee_one_off_allowances`, `document_vault`, `audit_logs`, `private_users`, `leave_quotas`. Other tables (departments, schedules, notifications, time_logs, etc.) protected by M5a only; promoted later.
- **Deliverables**:
  - [ ] Denormalize `company_id` onto tables that join through (`salaries`, `audit_logs`, `payslips`, `employee_one_off_allowances`, `employee_salary_assignments`, `employee_salary_overrides`) — backfill + write triggers to keep in sync.
  - [ ] Migration enabling RLS + `CREATE POLICY` on each of the 10 tables, using `current_setting('app.company_id', true)::int` as the predicate.
  - [ ] Extend `tenant_context` from M5a to ALSO call `SELECT set_config('app.company_id', :id, true)` per request.
  - [ ] Platform admin path uses a Postgres role with `BYPASSRLS`. Platform-admin actions still pass through the M5a guard's `bypass_tenant_guard` context for audit.
  - [ ] Feature-flag rollout: enable RLS on one test tenant first; soak for a week; flip globally.
- **Files**: large migration `enable_rls_sensitive_tables_<date>.py`, `backend/core/tenant_context.py` (extend), `backend/tests/test_rls.py` (new).
- **Done when**: `tests/test_rls.py` proves that `SET app.company_id = A; SELECT * FROM payslips;` returns only A-owned rows even when the SQL forgets the `WHERE` clause; same for the other 9 tables.

---

**Future Phase 7 work**: promote the remaining ~30 multi-tenant tables to full RLS one at a time as confidence grows. Tracked separately from this MVP.

---

#### M6 — Idempotency keys on POSTs
- **Summary**: Mutating endpoints accept an `Idempotency-Key` header; replays return the cached response without re-executing. Required on payroll finalize, rule supersede, and one-off create. Other POSTs accept the header but don't require it.
- **Why now**: A network retry on `POST /payroll/runs/{id}/finalize` could double-finalize today. Required for billing-grade reliability.
- **Effort**: S
- **Depends on**: nothing
- **Unblocks**: M9 (run wizard sends keys), M11 (rule timeline sends keys)
- **Deliverables**:
  - [ ] Migration creating `idempotency_keys` (`key PK, user_id, method, path, request_hash, response_status, response_body JSONB, created_at`)
  - [ ] `backend/core/idempotency.py` middleware: check key + body hash → return cached or execute + store
  - [ ] Required header on payroll finalize, supersede, one-off create; optional elsewhere
  - [ ] 24h retention cron
- **Files**: `backend/core/idempotency.py` (new), high-stakes routers, new migration, `backend/jobs/idempotency_cleanup.py` (new)
- **Done when**: replay same `POST .../finalize` with same key → cached response, no DB mutation; replay with different body → 409.

---

#### M7 — 2FA on payroll finalize
- **Summary**: Finalizing payroll requires a fresh step-up token (TOTP or email OTP, 5-minute TTL, single-use). Issuing money via the system requires re-authentication, not just a session cookie.
- **Why now**: Riskiest action in the system; SOC2 / common sense both demand step-up. The OTP infrastructure already exists in the password-reset flow — reuse it.
- **Effort**: S
- **Depends on**: nothing (reuses existing OTP infra)
- **Unblocks**: M9 (run wizard captures the step-up flow), M11 (rule supersede uses the same)
- **Deliverables**:
  - [ ] Migration creating `step_up_tokens` (`token PK, user_id, purpose, issued_at, expires_at, consumed_at`)
  - [ ] `POST /auth/step-up/request` (sends OTP) and `POST /auth/step-up` (validates → returns token)
  - [ ] `require_step_up_token('payroll_finalize')` dependency on `POST /payroll/runs/{id}/finalize`
  - [ ] (Optional, recommended) extend to `POST /payroll-rules/{country}/.../supersede`
- **Files**: `backend/api/v1/auth_step_up.py` (new), `backend/services/totp.py` (new or extend `password_reset` infra), `backend/api/v1/payroll.py`, new migration
- **Done when**: finalize without `X-Step-Up-Token` → 401 with hint; with valid token → success + token consumed; reuse → 401.

---

#### Hardening gate
- **Summary**: All M0–M7 tests pass + existing engine smoke tests still pass (no regression on PAYE/CSG/EOY math). UI work does NOT begin until this gate is green.
- **Why now**: UI built on the post-hardening data shape avoids a rework cycle.

### Phase 2 — UI Foundation

- [ ] **M8 — API service wrappers (web + mobile)** · Effort: M
  - Goal: typed wrappers for all 37 admin endpoints in `web/ivor-web/src/services/api.tsx` (web pattern) and `mobile/services/api.tsx` (mobile pattern). Pure plumbing, unblocks every UI screen.
  - Verify: TypeScript compiles; manual API call from a scratch component returns expected payload.

### Phase 3 — Web admin UI

- [ ] **M9 — Payroll Run Wizard** (UI Slice 1) · Effort: M · Depends: M8
  - Goal: `dashboard/payroll/runs/` with list + 3-step Start-Run wizard + payslip detail drawer.
  - Files: new `web/ivor-web/src/app/(platform)/dashboard/payroll/runs/page.tsx` and `components/{PayrollRunList,StartRunWizard,PayslipDetailDrawer}.tsx`.
  - Verify: log in as company owner, run May 2026 payroll end-to-end in browser.

- [ ] **M10 — Salary Structures editor + preview** (UI Slice 3) · Effort: M · Depends: M8, M2, M3
  - Goal: components catalog, structure editor with formula support (M1), employee assignment + reassign UI (auto-snapshots via M3), live preview widget showing resolved components for a given date.
  - Files: extend `web/ivor-web/src/app/(platform)/dashboard/salaries/components/` with `ComponentsCatalog.tsx`, `StructuresList.tsx`, `StructureEditor.tsx`, `EmployeeSalaryTab.tsx` (embedded into `dashboard/employees/[id]`).
  - Verify: create a Grade A structure with a formula component, assign employee, preview shows correct math.

- [ ] **M11 — Country Rules timeline** (UI Slice 4) · Effort: M · Depends: M8, M7
  - Goal: `dashboard/settings/payroll-rules/` timeline view per rule type with diff between versions, "Add new version" form (calls `supersede`). Platform-admin-only. **Triggers M7 step-up flow on save.**
  - Files: new under `dashboard/settings/payroll-rules/`.
  - Verify: add a new tax bracket version with source reference; timeline displays it with diff against prior.

- [ ] **M12 — Leave Types catalog** (UI Slice 5a) · Effort: S · Depends: M8
  - Goal: `dashboard/settings/leave-types/` table with active toggle + create/patch + "Reset to country defaults" button.
  - Files: new under `dashboard/settings/leave-types/`.
  - Verify: seed-from-country produces 4 MU defaults; create custom type; modify; round-trip seed leaves custom intact.

- [ ] **M13 — Profile Lock toggle + wire dependency into PUTs** (UI Slice 6a + B4) · Effort: S · Depends: M8
  - Goal: lock badge + toggle in `EmployeesDetails.tsx` header; **AND** wire `require_unlocked_or_admin()` into existing PrivateUser PUT endpoints (`backend/api/v1/user.py` update endpoints) so the lock actually blocks edits.
  - Files: extend web component; modify backend routers.
  - Verify: lock employee, attempt to PATCH first_name as the employee → 403; as admin → succeeds.

- [ ] **M14 — One-off Allowance scheduler** (UI Slice 7) · Effort: S · Depends: M8, M10
  - Goal: "Allowances" tab in `EmployeesDetails.tsx`. Table of pending + applied + delete (refused if applied).
  - Files: new `OneOffAllowancesTab.tsx`.
  - Verify: schedule a Rs 5000 bonus for next month, run payroll, see it on the payslip.

### Phase 4 — Mobile employee UI

- [ ] **M15 — Payslip viewer** (UI Slice 2) · Effort: M · Depends: M8
  - Goal: new `mobile/app/private_dashboard/payslips.tsx` with list + detail modal showing component breakdown + statutory split. PDF download button hidden until M21.
  - Files: new mobile screen; nav link from home.
  - Verify: log in on Expo Go; finalized payslip from M9 is visible and renders correctly.

- [ ] **M16 — Leave balance display** (UI Slice 5b) · Effort: S · Depends: M8, M12
  - Goal: extend `mobile/app/private_dashboard/leave.tsx` — replace hardcoded `LEAVE_TYPES` with a fetch to `leaveTypes.list`; add balance card row.
  - Files: extend existing.
  - Verify: balance reflects `LeaveQuota` data; statutory badge renders.

- [ ] **M17 — Locked-fields display** (UI Slice 6b) · Effort: S · Depends: M8, M13
  - Goal: extend `mobile/app/private_dashboard/profile.tsx` — disable inputs bound to `LOCKABLE_FIELDS` when locked, show lock icon, top-of-screen alert.
  - Files: extend existing.
  - Verify: lock from web (M13), open mobile profile, fields are disabled.

### Phase 5 — i18n + polish

- [ ] **M18 — Web i18n scaffold + `users.preferred_locale`** (UI Slice 9 web) · Effort: L
  - Goal: install `next-intl`; restructure routes under `src/app/[locale]/(platform)/dashboard/...`; add middleware; create `messages/{en,fr,mg}.json`; locale switcher in header. Backend: add `users.preferred_locale VARCHAR(10) NULL` migration; login response includes preferred locale.
  - Files: large refactor of web app routing; small backend migration.
  - Verify: switch locale, navigate every existing screen, all strings translated (start with EN+FR; MG strings can be empty placeholders).

- [ ] **M19 — Mobile Malagasy strings + translation backfill** (UI Slice 9 mobile) · Effort: M · Depends: M18 (for shared glossary)
  - Goal: add `mobile/app/locales/mg.ts`; backfill `en.ts` and `fr.ts` with strings used across all new screens (M15–M17). Use shared glossary from M18.
  - Files: locale files only.
  - Verify: switch language in mobile, all M15–M17 screens render correctly.

### Phase 6 — Remaining backend gaps

- [ ] **M20 — Module 4: Part-time fields + engine branching** · Effort: M
  - Goal: `private_users.employment_type` enum + `fte` Numeric; `salaries.pay_basis` + `hourly_rate` + `daily_rate`. `payroll_engine` branches on `pay_basis` (hourly = sum of `time_logs.hours_worked` × rate). Joiner/leaver pro-rata via new `services/proration.py`.
  - Files: migration; model; engine; service; smoke test.
  - Verify: hourly employee with 80 logged hours @ Rs 250 generates correct gross; mid-month joiner is pro-rated.

- [ ] **M21 — PDF generation for payslips** · Effort: M · Depends: M20 (for hourly display)
  - Goal: WeasyPrint-based MU bilingual EN/FR template; populate `payslips.pdf_url` and `hash_sha256` on finalize. Hooks into M15 mobile payslip viewer's "Download PDF" button.
  - Files: `backend/templates/payslips/MU/default_{en,fr}.html`; new `backend/jobs/payslip_pdf.py` background task; modify `payroll_engine.finalize_run`.
  - Verify: download a finalized payslip, PDF renders correctly with MU compliance fields.

- [ ] **M22 — Doc vault hardening (Module 6)** · Effort: M
  - Goal: `document_vault.uploaded_by_user_id` + `visibility` enum + `document_access_logs` + `document_expiry_reminders` + daily cron. Then UI extension (Slice 8) — ACL editor on web, filtering on mobile.
  - Files: backend migration + cron + S3 SSE-KMS config; web component extension; mobile filter logic.
  - Verify: upload work permit with expiry 25 days out, cron sends notification; ACL prevents cross-user access.

- [ ] **M23 — Bonus provisions + monthly accrual cron** (Module 3 Phase 2) · Effort: S
  - Goal: `bonus_provisions` table for monthly EOY liability accrual; cron writes provisions; web tile shows "EOY liability as of <date> = Rs X".
  - Files: migration; cron in `backend/jobs/bonus_provisioning.py`; web tile.
  - Verify: accrue for 6 months, sum equals expected fraction of YTD.

- [ ] **M24 — Payroll calendar enforcement** · Effort: S
  - Goal: `payroll_calendars` per country with period-close discipline. `create_draft_run` rejects out-of-order periods (e.g. May before April finalized).
  - Files: migration + service + engine check.
  - Verify: attempt to draft June 2026 before May 2026 is finalized → 409.

- [ ] **M25 — Pytest test suite + CI gate** · Effort: M
  - Goal: convert smoke scripts to pytest with shared fixtures (`tests/conftest.py`); wire into CI; gate merges on test pass.
  - Files: `backend/tests/` directory; CI config.
  - Verify: `pytest backend/tests/` green; CI runs on every PR.

### Phase 7 — Phase 2 / Phase 3 items (deferred from MVP)

These remain in the backlog. Prioritize after M25 based on customer feedback:

- [ ] Leave accrual cron + half-day + encashment + probation (Module 1 Phase 2)
- [ ] Per-company bonus overrides + tax-portion config + MG bonus rules (Module 3 Phase 2)
- [ ] Salary formula caps + retroactive pay UI (Module 5 Phase 2)
- [ ] Bank file generation (CSV/SEPA-MU) for direct deposit
- [ ] MRA filings (PAYE-A, CSG/NSF returns)
- [ ] Madagascar full activation: seed `country_payroll_rules` for MG, MG payslip template, MG translations
- [ ] Garnishments / court orders
- [ ] Time-off-in-lieu (TOIL)
- [ ] Multi-currency aggregation reporting
- [ ] Read-audit on payslips (B5)
- [ ] Salary benchmarking dashboard against `SectorCategorySalary`
- [ ] Immutable hash-chain on payslips (chain SHA-256 across periods)

---
