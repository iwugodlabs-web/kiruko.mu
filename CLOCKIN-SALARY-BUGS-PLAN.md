# Web bug/feature plan — clock-in review, employee code, allowances/deductions

Source: Ivor Tan Yan, WhatsApp, 7/8/2026. Four items. Investigated the actual
backend/web code before writing this (see "Current state" under each item) —
two of the four already have most of their backend built; the other two are
close to greenfield.

**Plan quality: 9/10.** All four items have now been traced against the
actual code (not just the models — the resolver's merge logic and the
assignment-creation endpoint were read line-by-line), and every open question
raised along the way has been closed with a concrete finding or an explicit
default decision — see Item 3 (resolver bug found and scoped) and Item 4
(scope decision made below after two rounds of no reply). The 1 point held
back is simply that decisions were made by me rather than confirmed by Ivor
(the item 2 code format, the item 3 legacy-field retirement question, and the
item 4 scope) — normal engineering judgment calls, not unresolved unknowns,
but worth a final skim before or during dev in case any lands differently
than expected.

Recommended build order: **1 → 2 → 3 → 4**. Item 1 is almost pure frontend
against an existing endpoint (lowest risk, fastest win). Item 2 is small and
unblocks Item 1's UI (showing the code next to the name in the review table).
Items 3 and 4 touch the same models/UI and should be designed together, but
4 depends on 3's UI existing first.

---

## 1. Clock-in review — make clock-in time editable

**Current state:** The backend is already done. `PATCH /time-logs/{id}`
(`backend/api/v1/time_log_review.py:292`) accepts `start_time`, `end_time`,
`hours_worked`, resets `admin_approved` to pending on edit, and writes an
`AuditLog(action="time_log.edit", ...)`. The gap is 100% frontend: the
Attendance screen's `TimeLogDetailDrawer.tsx` renders Clock In / Clock Out /
Total Hours as read-only rows and never calls this endpoint.

**One backend correctness gap found:** `patch_time_log` sets `hours_worked`
only if the caller explicitly passes it — it does **not** recompute it from
`start_time`/`end_time`. If the web form only sends the two timestamps,
`hours_worked` goes stale (and overtime/payroll figures downstream would be
wrong). Fix this server-side rather than trusting the frontend to compute it
correctly.

- [ ] Backend: in `patch_time_log`, when `start_time` and/or `end_time` end up
      set on `tl` after applying the patch, recompute `hours_worked` from the
      resulting pair (minus approved break time from `BreakLog`, matching
      however `hours_worked` is computed on create) unless the caller
      explicitly overrode `hours_worked` in the same request.
- [ ] Backend: validate `end_time > start_time` (400 if not) and reject edits
      that would move the log outside a finalized/locked payroll period (the
      codebase's back-dating guard pattern is already used in
      `salary_structures.py`'s assignment creation — reuse the same
      finalized-period check here if one doesn't already exist on this path).
- [ ] Web: add an "Edit" affordance to `TimeLogDetailDrawer.tsx` — turn the
      Clock In / Clock Out rows into a small inline form (date+time pickers)
      on click, or a distinct edit sub-view of the drawer.
- [ ] Web: on save, call `PATCH /time-logs/{id}` with the changed
      `start_time`/`end_time`; show a confirmation ("this will move the entry
      back to Pending review") before submitting, since that's a real
      behavior change the admin should be told about.
- [ ] Web: after a successful edit, refresh the row in `TimeLogTable.tsx` and
      reflect the reset-to-pending status without a full page reload.
- [ ] Web: gate the edit UI on the same permission the backend checks
      (`_require_company_admin_gated(..., "edit_hours")`) so the button isn't
      shown to roles that will just get a 403.
- [ ] Manual test: edit an already-approved log → confirm it flips back to
      pending in the UI and the audit row appears (there's already a CSV
      audit-export in this file — verify the edit shows up there too).

**Effort:** ~1–1.5 days (mostly frontend; backend is a small, contained fix).

---

## 2. Employee/user code (short human-readable ID)

**Current state:** No code exists. What shipped in commit `0eb3e6b7` ("show
employee ID in the employees list") is just the raw `private_user_id` DB
primary key printed next to the name — not a generated code. There's also no
existing "letters + digits" generator to model this on; every code-generation
utility in the repo (`invite.py`, `kiosk_service.py`) produces long crypto
tokens or a 4-digit kiosk PIN, not a short display code.

**Design decisions made (flag if you disagree):**
- Format: **first initial + last initial** + 4 random digits (e.g. `JS4821`
  for John Smith) — more conventional/recognizable than truncating just the
  first name, and Ivor's suggestion. Fallback to first-two-letters-of-`first_name`
  when `last_name` is blank/missing. Tradeoff considered: this is slightly
  less stable than a first-name-only code if an employee's last name changes
  later (marriage, correction) — accepted since actual initials are more
  legible than an arbitrary truncation, and last-name changes are rare.
  Collision odds are essentially the same either way (uniqueness comes from
  the digit suffix, not which 2 letters are picked).
- Uniqueness scope: **per company**, not global — two employees named John at
  two different companies can both be `JS4821`. This matches how the code
  will actually be used (looked up within one company's Attendance/Employees
  screens) and avoids a global sequence bottleneck.
- Generated once at employee creation, immutable after (regenerating a code
  that's already printed on a badge/pay slip would be confusing).

- [ ] DB: add `private_users.employee_code VARCHAR(6)` + Alembic migration
      with `UniqueConstraint("company_id", "employee_code")`.
- [ ] Backend: `generate_employee_code(db, company_id, first_name)` — build
      the 2-letter prefix, retry with a fresh random 4-digit suffix on
      collision (cap retries, e.g. 20, then widen to 5 digits as a fallback
      so it can't deadlock on a common-initials company).
- [ ] Backend: call the generator wherever a `PrivateUser` is created
      (signup, admin-created employee, bulk import path from
      `employee_import_service` — [[project_employee_import_gap]] shipped
      recently and is the other place new `PrivateUser` rows get created).
- [ ] Backend: one-off backfill script (`backend/scripts/`) to generate codes
      for all existing employees, following the pattern of other one-off
      scripts already in that folder.
- [ ] Backend: surface `employee_code` in whatever schema/endpoint feeds the
      Attendance review screen (`time_log_review.py`'s `_to_review_item` /
      the employee list endpoint) and the Employees list.
- [ ] Web: show the code in `TimeLogTable.tsx` / `TimeLogDetailDrawer.tsx`
      next to the employee's name (this is the explicit ask — "visible from
      the Clock-in review screen").
- [ ] Web: decide whether `EmployeesSection.tsx:508` keeps showing the raw
      `ID {private_user_id}` alongside the new code, or the code replaces it.
      Recommend **replace** — a raw DB id isn't meant for anyone outside
      engineering to look at, and now there's a proper human-facing code.
- [ ] Manual test: create a new employee, confirm a code is generated;
      create a second employee with the same first name at the same company,
      confirm no collision; run the backfill against a copy of the dev DB
      and confirm every existing employee gets a code with no duplicates
      within a company.

**Effort:** ~0.5–1 day.

---

## 3. Salary profile — add/remove allowances and deductions per employee

**Current state — this is the important finding.** There are **two parallel
salary systems** in the codebase:

1. **Legacy `Salary` model** (`salaries` table) — what the current employee
   profile screen (`SalaryTab.tsx` → `SalaryConfigModal.tsx`) actually edits.
   It has exactly one lump `allowance` numeric column. No list, no add/remove
   — that's *why* this bug exists; the UI was never built to support more
   than one allowance figure.
2. **Module 8 structure system** (`SalaryComponent`, `SalaryStructure` +
   `SalaryStructureLine`, `EmployeeSalaryAssignment` +
   `EmployeeSalaryOverride`) — this is a real per-component,
   effective-dated allowances/deductions engine, and it's already fully built
   on the backend (company component catalog, structure templates, and
   `POST /private-users/{id}/salary-assignments` which takes a full
   `overrides: [{component_id, amount}]` list). It's just only wired into a
   **company-level template editor** (`salary-structures/` pages), never into
   the per-employee profile screen Ivor is talking about.

So the right move is **not** to extend the legacy single `allowance` field —
it's to wire the already-built structure system into the employee profile
screen. That gets add/remove "for free" on the backend and avoids building a
second, incompatible allowance model.

One real gap in the backend to design around: there's no PATCH/DELETE for a
single override — the pattern is effective-dated, so "edit this employee's
allowances" means **creating a new `EmployeeSalaryAssignment`** (new
`effective_from`, full replacement `overrides` list), which automatically
supersedes the previous one. That's actually the right pattern for payroll
(clean history of what changed and when) — the web UI just needs to compose
"current overrides, plus/minus the one being added/removed" and submit it as
one new assignment rather than trying to PATCH a single line in place.

**Confirmed backend bug — must fix before "Add" can work.** Traced
`resolve_components()` in `salary_resolver.py` line-by-line: overrides are
only applied by looking up `overrides.get(line["component_id"])` against
lines that already exist in the structure snapshot/live structure. An
override for a component that **isn't** in the base structure is silently
dropped — it's never appended, so it never shows up in payroll. Worse,
`create_assignment` has an "overrides-only" path (`structure_id=None`)
that its own comment implies is supported, but `resolve_components` hits an
early `return components=[]` for `structure_id is None` *before* the
override-merge step even runs — so overrides-only assignments resolve to
nothing today. "Add a new allowance nobody else on this structure has" does
not currently work; it needs this fix:

- [ ] Backend `salary_resolver.py`: after overlaying overrides onto matching
      `effective` lines, append any override whose `component_id` isn't
      already in `effective` as a new resolved line (load the
      `SalaryComponent` directly for kind/category/is_taxable/
      statutory_base_codes).
- [ ] Backend `salary_resolver.py`: remove/adjust the early
      `if not has_snapshot and assignment.structure_id is None: return []`
      guard so overrides-only assignments still reach the override-merge
      step instead of short-circuiting to empty.
- [ ] "Remove an allowance" needs no schema change — set the override's
      `amount` to `0`. It'll resolve as a $0 line (normal/expected in
      payroll output), which is simpler than adding an "excluded" flag.

- [ ] Web: in the employee profile screen, add an "Allowances & Deductions"
      section (next to or replacing the current "Allowances" field in
      `SalaryConfigModal.tsx`) that reads the employee's current resolved
      components via `GET /private-users/{id}/salary/preview` (already
      exists, returns `ResolvedSalary`).
- [ ] Web: "Add" flow — pick a component from the company's catalog
      (`SalaryComponent`, same catalog the structure-template editor already
      uses) or create a new one inline (reuse `CreateComponentModal.tsx`),
      enter an amount, submit as a new assignment with the existing overrides
      plus this one.
- [ ] Web: "Remove" flow — submit a new assignment whose overrides list
      includes that component with `amount=0` (see resolver fix above; this
      is the confirmed mechanism, not an open question anymore).
- [ ] Backend: double-check `create_assignment`'s back-dating/finalized
      period guard covers "edit today's still-open assignment" cleanly — the
      web flow will call this endpoint far more often once it's UI-driven,
      not just at onboarding.
- [ ] Decide + document: does the legacy `Salary.allowance` field stay as a
      "base allowance" that's separate from Module 8 components, or does it
      get migrated into a `TRANSPORT`/generic component and retired? Mixing
      both is how the system ends up with two sources of truth for "what is
      this person's allowance" — recommend picking one now rather than
      shipping both.
- [ ] Manual test: add two allowances and one deduction to an employee, run
      `GET .../salary/preview`, confirm the totals reflect all three; remove
      one, confirm it's gone from the next preview and the prior assignment
      is preserved in history (effective_to set, not deleted).

**Effort:** ~2–3 days (UI is the bulk of it; backend is mostly wiring
existing endpoints, plus the exclusion-semantics check above).

---

## 4. Allowance/deduction: daily frequency + percentage-vs-amount

**Scope decision (no reply after two asks — proceeding on this basis):**
build both the daily-frequency feature *and* wire up the existing dead
`prorate_on_partial_month` flag, since the latter is a correct, low-cost fix
regardless of which scenario prompted the original ask, and the former is
what was literally requested. Also building percentage-of-basic support,
since that was explicitly asked for even though it doesn't exist anywhere in
the code today (checked `SalaryComponent`, `SalaryStructureLine`,
`EmployeeSalaryOverride`, the payroll engine — the only percentage math
anywhere is in the unrelated 13th-month/gratuity bonus-rules system,
`CountryBonusRule.rate` / `formula='percent_of_basic'`). Details below.

There's an existing, *unwired* piece of infrastructure worth fixing alongside
this regardless of motive: `SalaryComponent.prorate_on_partial_month` exists
and is captured through the resolver, but `payroll_engine.py`'s
monthly-proration path (~line 1260) prorates every structure-sourced earning
component uniformly for joiners/leavers and never actually reads that flag —
it's dead code today.

- [ ] Backend `payroll_engine.py` (~line 1260): make the monthly-proration
      loop check each component's `prorate_on_partial_month` flag instead of
      applying the multiplier unconditionally to every structure-sourced
      earning — components with the flag off keep their full amount even for
      a partial-month joiner/leaver.

**Daily building block already exists.** `services/proration.py` has
`working_days_in_period(db, country_code, start, end)` — a working-day count
(calendar days minus weekends/public holidays) already used for
`pay_basis='daily'` base-salary proration (`payroll_engine.py:1151`,
`"daily → BASIC := working_days_in_period × daily_rate"`). "Daily frequency"
for an allowance/deduction should reuse this exact concept: a daily
allowance's per-period amount = `daily_amount × working_days_in_period`, not
`sum_hours_worked_in_period` (attendance-based) — the two are different
things (scheduled working days vs. actual attendance) and the plan commits to
the schedule-based one, matching how `daily_rate` already works. Flag this
choice to Ivor/payroll if actual-attendance-based daily allowances (e.g. only
paid for days the employee actually clocked in) are what he wants instead —
that's a different (and cheaper-for-the-employer) semantics and would reuse
`sum_hours_worked_in_period` instead.

- [ ] DB migration: add to `SalaryComponent` (and mirror on
      `SalaryStructureLine`/`EmployeeSalaryOverride`, since amount lives at
      all three levels):
      - `frequency VARCHAR(10) NOT NULL DEFAULT 'monthly'` (`monthly` |
        `daily`)
      - `value_type VARCHAR(10) NOT NULL DEFAULT 'amount'` (`amount` |
        `percent_of_basic`) — **only if percentage is in scope**, see above.
- [ ] Backend `salary_resolver.py`: when computing a component's value for a
      period —
      - `frequency='daily'` → `amount × working_days_in_period(...)` for the
        payroll period being resolved.
      - `value_type='percent_of_basic'` → `rate × resolved BASIC component`
        for that same period (need BASIC resolved first — check resolution
        order in `resolve_components`, since percent-of-basic components must
        be computed after BASIC is known, same ordering constraint the bonus
        engine already handles for `percent_of_basic`).
- [ ] Backend `payroll_engine.py`: confirm `allowances_total`/deductions
      aggregation still holds once components can be daily-prorated —
      partial-month joiners/leavers already run through
      `compute_proration_factor`; make sure a daily component isn't
      double-prorated (once for daily frequency, again for partial-month
      factor) when an employee joins mid-month.
- [ ] Web `CreateComponentModal.tsx` / the new per-employee override UI from
      Item 3: add `frequency` (Monthly/Daily radio) and, if in scope,
      `value_type` (Amount/Percentage radio, with a `%` suffix input when
      percentage is selected) to the create/edit form.
- [ ] Web: on the resolved-salary preview, show daily components as
      "amount/day × N working days = total" so admins can sanity-check the
      math, not just a final number.
- [ ] Manual test: create a daily transport allowance of 50 MUR/day on an
      employee with 22 working days in the period, confirm the payslip shows
      1,100 MUR for that line; create (if in scope) a 5% percent-of-basic
      deduction and confirm it tracks changes to BASIC.

**Effort:** ~2 days for daily-only; **~3.5–4 days** if percentage is also in
scope (percentage touches ordering/dependency logic in the resolver that
daily-only doesn't).

---

## Total estimate

~6–8.5 working days across all four items, depending on the Item 4 scope
call. Items 1–2 can ship independently and quickly; 3–4 should be scoped/built
together since they touch the same models and UI surface.
