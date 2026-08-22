# Employee Country Assignment Plan — Missions & Transfers

Status: **Draft v2 — design only, no code written.**
Author: IwuGod / platform team
Date: 2026-07-20 (v2: full risk/tradeoff coverage)

---

## 1. Executive summary

Users can be sent on a **foreign mission** (temporary work abroad, same employer) or be
**transferred** (permanent move — within the same company or to a different company).
Today the platform has no way to represent a change of country for a user: an employee's
country is always the employer's (`Company.country_code`), and only independent users can
self-set a `country_code`.

This plan introduces **effective-dated country assignments** (`employee_country_assignments`)
and a **date-aware resolution** of an employee's effective country, replacing the current
static resolution. It is phased so that low-risk **display** changes ship first, while
payroll-affecting behavior (mission-country tax rules, FX) is gated behind legal review and a
separate currency design.

---

## 2. Current state (verified against code)

| Aspect | Where | Behavior |
|---|---|---|
| Company country | `core/model.py:202` `Company.country_code` | Employer's country; default `MU` |
| Employee self country | `core/model.py:119` `PrivateUser.country_code` | Only used when no company |
| Effective country | `core/model.py:150-185` `PrivateUser.effective_country_code` | **Property, no date arg.** Order: company → self → phone → `MU` |
| Serialization | `schema/user_schema.py:179` | `effective_country_code` on user payloads |
| Payroll country | `services/payroll_engine.py:1705-1901` | Resolved **per-run from `company.country_code`** (~12 call sites: fiscal-year start, public holidays, work days, overtime rule, tax snapshot) |
| Multi-employer | `core/model.py:131` `PrivateUser.jobs` | One employee can hold jobs at **multiple companies** |
| Payroll-run lifecycle | `core/model.py:737` + `shared/types/payroll.ts` `PayrollRunStatus` | `draft` → `finalized` → `cancelled`; finalized = immutable |
| Currency model | `mobile/app/context/CurrencyContext.tsx` | `baseCurrency` (MUR default) + `currency` (display) + per-salary stored currency |
| Existing tests | `tests/test_effective_country_code_phone_inference.py`, `tests/test_update_user_country_code.py` | Pin current `effective_country_code` behavior |
| "Transfer" today | `core/model.py:1048` | **Money transfer** — unrelated to this feature |

---

## 3. Goals & non-goals

### Goals
1. Model a user's **country** changing over time (mission / transfer), effective-dated.
2. Resolve an employee's **effective country per date** (for display, filters, and — later — payroll).
3. Support **both** transfer kinds: same-company location move and cross-company move, without breaking multi-employer reality.
4. Keep **existing behavior identical** for users with no assignment.
5. Phase 1 (display/currency) ships independently of Phase 2 (payroll).

### Non-goals (explicit)
- **Not** granular geo/location (city, office, street) — country-level only, per stakeholder decision.
- **Not** FX engine — only a per-run reporting snapshot for shadow figures (home net pay stays
  in stored currency; no in-engine conversion).
- **Not** work-permit/visa document management (out of scope; tracked as related work).
- **Not** retroactive editing of *finalized* payroll runs (see §9.3).

---

## 4. Decision record — alternatives considered

| Option | Pros | Cons | Decision |
|---|---|---|---|
| **A. Effective-dated `employee_country_assignments` table** (chosen) | Clean history; mirrors existing `EmployeeSalaryAssignment` pattern; date-aware by design; supports backfill | New table + migration; resolution must become date-aware | ✅ **Chosen** |
| B. Add `mission_country_code` / `mission_start` / `mission_end` columns on `PrivateUser` | Minimal, no new table | No history; only one mission at a time; mixes concerns; no audit; no reason/metadata | ❌ Rejected |
| C. Overload `PrivateUser.country_code` (just let employees set it) | Trivial | Breaks "employee inherits employer country" rule; no dates; payroll silently wrong; no audit | ❌ Rejected |
| D. Reuse `Job` as the transfer vehicle (change `Job.company_id`) | Existing model | A job isn't a country period; missions aren't job changes; mixes job history with location; no effective dates | ❌ Rejected |

**Why A:** it isolates the new concern, gives effective dates and history, and is consistent with
the proven `EmployeeSalaryAssignment` pattern already in production.

---

## 5. Data model

### 5.1 `employee_country_assignments`

```
private_user_id   FK -> private_users                        (not null)
country_code      FK -> countries.code                       (not null)
reason            String(32)                                 # mission | transfer_same_company | transfer_new_company
effective_from    Date                                       (not null)
effective_to      Date                                       (null = open-ended)
new_company_id    FK -> companies (nullable)                 # required iff reason='transfer_new_company'
notes             Text (nullable)
created_by        FK -> users (not null)
created_at / updated_at                                      (server defaults)
archived_at       DateTime (nullable)                        # soft delete for audit
```

Constraints:
- **Partial unique index** on `(private_user_id)` where `effective_to IS NULL` → at most one open assignment.
- **No overlap** check across ranges for the same user (transaction-level `ExclusionConstraint` if the DB supports it, else an application check under a row lock; validate in `create/update` and re-validate on `effective_to` updates).
- `reason='transfer_new_company'` **requires** `new_company_id` and it must reference an **active** company.
- `country_code` must be an **active** country (`countries.is_active`) — mission to a deactivated country rejected.
- `effective_to >= effective_from` enforced.

### 5.2 Audit
Every create / end / archive writes an `AuditLog` entry (`company:<company_id>`, actor, reason,
`country:<code>`, effective range) — consistent with the rest of the codebase.

---

## 6. Resolution — date-aware effective country

### 6.1 Signature
Replace the property with a function, keep the property as a "today" convenience:

```python
# core/model.py
def effective_country_code(self, as_of: date | None = None) -> str:
    as_of = as_of or date.today()
    assignment = active_country_assignment(self.private_user_id, as_of)  # new
    if assignment:
        return assignment.country_code
    if self.company_id and self.company and self.company.country_code:
        return self.company.country_code
    if self.country_code:
        return self.country_code
    # phone inference, then 'MU' (unchanged)
```

Priority (new): **active assignment → company → self → phone → `MU`**.

### 6.2 Call-site inventory (must all be updated or documented)
- `schema/user_schema.py:179` — payload field. Add `effective_country_code` stays (today); optionally expose `active_country_assignment` for the UI.
- `tests/test_effective_country_code_phone_inference.py`, `tests/test_update_user_country_code.py` — extend, keep existing cases passing (no-assignment behavior unchanged).
- Admin lists/reports that filter by country — switch to the date-aware function (default today).
- Mobile/Web displays of country — unchanged for today, but now also render assignment status (Phase 1).
- Grep for every `.effective_country_code` consumer during implementation; none may assume static company precedence.

### 6.3 Backward compatibility
No assignment ⇒ identical result to today. All existing tests must pass unmodified (that is the
definition of success for Phase 1 resolution).

---

## 7. Transfer semantics

### 7.1 Same-company location move (`transfer_same_company`)
Pure country change: create an assignment; **no** `company_id` change; **no** job/salary migration.
Affects display currency + (later) payroll country rules. Simplest path.

### 7.2 Cross-company transfer (`transfer_new_company`) — multi-employer aware
The codebase allows one employee to have **multiple jobs at different companies**
(`PrivateUser.jobs`). A cross-company transfer therefore means:

1. Create the assignment with `new_company_id` (this becomes the **primary** country source).
2. **Re-point primary affiliation**: update `PrivateUser.company_id` to `new_company_id`
   (if the employee is not already affiliated there via another job). If they ARE already
   multi-affiliated, treat the transfer as changing the *primary* company only — do **not**
   destroy other job rows.
3. Do **not** delete/migrate legacy salary/job data automatically. Add an explicit
   "transfer" action in the job-history flow so old-company payroll remains intact.
4. All of the above in **one transaction** with the assignment write; roll back on any error.

> Decision point (open): whether a cross-company transfer should be a single "re-point
> primary" action or a **two-sided** action (end employment at old company + onboard at new).
> Default recommended: re-point primary + keep old job as historical/secondary; revisit if
> product wants a hard cut-over.

---

## 8. Phased rollout

### Phase 1 — Display & currency (safe, no payroll impact)
- Backend: model + migration + CRUD + resolution function + payload exposure.
- Employee detail (web + mobile): "Location / Country" section showing current status
  ("On mission in TZ 🇹🇿 since 2026-07-01") + start/end/history.
- Currency display hierarchy for compensation cards (see §8.2).
- Non-MUR confirmation UX on any country-affecting change (reuse mobile settings pattern).

### Phase 2 — Mission payroll: home-country engine + host-country shadow run (definitive)
**Decision (2026-07-20, industry-verified):** adopt the **"home engine + shadow payroll"** model.
The payroll run continues to compute the employee's actual net pay with **home-country rules**
(`company.country_code` — unchanged); for mission/transferred employees we add a **parallel
shadow/reporting run** using the host-country rules for statutory withholding and social
security, **for reporting/remittance only — no salary is paid through it.** This is the
industry-standard mobility pattern (ADP, GTN, Remote, Airswift).

**This removes the earlier "per-employee country switch in the run" design.** Do **NOT** thread
per-employee country into the ~12 `payroll_engine.py` call sites. Scope becomes:

1. **Shadow computation** (new): for assigned employees, re-run the existing country-keyed
   rules (`payroll_rules.resolve(host_country)`) against the same earnings to produce shadow
   tax/SS figures. Reuses the existing `(country_code, code)` rules — no engine restructuring.
2. **Schema**: on `payslip` — `shadow_country_code`, `shadow_gross`, `shadow_tax`, `shadow_ss`
   (host figures reported in host currency).
3. **FX snapshot**: a guaranteed/reference exchange rate captured **when the run is created**
   (per-run snapshot ⇒ finalized runs stay immutable). Used only for *reporting* any converted
   amounts; home net pay stays in stored currency (see §8.2 §11.1).
4. **Split-period policy** (required): mission starts mid-period → host shadow days prorated;
   home pay unchanged. Keyed to `effective_from`/`effective_to` ∩ period.

**Threshold — only for missions that create host tax residency** (~183 days / >6 months,
per ADP). Short missions are typically payroll-exempt (often via dispensation) and do **not**
need shadow runs. The assignment must carry an `hours/days` hint or the engine must know the
expected mission length to decide whether shadowing triggers.

**Legal gate becomes a policy decision, not an engine decision:** choose **tax equalization**
(employee stays net-neutral; employer covers host/home delta — default for assignments) vs
**tax protection** (employee keeps host tax savings) vs unprotected. A written policy + annual
true-up/reconciliation is required; it is **not** a per-run engine concern.

### Phase 3 — History & reporting
- Mission/transfer timeline per employee; report filters by active country assignment;
  export of assignment history.

### 8.0 Implementation status
**Decisions locked (2026-07-30):** tax policy **tax equalization**; FX source **BOM daily
Consolidated Indicative rate**, frozen per run at creation. Phase 2 is **implemented** on branch
`feat/employee-country-assignments` (backend): `services/fx_service.py` (BOM RSS fetch +
`build_run_fx_snapshot`/`rate_for`), shadow compute in `compute_for_resolved` +
`payroll_rules.compute_shadow`, columns
`payslips.shadow_{country_code,currency,gross,taxable_income,tax,ss,equalization_due}` and
`payroll_runs.fx_{snapshot,source,as_of}`, migration `shadow_payroll_20260730`, web payslip
`ShadowSection`, shared types. Tested: `tests/test_shadow_payroll.py` + payroll/route suites green.

**Latest (2026-08-07):** seeded placeholder TZ shadow-payroll rules —
`backend/scripts/seed_tz_shadow_rules.py` (PAYE monthly bands + NSSF_EE/ER), wired into pytest
bootstrap (`tests/conftest.py`) and applied to the **live DB**. The shadow e2e test now asserts
non-zero host figures (`shadow_tax`, `shadow_ss`, `shadow_equalization_due`). Because TZ now has
rules, item (b) below is closed for TZ: a MU→TZ mission produces a real host-country shadow figure
instead of `0` + `shadow_missing_rules`.

**Open:** (a) shadow PAYE uses a static FLAT_PERIODIC application (reporting estimate, no
cumulative-withheld); (b) host rules must be seeded per host country for non-zero figures —
seeded so far: **MU** (full) and **TZ** (shadow-only, placeholder values flagged `VERIFY WITH
ACCOUNTANT`); any other host country yields `0` + a `shadow_missing_rules` flag until seeded;
(c) the ~183-day residency trigger (item 4 below) is a policy decision, NOT yet enforced by the
engine — every active assignment's host is shadowed. It is surfaced as an **informational
`residency_qualified` flag** in the Phase 3 report, for the employer to review (no auto-switch).

**Phase 3 — History & reporting (implemented 2026-08-07):** company-scoped report
`GET /companies/{company_id}/country-assignments/report` with filters (`as_of`, `country_code`,
`reason`, `status`, `include_archived`) and `format=csv` export; derives per-row
`{status, host_days, residency_qualified}`. Web: `CountryAssignmentsReport` panel on the Reports
page (status/type filters, residency badge, CSV export). **Cross-company transfer UI
implemented:** `GET /api/v1/companies?q=` company search (any company admin) + `transfer_new_company`
option in the employee Location panel with a destination-company picker (re-points `company_id`).

**Phase 3 — History & reporting (implemented 2026-08-07):** company-scoped report
`GET /companies/{company_id}/country-assignments/report` with filters (`as_of`, `country_code`,
`reason`, `status`, `include_archived`) and `format=csv` export; derives per-row
`{status, host_days, residency_qualified}`. Web: `CountryAssignmentsReport` panel on the Reports
page (status/type filters, residency badge, CSV export). **Cross-company transfer UI
implemented:** `GET /api/v1/companies?q=` company search (any company admin) + `transfer_new_company`
option in the employee Location panel with a destination-company picker (re-points `company_id`).

### 8.1 Suggested implementation order
1. Migration + model + CRUD + resolution (+ unit tests, existing tests green).
2. Payload + web employee-detail section (start/end/history).
3. Mobile display + non-MUR confirmation.
4. Phase 2 payroll (implemented — see §8.0; remaining: seed host rules + residency trigger policy).

---

## 9. Risks & mitigations (complete)

| # | Risk | Severity | Mitigation |
|---|---|---|---|
| 1 | **Date-aware resolution refactor** — property has no date arg; many consumers assume static precedence | High | Call-site inventory (§6.2); keep property as "today" alias; no-assignment behavior byte-identical; existing tests as regression gate |
| 2 | **Payroll blast radius** — country drives fiscal year, public holidays, work days, overtime, tax | High | **Mitigated by design change:** home-engine + shadow model means the ~12 engine call sites stay on `company.country_code`; only an additive shadow computation touches host rules. Per-run snapshot keeps finalized runs stable; run all engine tests + a mission-employee golden test |
| 3 | **FX / currency** — no rate source or hierarchy exists | High | Shadow/reporting only: per-run **guaranteed/reference rate snapshot** at run creation; home net pay stays in stored currency (no in-engine conversion). Phase 1 keeps display-only conversion via existing `CurrencyContext` `convert()` |
| 4 | **Split-period payroll** (mission starts mid-month) | High | **Shadow-only proration** — host shadow days prorated for reporting; home pay unchanged. Explicit proration policy keyed to effective range ∩ period; add to engine tests before enabling |
| 5 | **Backdating / retroactive recompute** | Medium | `effective_from` may be in the past, but finalized runs are **immutable**; recompute only draft runs; warn admin on backdate that affects a finalized period |
| 6 | **Multi-employer conflict** — single `new_company_id` vs multiple jobs | Medium | Transfer = re-point *primary* company; never delete other job rows; explicit history action (§7.2) |
| 7 | **Currency hierarchy ambiguity** — display vs base vs stored currency | Medium | Define hierarchy in §8.2; mission currency affects *display* only in Phase 1 |
| 8 | **Permission / approval** | Medium | Start/end requires `manage_salary_structures`-level or new `manage_employee_locations` permission; audit-logged |
| 9 | **Inactive/unknown country** | Low | FK to `countries.code` + `is_active` check |
| 10 | **Legal/statutory** (mission-country taxes) | High (product) | Narrowed to a **policy decision** (tax equalization vs protection vs unprotected) + annual true-up; shadow run reports host statutory figures without changing home net pay; Phase 1 never claims payroll correctness. Full legal sign-off still gates Phase 2 |
| 11 | **Soft-delete vs history** | Low | `archived_at` soft delete; timeline derives from rows, archive only removes from "active" resolution |
| 12 | **Test drift** — existing tests assert old resolution | Medium | All existing country tests must pass unchanged in Phase 1; add new tests for assignment precedence |

### 8.2 Currency display hierarchy (Phase 1)
For any amount shown on an employee's card/screen, resolution order:
1. **Per-salary stored currency** (unchanged — the payroll source of truth).
2. If the employee has an **active country assignment**, and the screen is country-scoped
   (e.g. location/mission summary), display in the **assignment country's currency**.
3. Otherwise, existing behavior (company currency / user display currency).

`CurrencyContext` display-currency and `baseCurrency` remain untouched for the user's own
settings; assignment currency only changes *per-employee* views.

---

## 10. Tradeoffs — pros & cons of this plan

### Pros
- **Effective-dated, historical** — unlike a flat `country_code`, every country change is
  auditable and recomputable for any past date.
- **Consistent with existing patterns** (`EmployeeSalaryAssignment`, `AuditLog`) — low
  cognitive load for the team, reuses working machinery.
- **Backward compatible** — no-assignment users behave identically; existing tests are the gate.
- **Phased** — display value ships without payroll/compliance risk.
- **Multi-employer aware** — doesn't destroy other jobs on transfer.
- **Explicitly gated hard parts** (FX, legal, split-period) behind sign-off.

### Cons / costs
- **New table + migration** and a **resolution refactor** with a wide call-site blast radius
  (though the Phase 2 re-scope keeps the payroll engine call sites untouched).
- **Phase 2 still requires legal sign-off** for the equalization/protection policy and the
  shadow-run correctness; the plan ships **display** first, so full payroll for missions is
  NOT delivered by Phase 1 (only display + shadow reporting in Phase 2).
- **No granular location** — country-only may be insufficient for work-permit/city-level
  compliance (accepted per stakeholder).
- **Split-period complexity** is reduced but not free: shadow proration still adds engine work.
- **FX only for reporting** — a snapshot rate is captured per run, but there is no authoritative
  conversion engine for *employee-facing* amounts beyond `CurrencyContext` display conversion.
- **Two-sided transfer semantics** not fully specified (open question).

---

## 11. Open questions (must resolve before implementation)

1. Phase 2 FX: **RESOLVED (2026-07-30)** — BOM daily consolidated indicative rate, per-run
   snapshot at run creation (`services/fx_service.py`, migration `shadow_payroll_20260730`).
2. Legal: **RESOLVED (2026-07-30)** — tax policy = **tax equalization** (default); the ~183-day /
   6-month host-residency trigger is a policy decision, NOT yet enforced by the engine (every
   active assignment's host is currently shadowed) — needs legal/finance sign-off before Go-Live.
   Still to confirm: whether host shadow withholding/remittance is required per destination.
3. Cross-company transfer: re-point primary vs. two-sided cut-over (§7.2)? Web pickup still needs
   a company-search endpoint (`/company` is platform-admin-only).
3. Cross-company transfer: re-point primary vs. two-sided cut-over (§7.2)?
4. Permission surface: new `manage_employee_locations` permission vs. reusing
   `manage_salary_structures`?
5. Should the mobile employee profile show an active mission **end date / countdown**?
6. Notifications: alert employer on mission start/end (e.g. when `effective_to` is near)?

---

## 12. Rollout & rollback

- **Ship** migration first (additive only), then CRUD, then resolution, then UI. Additive
  schema = instant rollback (drop table, keep old resolution path behind a feature flag).
- **Feature flag**: `employee_country_assignments` enabled for a pilot company; flag off
  restores the exact current `effective_country_code` logic.
- Phase 2 ships only when the tax policy (equalization/protection), FX snapshot source, and
  shadow-run correctness are signed off and tested.

---

## 13. Test plan (new)

- Resolution: precedence (assignment > company > self > phone > MU) per date; open-ended and
  closed ranges; no-assignment identity with existing suite.
- CRUD: overlap rejection, one-open-assignment constraint, inactive-country rejection,
  `transfer_new_company` requires `new_company_id`, transaction rollback.
- Payroll (Phase 2): mission-employee golden test — home net pay unchanged, host shadow
  figures correct (incl. mid-period proration); finalized-run immutability on backdate.
- UI: web start/end/history; mobile display + non-MUR confirmation.
- Backward-compat: all existing `effective_country_code` tests unchanged.

---

## 14. Appendix — verified call-site references

- `core/model.py:150` `effective_country_code` property; `:119` `country_code`; `:202` `Company.country_code`.
- `schema/user_schema.py:179` serialized `effective_country_code`.
- `services/payroll_engine.py`: `:1705` snapshot country; `:1713` overtime rule; `:1715` rules snapshot; `:1759,:1779,:1791,:1795,:1804` per-employee compute; `:1881-1901` finalized-run recompute path; `:79,:259` fiscal year; `:402-443,:1021` public holidays; `:652` work days.
- `core/model.py:1048` `Transfer` (money — unrelated).
- `tests/test_effective_country_code_phone_inference.py`, `tests/test_update_user_country_code.py`.
- `mobile/app/context/CurrencyContext.tsx` — `baseCurrency`, `currency`, `convert()`.
