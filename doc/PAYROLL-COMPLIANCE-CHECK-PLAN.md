# Payroll Compliance Check — Plan & Spec

Status: **deferred to post-launch** (see Timing). Architecture verified; scope deliberately narrowed after measuring what already exists.

## Goal
Answer three distinct questions for an employee + pay period:
1. **Are we underpaying vs the legal floor?** (Config vs Standard)
2. **Did the payroll engine pay what our setup says?** (Actual vs Config) — catches engine bugs / bad data
3. **Did the payslip meet the floor?** (Actual vs Standard)

## What we VERIFIED (the de-risking)
- [x] **The payroll engine runs "what-if" with no run persisted.** `payroll_rules.resolve_overtime_rule` + `payroll_rules.resolve` (snapshot) → `_resolve_full(db, emp, period_start, period_end, country)` (read-only: resolves real config + clock-ins + allowances + bonus; the loan-repayment *write* is a separate fn only `finalize_run` calls) → `compute_for_resolved(resolved, snapshot, …)` (docstring: *"Pure: …return the full payslip computation"*). Wrap in a rollback savepoint as belt-and-suspenders. **No reimplementation needed.**
- [x] **Payslips store the full breakdown.** `Payslip.components` (JSONB) = `[{code,label,kind,category,amount,source}]` + per-category totals. So the **Actual lane is a true auto-fill**, and Config↔Actual share the *exact same schema* (Actual is the stored output of the same `compute_for_resolved`).
- [x] **A national minimum-wage floor exists.** `Country.min_wage` (monthly). NOTE: a second source, a `MIN_WAGES` constant in `api/v1/job.py`, is used by the existing check — **dedupe to one source.**
- [x] **The headline check already ships.** `api/v1/job.py` computes per-employee `below_min_wage` (config total vs minimum) + `below_min_wage_count`, surfaced in the company compliance dashboard.

## The honest conclusion: extend, don't rebuild
The single most valuable question ("anyone configured below the legal minimum?") is **already answered** in the product. A full 3-lane tool would mostly duplicate it. Net-new value is only:
- **Overtime/period-aware floor** — today's `below_min_wage` is a flat monthly total vs a flat minimum (no OT, rest-day, or hours awareness).
- **Actual-vs-Config lane** — nothing today verifies the payslip matches what config should produce (engine-bug detection).

## Decided parameters
- **Tolerance:** flag a line only if the gap exceeds **max(Rs 2.00, 0.5% of the line)**; flag gross above **Rs 2.00**. Below = rounding, stays quiet.
- **Canonical rows (5):** group every source's components by category — *Base/Regular* (REG + basic), *Overtime* (OT tiers), *Premiums* (rest + holiday + night), *Allowances* (non-basic, non-bonus), *Deductions* — anchored on *Gross*. All three engines emit `category`/`code`, so this is grouping, not guessing.
- **Verdict UX — no green clearance, by design.** Only two states: red **⚠️ Problem** (below floor or mismatch > tolerance), or neutral grey *"No issues vs the general statutory floor. Sector Remuneration Orders were NOT checked."* Framed as *what we checked / didn't*; if the employer is in a regulated sector, name it. There is no "compliant" badge to misread.

## Hard ceiling (real, not UX)
The engine models only the **general/national** floor. Sector Remuneration Orders (catering, tourism, construction, security, sugar…) are **not** modeled. In Mauritius, catering/tourism dominate — so for those employers the best honest output is *"general floor OK, sector not checked,"* which is **not a real compliance answer**. The single highest-value follow-up is modeling the **dominant pilot sector's** Order.

## Build order
- [ ] **Phase 0 (cheap, do first):** dedupe the min-wage source (`Country.min_wage` vs `MIN_WAGES`), and make the existing `below_min_wage` check use it consistently.
- [ ] **Phase 1:** upgrade the existing check from flat-monthly to **period/overtime-aware** using the verified what-if path (`_resolve_full` + `compute_for_resolved`). Surface in the compliance dashboard. Zero new data dependency.
- [ ] **Phase 2 (post-launch, when runs flow):** add the **Actual-vs-Config** lane reading `Payslip.components` — engine-bug detection. This is the genuinely new tool.
- [ ] **Phase 3:** run Phase-1 across all employees as a background compliance monitor (flag + alert).
- [ ] **Value-unlock (separate):** model the dominant pilot sector's Remuneration Order so the floor answer is real for regulated-sector employers.

## Timing
12 days to launch with D-U-N-S / OTP / kiosk ahead. The headline value already exists, so **none of this is launch-critical.** Do Phase 0 if trivial; everything else post-launch.

## Open items
- [ ] One-off SQL: which sectors are the pilot employers actually in? (decides whether the sector ceiling bites on day one). Prefer a query over a dashboard.
- [ ] Confirm `Country.min_wage` is populated for MU and matches the `MIN_WAGES` constant.
