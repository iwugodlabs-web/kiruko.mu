# Payroll Correction & Dispute Loop-Closers — Plan

Status: proposed · Created 2026-06-21 · **Direction set 2026-06-21**

## Decision (2026-06-21)
**Fix only the affected payslip / complaint — per-employee correction. No
whole-run Redo as the normal path.** A correction touches one employee, posts
the delta, leaves everyone else (and the original payslip) untouched. This is
how mature payroll systems do corrections (off-cycle / adjustment runs), and it
removes the worst risks of the whole-run Redo.

## Context
A concern raised from a payslip is **structurally linked** to the run/payslip
(`UserRight.payroll_run_id` / `payslip_id`, shipped 2026-06-21), so a correction
can flow straight from the complaint. The whole-run Redo
(`POST /payroll/runs/{run_id}/redo`) remains only as a last-resort/legacy tool.

### ⚠️ Finding
There is **no payslip-finalize notification anywhere today** — employees are
never told a payslip is ready; they just see it in the app. So "notify on
correction" is a *new* capability, and the Redo dialog's claim *"Employees
already notified of the old payslips…"* is **inaccurate** and should be fixed.

---

## Spike findings (2026-06-21)
- **No payment/disbursement tracking exists.** `finalized` is the end state;
  there is no "paid" status on PayrollRun/Payslip. ⇒ a correction is a **ledger
  amendment** (records the corrected figures + delta); the employer settles the
  actual money (top-up / claw-back) **outside Kiruko**.
- **PAYE is per-period** (annualize → progressive brackets → ÷12), NOT
  cumulative/YTD ⇒ a one-month correction recomputes PAYE for that month alone;
  no YTD context needed. Brackets are progressive, so recompute (don't scale).
- **MRA/statutory filing: N/A** — verified there is no in-system filing/export,
  so no amended-return concern (the spike's MRA caveat doesn't apply here).
- **Run structure:** `uq_payroll_run_company_period` blocks a 2nd non-cancelled
  run per period ⇒ the **adjustment payslip attaches to the ORIGINAL run** with
  `parent_payslip_id` + `is_adjustment`. Original payslip stays immutable.
- **Loan/statutory idempotency:** recompute on the corrected figures, post the
  **delta** as new rows tagged to the adjustment payslip — never mutate originals.
- **No existing per-employee correction primitive** — only whole-run Redo.

**Verdict: 100% — LOCKED (2026-06-21).** Decision: ship **ledger-only**
corrections now — Kiruko records the corrected payslip + the delta (owed /
claw-back); the employer settles the actual money outside the app. The UI must
say this plainly. Payment-tracking (`paid_at`/`payment_method`, auto-settle) is
an explicit **future phase**, not a blocker. All other unknowns resolved:
- delta-of-delta: allowed (counter-adjustment chained via parent_payslip_id).
- loans/statutory: delta posted as NEW rows tagged to the adjustment; originals
  never mutated.
- PAYE: recomputed for the corrected month (per-period, progressive brackets).
- MRA: N/A (no in-system filing).

## Phase 1 — Per-employee payslip correction (the spine)
Decided: **delta = a separate adjustment payslip** linked to the immutable
original (cleaner audit; original untouched).
Statutory: confirmed **no in-system MRA/CSG/NSF filing exists** — statutory is
only computed/shown on the payslip, never submitted. So a correction needs **no
in-system amended-filing handling**; any external/manual re-filing is the
employer's process, out of scope.
- [ ] Backend: correct a **single** finalized payslip — recompute that one
      employee, create an **adjustment payslip** linked to the original
      (original stays immutable & on record). Post the **delta** (owed / claw-back).
- [ ] Idempotency: CSG/PAYE/NSF + loan ledger must net the delta, not
      double-count (reuse the redo loan-reversal approach, delta-scoped).
- [ ] Drive it from the complaint: a "Correct this payslip" action on the
      linked dispute (and on the finalized payslip in the web payroll UI).
- [ ] Endpoint + permission gate (`manage_payroll`); audit every correction.
- [ ] Tests: delta posting, idempotent statutory/loan, original preserved.

## Phase 2 — Close the loop (now trivial, single employee)
- [ ] Notify **only the affected employee**: *"Your {period} payslip was
      corrected — net pay updated."* (Localize en/fr/mg.)
- [ ] Surface the linked dispute: append a system note (`internal_notes` +
      `concern_audit`) *"Payslip corrected on {date}"*, optionally bump status
      → `action_taken` via a legal transition. **Never auto-close** — the
      employee confirms.
- [ ] Re-point the dispute link to the adjustment payslip if needed.
- [ ] Fix the Redo confirm-dialog wording (remove the false "already notified").
- [ ] Tests.

## Phase 3 — DROPPED (Redo is a dev/testing tool only)
Decided 2026-06-21: **whole-run Redo is for dev/testing, not a production
correction path.** Per-employee correction (Phase 1) is the only production
fix. So the paid/filed guardrails are unnecessary — Redo isn't a tool users
reach for in prod.
- [ ] Gate Redo behind a **config flag** so it only works in dev/testing.
      e.g. `ENABLE_PAYROLL_REDO` env (default **off**; on in dev/.env). The
      `/payroll/runs/{id}/redo` endpoint returns 403/404 when off, and the web
      hides the Redo button unless the flag is on. Small, safe, prevents
      accidental prod use.

---

## Risks / cons to watch (under the per-employee model)
1. **No finalize notification exists** — "notify on correction" is net-new, and
   the Redo dialog currently lies about it. Fix the wording.
2. **Statutory amendment — RESOLVED/low.** No in-system filing exists (verified
   2026-06-21): statutory is computed/displayed only, never submitted. A
   correction has no in-system filing impact. Residual risk is purely external
   (if the employer manually filed the old figure with MRA, they re-file
   manually — the system neither tracks nor breaks that).
3. **Already-paid** — correct via a **delta** (what's still owed / to claw back),
   never a silent overwrite. The per-employee delta model is the mitigation.
4. **Immutability/audit** — always keep the original payslip + a linked
   adjustment; audit every correction.
5. **Grievance fairness** — surface the fix on the dispute, but the employee
   confirms before close. Never auto-close.
6. **Largely gone vs whole-run Redo:** collateral changes to *other* employees,
   whole-period already-paid desync, whole-run re-filing — all avoided because a
   correction touches one person.

## Sequencing
1. **Phase 1** (single-payslip correction + delta) — the foundation; spike the
   statutory-amendment question first.
2. **Phase 2** (notify + dispute surface) — small once Phase 1 lands.
3. **Phase 3** (Redo guardrails) — optional safety on the legacy path.

Plan quality ~80%. Open unknowns: statutory-amendment handling and the exact
delta representation (adjustment payslip vs line items on a correction run).
