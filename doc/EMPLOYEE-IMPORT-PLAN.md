# Bulk Employee Import — Plan

**Problem.** There is **no usable bulk-import flow for employers.** Onboarding an
employer's existing workforce is the make-or-break for payroll adoption, and
right now the only path is the **6-step single-employee wizard** (`OnboardingWizard`
→ `inviteCompanyUser`), one person at a time, invite-based. An employer with 40
staff faces 40 wizards + 40 invites to chase — the friction that kills payroll
deals and breeds data-entry errors (→ wrong paychecks → lost trust).

**What exists today (audited 2026-06-21):**
- `jobs/excel_job_importer.py` (366 lines) is **unwired** — no endpoint, no UI,
  no script (ends with `# Example usage (not executed here)`).
- It **cannot create employees** — `_find_private_user()` skips any row whose
  user doesn't already exist (`reason: user_not_found`), so it's useless for a
  fresh workforce.
- Its columns (`Category of Employee`, `Sector`, `2025`/`2024` rates,
  `sector_rates.xlsx`) show it was built to ingest **sector / Remuneration-Order
  rate data, not an employer's staff roster.** Wrong tool. **Do not extend it —
  build fresh; decommission or clearly re-label it as the sector-rate tool.**
- It commits **per row** (no atomicity) and conflates `dry_run` with `failed`.

**Goal.** Let an employer upload a CSV/Excel of their staff and get them created
— users + jobs + salaries — with validation, a dry-run preview, and clear
partial/atomic handling. Reuse the validation the onboarding wizard already
encodes (it knows the required fields, permit logic, min-wage, currency).

---

## Phase 0 — Decisions (quick, gate the design)
- [ ] **Create-direct vs invite.** Onboarding an *existing* workforce should
  **create pre-provisioned employee records directly** (PrivateUser + Job +
  Salary), NOT fire 40 invites the staff must accept. Decide: do imported
  workers get a login later (optional invite/claim), or are they payroll-only
  records until invited? Recommend: create directly, invite optional/later.
- [ ] **Required vs optional columns** (draft below) — minimum to run payroll vs
  nice-to-have.
- [ ] **MVP scope** = employees + salary. Departments auto-created by name if new.
  Documents/permits captured but not blocking.

## Phase 1 — Template + parser
- [ ] Define a **downloadable CSV/XLSX template** with the columns below (header
  row + 1 example row + an instructions sheet).
- [ ] Parser (CSV + XLSX) that normalizes headers (trim/case-insensitive),
  trims values, and maps to the `OnboardDraft` shape the wizard already uses.
- [ ] Columns (mirror `onboard/components/types.ts`):
  - **Required:** `first_name`, `last_name`, `email`, `job_title`, `start_date` (YYYY-MM-DD), `base_salary`, `currency` (MUR/MGA/USD/EUR/GBP)
  - **Recommended:** `passport_number` (dup key), `department`, `work_days_per_week`, `hours_per_month`, `contracted_hours`, `role` (employee/manager/admin)
  - **Optional/compliance:** `dob`, `nationality`, `permit_type`, `permit_number`, `permit_expiry`, `has_permission_to_work`, `deduct_transport`, `deduct_accommodation`, `notes`

## Phase 2 — Validation + dry-run preview (NO writes)
- [ ] Per-row validation, reusing the wizard's rules (`getComplianceIssues`):
  required fields present; email well-formed; `start_date` parseable; `currency`
  in allowed set; **below-minimum-wage flag** (MUR 11,275/mo etc. — already a
  known check); permit logic (tourist-visa warning); `role` valid.
- [ ] **Duplicate detection** within the file AND against existing data, keyed on
  `email` + `passport_number` → mark as skip/update, not silent double-create.
- [ ] Return a **preview**: `{ total, ok, errors:[{row, field, reason}], warnings:[...] }`
  so the UI shows "37 ready, 3 errors (rows 7, 14, 22), 2 below min wage" before
  anything is written.

## Phase 3 — Commit (create user + job + salary)
- [ ] For each valid row create **User + PrivateUser + Job + Salary** (+ the
  new-model `SalaryStructure`/assignment if that's the canonical path), mirroring
  exactly what the wizard's invite-accept does so imported and wizard-created
  employees are identical downstream.
- [ ] **Transactional discipline:** all-or-nothing per import, OR commit-valid +
  report-skipped — but NEVER the current silent per-row half-state. Make it
  **idempotent**: re-importing the same file updates/skips, never duplicates.
- [ ] Set `company_onboarding_status='approved'` (so they appear in the
  dashboard) and sensible defaults for unspecified Job fields.
- [ ] Audit-log the import (who, when, counts, file hash).

## Phase 4 — API + UI
- [ ] `POST /companies/{cid}/employees/import?dry_run=true` → preview; `dry_run=false` → commit. Admin + `manage_employees` gated, company-scoped.
- [ ] Web: **"Import employees"** on the employees page → upload → **preview table** (ok/errors/warnings, fix-and-reupload loop) → **Confirm import**. Plus a **Download template** button.
- [ ] Surface the same below-min-wage / permit warnings the wizard shows.

## Phase 5 — Verify
- [ ] Tests: happy path (N created); dup-in-file; dup-vs-existing; missing required; bad currency/date; below-min-wage warning (not blocking); idempotent re-import; partial-failure reporting.
- [ ] Reconcile: an imported employee and a wizard-created one produce identical payroll on the same inputs.

---

## Non-goals / notes
- Not reusing `excel_job_importer.py` — it's the wrong shape and can't create
  users. Re-label it (sector-rate tool) or remove to avoid confusion.
- Bank details / documents stay post-import (the profile already handles them).
- Photos/biometrics out of scope.

## Risk framing
- **Not a 29 Jun launch blocker** *if* the first pilot employers are small (a few
  staff each) — the wizard survives that.
- **Top of the post-launch list, above new features** — onboarding friction is
  what converts a pilot into retention or abandonment. Every employer past ~10
  staff hits this wall on day one.

## Honest quality: plan ~9/10 (well-scoped, grounded in the existing wizard
fields + invite flow). Build is **moderate** (~few days): parser + validation +
endpoint + preview UI + tests, reusing the wizard's validation rules. The only
real design fork is Phase 0's create-direct-vs-invite — settle that first.
