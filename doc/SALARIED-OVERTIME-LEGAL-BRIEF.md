# Legal Brief — Salaried Overtime Handling (Kiruko)

**To:** In-house compliance counsel
**From:** Product/Engineering
**Re:** How the payroll engine should treat overtime for monthly-salaried workers under the Workers' Rights Act 2019
**Status:** Decision-gating. We will not build until we have your answers to §4.

---

## 1. Context (what the software does)

Kiruko runs payroll for employers in Mauritius. Each month the employer
finalises a "payroll run" and the system computes every worker's gross, statutory
deductions (PAYE, CSG, NSF), and net pay, and issues a payslip.

**The system is the record-keeper; the employer is the employer of record.** We
do not set wages or employment terms — we compute payroll from the data the
employer maintains (clock-ins, salary, contract type).

## 2. The gap we found

The engine computes **overtime** only for workers paid **by the hour**. For
workers on a **fixed monthly salary**, it currently computes **no overtime at
all** — not in the monthly run, and not in any later correction.

A read-only measurement of current data shows salaried workers earning under the
threshold who have worked rest-day / >45h weeks with **zero overtime computed**.
So this is a potential **underpayment**, not a cosmetic issue.

## 3. Our reading of the law (please confirm or correct)

From the WRA 2019 (verified against the MRA published text):

| § | Our reading |
|---|---|
| **s.20** | Normal working week = **45 hours** for *every* worker (excl. part-time / garde malade). |
| **s.24** | Overtime is owed to *"a worker"* — **no monthly-vs-hourly distinction**. 1.5× weekday extra; 2× public holiday (normal hrs); 3× public holiday (after hrs). |
| **s.24(5)–(6)** | A contract **may** state that the monthly salary **already includes** overtime, **provided the maximum overtime hours are specified in writing** and the basic salary is stated. |
| **s.24(7A)** | Authorised leave (paid or unpaid) counts as **attendance** for computing overtime hours. |
| **s.25** | Notional basic hourly rate for a salaried worker: a month = **195 hours** (hourly = monthly basic ÷ 195). |
| **s.2 / s.3** | A worker whose **basic wage/salary exceeds Rs 600,000/yr (~Rs 50,000/mo)** is **excluded** from overtime (Part V is not in the carve-out list). Managers / PRB staff / public officers separately excluded. |

**Our intended design (subject to your sign-off):** for each salaried worker the
employer classifies overtime handling as one of —
- **auto** — system computes & pays overtime (basic ÷ 195 × statutory multipliers);
- **bundled** — salary already includes it per a written s.24(5) agreement → system does not pay, records the agreement reference;
- **review** — employer is warned and must acknowledge before finalising.

## 4. Questions we need answered (each gates a build decision)

**Q1 — Bundling validity & evidence (gates the "bundled" option).**
Is the s.24(5) "salary includes overtime" arrangement valid for ordinary
private-sector employers on our platform? **What specific evidence must we
require** before letting an employer mark a worker "bundled" (e.g. a written
clause naming the maximum overtime hours and the basic salary)? Is there a cap
beyond which bundling is not permitted?

**Q2 — Does an employer acknowledgement discharge the platform's duty? (gates the "review/warn" option — the load-bearing question).**
If the system **warns** the employer that overtime appears due and the employer
**acknowledges and chooses to handle it outside the system**, does that
adequately protect *the platform* from liability? Or is overtime a
non-waivable statutory entitlement such that a click-through acknowledgement is
**not** a safe basis — i.e. must we actually compute and surface the amount
rather than merely warn? **Does the platform (as software provider, not
employer) carry any independent liability here at all?**

**Q3 — Is 45h/week the correct default? (gates detection).**
We default normal hours to 45/week (s.20). Do the **sector Remuneration Orders**
applicable to our pilot employers set **different** normal hours or overtime
rates that should override the default? If so, which sectors / which figures?

**Q4 — Threshold mechanics (gates eligibility logic).**
For the Rs 600,000/yr exclusion: (a) is it measured on **basic** wage only, or
total remuneration? (b) how is the **"at a rate exceeding"** test applied to a
mid-year raise or a part-year worker? (c) for our purposes, is Rs 50,000/month
basic a correct monthly proxy?

## 5. What we need back

A short written confirmation per question (confirm / correct + any conditions).
Q2 is the one we cannot proceed without — it decides whether "warn + employer
handles it" is a permissible design or whether the system must compute and pay
salaried overtime directly.

---

*Engineering refs (not needed for the legal review): `SALARIED-OVERTIME-PLAN.md`,
`backend/scripts/measure_salaried_ot_exposure.py` (read-only exposure count).*
