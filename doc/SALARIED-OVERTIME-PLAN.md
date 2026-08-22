# Salaried Overtime — Compliance Plan (WRA 2019)

> ## ✅ DECISION (2026-06-21): WARN-mode detection ON; auto-pay DEFERRED; pay via manual "Additional duty" rail
>
> **Verdict:** Salaried/monthly overtime is **paid** through the existing manual
> "Additional duty" one-off allowance (`EmployeeOneOffAllowance`, employee
> profile) — employer computes + enters; flows taxable → gross → PAYE/CSG/NSF →
> net → payslip with audit. **Payment stays manual; auto-pay (Phase 3 `auto`
> mode) is DEFERRED** behind the Phase 0 gate.
>
> **What now ships (2026-06-21 update):** the engine's **warn-mode detection** is
> wired on. For a worker an employer classifies `MONTHLY_ELIGIBLE`, the run
> computes the owed s.24 OT via the existing bucketer (priced at s.25 basic÷195)
> and emits a `salaried_ot_review:<hours>:<amount>` flag **without changing pay**.
> The web payslip drawer renders it ("Salaried overtime detected — review and add
> via Additional duty"). This closes the manual rail's worst gap — employers
> silently missing **rest-day / public-holiday** OT — while keeping a human on
> the payment decision. Controlled by `SALARIED_OT_MODE` env: `warn` (default,
> shipped) | `auto` (deferred — wrong-money risk until Phase 0 clears) | `off`.
> Detection is opt-in: default `overtime_eligibility=HOURLY` workers are untouched.
>
> **Why defer the engine fix (not a code problem):** the engine math is sound
> (reuses `overtime_engine.bucket()` + s.25 rate), but auto-paying would rest on
> four things code can't guarantee:
> 1. **Reliable salaried clock-in data** — salaried staff are the least likely to
>    punch a clock; incomplete clock-ins → confidently-wrong OT.
> 2. **Correct per-employee classification** (`MONTHLY_ELIGIBLE` vs `EXEMPT`) — a
>    misclassified bundled-contract worker (s.24(5)) would be **double-paid**.
> 3. **Unresolved legal definitions** — which components count as "basic" for the
>    Rs600k/yr cap; sector Remuneration Order overrides of the 45h norm.
> 4. **No real measurement** — Phase 0 exposure count (prod, ~mid-July) hasn't run.
>
> The manual rail keeps a **human in the loop** across all four — judgment the
> auto-compute would replace with unvalidated assumptions. **Known trade-off:**
> it relies on the employer noticing every OT case; the easy miss is **rest-day /
> public-holiday work** (2×/3×), which doesn't look like "extra hours."
>
> **Revisit when** the two non-code gates clear: (a) prod exposure measurement
> (~mid-July 2026, once pilots have live runs) and (b) lawyer sign-off on the
> s.24(5) bundled-contract + "basic"/threshold questions below. The suspended
> engine code (compute → keep OT buckets → price at basic÷195, gated by
> `SALARIED_OT_MODE` warn/auto) then becomes a confident fix to re-apply. A
> middle step short of auto-pay: **compute + pre-fill** the suggested OT into the
> Additional-duty field for the employer to confirm (no silent miss, no auto-pay).

**Problem.** The payroll engine computes overtime only for the **hourly** pay
basis (`_apply_pay_basis` → `_bucket_hourly_overtime`). **Monthly/daily
(salaried) workers get no overtime at all** — neither in a run nor in a
correction. Under the Workers' Rights Act 2019 this is a statutory entitlement
for salaried staff earning ≤ Rs 600,000/yr basic, so the gap is an
**underpayment risk**, not a cosmetic one.

**Legal basis (WRA 2019, verified against the MRA official text):**
- **s.20** — normal working week = 45 h for *every* worker (not part-time / garde malade).
- **s.24** — OT for *a worker*: 1.5× weekday extra; 2× public holiday (normal hrs); 3× public holiday (after hrs). No monthly/hourly distinction.
- **s.24(5)–(6)** — an agreement *may* state that monthly salary **already includes** OT, **if the max OT hours are specified in writing**. ⇒ the platform cannot assume OT is owed; some salaried contracts bundle it.
- **s.24(7A)** — authorised leave (paid or unpaid) counts as **attendance** for OT computation.
- **s.25** — notional basic hourly rate for a salaried worker: **month = 195 hours** (hourly = monthly basic ÷ 195).
- **s.2 "worker" + s.3** — a person earning **> Rs 600,000/yr basic (≈ Rs 50,000/mo)** is **excluded** from OT (Part V not in the carve-out list). Managers / PRB staff / public officers have separate exclusions.

**Core principle.** The engine *can* compute salaried OT correctly (s.25 + the
already-seeded multipliers). The only blocker is the bundled-contract ambiguity
(s.24(5)). So: **capture the one missing fact per employee, compute when owed,
warn only when genuinely unknown** — on versioned rule data, gated by a
measurement and validated by legal. This is stronger than warn-only and avoids
both underpayment and double-pay.

**Measurement (dev DB, 2026-06-21):** 2 monthly employees, both OT-entitled; a
weekly-hours-only detector found 0 exposure while one worker had 9 rest/holiday
shifts that attract 2× OT. Confirms (a) the scenario is real and (b) detection
must include rest-day/holiday, not just weekly hours. **Re-run against the
pilot/prod dataset before building.**

---

## Phase 0 — Validate (HARD GATE — do not build past this without both)

> **Timing — run the measurement ~2-3 weeks INTO the pilot, not before.** Go-live
> is 29 Jun 2026; at launch prod has no payroll history, so the exposure count
> would read zero for the wrong reason (no data, not no exposure). The script
> (`measure_salaried_ot_exposure.py`) needs employers to have run a few real
> payrolls first. **Target: re-measure ~mid-July 2026**, once the pilot has live
> runs. Until then, salaried OT is a **documented, accepted gap — not a launch
> blocker** (recorded here + in memory). The script can only be run where prod is
> reachable (e.g. the DigitalOcean app), not from the local dev environment.

- [ ] Re-run the exposure query against the **pilot/prod** dataset (not dev), **~mid-July 2026** once live runs exist. Count: monthly + ≤Rs50k/mo + (any week >45h OR rest-day OR public-holiday shift).
- [ ] **Legal sign-off** from the in-house compliance lawyers on four questions:
  - [ ] Is an s.24(5) "salary includes OT" classification valid for our employer types, and what evidence must we capture?
  - [ ] Does a logged employer **acknowledgement** actually discharge the platform's duty / shift liability, or is that unsafe to claim?
  - [ ] Is 45 h/week the right default, or do sector **Remuneration Orders** override it for pilot sectors?
  - [ ] Exact threshold mechanics: "basic" = which component(s); part-year / mid-year rate changes; the "at a rate exceeding" test.
- [x] **Decision (2026-06-21): WARN-mode ON, AUTO deferred** — engine detects + flags owed salaried OT (`salaried_ot_review`, rendered in the web payslip drawer); payment stays manual via "Additional duty". `auto` pay-into-run gated behind `SALARIED_OT_MODE` until the prod measurement + legal sign-off above clear (see decision banner at top).

## How the industry does it (validates the shape)
Mainstream payroll (ADP, Paychex, Gusto, Deel, Sage) all use the same model:
a **per-employee eligibility flag** (FLSA exempt vs non-exempt) → for eligible
staff, **auto-compute OT from time data** into payroll; "approaching-OT" alerts
are a *supplement*, not a substitute. So: the eligibility flag is standard, and
**auto-compute is the destination — "warn-only" is training-wheels**, justified
here only by launch timing + the s.24(5) legal question, not as an end state.

## What ALREADY EXISTS in this codebase (extend, don't rebuild)
A scan found most of the machinery is present and just not wired for the monthly
**pay basis**:
- **`Job.overtime_eligibility`** = `HOURLY | MONTHLY_ELIGIBLE | EXEMPT` (default
  HOURLY) — this IS the industry eligibility flag. **Use it; do NOT add a new
  `overtime_handling` field.** `EXEMPT` ≈ bundled/over-threshold; `MONTHLY_ELIGIBLE`
  ≈ salaried-but-owed-OT. Set via `api/v1/payroll_rules.py` already.
- **`overtime_engine.bucket()`** already resolves `MONTHLY_ELIGIBLE`/`EXEMPT`,
  applies the `monthly_basic_ot_cap` (auto-downgrades over-cap to EXEMPT), the
  45h threshold, rest-day/holiday multipliers, breaks — the real, tested OT math.
- **`_bucket_hourly_overtime`** already calls it — but only from the **hourly**
  pay-basis branch, and it stubs `monthly_basic = None` / uses `salary.hourly_rate`.

**The actual gap is narrow:** the **monthly** branch of `_apply_pay_basis` only
prorates structure components and **never invokes the bucketer**, and the
rate-derivation for a monthly worker (basic ÷ 195) is stubbed. So the build is:
derive monthly_basic + hourly rate, and route the monthly branch through the
**existing** bucketer — not a parallel OT calculator (a hand-rolled estimator was
prototyped and discarded to avoid drift from the real engine).

## Phase 1 — Model the law as versioned rule data (append-only)
*(Follows the existing temporal/auditable pattern — UPDATE forbidden.)*
- [ ] OT-exemption threshold (Rs 600,000/yr basic) as a versioned country rule (not hardcoded).
- [ ] Normal weekly-hours norm (45 default) + **sector Remuneration Order overrides**.
- [ ] Confirm the 195-hour divisor (s.25) is sourced from rule data (seed already uses `monthly_hours=195`).
- [ ] Fix stale citation: seed comment says "s.27" — correct to s.20 / s.24 / s.25.

## Phase 2 — Per-employee eligibility (REUSE existing field)
- [ ] Use the existing **`Job.overtime_eligibility`** (`HOURLY|MONTHLY_ELIGIBLE|EXEMPT`) — no new field.
- [ ] `EXEMPT` covers the s.24(5) "salary includes OT" / over-threshold case (the bucketer already auto-downgrades over-cap workers to EXEMPT via `monthly_basic_ot_cap`).
- [ ] Surface/edit `overtime_eligibility` in the worker-profile UI so employers can classify (currently only settable via the payroll-rules API).
- [ ] Decide the default for salaried staff: keep `HOURLY`, or migrate monthly-pay-basis workers to a deliberate classification (don't silently assume eligible).

## Phase 3 — Wire the monthly branch through the EXISTING bucketer
- [ ] In `_apply_pay_basis`' **monthly** branch: when `overtime_eligibility == MONTHLY_ELIGIBLE`, derive `monthly_basic` from the structure's basic component and `hourly_rate = basic ÷ 195` (s.25), then call `overtime_engine.bucket()` — the same path hourly already uses (rest-day/holiday/45h all handled there).
- [ ] Refactor the log→`BucketerTimeLog` conversion out of `_bucket_hourly_overtime` so monthly + hourly share ONE conversion (no duplicate).
- [ ] Fill the `monthly_basic = None` stub in `_bucket_hourly_overtime` while there.
- [ ] **Warn vs auto = one flag** (`ENABLE_SALARIED_OT_REVIEW`, default off): warn mode emits the bucketer's computed OT as a `salaried_ot_review:<hours>:<amount>` flag WITHOUT adding to pay; auto mode adds the OT components to the run. Same computation, different action.

## Phase 4 — Three outcomes per salaried worker
**Payment rail already exists — reuse it, don't build one.** The worker-profile
"Additional allowance / duty" (`EmployeeOneOffAllowance`) is an ad-hoc **taxable**
earning for a specific month that the engine already consumes at draft + finalize
(`one_off_allowances_service`) → flows into gross → PAYE/CSG/NSF → net → payslip,
with audit. So the build is **detect + compute + suggest into that allowance**,
NOT new overtime-payment plumbing.

- [ ] **auto** (`MONTHLY_ELIGIBLE`, flag on) → the bucketer's OT components go **straight into the run** (same as hourly today) — this is the industry-standard path; corrections inherit it. The one-off allowance remains available for manual top-ups.
- [ ] **exempt/bundled** (`EXEMPT`) → compute nothing; the bucketer already treats EXEMPT as a single REG bucket.
- [ ] **warn / interim** (`MONTHLY_ELIGIBLE`, flag in warn mode, or unclassified-with-exposure) → emit `salaried_ot_review:<hours>:<amount>` with the **bucketer-computed** amount, don't touch pay; employer applies it via the pre-filled Additional allowance and acknowledges before finalize.

## Phase 5 — Surface + audit trail
- [ ] Payslip `flags` rendering (mobile + web `describeFlag` already exist — add the new codes).
- [ ] Run-level warning pre-finalize (reuse `compliance_flags` + warnings UI).
- [ ] Acknowledgement written to `AuditLog` (who, when, which employees) — append-only.
- [ ] Correction recompute + correction-note PDF reflect computed OT.

## Phase 6 — Verify
- [ ] Tests: bundled vs auto vs review; threshold boundary (49,999 vs 50,001); rest-day; public-holiday normal/after; week-straddling-month; leave-as-attendance.
- [ ] Reconcile one hand-computed worked example end-to-end (run → payslip → correction → PDF).
- [ ] Confirm hourly employees are unchanged (no regression in the existing path).

---

## Testing (warn-mode, shipped 2026-06-21)

### 1. Automated (fastest — proves the logic)
```bash
cd backend
.venv/bin/pytest tests/integration/test_payroll_scenarios.py -k salaried -v
```
Two passing rows:
- `..._unclassified_worker_untouched` — a default (`HOURLY`) monthly worker who
  works a rest day gets **no flag, no pay change**.
- `..._warn_mode_flags_without_paying` — a `MONTHLY_ELIGIBLE` worker → the
  `salaried_ot_review` flag is emitted and **gross is unchanged**.

Whole harness (8 rows): `.venv/bin/pytest tests/integration/test_payroll_scenarios.py -v`

### 2. Manual end-to-end (see the flag in the web UI)
Pick a **monthly** employee who clocked a **Sunday / public-holiday** shift in a
month (or add one), then classify them eligible:
```sql
-- dev DB; <pid> = the employee's private_user_id
UPDATE jobs SET overtime_eligibility = 'MONTHLY_ELIGIBLE' WHERE private_user_id = <pid>;
```
1. Backend running with default env (no `SALARIED_OT_MODE` → `warn`).
2. Web app → **Payroll → Runs** → create a **draft run** for that month.
3. Open the employee's **payslip** in the detail drawer.
4. Under **"Payroll warnings"**: *"Salaried overtime detected — ~Xh of rest-day /
   public-holiday / over-45h work (≈ Rs Y at the s.25 rate). Not auto-paid:
   review and add it via Additional duty pay if owed."*
5. Confirm **gross/net unchanged** vs. before classifying — warn never moves money.
6. To pay it: add that amount as **Additional duty** on the profile for that
   month, re-run → it flows into gross → net → payslip.

**Negative check:** set the worker back to `HOURLY` → the flag disappears
(detection is opt-in).

### 3. Mode toggle (restart backend with the env var)
| `SALARIED_OT_MODE` | Effect |
|---|---|
| *(unset)* / `warn` | **shipped default** — flag only, no pay change |
| `off` | no flag, no computation (pre-feature behavior) |
| `auto` | **deferred** — would pay OT into the run; do NOT enable before Phase 0 clears |

### Gotchas
- The flag only fires when the bucketer finds **OT buckets** — the employee needs
  a real rest-day/holiday shift or a >45h week in the period, with clock-ins
  present. Salaried staff who never clock in won't trigger it (known limitation).
- It is **employer-only** (web payslip drawer). The employee's mobile payslip
  intentionally does not render it.

## Scope notes / non-goals
- **No new payment mechanism.** Salaried OT is paid through the existing
  `EmployeeOneOffAllowance` ("Additional allowance/duty") rail, which is already
  taxable + statutory + payslip-integrated. The build adds detection, computation,
  and a pre-filled suggestion — not a payment path.
- This does **not** model every sectoral Remuneration Order's hours — only a
  per-sector override hook; ROs are populated as needed (known unmodeled ceiling).
- Night-premium stays a no-op (no universal MU statutory night multiplier).
- The `auto` computation reuses the existing bucketer + seeded multipliers — no
  new rate logic, just wiring the monthly basis into it.

## Honest quality: ~9/10 **if** Phase 0 validates the assumptions. Build is
**moderate** (engine detection + schema + suggestion UI + tests) — trimmed now
that the one-off allowance supplies the payment rail (no new payment plumbing).
Warn-only was 6.5/10 because it under-detected (rest-day/holiday) and rested on
an unvalidated liability claim. This version computes where the law is clear,
warns where the contract is unknown, **pays via existing infra**, and gates on
measurement + legal — but it is NOT worth starting before Phase 0.
