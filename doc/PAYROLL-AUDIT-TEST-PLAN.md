# Payroll Audit — Test Plan

Branch under test: **`integration/payroll-audit`** (merges the 4 fix branches).
Test against a **non-production** database.

## 0. Setup (once)
```bash
git checkout integration/payroll-audit
cd backend
source .venv/bin/activate
# Test DB (kontokaz_test) — drops/recreates a SEPARATE db, never prod:
alembic -c alembic.ini upgrade head          # applies head-merge + repayment_run_id
# Automated suites:
pytest tests/test_overtime_engine.py -v               # 31 pass, NO db needed
pytest tests/test_payroll_engine_fixes.py -v          # loan + dispute (needs test db)
```
Expected: `alembic heads` shows a single head `repayment_run_link_20260619`.

---

## 1. 🔴 Loan double-deduction on payroll redo
**Automated:** `pytest tests/test_payroll_engine_fixes.py::TestLoanRepaymentRunLink -v`

**Manual (API/UI):**
1. Give an employee an **active loan**: principal 60,000, duration 12 months → 5,000/month installment, `repaid_amount = 0`.
2. Create a payroll run for a month and **finalize** it.
   - ✅ Expect: `loan.repaid_amount = 5000`, exactly **1** `repayments` row for that loan.
3. **Redo** the run (the run's "Redo" / void-and-recreate action).
   - ✅ Expect: `loan.repaid_amount = 0` again, the repayment row is **gone**.
4. Fix the data and **finalize the new run**.
   - ✅ Expect: `loan.repaid_amount = 5000` (NOT 10,000), exactly **1** repayment row.
- ❌ **Before the fix:** step 4 left `repaid_amount = 10000` and 2 repayment rows.
- Regression guard: a **manually** entered repayment (no payroll run) must survive a run cancel untouched.

---

## 2. 🔴 Dispute-finalize gate misses last-day disputes
**Automated:** `pytest tests/test_payroll_engine_fixes.py::TestDisputeFinalizeGate -v`

**Manual:**
1. Employee clocks in on the **last calendar day** of a pay period.
2. Admin **rejects** that clock-in; employee **disputes** it (dispute status = pending).
3. Try to **finalize** the payroll run for that period.
   - ✅ Expect: blocked — `409 "Cannot finalize: 1 unresolved time-log dispute(s) in this period."`
4. Resolve the dispute → finalize now succeeds.
- ❌ **Before the fix:** step 3 **succeeded** (a last-day dispute was invisible to the gate), freezing a payslip the dispute might change.

---

## 2b. 🟠 Employer-loan M1 — personal loans not deducted from pay
**Automated:** `pytest tests/test_payroll_engine_fixes.py::TestLoanRepaymentsHelper -v`

**Manual:**
1. As an employee, add a **personal loan** in the mobile Expenses tracker (these default to `loan_type = 'personal'`).
2. Run payroll for that employee.
   - ✅ Expect: **nothing is deducted** for that loan (only `loan_type = 'employer'` loans are deducted).
- ❌ **Before the fix:** the personal loan installment was deducted from the employee's salary.
- (Employer loans don't exist via UI yet — that's M3 of `EMPLOYER-LOAN-PLAN.md`.)

## 3. 🟠 Overtime dashboard — honest stats
Open the **employer dashboard home**. Each is a distinct, now-correct number.

a. **Overtime Pending (awaiting approval):** create a time log flagged `is_overtime`, not yet confirmed/rejected.
   - ✅ Appears in the "Overtime Pending" count; confirming or rejecting it drops the count.
b. **Attendance Gaps (forgotten clock-out):** leave a session open (no clock-out) for **>16h**.
   - ✅ Shows under "Attendance Gaps", NOT as a live session or overtime.
c. **Break-aware live duration:** an active session clocked in ~9h ago **with a 1h break**.
   - ✅ Live "duration" shows ~8h (break subtracted), not 9h.
d. **De-aliased:** "Attendance Gaps" and "Overtime Pending" now show **different** numbers.
   - ❌ Before: both showed the **same** count.
e. **Gross not double-counted:** a job that has **more than one** salary row.
   - ✅ `totalGrossPayroll` / `totalWorkHours` are not inflated (use the latest salary only).

---

## 4. 🟡 Edge cases

**A. Holiday `observed_date` in proration**
- Setup: a public holiday whose `date` is a Sunday but `observed_date` is the following Monday.
- Run payroll for a **daily-paid** worker (or a salaried joiner/leaver) that month.
- ✅ Expect: the **observed** Monday is excluded from working days; the Sunday isn't double-counted. Working-day count matches a hand count.
- ❌ Before: Monday counted as a normal working day (wrong daily rate / absence deduction).

**B. NULL `is_overtime` on hourly pay**
- Setup: an hourly-basis employee with a time log whose `is_overtime` is **NULL** (regular hours).
- ✅ Expect: those hours are **paid** (included in the hourly sum).
- ❌ Before: silently dropped from pay.

**C. Forced-OT inflating the weekly accumulator**
- Automated: `pytest tests/test_overtime_engine.py::TestForcedOvertimeAccumulator -v`
- Setup: 8h **confirmed-OT** on Monday + 10h regular Tue–Fri (40h regular, under the 45h weekly threshold).
- ✅ Expect: 40h paid **REG**, 8h paid **OT**.
- ❌ Before: 37h REG + 11h OT (3 regular hours wrongly paid at the OT premium).

**D. EXEMPT estimate dropping unconfirmed OT**
- Setup: an **EXEMPT** employee with worker-flagged-but-unconfirmed OT hours, viewing the **estimated** payslip surface.
- ✅ Expect: those hours are **included** in the estimate.
- ❌ Before: dropped, so the estimate read artificially low.

---

## Notes
- The overtime engine suite is **pure** (no DB) — safe to run anywhere.
- `test_payroll_engine_fixes.py` uses the **`kontokaz_test`** database (separate from prod); the bootstrap drops/recreates only that db.
- Merging to `main` requires running `alembic -c alembic.ini upgrade head` on the target DB (collapses the 3 old alembic heads + adds `repayments.payroll_run_id`).
