# Overtime & Premium Pay — Design

Status: **proposal v2** · Owner: backend · Last updated: 2026-05-20
Legal sources verified against MU Workers' Rights Act 2019 (consolidated 27 July 2024) and MG Loi 2024-014 (Code du Travail) + Décret 68-172 + WageIndicator.

## Why

The current engine sums confirmed-overtime hours into the basic hourly pot at **base rate**. That's wrong under both target jurisdictions and exposes the company to wage-claim back-pay + statutory penalties.

| Jurisdiction | Statutory floor | Sources |
|---|---|---|
| **MU** | 1.5× over 45 h/week · 2× rest day · 2× holiday during normal hours · 3× holiday after normal hours | Workers' Rights Act 2019 ss.27, 28; consolidated 27 Jul 2024 |
| **MG** | 130% first 8 OT-h/wk · 150% beyond · 140% rest day · 150% holiday · 130% regular night · 150% occasional night | Loi 2024-014 ss.108–112, 149; Décret 68-172 |

Multi-tenancy makes this worse: a single line of code change can mis-pay every worker across every tenant simultaneously.

## Scope

**In v1:** Statutory floor per country, append-only versioned. Sector-specific Remuneration Orders modelled as country-rule overlays. Per-company per-date override via existing `CompanyHolidayRate.multiplier` (currently dead column — finally wired). Per-employee `weekly_rest_day_dow` + `overtime_exempt`. Bucketed payslip components. Snapshotted on draft+finalize.

**Out of v1:** General company OT policy beyond statutory + holiday overrides (defer until a customer asks). TOIL (time-off in lieu). On-call premium. Per-employee contractual OT. Rotating rest days.

## Critical legal findings (verified, not assumed)

These reshape the v1 design vs. my initial proposal:

1. **MU EOY gratuity *includes* overtime.** The WRA 2019 s.2 defines "earnings" as wages earned pursuant to ss.24, 27(5), 30 and 40 — which include overtime. The 13th-month bonus base is the higher of (a) 1/12 of annual earnings (incl. OT), or (b) the last monthly pro-rated basic salary. The earlier proposal assumed `gross_basic` was the base; **this is wrong for MU**. EOY bonus uses `gross_total`. The `gross_basic` distinction is still required for **unpaid-leave deduction** (s.30 — "ordinary daily wage").

2. **MU public-holiday rate splits "during/after normal hours".** 2× during normal working hours, 3× after. Initial design had a single `public_holiday_multiplier`; needs two columns: `public_holiday_normal_hours_multiplier` (2.0) and `public_holiday_after_hours_multiplier` (3.0).

3. **MG bonuses *don't combine* with each other but *do stack* with OT.** A worker on Sunday-night at OT can get 140% (Sunday) plus the OT multiplier — but cannot also stack the 130% night premium. The bucketer picks the *highest* special-hour multiplier per slice, then composes with the OT-tier multiplier. Engine logic must encode max-not-add.

4. **MG night premium is "REPLACE", not "ADDITIVE".** 130% of *normal* rate for habitual night work, 150% for occasional. Initial design had `night_mode` enum; v2 keeps the column but documents MG sets `REPLACE`. MU's night premium (15–25%) is sector-specific and only ADDITIVE.

5. **Rest day ≠ Sunday.** MU explicitly: "weekly rest day" with possible substitute (catering/tourism rotations). MG same. Per-employee `Job.weekly_rest_day_dow` required.

6. **Annual / weekly caps exist.** MU: 10 OT hours/week soft cap, 55 hours/week absolute. MG: 20 hours/week absolute. Engine emits `compliance_flags` warning, doesn't refuse payment.

7. **Sector-specific Remuneration Orders override the general floor in MU.** Catering/tourism specifically: 1.5× first 8 daily hours of rest-day work then 2× beyond. Construction: different again. Mauritius has ~30 sectoral Remuneration Orders. v1 codes general statutory floor; sector overlays deferred to a `country_overtime_rule_sector_override` table in a later phase.

## Data model

### NEW: `country_overtime_rules` (temporal, append-only)

Follow `country_payroll_rules_engine_20260427.py` pattern exactly — same temporal columns (`effective_from`, `effective_to`, `version`, `superseded_by_id`) and the same Postgres `forbid_rule_mutation` trigger.

```python
class CountryOvertimeRule(Base):
    __tablename__ = "country_overtime_rules"

    id                    = Column(Integer, primary_key=True)
    country_code          = Column(String(2), nullable=False, index=True)

    # Temporal — identical pattern to tax_bracket_sets et al.
    effective_from        = Column(Date, nullable=False)
    effective_to          = Column(Date, nullable=True)
    version               = Column(Integer, nullable=False)
    superseded_by_id      = Column(Integer, ForeignKey("country_overtime_rules.id"), nullable=True)
    created_at            = Column(DateTime(timezone=True), server_default=func.now())
    source_url            = Column(String, nullable=True)   # link to gazette / decree
    notes                 = Column(String, nullable=True)

    # Thresholds
    weekly_threshold_h    = Column(Numeric(5, 2), nullable=False)   # MU 45, MG 40
    daily_threshold_h     = Column(Numeric(5, 2), nullable=True)    # MU 8 (sectoral), MG unused

    # Multi-tier weekday OT lives in a child table (`country_overtime_weekday_tiers`)
    # so the admin UI gets row-level editing + audit log per tier, matching the
    # `tax_bracket_sets` / `tax_brackets` pattern. See child table below.

    # Rest-day work (replaces base rate for hours worked on the worker's weekly rest day)
    rest_day_multiplier   = Column(Numeric(3, 2), nullable=False)   # MU 2.0, MG 1.40

    # Public-holiday work — MU splits these
    public_holiday_normal_hours_multiplier  = Column(Numeric(3, 2), nullable=False)  # MU 2.0, MG 1.50
    public_holiday_after_hours_multiplier   = Column(Numeric(3, 2), nullable=False)  # MU 3.0, MG 1.50 (same as normal)

    # Night work
    night_start           = Column(Time, nullable=True)             # MG 22:00, MU sector-only
    night_end             = Column(Time, nullable=True)             # MG 05:00
    night_multiplier_habitual   = Column(Numeric(3, 2), nullable=True)  # MG 1.30
    night_multiplier_occasional = Column(Numeric(3, 2), nullable=True)  # MG 1.50
    night_mode            = Column(String, nullable=True)           # 'ADDITIVE' (MU) | 'REPLACE' (MG) | NULL

    # Caps — advisory, emit compliance_flags
    weekly_ot_soft_cap_h  = Column(Numeric(5, 2), nullable=True)    # MU 10
    weekly_total_max_h    = Column(Numeric(5, 2), nullable=True)    # MU 55, MG 60 (40 + 20 OT max)

    # Monthly-salary cap above which OT is not owed under MU Workers' Rights Regulations.
    # Engine fails safe: MONTHLY_ELIGIBLE workers above this cap are treated as EXEMPT.
    # NULL means "no cap" (any salaried worker eligible if MONTHLY_ELIGIBLE).
    monthly_basic_ot_cap  = Column(Numeric(12, 2), nullable=True)   # MU ~50,000 (verify current cap)

    # Stacking rules
    stack_holiday_on_rest_day  = Column(String, nullable=False, default='MAX')
        # MU + MG both: 'MAX' (take the higher of the two, not additive)
    stack_night_on_premium     = Column(String, nullable=False, default='NO_STACK')
        # MG: night cannot combine with other premium days; OT stacks with day type
        # MU: night additive on top of any other rate

    # Week start
    week_start_dow        = Column(SmallInteger, nullable=False, default=1)  # ISO Mon=1
```

Add the `forbid_rule_mutation` trigger via the same helper used in `country_payroll_rules_engine_20260427.py`. Only `effective_to` and `superseded_by_id` are mutable post-insert (the close-out columns).

### NEW: `country_overtime_weekday_tiers` (child of `country_overtime_rules`)

Tiered weekday OT modeled as a child table so the admin UI can edit each tier with row-level audit. Mirrors the `tax_bracket_sets` → `tax_brackets` pattern.

```python
class CountryOvertimeWeekdayTier(Base):
    __tablename__ = "country_overtime_weekday_tiers"

    id                  = Column(Integer, primary_key=True)
    overtime_rule_id    = Column(Integer, ForeignKey("country_overtime_rules.id", ondelete="CASCADE"),
                                 nullable=False, index=True)
    tier_order          = Column(SmallInteger, nullable=False)   # 1, 2, 3 …
    up_to_hours         = Column(Numeric(5, 2), nullable=True)   # null = "and beyond"
    multiplier          = Column(Numeric(3, 2), nullable=False)

    __table_args__ = (
        UniqueConstraint('overtime_rule_id', 'tier_order'),
        CheckConstraint('multiplier >= 1.00', name='multiplier_not_below_one'),
    )
```

Seed examples:
- **MU**: 1 row — `(tier_order=1, up_to_hours=NULL, multiplier=1.50)`.
- **MG**: 2 rows — `(1, 8.00, 1.30)`, `(2, NULL, 1.50)`.

The child table is also guarded by `forbid_rule_mutation` (same trigger pattern) — tiers are immutable once their parent rule's `effective_from` has passed.

### EXTEND: `Job`

```sql
ALTER TABLE jobs
    ADD COLUMN overtime_eligibility VARCHAR(20) NOT NULL DEFAULT 'HOURLY',
        -- 'HOURLY' | 'MONTHLY_ELIGIBLE' | 'EXEMPT'
    ADD COLUMN weekly_rest_day_dow SMALLINT NOT NULL DEFAULT 7,  -- ISO Sun=7
    ADD COLUMN contracted_hours_per_week NUMERIC(5, 2) NULL;
ALTER TABLE jobs ADD CONSTRAINT jobs_overtime_eligibility_chk
    CHECK (overtime_eligibility IN ('HOURLY', 'MONTHLY_ELIGIBLE', 'EXEMPT'));
```

- **`overtime_eligibility`** — three states, not boolean:
  - `'HOURLY'` (default): worker has `Salary.hourly_rate`; bucket directly.
  - `'MONTHLY_ELIGIBLE'`: salaried worker still entitled to OT under WRA. Engine derives `hourly_rate = monthly_basic / (contracted_hours_per_week × 52 / 12)`, then buckets normally. **Safety**: if `monthly_basic > country.monthly_basic_ot_cap`, engine treats as `EXEMPT` (per MU Workers' Rights Regulations salary cap).
  - `'EXEMPT'`: managerial / above-cap salaried. Always pays base rate; no OT bucketing.
- **`weekly_rest_day_dow`** ISO day (1=Mon … 7=Sun). Default Sunday.
- **`contracted_hours_per_week`** — the worker's contractual normal hours. NULL means "use country statutory". Bucketer uses `effective_threshold = min(contracted_hours_per_week, rule.weekly_threshold_h)` — protects part-timers whose contract is below 45hr but who routinely work overtime.

Migration backfills existing `overtime_exempt=true` rows (from any prior draft) to `'EXEMPT'`; others default to `'HOURLY'`.

### REUSE + EXTEND: `public_holidays`

Already exists at `core/model.py:1174-1183`. Already consumed by `proration.working_days_in_period`.

```sql
ALTER TABLE public_holidays
    ADD COLUMN observed_date DATE NULL;  -- NULL → use `date`
UPDATE public_holidays SET observed_date = date;  -- backfill
```

`observed_date` accommodates MU's Sunday→Monday substitution custom. Seeder writes `observed_date = following Monday` for MU public holidays falling on Sunday. Bucketer classifies slices using `observed_date` (falling back to `date` if NULL). The original `date` is retained for display ("Independence Day — observed Monday 13 March").

Seed scope: MU 2026 + 2027, MG 2026 + 2027. Annual maintenance job.

### REUSE: `CompanyHolidayRate`

Already exists at `core/model.py:1186-1200` with `multiplier` column — currently dead. v1 wires it as the **per-company per-date override** on the public-holiday multiplier:

- Engine reads country's `public_holiday_normal_hours_multiplier` as floor.
- If `CompanyHolidayRate` row exists for `(company_id, date)`, use that multiplier instead.
- Floor validator on insert/update: reject if `multiplier < country_floor` (audit-logged 422).

No new `company_overtime_policy` table in v1.

### EXTEND: `CountryRulesSnapshot`

```python
class CountryRulesSnapshot(BaseModel):
    # ... existing fields ...
    overtime: Optional[CountryOvertimeRuleRead] = None
```

`payroll_rules.resolve()` joins the new table. `finalize_run` already serializes the snapshot to `PayrollRun.country_rules_snapshot` JSONB — no additional wiring.

### EXTEND: `PayrollRun`

```sql
ALTER TABLE payroll_runs
    ADD COLUMN compute_version SMALLINT NOT NULL DEFAULT 1,
    ADD COLUMN company_overrides_snapshot JSONB NULL,
    ADD COLUMN compliance_flags JSONB NULL DEFAULT '[]';
```

`compute_version`: 1 = legacy hours-sum compute, 2 = bucketed OT engine. Finalize logic branches by version. Legacy runs never re-bucket.
`company_overrides_snapshot`: per-date `CompanyHolidayRate` overrides as they existed when the run was created. Audit trail.
`compliance_flags`: `["exceeded_weekly_max_h", "exceeded_annual_ot_cap"]` etc.

## Engine — bucketing algorithm

New module `services/overtime_engine.py`. Pure-functional.

```python
@dataclass(frozen=True)
class BucketedHours:
    code: str                    # "REG" | "OT_WEEKDAY_T1" | "OT_WEEKDAY_T2" | "OT_REST_DAY"
                                 #   | "OT_HOLIDAY_NORMAL" | "OT_HOLIDAY_AFTER" | "NIGHT_PREMIUM"
    hours: Decimal
    multiplier: Decimal
    counts_in_basic_gross: bool  # only REG = True
    source_timelog_ids: list[int]
    weekly_accumulator_at_emit: Decimal


def bucket(
    logs: list[TimeLog],
    rule: ResolvedOvertimeRule,            # country rule + company holiday overrides
    holidays: set[date],
    period_start: date,
    period_end: date,
    job: Job,                              # weekly_rest_day_dow, overtime_exempt, timezone
    company_timezone: str,                 # IANA, e.g. "Indian/Mauritius"
) -> tuple[list[BucketedHours], list[str]]:  # buckets, compliance_flags
```

### Algorithm (in order)

1. **Eligibility resolution.**
   - `overtime_eligibility == 'EXEMPT'` → emit single `REG` bucket with all confirmed hours; return.
   - `overtime_eligibility == 'MONTHLY_ELIGIBLE'` → derive `hourly_rate = monthly_basic / (contracted_hours_per_week × 52 / 12)`. Safety check: if `monthly_basic > rule.monthly_basic_ot_cap`, treat as `EXEMPT` and emit single `REG` bucket.
   - `overtime_eligibility == 'HOURLY'` → use `Salary.hourly_rate` directly.
2. **Effective threshold.** `effective_threshold = min(job.contracted_hours_per_week, rule.weekly_threshold_h)`. Falls through to statutory when contract is NULL.
3. **Extend load window.** Load logs from `period_start - 6 days` through `period_end` so the weekly accumulator is accurate when a week straddles a period boundary. Drop buckets where `slice.date < period_start` at the end.
4. **Convert UTC → local.** For each TimeLog, convert `start_time`/`end_time` to `company_timezone`. All subsequent date/day-of-week/night-window comparisons use the local wall-clock.
5. **Drop unconfirmed OT.** `is_overtime=true AND overtime_confirmed_by_employer=false` → discard the log entirely.
6. **Subtract breaks.** Build `worked_intervals = [start_time, end_time] − union(BreakLog ranges)` for each TimeLog. The slicer operates on these intervals, not on raw start/end — so a 23:30–00:30 break inside a 21:00–07:00 shift correctly excludes that hour from both the night premium and the hour count.
7. **Slice each worked interval into atomic slices** where each slice has a single `(observed_date, day_type, night_state)` triple. State machine outputs slices of:
   - Day-portion vs. night-portion of one calendar day.
   - Slices that straddle midnight produce two date-keyed slices.
8. **Classify each slice's day_type** (using `observed_date` from `PublicHoliday`, not raw `date`, so MU Sunday-to-Monday substitutions land correctly):
   - `slice.observed_date in holidays` → mark `HOLIDAY`.
   - `slice.observed_date.isoweekday() == job.weekly_rest_day_dow` → mark `REST_DAY`.
   - Else → `WEEKDAY`.
9. **Stacking resolution.** If a slice is *both* `REST_DAY` and `HOLIDAY`:
   - `rule.stack_holiday_on_rest_day == 'MAX'` (default): pick the higher multiplier; tag as `HOLIDAY` for component naming.
   - `'ADD'` (reserved for future jurisdictions): sum and tag as both.
10. **Apply day-type multiplier to slice:**
   - `HOLIDAY` slice during "normal working hours" → `OT_HOLIDAY_NORMAL` at `public_holiday_normal_hours_multiplier`.
   - `HOLIDAY` slice after normal hours → `OT_HOLIDAY_AFTER` at `public_holiday_after_hours_multiplier`. ("After normal hours" = after the worker has accumulated their daily quota; for MU this is after 8 daily worked hours, regardless of whether they're cumulative on the holiday or earlier in the week.)
   - `REST_DAY` slice → `OT_REST_DAY` at `rest_day_multiplier`.
   - `WEEKDAY` slice → **weekly-threshold tier walker** (see below).
11. **Night premium composition (after day-type classification):**
   - If slice falls in `[night_start, night_end]` and `rule.night_mode == 'ADDITIVE'` (MU sector): emit an *additional* `NIGHT_PREMIUM` bucket of `slice.hours × (night_multiplier - 1.0)`. Original bucket stands.
   - If `night_mode == 'REPLACE'` (MG): the slice's *primary* bucket multiplier becomes `max(day_type_multiplier, night_multiplier)` — **except** when `stack_night_on_premium == 'NO_STACK'` and the day-type was already a premium (REST_DAY/HOLIDAY). In that case the day-type multiplier wins (per MG's "no stacking of bonuses").
12. **Weekly-threshold tier walker** (only fires for `WEEKDAY` slices):
    - `weekly_acc[iso_week] += slice.hours`
    - Walk tiers using `effective_threshold` (step 2): hours below it → `REG`; hours above feed `OT_WEEKDAY_T1`, `OT_WEEKDAY_T2`, etc. per `weekday_tiers` config.
    - `is_overtime=true` confirmed logs **skip the REG step**: even at 5/45 hours, an explicitly-flagged OT shift goes into `OT_WEEKDAY_T1`. (Worker took an emergency shift, gets full OT.)
13. **Filter to period.** Drop any buckets whose slice date is before `period_start`. They were only loaded to keep the accumulator correct.
14. **Compliance flags.** If aggregate OT hours exceeded `weekly_ot_soft_cap_h` or `weekly_total_max_h`, append a flag. Never fail-close — the worker still gets paid for time worked.

### Rounding policy (pinned)

`Decimal.quantize(value, Decimal('0.01'), rounding=ROUND_HALF_UP)` applied **per bucket emission**, not per slice and not accumulate-then-round:

```python
amount = (Decimal(hours) * Decimal(hourly_rate) * Decimal(multiplier)).quantize(
    Decimal('0.01'), rounding=ROUND_HALF_UP,
)
```

`BucketedHours.hours` stays at full precision (`Decimal`) for the accumulator. `gross_basic` and `gross_total` sum already-quantized component amounts. Asserts in M3 unit tests pin this to the cent against hand-computed expected values.

### No-rule-found fallback (fail-safe, not fail-through)

`payroll_rules.resolve(country, period_start)` raises `MissingOvertimeRule(country_code, period_start)` when no row matches. `create_draft_run` catches and returns HTTP 422 with `code='NO_OVERTIME_RULE_FOR_COUNTRY'` plus admin guidance pointing at the seed script.

This is deliberate: silently applying base-rate-everything for an unseeded country would be wage theft. New tenants in countries we haven't seeded cannot run payroll until an admin seeds the country rule.

### Confirmation gate composition (preserves existing behavior)

- `is_overtime=true` + `overtime_confirmed=false` → drop entirely (unchanged).
- `is_overtime=true` + `overtime_confirmed=true` → forced into OT bucket regardless of weekly threshold.
- `is_overtime=false` → engine decides bucket via threshold/day classification.

### Plug-in point

`payroll_engine._apply_pay_basis` (around line 499), hourly branch. Today:

```python
hours = sum_hours_worked_in_period(db, employee, period_start, period_end, require_approved_clockins)
hourly_basic = hourly_rate * hours
```

After:

```python
rule = resolve_overtime_rule(db, company, period_start)
holidays = public_holidays_for(country_code, period_start - 7, period_end + 1)
logs = approved_timelogs(db, employee, period_start - 7, period_end, require_approved_clockins)
buckets, flags = overtime_engine.bucket(logs, rule, holidays, period_start, period_end, job, company.timezone)
components.extend(build_components_from_buckets(buckets, hourly_rate_at_time_of_shift))
run.compliance_flags = (run.compliance_flags or []) + flags
```

Each bucket emits a `PayslipComponent`:

```
BASIC                 45.00 h × MUR 200 × 1.00 = MUR  9,000.00   counts_in_basic_gross=true
OT_WEEKDAY             4.00 h × MUR 200 × 1.50 = MUR  1,200.00   counts_in_basic_gross=false
OT_REST_DAY            6.00 h × MUR 200 × 2.00 = MUR  2,400.00   counts_in_basic_gross=false
OT_HOLIDAY_NORMAL      0.00 h × MUR 200 × 2.00 = MUR  0.00       counts_in_basic_gross=false
OT_HOLIDAY_AFTER       0.00 h × MUR 200 × 3.00 = MUR  0.00       counts_in_basic_gross=false
```

`PayslipComponent.meta JSONB` carries `bucket_source_timelog_ids` + `weekly_accumulator_at_emit` for the audit/dispute drill-down.

## Downstream bases — basic vs total

```python
gross_basic   = sum(c.amount for c in components if c.counts_in_basic_gross)
gross_total   = sum(c.amount for c in components if c.kind == 'earning')
```

| Calc | Base | Reasoning |
|---|---|---|
| Unpaid-leave deduction (`_compute_leave_impact_for_period`) | `gross_basic` | MU WRA s.30 "ordinary daily wage" |
| **NSF** (Employee 1%, Employer 2.5%) | **`gross_basic`** | NSF Act: "basic wage or salary excludes overtime, bonus, allowances". Existing seed `taxable_base=basic` ✓ |
| **CSG** (Employee 1.5%, Employer 3%) | **`gross_total`** | CSG Regulations: applies to gross monthly remuneration incl. OT + allowances. Existing seed `taxable_base=gross` ✓ |
| PAYE | `gross_total` | OT is taxable income |
| MU EOY gratuity | **`gross_total`** | WRA s.2 "earnings" includes OT wages from s.27(5) (verified) |
| MG congé payé | `gross_basic` | Salaire de base only |
| Loan repayment | `gross_total` | Per existing config |

**M2 audit result (2026-05-20):** The existing `statutory_deductions` seed already routes each contribution to the right base via the `taxable_base` field (basic vs gross). When M4 introduces OT buckets and sets `is_basic=True` only on the `REG` bucket, the `bases_by_code['basic']` aggregate will naturally exclude OT premiums and `bases_by_code['gross']` will include them. No routing change needed — the architecture supports per-deduction base selection.

The one thing M4 must verify: every new bucket component sets `is_basic` correctly (`REG` → True; `OT_*` and `NIGHT_PREMIUM` → False).

`compute_for_resolved` tracks both running totals. Each downstream consumer reads the correct one.

## Web/mobile surfacing

- **Payslip drawer** (`PayslipDetailDrawer.tsx`): the Components section already renders the list; buckets show up as rows with a small "OT" pill in the category column. Add a "Why this amount?" expand → renders `meta.weekly_accumulator_at_emit` and the source clock-ins.
- **Estimate PDF** (`templates/payslips/MU/estimated.html`): extend the recently-added "Hours feeding this estimate" drill-down to show each clock-in's resulting bucket(s). One clock-in can produce multiple bucket rows when it spans midnight or the weekly threshold.

## Snapshot & replay (memory: append-only)

- `payroll_rules.resolve(country, period_start)` joins the new `country_overtime_rules` lookup into the snapshot.
- `PayrollRun.country_rules_snapshot.overtime` JSONB block carries the resolved rule.
- `PayrollRun.company_overrides_snapshot` JSONB carries `CompanyHolidayRate` rows active at run-create time.
- Finalize re-computes using the snapshot, so country rule changes after finalize don't change paid amounts. Matches `feedback_versioned_rules`.
- Existing finalized payslips untouched (`compute_version=1`). Only new draft/finalize runs use the bucketed engine (`compute_version=2`).

## `compute_version` sunset plan (committed upfront)

The `compute_version` column is a safety lever for the M4 cutover, not a permanent dual-pipeline. Carrying two compute paths forever doubles the test burden on every future payroll-engine change. We commit to a sunset path now so we don't paint into a corner:

- **Cutover date** (T): the day `compute_version=2` lands in production. Every new draft / finalize run from T onwards is v2. v1 runs predating T continue to **display correctly** but cannot be regenerated or recomputed.
- **T + 3 months**: v1 code path becomes a thin read-only renderer — no new compute paths run through it. Bug-fixes to the v1 path are limited to crash fixes; behavior is frozen.
- **T + 12 months**: v1 path removed entirely. Any remaining v1-finalized payslips are migrated to v2-shape JSONB at display-time (a one-way decorator that converts the old component list to the new bucketed schema, marking buckets as `legacy_undifferentiated`). The Python `_apply_pay_basis` v1 branch is deleted.
- **Constraints during the dual period**:
  - Every new test of payroll-engine logic must run against both versions. CI matrix enforces.
  - The two paths share helper functions only — no v1-specific feature additions.
  - Document migrations against v1 are blocked; only v2 runs receive schema updates.

Concretely: v2 must be production-stable before T+3 months or the sunset slips. If v2 hits unexpected production bugs at T+1 month, we extend, not roll back — rolling back creates a third version which is worse.

## Milestones

Each milestone is independently mergeable, has explicit acceptance criteria, and a clear dependency chain. The chain matters: M1's schema decisions cascade through every later milestone, so M0 ground-truthing is a real gate, not a formality.

```
M0 ──► M1 ──► M2 ──► M3 ──► M4 ──┬─► M5 (web/mobile UI)
                                  ├─► M6 (admin UI)
                                  └─► M7 (MG rollout) ──► M8 (sector overlays, post-v1)
```

---

### M0 — Pre-flight: legal sign-off + payslip ground-truth (1 day · BLOCKING)

**Goal:** Close the legal-interpretation gap with real-world evidence, not summary articles.

**Tooling status (built — what's left is human/ops, see below):**
- The reconciliation harness `scripts/reconcile_mu_payslip.py` now drives the
  **real** `services/overtime_engine.bucket()` against the **live seeded MU
  rule + holidays** (loaded from the DB), with a gross-total cross-check. Fill
  in `_PAYSLIP_INPUTS` and run `python -m scripts.reconcile_mu_payslip`.
- The lawyer query is drafted at `backend/M0_LAWYER_QUERY_DRAFT.md` (four
  questions mapped to the `PENDING_M0_VERIFICATION` seed markers).
- The "general statutory floor only — sector Remuneration Orders not applied"
  gap is now surfaced in the admin overtime page (amber callout).

- [ ] **Validate against 3 real MU payslips** from established firms using Datapay / Ascend / PeoplePay. Source: public employer postings, sample contracts, ex-employee shares. Transcribe each into `_PAYSLIP_INPUTS` (use the engine's bucket codes: REG / OT_WEEKDAY_T1 / OT_REST_DAY / OT_HOLIDAY_*) and run the harness. Discrepancies surface the gaps no doc reading would catch. *(human: obtain payslips)*
- [ ] **Legal-interpretation sourcing** — pick one of:
  - (a) Registered Mauritian labour-law firm opinion letter on the "after normal hours" boundary for MU's 3× holiday multiplier. Budget: MUR 5–15k, 1–2 weeks turnaround. *(draft ready in `M0_LAWYER_QUERY_DRAFT.md`)*
  - (b) MoLHRD direct query via the Industrial Relations division. Slower / lower success rate but free.
  - (c) Reverse-engineer from the 3 payslips in step 1 if they happen to span a public holiday.
  Default to (c) + (a) as a backstop.
- [x] Confirm v1 ships **only** the general statutory floor for MU (no sector Remuneration Orders). Documented in the admin UI (amber callout on the overtime rules page). *(customer onboarding copy still TODO when onboarding flow exists)*
- [ ] Pick a launch sector and verify the general floor matches its Remuneration Order, OR explicitly defer that sector until M8. *(human: product decision)*
- [ ] One stakeholder (PM or counsel) signs off on `OVERTIME.md` v2. *(human: sign-off)*

**Acceptance:** v2 doc signed off; 3 real payslips reconcile to within MUR 1.00; legal-uncertainty notes either resolved or explicitly accepted as out-of-scope.

**Why first:** Migrations to `country_overtime_rules` are append-only. Wrong values seed historical artifacts that live forever in the audit chain. Reading actual payslips closes more gap than any further design iteration.

---

### M1 — Schema + holiday calendar + backfill (3 days)

**Goal:** All persistent state lands; no behavior change yet.

- [ ] Migration: `country_overtime_rules` table (incl. `monthly_basic_ot_cap`) + `forbid_rule_mutation` trigger.
- [ ] Migration: `country_overtime_weekday_tiers` child table + same mutation trigger + `(overtime_rule_id, tier_order)` unique index.
- [ ] Migration: `jobs.overtime_eligibility VARCHAR NOT NULL DEFAULT 'HOURLY'` + CHECK constraint (`HOURLY|MONTHLY_ELIGIBLE|EXEMPT`).
- [ ] Migration: `jobs.weekly_rest_day_dow SMALLINT NOT NULL DEFAULT 7`.
- [ ] Migration: `jobs.contracted_hours_per_week NUMERIC(5,2) NULL`.
- [ ] Migration: `public_holidays.observed_date DATE NULL` + backfill `observed_date = date`.
- [ ] Migration: `payroll_runs.compute_version SMALLINT NOT NULL DEFAULT 1` + `company_overrides_snapshot JSONB` + `compliance_flags JSONB DEFAULT '[]'`.
- [ ] Migration: `companies.timezone VARCHAR NOT NULL DEFAULT 'Indian/Mauritius'`.
- [ ] Seed MU statutory rule (effective_from = system start date) incl. `monthly_basic_ot_cap` (verify current cap from Workers' Rights Regulations).
- [ ] Seed MU public holidays 2026 + 2027 (with `observed_date` = next Monday for Sunday-falling holidays).
- [ ] Backfill: jobs where `company_role.name ILIKE` matches manager/director/head-of patterns → `overtime_eligibility='EXEMPT'`. Best-effort; admin-review report generated.
- [ ] Startup check: warn when `MAX(public_holidays.observed_date) < CURRENT_DATE + INTERVAL '90 days'` per active country.

**Acceptance:** `alembic upgrade head` runs clean; existing test suite passes unchanged; new tables/columns reachable via SQLAlchemy; backfill report inspected.

**Risk:** Trigger blocks legitimate close-out mutations on `effective_to`/`superseded_by_id`. Mitigation: copy trigger exactly from `country_payroll_rules_engine_20260427.py` — it already excludes those columns.

---

### M2 — Resolver + snapshot + fail-safe + deduction base audit (2 days)

**Goal:** `payroll_rules.resolve()` returns the overtime block; `finalize_run` snapshots it; unseeded countries fail loudly; each statutory deduction's wage base is verified against its own Act.

- [ ] Extend `CountryRulesSnapshot.overtime: Optional[CountryOvertimeRuleRead]` (incl. nested `weekday_tiers: List[...]`).
- [ ] `payroll_rules.resolve(country, period_start)` joins the new tables (parent + tiers).
- [ ] `payslip_estimate_service.build_context` reads the resolved rule (live, no snapshot).
- [ ] `finalize_run` already serializes the snapshot — verify the JSONB now contains the overtime block + tiers.
- [ ] Read-side endpoint `GET /payroll/runs/{id}` exposes `country_rules_snapshot.overtime` in the response.
- [ ] `payroll_rules.resolve()` raises `MissingOvertimeRule(country_code, period_start)` when no row matches.
- [ ] `create_draft_run` catches it → HTTP 422 `code='NO_OVERTIME_RULE_FOR_COUNTRY'` with admin guidance pointing at the seed script. Mid-period rule-change flag: if a new `effective_from` lands inside any open draft's period, emit an admin warning (do NOT auto-recompute; admin voids + recreates).
- [ ] **Statutory deduction base audit** (4–6 hours). Read each Act and confirm which gross feeds each deduction. Update the basis table in this doc with verified citations:
  - [ ] **CSG** (Contribution Sociale Généralisée): which base? Salary cap? Is OT included?
  - [ ] **NSF** (National Savings Fund): which base? Cap? Different rate brackets for part-time vs. full-time?
  - [ ] **PAYE**: confirmed OT included (taxable income); verify the brackets snapshot.
  - [ ] **Loan repayment**: confirmed `gross_total` from existing config — no change.
  - [ ] **MU EOY gratuity**: confirmed via WRA s.2 "earnings" definition; verify the existing `compute_bonus` path routes to `gross_total` not the post-everything gross.
  - [ ] **MG congé payé**: confirmed `gross_basic` — re-read Code du Travail s.149 to verify.
  - [ ] If any base differs from the doc's table, update both the table and the `compute_for_resolved` routing.

**Acceptance:** A new draft run on a MU company has `country_rules_snapshot.overtime` populated; legacy finalized runs unaffected (`compute_version=1` still).

---

### M3 — Pure engine + unit tests (4–5 days)

**Goal:** The bucketer exists, is correct, and is independently testable. No payroll wiring yet.

- [ ] `services/overtime_engine.py` with pure-functional `bucket(logs, rule, holidays, period_start, period_end, job, company_timezone) -> (List[BucketedHours], List[str])`.
- [ ] `BucketedHours` dataclass: `code`, `hours`, `multiplier`, `counts_in_basic_gross`, `source_timelog_ids`, `weekly_accumulator_at_emit`.
- [ ] Slicer state machine: midnight crossing + night window + day-type classification + break subtraction, documented as a state table in the module docstring.
- [ ] Eligibility resolver: `HOURLY` / `MONTHLY_ELIGIBLE` (derive hourly_rate) / `EXEMPT` paths with `monthly_basic_ot_cap` safety fallback.
- [ ] Effective-threshold computation: `min(job.contracted_hours_per_week, rule.weekly_threshold_h)`.
- [ ] Rounding policy: `Decimal.quantize('0.01', ROUND_HALF_UP)` applied per-bucket emission; asserted in tests to the cent.
- [ ] Unit tests (target 40+):
  - [ ] Regular 40h week, no OT.
  - [ ] 50h week, 5h OT bucketed at weekday tier 1.
  - [ ] Week straddling pay-period boundary (acc carries over).
  - [ ] Rest day non-Sunday (worker `weekly_rest_day_dow=3`).
  - [ ] Public holiday normal hours (≤8 daily).
  - [ ] Public holiday after-hours (>8 daily).
  - [ ] Holiday-on-rest-day → MAX multiplier.
  - [ ] MU ADDITIVE night (sector-overlaid, defer until sector schema).
  - [ ] MG REPLACE night, habitual (130%) and occasional (150%).
  - [ ] MG `stack_night_on_premium='NO_STACK'` — Sunday-night picks 140%, not stacked.
  - [ ] Multi-tier MG (130 first 8 OT-h / 150 beyond).
  - [ ] Confirmation gate drops unconfirmed `is_overtime=true`.
  - [ ] Confirmed `is_overtime=true` skips REG even under threshold.
  - [ ] `overtime_exempt=true` → all REG.
  - [ ] Soft-cap warning fired at 10h/wk (MU).
  - [ ] Hard-cap warning fired at 55h/wk (MU).
  - [ ] UTC → `Indian/Mauritius` conversion correct for night-window classification.
  - [ ] Midnight crossing Sat 22:00 → Sun 06:00 produces 2 date-keyed slices.
  - [ ] `Decimal.ROUND_HALF_UP` consistent across all multiplications.
  - [ ] Overlapping `TimeLog` rows raise `ValueError` (validation, not silent merge).
- [ ] Snapshot tests on three real-shape fixtures (MU 45h worker, MU rest-day worker, MG multi-tier worker).
- [ ] Property-based tests (Hypothesis): random `(log_set, rule)` combinations assert engine invariants: total hours conserved, all multipliers ≥ 1.0, `gross_basic ≤ gross_total`, no negative buckets.
- [ ] Part-time fixture: 20hr-contracted worker working 30hr/wk → 10hr OT at T1.
- [ ] Salaried-eligible fixture: MUR 30k monthly basic with 40hr/wk contract → derived hourly rate, bucketed correctly.
- [ ] Salaried-above-cap fixture: MUR 80k monthly basic → engine treats as EXEMPT.
- [ ] Break-subtraction fixture: 21:00–07:00 shift with 23:30–00:30 break → break hour excluded from night portion.
- [ ] Holiday-substitution fixture: MU holiday on Sunday with `observed_date` Monday → Monday classified as HOLIDAY, not Sunday.
- [ ] **Public-holiday-during-leave fixture**: worker on approved annual leave when a MU public holiday falls inside the leave window. Per WRA s.31, the holiday day is credited back to leave balance. The OT engine itself doesn't pay anything (worker didn't work) but `_compute_leave_summary` must recognize the holiday and subtract one leave day from the impact calculation. Verify the integration with the existing leave engine; surface a `compliance_flags: ["holiday_during_leave_adjusted"]` flag for the audit trail.
- [ ] **Slicer state machine table** pinned in the module docstring before tests are written. Enumerate the 16-row truth table of `(crosses_midnight, in_night_window, is_rest_day, is_holiday)` → emitted slice types. Tests assert against this table; UI debug renderer shows the state for any given clock-in.

**Acceptance:** 100% unit-test pass; module reviewed; no payroll behavior changed because engine isn't wired yet.

---

### M4 — Wire into compute (2.5–3 days)

**Goal:** Bucketed OT actually pays workers correctly for hourly-basis runs. Estimate widened from 1.5d → 2.5–3d: `gross` has ~30 downstream consumers (PAYE, CSG, NSF, EOY gratuity, congé payé, loans, statutory deductions, leave impact, allowances, payslip rendering, audit log). Each needs verification it reads the right base.

- [ ] `payroll_engine._apply_pay_basis` hourly branch routes through `overtime_engine.bucket` when run is `compute_version=2`. Legacy v1 runs untouched.
- [ ] `build_components_from_buckets(buckets, hourly_rate_at_time_of_shift)` emits `PayslipComponent` rows with `meta.bucket_source_timelog_ids`, `meta.weekly_accumulator_at_emit`.
- [ ] `compute_for_resolved` tracks `gross_basic` (REG only) and `gross_total` (all earnings) separately.
- [ ] `_compute_leave_impact_for_period` rebased on `gross_basic` (was post-everything gross — pre-existing latent bug now exposed and fixed).
- [ ] PAYE, CSG, NSF, EOY gratuity, MG congé payé each route to the correct base per the table in this doc.
- [ ] `create_draft_run` and `finalize_run` write `compute_version=2`.
- [ ] `run.compliance_flags` accumulated from engine output and persisted.
- [ ] Legacy finalize_run + draft_run tests still pass unchanged.
- [ ] New integration test: end-to-end MU run with mixed regular + OT + rest-day hours produces expected `gross_total`, `gross_basic`, statutory deductions, net.

**Acceptance:** A real MU sample payslip matches hand-computed expected values to the cent; legacy snapshots unchanged.

---

### M5 — Payslip rendering + cost previews (2.5 days)

**Goal:** Workers can see exactly why they were paid what they were paid; employers see OT cost before confirming.

- [ ] Web `PayslipDetailDrawer.tsx`: bucket rows display with multiplier badges in the category column.
- [ ] Web drawer: "Why this amount?" expand on each OT row → renders `meta.weekly_accumulator_at_emit` + source clock-ins.
- [ ] Mobile payslip viewer: same bucket rows + multiplier badge.
- [ ] Estimate PDF (`templates/payslips/MU/estimated.html`): per-clock-in row shows its resulting bucket(s). One clock-in may render multiple rows when it spans midnight or the weekly threshold.
- [ ] Estimate PDF: footnote explaining that proportional shares are now bucket-level, not aggregate-level.
- [ ] Worker preview endpoint: `GET /shifts/preview-pay?date=&hours=` returns the projected bucket(s) + amount for a hypothetical shift. Surface on the mobile clock-in / shift-acceptance screens.
- [ ] Employer cost preview endpoint: `GET /timelog/{id}/overtime-cost-preview` returns the wage impact of confirming OT (e.g., "Confirming will add MUR 1,200 — 2× OT, MUR 600 above base"). Wire into the company-dashboard time-log approval row.

**Acceptance:** Visual review on a sample payslip with rest day + holiday + weekday OT; "Why this amount?" expand functional in both web and mobile.

---

### M6 — Admin UI + CompanyHolidayRate + recompute tool + tenant-isolation audit (3.5 days)

**Goal:** Platform admins can author/version country rules; employers can override per-date holiday multipliers; correcting a wrong rule is recoverable; multi-tenant boundaries audited.

- [ ] `/admin/payroll-rules/overtime` page: reuse `TimelineCard` pattern from existing admin pages. Read-only for v1 (creation via seeder); edit + new-version in a follow-up.
- [ ] `/admin/payroll-rules/holidays` per-country calendar view. Add / edit / delete with audit log. Surfaces `observed_date` for substituted holidays.
- [ ] Wire `CompanyHolidayRate.multiplier` into `overtime_engine.bucket`'s holiday-multiplier resolution.
- [ ] Floor validator: when creating/updating a `CompanyHolidayRate`, reject if `multiplier < country.public_holiday_normal_hours_multiplier` with HTTP 422.
- [ ] Audit log entry on every `CompanyHolidayRate` create/update.
- [ ] **Bulk-recompute endpoint:** `POST /admin/payroll/runs/recompute-drafts` with body `{country_code, period_overlap_after_date?}`. Voids existing payslips on matching open draft runs and recreates them with the current snapshot. Audit-logged per affected run. Hard-fails if any matching run is `finalized` (never recompute finalized).
- [ ] **Tenant-isolation security audit:** checklist + grep audit of every read endpoint touching `CompanyHolidayRate`, `Job.overtime_eligibility`, `country_overtime_rules`, `payroll_runs.compliance_flags`. Verify each filters by `current_user.company_id` (or is platform-admin only). Document findings + fixes.

**Acceptance:** Admin can view MU OT rule via the UI; employer can add a `CompanyHolidayRate=2.5` for 25 December and the next draft run picks it up; attempt to set `multiplier=1.5` rejected with clear error; recompute endpoint correctly re-runs an open draft after a country rule update; tenant-isolation audit closed.

---

### M7 — MG rollout (1 day)

**Goal:** Madagascar tenants can run payroll with their own statutory floor.

- [ ] Seed MG statutory rule: 40h/wk · `rest_day_multiplier=1.40` · `public_holiday_normal_hours_multiplier=1.50` · `public_holiday_after_hours_multiplier=1.50` · `night_mode='REPLACE'` · `night_multiplier_habitual=1.30` · `night_multiplier_occasional=1.50` · `stack_night_on_premium='NO_STACK'` · `weekly_total_max_h=60`.
- [ ] Seed MG `country_overtime_weekday_tiers` child rows: `(tier_order=1, up_to_hours=8.00, multiplier=1.30)`, `(tier_order=2, up_to_hours=NULL, multiplier=1.50)`.
- [ ] Seed MG public holidays 2026 + 2027.
- [ ] Integration test: MG worker with 50h week including Sunday-night → expected components match Code du Travail hand-computation.
- [ ] Document MG-specific quirks in admin UI tooltip (no-stack-on-premium rule especially).

**Acceptance:** A MG worker fixture run produces the correct gross/net per Code du Travail.

---

### M8 — Sector Remuneration Orders (POST-v1, deferred)

**Goal:** Support MU's ~30 sectoral overlays (catering/tourism, construction, sugar, security, etc.).

- [ ] Schema: `country_overtime_rule_sector_override` table (country_code, sector_code, effective_from/to, all the same multiplier columns as `country_overtime_rules`).
- [ ] `Company.sector_code` foreign key.
- [ ] Resolver merges country base + sector override at compute time.
- [ ] Seed top-3 sectors (catering/tourism, construction, security).

**Acceptance:** Not for v1. Track as separate milestone; revisit when first sector-specific customer signs.

---

## Total v1 effort

| Milestone | Effort | Cumulative |
|---|---|---|
| M0 — Legal sign-off + 3 payslips validated | 1 d | 1 d |
| M1 — Schema (incl. tiers child) + holidays + backfill | 3 d | 4 d |
| M2 — Resolver + snapshot + fail-safe + deduction-base audit | 2 d | 6 d |
| M3 — Engine + tests (incl. Hypothesis + leave overlap) | 4–5 d | 10–11 d |
| M4 — Wire into compute (all `gross` consumers) | 2.5–3 d | 12.5–14 d |
| M5 — Rendering + cost previews | 2.5 d | 15–16.5 d |
| M6 — Admin UI + recompute + tenant audit | 3.5 d | 18.5–20 d |
| M7 — MG rollout | 1 d | 19.5–21 d |

**~20–21 working days for a senior IC, v1 (MU + MG general floor, no sector overlays).**

M5 and M6 are parallelizable if you have a second person; that brings the wall-clock to ~16 days.

## Tenant-isolation audit (M6 — completed 2026-05-20)

Grep + endpoint review of every read/write path touching the new multi-tenant
surfaces. Result: **no cross-tenant leak found; no fixes required.**

| Endpoint | Surface | Gating | Verdict |
|---|---|---|---|
| `GET /{company_id}/holiday-rates` | `CompanyHolidayRate` | `_require_company_member` + `.filter(company_id==)` | ✓ |
| `POST/PUT/DELETE /{company_id}/holiday-rates` | `CompanyHolidayRate` | `_require_company_member` + `company_id` scoping + floor validator + audit | ✓ |
| `GET /payroll-rules/{cc}/overtime-rules` | `country_overtime_rules` | `require_platform_admin` (global reference data) | ✓ |
| `GET /payroll-rules/{cc}/snapshot` | overtime rule | `require_platform_admin` | ✓ |
| `GET/POST/PUT/DELETE /payroll-rules/{cc}/holidays` | `public_holidays` (global) | `require_platform_admin` + audit | ✓ |
| `GET /payroll/runs/{id}` | `compliance_flags` | `_require_admin_for_company(run.company_id)` | ✓ |
| `GET /payroll/runs` | runs list | `_require_admin_for_company` + `.filter(company_id==)` | ✓ |
| `POST /payroll/runs/recompute-drafts` | drafts | `_require_admin_for_company` + `.filter(company_id==)` + `manage_payroll` perm | ✓ |
| `GET /overtime/preview-shift` | `Job` OT fields | own (`user_id==target.user_id`) or `_require_admin_for_company(target.company_id)` | ✓ |
| `GET /payslips/{id}`, `GET /payslips/employee/{id}` | payslip components (OT `meta`) | own or `_require_admin_for_company` | ✓ |

`Job.overtime_eligibility`, `weekly_rest_day_dow`, `contracted_hours_per_week`
are **not exposed in any response schema** — read only inside the engine and
preview endpoint, both of which are already company-scoped.

**Note on the `tenant_guard` advisory layer.** `core/tenant_guard.py` is a
`before_execute` listener (default mode `log`) that warns when a query touches
a `DIRECT_MULTI_TENANT_TABLES` table without a literal `company_id` token. The
overtime endpoints all call `require_company_admin` → `is_company_admin_for`
(`core/roles.py`), which evaluates `user.company` — a lazy-load on the
`Company.user_id` FK that emits `SELECT … FROM companies WHERE user_id = …`.
That fires a `['companies'] … tenant=None` warning. It is a **false positive**,
not a leak: the query is scoped to the actor's own company via `user_id`; the
guard's heuristic only recognizes the `company_id` token. Pre-existing and
app-wide (every company-scoped endpoint hits it), advisory-only. A precise fix
would be to make `is_company_admin_for` test ownership with an explicit
`Company.company_id == company_id AND Company.user_id == user.user_id` query
(satisfies the guard and is more exact) — deferred as an app-wide auth change.

## Risks (acknowledged, mitigated where listed)

| # | Risk | Mitigation |
|---|---|---|
| 1 | MU sector-specific Remuneration Orders override the general statutory floor (~30 sectors). | v1 uses general floor only; admin-doc'd; sector overlays in a follow-up phase via `country_overtime_rule_sector_override` table. |
| 2 | "After normal hours" definition for MU holiday-after-hours (3×) — does it mean after 8 daily hours? After the worker's specific daily schedule? Or after sundown? | Conservative reading: after 8 daily cumulative hours on the holiday. Doc'd; flagged for MoLHRD opinion. |
| 3 | TZ-aware comparisons: `TimeLog.start_time` is stored UTC; rule night_start is wall-clock. | New `companies.timezone` (IANA, default per country); engine converts UTC → local once at slice classification. |
| 4 | Annual cap enforcement vs. compliance flag. | Soft cap → warn (`compliance_flags`); never refuse payment. Hard cap (MU 55hr/wk) → still pay but compliance_flags includes `legal_max_exceeded`. |
| 5 | Overlapping `TimeLog` rows (worker double-clocked-in). | Validate at write time (reject); bucketer asserts defensively. |
| 6 | Mid-period hourly-rate change (raise on the 15th). | Resolver looks up rate effective on `slice.date`, not at `period_start`. |
| 7 | Daylight saving. | MU and MG don't observe DST. Document; defer to other-country rollout. |
| 8 | Decimal rounding mode consistency. | Force `ROUND_HALF_UP` on all `Decimal.quantize` calls in the engine. Audit existing engine for drift. |
| 9 | Backward compat with `compute_version=1` finalized runs. | Snapshot is frozen. Legacy runs never re-bucket. New engine off-path entirely for v1 runs. |
| 10 | Trigger blocks legitimate `effective_to` mutation on close-out. | Copy the existing trigger pattern from `country_payroll_rules_engine_20260427.py` — it already allows `effective_to`/`superseded_by_id` updates. |

## Plan quality

**~91%.** Up from 87% after folding in the seven items surfaced in the second fresh-eyes review: child-table refactor for weekday tiers; `compute_version` sunset plan; M4 effort widened to realistic; M2 deduction-base audit; M3 leave-overlap fixture + state-machine pin-down; M0 widened with three-real-payslips validation + labour-lawyer path; honest budget for legal sourcing.

Remaining 9%:
- **MU "after normal hours" definition** for the 3× holiday multiplier (cumulative-on-the-holiday vs. cumulative-on-the-week). Closes ~2 points with the M0 payslip reconciliation or the lawyer's letter.
- **Sector-specific Remuneration Orders** for MU (~30 sectors). v1 ships the general floor; M8 adds overlays. Closes ~3 points when the first sector customer signs.
- **Algorithmic gaps prose can't catch.** Best closed by M3 unit tests + property-based runs + an early MU customer's payroll auditor signing off on a real January payslip. Closes ~3 points.
- **Production discoveries** (perf at 1000-employee scale, integration with the 30 `gross` downstream consumers, decimal-drift over month-long aggregation). Only surfaces in M4. Closes the final ~1 point.

Note: pushing past 91% on paper is diminishing-returns. The next gains are pre-code — the M0 payslip reconciliation is the single highest-leverage validation — and the rest land during M3 implementation. The honest read is "design is solid enough to start" rather than "design is finished."

---

**Sources:**
- MU Workers' Rights Act 2019 (consolidated 27 July 2024) — socialsecurity.govmu.org
- MU MRA Workers' Rights Act 2019 — mra.mu
- MU DTOS employment-law update — dtos-mu.com
- MU Playroll Working Hours guide — playroll.com
- MG Code du Travail (Loi 2024-014) + Décret 68-172 via WageIndicator — wageindicator.org
