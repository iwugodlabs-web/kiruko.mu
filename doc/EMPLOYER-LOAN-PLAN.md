# Employer Loan / Salary Advance — Design Plan

**Status:** Draft for review · **Author:** Claude · **Date:** 19 Jun 2026
**Context:** The mobile app already has a **personal loan tracker** (employee self-manages loans from banks/family — `mobile/app/private_dashboard/expenses.tsx`). This plan adds the *separate* standard HR feature: an **employer-provided loan / salary advance** that the employer originates and that is **repaid by payroll deduction**.

Keep the personal tracker exactly as-is. This is a new, parallel concept.

---

## ⚠️ Latent bug this also fixes (important)
`_compute_loan_repayments_for_period` (payroll_engine.py) deducts **every** active loan for the employee — it filters on `status == "active"` only, with **no loan-type filter**. So today, **a personal loan an employee logs in Expenses would be deducted from their Kontokaz payslip.** That's wrong — the employer isn't repaying the employee's car loan. Introducing a loan type and restricting payroll deduction to **employer loans only** fixes this conflation. **This should ship even if the rest of the feature is deferred.**

---

## Is this standard?
Yes — "staff loan / salary advance with payroll deduction" is a core payroll feature (ADP, Sage, PaySpace, etc.), and especially common in Mauritius. The standard lifecycle:

1. **Originate** — employer sets principal, term, installment, interest (staff loans often 0%), start date.
2. **Consent** — employee acknowledges a written agreement **authorizing the payroll deduction** (legally load-bearing).
3. **Disburse** — money paid out (recorded in-app; transfer happens outside).
4. **Deduct** — each pay run deducts the installment until cleared (backend already does this).
5. **Settle on exit** — remaining balance recovered from final pay, within legal limits.

---

## Two loan types — different rules
| | Personal (exists) | Employer (new) |
|---|---|---|
| Lender | Bank/family | The employer |
| Created by | Employee | Employer (HR/admin) |
| Employee can edit terms | Yes | **No** (it reduces their pay) |
| Consent required | No | **Yes** |
| Payroll-deducted | **No** (must stop deducting these) | **Yes** |
| Audit trail | Light | **Full / append-only** |

---

## Data model
Append-only / immutable for the legally-sensitive parts (per the repo's versioned-rules rule).

**Extend `Loan`:**
- [ ] `loan_type` — `'personal' | 'employer'` (default `'personal'`; backfill existing rows to `'personal'`).
- [ ] `company_id` — nullable FK → companies (the granting employer; null for personal).
- [ ] `granted_by_user_id` — nullable FK → users (the admin who originated it).
- [ ] `disbursed_at` — nullable timestamp (null = not yet paid out).
- [ ] Extend `status` vocabulary: `draft → pending_consent → active → paid` (+ `cancelled`, `written_off`).

**New table `LoanConsent` (append-only, never updated):**
- [ ] `id`, `loan_id`, `employee_user_id`, `consented_at`, `terms_snapshot` (JSONB of principal/term/installment/interest at consent time), `method` (`in_app` / `signed_doc`), optional `device`/`ip`.
- The immutable record that the employee authorized the deduction.

**Company-level deduction guardrails** (new settings on `Company` or a settings table):
- [ ] `max_loan_deduction_pct_of_net` (default e.g. `0.33`).
- [ ] `min_net_pay_floor` (company-configured; ideally sector min wage — see "open questions").

**Deferred (future):** `LoanAmendment` (append-only restructure record), interest-accrual schedules.

---

## Lifecycle / state machine (employer loan)
```
draft ──(employer finalizes)──► pending_consent ──(employee consents)──► active
  │                                                                        │
  └──(employer cancels)──► cancelled                  (payroll deducts each run)
                                                                           │
                              active ──(balance == 0)──► paid              │
                              active ──(employer writes off)──► written_off
```
- Terms are **locked once `active`** (immutable; a change = a new amendment record, not an UPDATE).
- Payroll deducts only loans in `active` with `loan_type == 'employer'`.

---

## Payroll engine changes (the trickiest part)
- [ ] **Restrict deduction to employer loans** — `_compute_loan_repayments_for_period` filters `loan_type == 'employer'` AND `status == 'active'` AND consent exists. *(Also fixes the latent bug above.)*
- [ ] **Deduction cap / net-pay floor** — there is currently **no** net floor. Reorder the computation:
  `gross → statutory/PAYE → provisional net → cap loan installment so (net − loan) ≥ floor and loan ≤ pct × net → final net`.
  Carry the un-deducted shortfall to the next period (term extends); emit a `compliance_flag` like `loan_deduction_capped:{loan_id}:{amount}`.
- [ ] Repayment booking already run-linked + idempotent + reversible (shipped in `fix/loan-repayment-redo`) — reuse as-is.

---

## Frontend
**Web (employer) — the real gap today (no loan UI exists):**
- [ ] Loan list per company: employee, principal, balance, status, installment, next deduction.
- [ ] Create employer loan (originate → `draft` → finalize → `pending_consent`).
- [ ] Loan detail + repayment ledger (manual + payroll-booked, **labeled by source**).
- [ ] Mark disbursed; cancel / write-off actions.

**Mobile (employee):**
- [ ] **Consent screen** — review terms + acknowledge (writes `LoanConsent`); until then the loan is `pending_consent` and not deducted.
- [ ] **Read-only** employer-loan view (separate from the editable personal tracker).
- [ ] Per-loan **payslip line** ("Loan repayment — <name>: Rs X") on the payslip, instead of today's bare aggregate.

---

## Milestones
- [ ] **M1 — Model + stop-the-bleed.** Add `loan_type` etc. + migration; restrict payroll deduction to employer loans. *(Ships the latent-bug fix; safe to release alone.)*
- [ ] **M2 — Deduction cap.** Provisional-net reorder + company floor/pct + compliance flag + carry-forward. Pure-engine tests.
- [ ] **M3 — Employer web UI.** Originate / list / detail / ledger / disburse.
- [ ] **M4 — Employee consent + payslip line.** Consent screen, read-only view, per-loan payslip line.
- [ ] **M5 — Lifecycle polish.** Termination settlement, write-off, amendment record.

**Recommended pilot scope:** M1 only (it's a correctness fix). M2–M4 as a fast-follow after launch. M5 later.

---

## Open questions (need your call)
1. **Interest** on staff loans — 0% only, or support a rate? (Affects schedule + disclosure.)
2. **Consent method** — in-app acknowledge sufficient for your legal comfort, or do you need a signed PDF on file?
3. **Net floor** — statutory min wage is **not modeled** yet (sector Remuneration Orders). For pilot, a company-configured floor is pragmatic; full min-wage modeling is a separate effort.
4. **When capped** — carry shortfall to next period (extend term) vs hard-stop and alert the employer?
5. **Disbursement** — record-only (transfer outside app), or integrate a payout later?

---

## Honest plan quality: **8/10**
Solid and grounded in the existing model + the repayment work already shipped. The two soft spots: (a) the engine **net-cap reordering** needs care to not disturb the existing PAYE/statutory order, and (b) the **legal min-wage floor** is unmodeled, so the cap is only as good as the configured floor until Remuneration Orders are modeled. Both are called out above. M1 is a clean, low-risk win regardless of the rest.
