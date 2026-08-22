# Draft query to a Mauritian labour-law firm — M0 sign-off

Save this as a separate Markdown file before sending. Edit the bracketed
context to fit. The four numbered questions are the substance — they
correspond directly to the `PENDING_M0_VERIFICATION` items in
`scripts/seed_overtime_rules_mu.py`.

---

Subject: Overtime, premium-pay, and EOY gratuity rules under WRA 2019 — opinion request

Dear [firm name],

We are building an HR/payroll platform for SMEs in Mauritius and need
written confirmation of four interpretive questions under the Workers'
Rights Act 2019 (consolidated 27 July 2024) before launch. Each affects
the multipliers our engine applies to a worker's hours and, therefore,
our compliance posture from day one.

**Context:** the platform computes pay automatically from clock-in records.
We split hours into rate-coded buckets (regular, weekday-OT, rest-day,
public-holiday-during-normal-hours, public-holiday-after-normal-hours).
Each bucket pays at its statutory multiplier. We are seeding the general
statutory floor only — sector-specific Remuneration Orders are out of
scope for v1.

**Question 1 — "After normal hours" boundary for the 3× public-holiday multiplier.**
WRA s.27 / s.28 specifies 2× during normal working hours and 3× thereafter
on a public holiday. Is "normal working hours" defined relative to:
  (a) the worker's contractual daily hours (e.g. their usual 8-hour day), or
  (b) the statutory 8 hours per day mentioned in sectoral Remuneration Orders, or
  (c) something else (e.g. accumulated weekly hours)?

Our default reading is (b) — the 3× rate engages after the worker has
accumulated 8 cumulative hours on the holiday in question. We need to
confirm or correct this.

**Question 2 — Salary cap above which OT is not owed (Workers' Rights Regulations).**
Our reading: monthly-salaried workers earning above a threshold are
deemed exempt from OT under the Workers' Rights Regulations. We have
provisionally seeded MUR 50,000 / month. Please confirm:
  (a) the current threshold value as of 2026,
  (b) the basis it applies to (basic monthly salary vs. total monthly
      remuneration vs. annual),
  (c) whether the cap is itself indexed (e.g. annual revision by gazette
      notice) and where to find authoritative updates.

**Question 3 — Sunday-to-Monday substitution custom for public holidays.**
Where a public holiday falls on a Sunday (e.g. Abolition of Slavery,
1 February 2026), is the holiday observed on:
  (a) Sunday itself (no substitution; workers are off because Sunday is
      typically the rest day), or
  (b) the following Monday under any sector or general practice?

We have seeded `observed_date = date` (no substitution) and need
confirmation. The question matters because the engine pays the
holiday multiplier on the observed date.

**Question 4 — Holiday + rest-day stacking.**
Where a public holiday falls on the worker's weekly rest day, is the pay:
  (a) the higher of the two multipliers (the engine's default — "MAX"), or
  (b) the sum of the two (additive — "ADD"), or
  (c) something else (e.g. holiday multiplier with rest-day-in-lieu)?

Each case affects whether a worker working a Sunday public holiday is
paid 2× or 4× of base.

---

For each answer, please cite the section of WRA 2019 (or the
corresponding regulation / decree / ruling) so we can record the source
in our engine's audit trail.

Budget: we anticipate this as a fixed-fee written opinion (please quote).
Turnaround: ideally 1–2 weeks. We're happy to retain the firm for ongoing
compliance reviews as the platform rolls out.

Best regards,
[your name]
[your title]
[platform name]
