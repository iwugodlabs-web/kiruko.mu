# Tanzania (TZ) onboarding plan

Status: researched and re-scoped 2026-07-16. Two rounds of research went into
this — legal/tax research (web, cross-checked against multiple sources) and a
full codebase audit (schema, engine execution order, cross-tenant risk). Both
are folded in below. Nothing has been seeded into production; only additive,
inert scaffolding has landed so far (see "Done so far").

## Solidity: 8/10

Up from 6.5 → 7 → 7.5 → 8 across four rounds of scrutiny. What moved it this
round: the two remaining "unconfirmed either way" flags (night premium,
holiday during/after-hours split) got resolved — night premium turned out to
already fit the schema with zero changes (habitual/occasional distinction
mirrors Tanzania's own legal "night worker" definition almost exactly), and
the holiday split is now a reasonable-confidence working assumption rather
than a total unknown. The SDL headcount-conditional design decision is also
closed (`Company.sdl_applicable` admin toggle, not a live count). What's
still holding it back from higher: none of the three schema changes below
have been implemented or tested yet, and the exact legal figures are still
unsourced (by design — see
the rate-sourcing gate).

---

## Why this is tractable at all

The rules engine was built multi-country from the start — `Country`,
`TaxBracketSet`/`StatutoryDeduction`, `CountryLeaveDefault`, `CountryBonusRule`,
`CountryOvertimeRule` are all keyed by `country_code`, versioned, append-only
(a DB trigger forbids `UPDATE`, only `payroll_rules.supersede()` can close a
version and open the next). Tenant isolation is enforced by `company_id`, not
country — Postgres RLS via `SET LOCAL app.company_id`
(`core/tenant_context.py`), gated through `require_company_scope`
(`core/dependencies.py`). **Adding a second country doesn't touch how
isolation works** — a query correctly scoped by `company_id` today stays
correctly scoped regardless of how many countries exist. This was confirmed
by audit, not assumed.

Madagascar (MG) is a second country ~70% seeded (overtime rules + holidays +
integration tests) but still gated `disabled: true` in the admin UI. MG is
evidence the multi-country design works in practice, not just in theory —
but MG's overtime shape (multi-tier, `REPLACE` night mode) turned out to be
*more* complex than MU's, while Tanzania's turns out to be structurally
*simpler* in overtime but genuinely *different* in tax mechanics (below).

---

## The rate-sourcing gate (unchanged, still the pacing constraint)

Exact numbers — PAYE bands, NSSF/SDL/WCF rates, leave day-counts — are not to
be typed into a seed script or entered as real data from a web search. This
project's own precedent (`M0_LAWYER_QUERY_DRAFT.md`, the MU sign-off gate
before launch) treats this as a hard pre-req. Everything below that reads
"confirmed" means: multiple independent secondary sources converged and one
authoritative source (PwC Tax Summaries, TRA's own site) corroborated the
*mechanism* — enough to design the engine correctly. It is explicitly **not**
enough to seed real payroll data from. That still needs one of:
- Sourced TZ figures you already have (labour-law firm opinion, gazette,
  payroll provider's published table), or
- A TZ-equivalent of `M0_LAWYER_QUERY_DRAFT.md` sent to a Tanzanian firm.

---

## Confirmed legal/structural findings

### 1. PAYE is flat-monthly, not cumulative-YTD — a real engine gap, not just different numbers

TRA's published PAYE brackets are explicitly monthly tables (not annual ÷
12), and individuals whose only income is employment from a resident
employer are **exempt from filing an annual return** — no year-end
reconciliation truing up monthly withholding. Mauritius's engine does the
opposite: `compute_paye()`/`_ytd_paye_state` (`payroll_engine.py:94-117`)
track cumulative year-to-date taxable income and withhold only the marginal
delta each period. Applying TZ's bracket numbers to MU's cumulative
machinery would silently produce wrong withholding from month 2 onward.

**Fix**: add `tax_computation_mode` (`CUMULATIVE_YTD` | `FLAT_PERIODIC`) to
`TaxBracketSet`. MU becomes an explicit `CUMULATIVE_YTD` — today's exact code
path, unchanged. TZ becomes `FLAT_PERIODIC` — a new, simpler branch: apply
the current period's bracket table directly, no YTD lookup. Every future
country declares its own mode.

Sources: [PwC — Tanzania Tax administration](https://taxsummaries.pwc.com/tanzania/individual/tax-administration), [TRA PAYEE Calculator](https://www.tra.go.tz/calculators/paye), [Tanzania PAYE Guide 2026](https://www.countrytaxcalc.com/tax-guides/africa/tanzania-paye-guide-2026/)

### 2. NSSF employee contribution reduces the PAYE taxable base — confirmed schema gap

4 of 5 sources agree (PwC explicit: *"The only amount deductible from
employment income is the employee's statutory social security
contribution"*), one outlier disagreed. Treating PwC as authoritative among
secondaries: **PAYE taxable base = gross − NSSF employee contribution.**

Audited directly against the schema and code (not assumed):
`StatutoryDeduction.taxable_base` (`core/model.py:1565`) only supports
`'basic'`/`'gross'` — `'custom'` is documented in a comment but **not
implemented anywhere**; `_base_for()` in `payroll_rules.py:578-586` treats
anything that isn't `'basic'` as `'gross'`. And execution order in
`compute_for_resolved()` confirms `bases_by_code` is built once, from
earnings only, *before* any deduction is computed (`payroll_engine.py:164-185`)
— PAYE (`:189-220`) is finalized *before* `employee_statutory` is even
computed (`:223-230`). There is no mechanism, today, for one deduction's
computed amount to affect another deduction's base.

**Fix** (concrete design, audited for zero MU regression):
1. Add nullable `reduces_base_code` (`String(40)`) to `StatutoryDeduction`.
   For TZ's NSSF row: `reduces_base_code="PAYE"`. Every existing MU row stays
   `NULL` (no backfill).
2. In `compute_for_resolved()`, before the PAYE block: split `employee_deds`
   into base-reducing vs. not. Compute the base-reducers first via
   `compute_statutory()` (only needs earnings-derived bases — no
   circularity), subtract each from `bases_by_code[d.reduces_base_code]` and
   `taxable_monthly`, floored at 0 (mirrors the existing absence-deduction
   floor pattern at `:179-185`). Then compute PAYE against the reduced base
   as today. Then compute the remaining deductions normally; merge both
   result dicts.
3. **MU regression risk: zero.** No MU row will ever have `reduces_base_code`
   set, so the new branch is unconditionally a no-op for MU — byte-identical
   output.

Sources: [PwC — Tanzania Deductions](https://taxsummaries.pwc.com/tanzania/individual/deductions), [Rivermate — Tanzania Taxes](https://rivermate.com/guides/tanzania/taxes)

### 3. Sick leave doesn't fit `CountryLeaveDefault`'s shape at all — confirmed schema gap

Tanzania's sick leave: 126 days over a **36-month cycle** (not annual), split
63 days full pay + 63 days half pay, medical certificate required.
`CountryLeaveDefault` (`core/model.py:1580-1604`) has `days_per_year`
(annual only) and `accrual_method` (`monthly`|`annual`|`tenure_based`) — no
concept of a multi-year cycle length, no concept of a pay-rate tier within
one leave type. This is a genuine schema gap, not a data-entry gap.

**Design sketch** (needs refinement at implementation time, not a final DDL):
add `cycle_months` (nullable Integer, default semantics = 12 i.e. today's
"annual" meaning, so existing rows are unaffected) and a way to express a
reduced-pay tail — e.g. `reduced_pay_days` (nullable Integer) +
`reduced_pay_rate` (nullable Numeric) meaning "of the total entitlement, the
last N days pay at rate X instead of full pay." Annual/maternity/paternity
leave types (which *do* fit the existing annual-days shape cleanly) are
unaffected — this only activates for leave types that set the new fields.

Sources: [Skuad — Tanzania Leave Policy](https://www.skuad.io/leave-policy/tanzania), [Rivermate — Tanzania Leave](https://rivermate.com/guides/tanzania/leave)

### 4. SDL only applies to employers with 10+ staff — confirmed schema gap, different axis than #3

NSSF: 10% employee + 10% employer (or a 15/5 split option — flexibility
probably not needed for v1). SDL: 3.5%, employer-only, **but only for
employers with 10 or more staff**. WCF: 0.5%, employer-only, no threshold
mentioned.

`StatutoryDeduction.threshold_low`/`threshold_high` (`core/model.py:1563-1564`,
both `Numeric(14,2)`) are **income** thresholds — a tax-bracket-style pattern
for the given employee's pay, not an **employer headcount** condition. No
field anywhere references company size. This is a different kind of
conditionality than anything the schema currently expresses: existing
thresholds gate on *this employee's* pay; SDL needs to gate on *the whole
company's* headcount.

**Decided**: `Company.sdl_applicable` (nullable Boolean), platform-admin sets
it once based on the employer's known size, not a live per-run headcount
query. Headcount fluctuating right around the 10-person threshold would
otherwise make SDL flicker on/off between payroll periods, which is worse
than requiring one deliberate admin judgment call at onboarding (and matches
how "who's obligated for X" is normally a slower-moving registration fact,
not a mechanically inferred one, in real payroll operations). Lowest
engineering priority of the three schema gaps regardless — SDL is
employer-paid, doesn't affect worker take-home pay or PAYE correctness.

**Known v1 simplification, not designed for**: NSSF nominally allows the
employer to choose a 15%/5% (employer/employee) split instead of 10%/10%, or
even absorb the full 20% without deducting from the worker. `StatutoryDeduction`
is country-level only — no per-company override of a country statutory rate
exists anywhere (per-employee overrides via `EmployeeSalaryOverride` are for
salary *components*, not statutory *rates*). Treating this as out of scope
for v1: the standard 10%/10% split is assumed for every TZ company unless
this becomes a real customer request, at which point it's a per-company
override feature to design properly, not a v1 requirement.

Sources: [NSSF — Rate of Contributions](https://www.nssf.go.tz/pages/rate-of-contributions), [PwC — Tanzania Other taxes](https://taxsummaries.pwc.com/tanzania/individual/other-taxes)

### 5. Overtime — fits the existing schema cleanly, one minor wrinkle

1.5x normal OT, 2x rest days/public holidays, 45hr/9hr standard week, OT
capped at 50h/**month**. `CountryOvertimeRule`/`CountryOvertimeWeekdayTier`
(proven flexible by both MU's and MG's very different shapes — single-tier
vs. multi-tier, `ADDITIVE` vs `REPLACE` night mode) fits this with no schema
change: `weekly_threshold_h=45`, one weekday tier
`(up_to_hours=NULL, multiplier=1.5)`. **Holiday during/after-hours split,
re-checked**: every source found (WageIndicator, Playroll, Mywage) reports a
single flat 200% for holiday work, with no second "after normal hours" tier
the way MU's WRA s.27/s.28 has (2× during, 3× after). Absence of a
second-tier mention across multiple independent consumer-facing sources is
reasonable-but-not-certain evidence TZ likely uses one flat rate —
`public_holiday_normal_hours_multiplier` =
`public_holiday_after_hours_multiplier` = `2.0` is the working assumption,
final value still gated on M2. Either way needs no schema change — the
schema already supports a flat rate by setting both fields equal, which is
exactly this case. Minor wrinkle: the schema's cap fields (`weekly_ot_soft_cap_h`,
`weekly_total_max_h`) are weekly-named; TZ's cap is monthly. Low severity —
approximable (50h/month ≈ 11.5h/week) as a stopgap, or the field could be
generalized later. Not a blocker.

**Night premium — re-checked, resolved, fits the schema with no changes
needed.** A dedicated search surfaced it: night (20:00–06:00) work carries a
5% premium over normal wage, and a "night worker" is specifically defined
(≥3 hours worked between 20:00–06:00, for at least half their annual working
hours) — i.e. Tanzania's law already distinguishes *habitual* from
*occasional* night work, which maps directly onto the existing
`night_multiplier_habitual`/`night_multiplier_occasional` fields with no
schema change. One genuinely unclear point for M2 to settle, not an
architecture question: one source described night work performed as
overtime as paid "at the night rate (105%)" — worded ambiguously as to
whether that means the night premium *replaces* the OT multiplier when they
overlap (`night_mode='REPLACE'`, MG's precedent) or stacks additively on top
(`'ADDITIVE'`). The schema already has `night_mode` as exactly this switch —
confirmed MU itself has no opinion here either way, since MU currently ships
with no night premium at all (`night_multiplier_habitual`/`occasional`/
`night_mode` all unset in `scripts/seed_overtime_rules_mu.py:105-107`) — so
this is a data value to source correctly at M2, not new engineering work,
and not a case of picking between two existing-country conventions.

**Decided handling for this specific gap**: add it as an explicit, precise
question to the TZ-equivalent lawyer-query letter (mirroring how
`M0_LAWYER_QUERY_DRAFT.md` posed MU's own ambiguous WRA questions), e.g.
*"when a worker's hours fall in both the night window and an overtime/
premium bucket, does the night rate replace the overtime rate for those
hours, or stack on top of it?"* — not resolved from secondary sources. Until
answered, TZ's night-premium fields stay `NULL`/unset, the same state MU is
in today — TZ launches without a night premium rather than on a guessed
stacking rule, since a wrong guess here directly misprices a worker's pay
either direction. Closing this later is a routine `supersede()` version
bump (new version, close the old row, audited), not a rushed change now.
Rather than leave the gap fully silent, the engine should emit a
`compliance_flags` entry (the existing `flags_out` mechanism already used
for e.g. `"paye_ytd_would_be_negative_floored"`,
`"loan_capped_to_net:..."`) — something like
`"tz_night_ot_overlap_unresolved"` — whenever a TZ payslip actually has
hours that fall in both the night window and an overtime/premium bucket, so
the gap is visible on the payslip/admin side instead of quietly absent.
Added to M1 below.

Sources: [Playroll — Tanzania Working Hours & Overtime](https://www.playroll.com/working-hours/tanzania), [WageIndicator — Tanzania Compensation](https://wageindicator.org/en-tz/work-in-tanzania/labour-law/compensation-and-working-time/), [Night work Regulation in Tanzanian Context](https://www.linkedin.com/pulse/20140917032739-195964869-night-work-regulation-in-tanzanian-context), [Employment and Labour Relations Act, 2004 (kazi.go.tz)](https://www.kazi.go.tz/uploads/documents/en-1599586772-sw1563551925-Employment%20and%20Labour%20Relations%20Act%206-2004.pdf)

### 6. Annual/maternity/paternity leave, fiscal year — fit cleanly, no schema change

28 days annual, 84 days maternity (100 for multiples), 3 days paternity (7
for premature-birth cases, since March 2025) — all straightforward
`days_per_year` fits. Employment-income tax year is **July–June**, matching
MU's existing `fiscal_year_start='07-01'` — no fiscal-year-crossing engine
logic needed, unlike what a January–December mismatch would have required.

Sources: [Skuad — Tanzania Leave Policy](https://www.skuad.io/leave-policy/tanzania), [Africapay — Tanzania Maternity/Paternity](https://africapay.org/tanzania/labour-law/maternity-work/maternity-paternity-leave)

---

## Codebase audit findings (beyond the schema gaps above)

### Cross-company currency aggregation — audited, currently safe, but no existing pattern to copy

Full sweep of `api/v1/company.py`, `api/v1/admin.py`, `api/v1/payroll.py`,
`api/v1/reports.py`, `remittance_pdf.py`, `bonus_provisioning.py`,
`bonus_engine.py`, and the web admin dashboard/employer components found
**no existing cross-company monetary sum anywhere in the codebase** — every
`func.sum()`/aggregate on money is filtered to a single `company_id` first.
This is good news (no hidden mixed-currency bug to fix) but also means there
is no existing pattern to copy: **any future platform-wide financial
dashboard or export must explicitly design for `GROUP BY currency` from day
one**, since nothing in-tree demonstrates it. Noting as a constraint on
future work, not a current defect.

### Additional hardcoded-MU spots found by audit (beyond the already-known list)

| Location | Issue |
|---|---|
| `services/salary_resolver.py:210` | No-assignment fallback returns `ResolvedSalary(currency="MUR", ...)` unconditionally — a TZ employee with no assignment yet gets an implicit MUR empty payslip instead of TZS. |
| `db_models/crud/sector.py:17-18` | `create_sector()` defaults `country_code`/`currency` to `'MU'`/`'MUR'` if the caller omits them. |
| `schema/sector_schema.py:24,56` | Same default at the Pydantic contract layer. |
| `services/payslip_estimate_service.py:32,474,600,693,697,783` | A **second, separate** template registry from `payslip_pdf_service.py`'s (`_TEMPLATE_BY_COUNTRY = {"MU": ...}`) — the *estimate* (unfinalized) flow needs its own TZ template entry, distinct from the finalized-payslip one already known. |
| `services/time_log_service.py:219,223`, `api/v1/payroll.py:88,176`, `jobs/clock_reminders.py:51` | More `"Indian/Mauritius"` fallback literals, independent of `Company.timezone`'s DB default — none of these read the new `Country.default_timezone` column added by the TZ scaffold migration yet. |
| `api/v1/job.py:334` | `MIN_WAGES` dict already has an `"MGA"` entry — confirms MG is genuinely partially seeded, useful corroboration of the MG-as-template assumption. |

### Tenant isolation — confirmed sound, not a country-count risk

`require_company_scope` (`core/dependencies.py`) + Postgres RLS via `SET
LOCAL app.company_id` (`core/tenant_context.py:143-247`), with an
audit-logged `bypass_tenant_guard(reason)` escape hatch used only for
genuinely platform-wide operations (e.g. the startup holiday-calendar
coverage check in `main.py:344-360`, which already iterates
`Company.country_code` distinct values under an explicit, deliberate bypass
— i.e. multi-country-aware code that already exists and works today). No
coincidental single-country dependency found anywhere in the isolation
model. The `company.country_code or "MU"` fallbacks scattered around
(`job.py:796`, `payslip_estimate_service.py`, `payslip_pdf_service.py:318`)
are dead code today (`Company.country_code` is `NOT NULL`), not a leak —
just fragile enough to silently reroute to MU's rules if a future raw-SQL
insert ever bypassed the ORM default.

**The one real gap, unchanged from before, now doubly confirmed**:
`PrivateUser` has no `country_code` column at all (confirmed by direct grep
— zero hits). Independent/personal users have no country signal today. Not a
cross-tenant leak (no data crosses between two personal users), but a
correctness gap once TZ personal users exist.

---

## Milestones

### Done so far (additive, inert, no MU behavior change)

- [x] Migration `tanzania_country_scaffold_20260716`: `Country(code="TZ", ...)`, `is_active=FALSE`. `fiscal_year_start`/`min_wage` left NULL pending M2.
- [x] `countries.default_timezone` column + MU backfill + `Country.default_timezone` on the model. **Not yet wired into the call sites found by the audit** (`time_log_service.py`, `api/v1/payroll.py`, `jobs/clock_reminders.py` still hardcode the MU literal independently).
- [x] `CompanyCreate.country_code` field added (schema only — `company_crud.create_company()` doesn't yet validate/use it).

### M0 — Country scaffolding, employee-country model, admin visibility

- [ ] Finish wiring `country_code` through `company_crud.create_company()`: validate against `countries`, derive `timezone` from `Country.default_timezone`. Country immutable after creation (not on `CompanyUpdate`) — changing it post-creation would corrupt fiscal-year-keyed PAYE state and timezone-classified overtime history.
- [ ] **New**: `PrivateUser.country_code` (nullable) + `effective_country_code` property (`company.country_code` if `company_id` set, else `self.country_code or "MU"`) + mobile profile UI (next to the existing currency picker) + a sweep of the audit's newly-found fallback sites to use it instead of literals.
- [ ] `country_code` on `CompanySummary` (backend `list_companies` + both frontend interfaces) + a country filter chip on `EmployersSection.tsx`'s existing filter row.
- [ ] `"TZS"` to `ALLOWED_CURRENCIES` (not `MIN_WAGE_MONTHLY`/`MIN_WAGES` — both degrade safely on an unknown currency; do not guess a number for either now, or for `sector.py`'s/`sector_schema.py`'s defaults).
- [ ] `core/phone_utils.py` +255 support.
- [ ] `{ code: "TZ", disabled: true }` in the admin `COUNTRIES` picker — the picker itself is already a full write-capable, versioned, step-up-gated editor (`payroll_rules.supersede()` under the hood); un-disabling is the only gap, not building new editor UI.

### M1 — Engine changes (the real work; each is additive/opt-in, designed for zero MU regression)

- [x] `tax_computation_mode` on `TaxBracketSet` (`CUMULATIVE_YTD` default = today's behavior; `FLAT_PERIODIC` new branch for TZ). Implemented, migrated, and verified against local dev DB — 23/23 existing PAYE tests pass unchanged. Caught and fixed a real gap during implementation: `TaxBracketSetRead` is built with explicit kwargs in two places (`payroll_rules.py`'s `resolve()`, `api/v1/payroll_rules.py`'s `_bracket_set_to_read()`), not `model_validate()` — the new field wouldn't have flowed through from the DB without adding it to both explicitly.
- [x] `reduces_base_code` on `StatutoryDeduction` + the base-reduction pass in `compute_for_resolved()`, per the concrete design above. Implemented, migrated, verified — 146/146 payroll/PAYE/statutory/overtime/bonus tests pass unchanged.
- [x] `cycle_months` + reduced-pay-tier fields on `CountryLeaveDefault`. Schema only, as scoped — no engine logic consumes these two fields yet (leave-taken pay impact still assumes full-pay, annual-cycle entitlements everywhere it's computed). Needed before M2 can actually seed TZ's sick-leave shape correctly.
- [~] **`statutory_base_codes=["PAYE","CSG_EE",...]` hardcoded MU literals — attempted, deferred, not a rushed fix.** Added `applies_to_overtime`/`applies_to_bonus` (nullable Boolean, inert/unused) to `StatutoryDeduction` as likely-needed groundwork, but stopped short of touching the 4 call sites (`payroll_engine.py:818,1085,1201`, `bonus_engine.py:69`). While designing the generalization I found MU actually has a **5th** statutory code missed by prior research: `TRAINING_ER` (HRDC Training Levy, `taxable_base="gross"`, employer-only, seeded in `seed_mu_payroll_rules_2025_26.py:114`). A naive "include every active StatutoryDeduction code" generalization would have added it to every basic earning's `statutory_base_codes`, narrowing its base from full gross to basic-only earnings — a real, silent underpayment of the actual Training Levy remittance, not a hypothetical. Deeper issue: it's not yet clear whether the *existing* hardcoded lists (which include `CSG_EE`/`CSG_ER` in the OT bucket) are doing necessary work or are partially redundant with what each code's own `taxable_base` enum fallback (`gross`/`basic` via `_base_for()` in `payroll_rules.py`) would already produce on its own — `gross` and `basic` are both already absence-adjusted (`payroll_engine.py:179-185`), so it's not obvious every hardcoded entry is load-bearing. This needs to be traced code-by-code before any replacement, not generalized by pattern-matching under time pressure on code that computes real Mauritian payroll today. Next session should start here with a deliberate trace, not a quick fix.
- [x] WRA s.25 `Decimal("195")` hourly-rate divisor → `CountryOvertimeRule.notional_hourly_divisor` (nullable, falls back to 195). Implemented, migrated, verified — full test suite green.
- [x] `Company.sdl_applicable` (nullable Boolean) admin toggle. Implemented and actually wired: `compute_for_resolved()` takes `sdl_applicable`, filters `employer_deds` to drop any `code == "SDL"` row unless true, all 4 call sites in `payroll_engine.py` updated to pass `company.sdl_applicable`. No MU row is ever `code=="SDL"`, so unconditional no-op there — verified.
- [~] **`compliance_flags` entry for unresolved night+OT overlap — deferred, not a rushed fix.** Needs `overtime_engine.py`'s `bucket()`/`_apply_night_premium()`, not traced carefully this session (unlike `payroll_engine.py`, which was). Found a real subtlety while scoping it: `rule.night_mode is None` is *also* MU's current legitimate state (no night premium by design, confirmed in `_apply_night_premium()` — it no-ops cleanly on `None`) — a flag fired blindly on that condition would incorrectly fire for MU too. Distinguishing "TZ, temporarily unconfigured" from "MU, no night premium by design" isn't something the schema signals yet. Needs a real design pass, not a guess, before implementing.

### M2 — Enter TZ payroll rules (blocked on rate-sourcing)

No seed scripts — data entry goes through the now-un-disabled admin
`/admin/payroll-rules` UI, which already has the audit trail, step-up
auth, and optimistic concurrency built in. Sector rate sheet (if TZ has
sector-based minimums) still needs `jobs/seed_sectors_from_excel.py --country
TZ --currency TZS` since that importer takes a spreadsheet, not a form.
Integration test mirroring `test_overtime_integration.py::_seed_mg`.

The TZ-equivalent lawyer-query letter (mirroring `M0_LAWYER_QUERY_DRAFT.md`)
should include, at minimum: the night+OT stacking question above, plus
confirmation of every "reasonable-confidence working assumption" flagged in
the findings above (the flat 200% holiday rate, the exact PAYE brackets/
NSSF/SDL/WCF rates, the sick-leave cycle mechanics) before any of it is
entered as real payroll data.

### M3 — Payslip rendering

- [ ] `templates/payslips/TZ/{default,correction,estimated}.html` + registry entries in **both** `payslip_pdf_service.py` and `payslip_estimate_service.py` (confirmed two separate registries, not one).
- [ ] `_STATUTORY_LABELS` entries for NSSF/SDL/WCF.

### M4 — Compliance + i18n polish

- [ ] Swahili locale (mobile already has `mg.ts` as a precedent).
- [ ] `doc/OVERTIME.md` gets a TZ milestone section.

---

## Pros and cons, honestly

**Pros:**
- Isolation model confirmed safe by audit — adding TZ cannot leak data between tenants or corrupt MU's isolation guarantees.
- Every engine change designed so far is additive/opt-in with an explicit "MU regression risk: zero" argument, not just asserted but traced through the actual code (`reduces_base_code` defaults NULL for all MU rows; `tax_computation_mode` defaults to MU's exact current behavior).
- The admin rule-editor already existing (not read-only, as an earlier doc had wrongly stated) removes an entire category of planned work.
- Legal/mechanical research converged across independent sources for every major finding, with primary-source (TRA, PwC) corroboration where it mattered most (PAYE mechanism, NSSF deductibility).

**Cons:**
- Three separate schema changes now confirmed necessary (`tax_computation_mode`, `reduces_base_code`, leave cycle/tier fields) — this is genuinely more engine surgery than the original "just seed different numbers" framing implied, even though each change is individually low-risk.
- No effort estimate has been given at any point in this plan. Given the schema changes plus the sweep of ~10 newly-found hardcoded call sites, this is realistically multiple weeks, not days — MG's *overtime-only* milestone was scoped at 1 day, and TZ's scope is substantially larger than MG's.
- Everything legal is still gated on sourcing — the entire M2 (and by extension, real TZ customers going live) has no timeline until that's resolved.
- The night-premium OT-stacking interaction (`ADDITIVE` vs `REPLACE` when night work coincides with overtime) is genuinely ambiguous in the secondary sources found — a real M2 sourcing item, not just a formality, since it directly affects a worker's pay on overlapping night+OT hours.
- The holiday during/after-hours split is a reasonable-confidence assumption (flat 200%, no MU-style second tier), not a confirmed fact — still needs M2 to either confirm or correct before real payroll runs on it.
- Resolved this round, no longer open: SDL's headcount-conditional design (decided: admin toggle) and the night-premium/holiday-split "unconfirmed either way" flags (now sourced, schema confirmed sufficient either way).
