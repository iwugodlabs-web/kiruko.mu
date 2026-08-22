"""M3 — bucketed overtime + premium-pay engine (pure-functional).

Splits a worker's clock-ins into rate-coded buckets per the country's
statutory rule + per-company holiday overrides. No DB access here — the
caller (payroll_engine in M4) hands in the resolved rule, holidays, and
already-loaded TimeLogs/BreakLogs.

Algorithm overview
==================

1.  Eligibility resolution — EXEMPT / above-cap MONTHLY_ELIGIBLE workers
    short-circuit to a single REG bucket.
2.  Effective weekly threshold = min(contracted_hours_per_week, statutory).
3.  UTC → company timezone conversion for every TimeLog.
4.  Subtract BreakLog ranges from each TimeLog's [start, end].
5.  Slice each worked interval into atomic slices, each with a single
    (observed_date, day_type, in_night_window) triple.
6.  Classify by day_type (HOLIDAY / REST_DAY / WEEKDAY).
7.  HOLIDAY × REST_DAY stacking via rule.stack_holiday_on_rest_day.
8.  Premium days bypass the weekly threshold; weekday slices feed a
    multi-tier accumulator (REG → OT_WEEKDAY_T1 → OT_WEEKDAY_T2 …).
9.  Night premium composition: ADDITIVE emits an extra NIGHT_PREMIUM
    bucket; REPLACE substitutes the multiplier on the primary bucket
    unless stack_night_on_premium='NO_STACK' AND the slice already has
    a premium day-type.
10. Filter to period (slices loaded for accumulator context but lying
    outside [period_start, period_end] are dropped before emission).
11. Emit compliance_flags for soft / hard cap exceedances.

Slicer state-machine truth table
================================

For each worked interval, the slicer emits atomic slices keyed by:

    (crosses_midnight, in_night_window, slice_date_type, is_night_pre/post_midnight)

Slice *shape* combinations (how many slices an interval emits):

| # | input shape                              | emitted slices |
|---|------------------------------------------|----------------|
| 1 | 09:00–18:00 same day, no night overlap   | 1 day slice   |
| 2 | 21:00–23:00 in-day, partial night window | 1 night slice (if rule defines night) |
| 3 | 22:00–06:00 midnight + night             | 1 night slice on day A + 1 night slice on day B |
| 4 | 21:00–07:00 midnight + day/night mix     | 1 day-pre slice (A) + 1 night slice (A→B) + 1 day-post slice (B) |
| 5 | 23:30–00:30 break inside                 | break-subtracted intervals fed back to slicer |

Full classification truth table — for each ATOMIC slice (post midnight/night
split), the four booleans (crosses_midnight, in_night_window, is_rest_day,
is_holiday) map to the bucket(s) below. `crosses_midnight` never changes a
slice's own classification (it only governs slice COUNT, table above): each
resulting calendar-day slice is classified independently by its own date, so
the 8 rows for crosses_midnight=N repeat identically for crosses_midnight=Y.

day-type precedence: HOLIDAY > REST_DAY > WEEKDAY (holiday∧rest_day resolves
per `stack_holiday_on_rest_day`, default MAX → higher multiplier, tagged
HOLIDAY). Night handling depends on `night_mode`/`stack_night_on_premium`.

| #  | midnight | night | rest_day | holiday | resulting bucket(s) |
|----|----------|-------|----------|---------|---------------------|
|  1 | N | N | N | N | REG, or OT_WEEKDAY_Tn (weekly tier walker) |
|  2 | N | N | N | Y | OT_HOLIDAY_NORMAL / _AFTER (after daily quota) |
|  3 | N | N | Y | N | OT_REST_DAY |
|  4 | N | N | Y | Y | holiday wins (MAX) → OT_HOLIDAY_* |
|  5 | N | Y | N | N | weekday slice + night premium (ADDITIVE: +NIGHT_PREMIUM; REPLACE: max(1.0, night)) |
|  6 | N | Y | N | Y | OT_HOLIDAY_* ; night per stack_night_on_premium (NO_STACK→holiday wins) |
|  7 | N | Y | Y | N | OT_REST_DAY ; night per stack_night_on_premium (NO_STACK→rest-day wins) |
|  8 | N | Y | Y | Y | holiday wins (MAX) → OT_HOLIDAY_* ; night per stack policy |
|  9 | Y | N | N | N | as row 1, per calendar-day slice |
| 10 | Y | N | N | Y | as row 2, per calendar-day slice |
| 11 | Y | N | Y | N | as row 3, per calendar-day slice |
| 12 | Y | N | Y | Y | as row 4, per calendar-day slice |
| 13 | Y | Y | N | N | as row 5, per calendar-day slice |
| 14 | Y | Y | N | Y | as row 6, per calendar-day slice |
| 15 | Y | Y | Y | N | as row 7, per calendar-day slice |
| 16 | Y | Y | Y | Y | as row 8, per calendar-day slice |

Rounding policy
===============

`Decimal.quantize('0.01', ROUND_HALF_UP)` applied **per BucketedHours
emission**. Internal `hours` accumulation stays at full precision.
"""

from __future__ import annotations

from dataclasses import dataclass, field
from datetime import date, datetime, time, timedelta, timezone
from decimal import Decimal, ROUND_HALF_UP
from typing import Dict, FrozenSet, List, Optional, Tuple

import zoneinfo

# Type-only imports — keep this module dependency-light to stay pure/testable.
from schema.payroll_rules_schema import (
    CountryOvertimeRuleRead,
    CountryOvertimeWeekdayTierRead,
)


# ---------------------------------------------------------------------------
# Value objects passed in by the caller
# ---------------------------------------------------------------------------


@dataclass(frozen=True)
class BucketerTimeLog:
    """Minimal shape the bucketer needs from a TimeLog row."""
    timelog_id: int
    start_utc: datetime              # tz-aware UTC datetime
    end_utc: Optional[datetime]      # may be None for unclosed (excluded)
    is_overtime: bool                # worker flag
    overtime_confirmed: bool         # employer confirmation


@dataclass(frozen=True)
class BucketerBreak:
    """Minimal shape of a BreakLog row used to subtract from worked hours."""
    timelog_id: int
    start_utc: datetime
    end_utc: datetime


@dataclass(frozen=True)
class BucketedHours:
    """One emitted pay bucket. Multiple buckets per shift are normal —
    a single shift can produce REG + OT_WEEKDAY + NIGHT_PREMIUM if it
    crosses thresholds and the night window."""
    code: str
    hours: Decimal
    multiplier: Decimal
    counts_in_basic_gross: bool      # True for REG only (drives gross_basic vs gross_total)
    source_timelog_ids: Tuple[int, ...]
    weekly_accumulator_at_emit: Decimal
    notes: str = ""                  # free-text for audit drill-down (e.g. "above weekly threshold")

    def amount(self, hourly_rate: Decimal) -> Decimal:
        """Compute the cash amount for this bucket. Quantized per-emission."""
        raw = self.hours * Decimal(hourly_rate) * self.multiplier
        return raw.quantize(Decimal("0.01"), rounding=ROUND_HALF_UP)


# ---------------------------------------------------------------------------
# Bucket codes (stable strings — used in PayslipComponent.code)
# ---------------------------------------------------------------------------

REG = "REG"
OT_WEEKDAY_T = "OT_WEEKDAY_T"           # prefix; tier_order appended (T1, T2 …)
OT_REST_DAY = "OT_REST_DAY"
OT_HOLIDAY_NORMAL = "OT_HOLIDAY_NORMAL"
OT_HOLIDAY_AFTER = "OT_HOLIDAY_AFTER"
NIGHT_PREMIUM = "NIGHT_PREMIUM"


# ---------------------------------------------------------------------------
# Internal slice representation
# ---------------------------------------------------------------------------


@dataclass(frozen=True)
class _Slice:
    """An atomic worked sub-interval — single calendar date, single
    night-window state."""
    timelog_id: int
    start_local: datetime           # tz-aware, in company tz
    end_local: datetime
    in_night_window: bool
    is_overtime_forced: bool        # confirmed-OT log overrides threshold check

    @property
    def observed_date(self) -> date:
        """The calendar date the slice belongs to (start.date in local tz)."""
        return self.start_local.date()

    @property
    def hours_dec(self) -> Decimal:
        """Hours worked in this slice as Decimal."""
        delta = self.end_local - self.start_local
        return Decimal(delta.total_seconds()) / Decimal(3600)


# ---------------------------------------------------------------------------
# Helpers — interval math
# ---------------------------------------------------------------------------


def _to_local(dt_utc: datetime, tz_name: str) -> datetime:
    """Convert a UTC datetime to the company's local timezone."""
    tz = zoneinfo.ZoneInfo(tz_name)
    if dt_utc.tzinfo is None:
        dt_utc = dt_utc.replace(tzinfo=timezone.utc)
    return dt_utc.astimezone(tz)


def _subtract_breaks(
    log_start: datetime, log_end: datetime, breaks: List[BucketerBreak]
) -> List[Tuple[datetime, datetime]]:
    """Return the list of (start, end) worked intervals after subtracting
    every break range that overlaps [log_start, log_end]. Breaks are
    expected in UTC — but we operate on whatever tz the caller passed
    (the caller converts both before calling here)."""
    if not breaks:
        return [(log_start, log_end)]
    # Clip breaks to the shift range and sort by start.
    clipped = []
    for br in breaks:
        bs = max(br.start_utc, log_start)
        be = min(br.end_utc, log_end)
        if be > bs:
            clipped.append((bs, be))
    clipped.sort()

    out: List[Tuple[datetime, datetime]] = []
    cursor = log_start
    for bs, be in clipped:
        if bs > cursor:
            out.append((cursor, bs))
        cursor = max(cursor, be)
    if cursor < log_end:
        out.append((cursor, log_end))
    return out


def _split_at_midnight(start: datetime, end: datetime) -> List[Tuple[datetime, datetime]]:
    """Split an interval into per-calendar-date pieces."""
    out: List[Tuple[datetime, datetime]] = []
    cursor = start
    while cursor < end:
        next_midnight = datetime.combine(
            cursor.date() + timedelta(days=1),
            time(0, 0),
            tzinfo=cursor.tzinfo,
        )
        chunk_end = min(end, next_midnight)
        out.append((cursor, chunk_end))
        cursor = chunk_end
    return out


def _split_at_night_window(
    start: datetime, end: datetime, night_start: Optional[time], night_end: Optional[time]
) -> List[Tuple[datetime, datetime, bool]]:
    """Split an interval into sub-intervals each entirely inside or outside
    the night window. Returns (start, end, in_night_window) tuples.

    Both endpoints are in the same local timezone; midnight crossing is
    handled upstream by `_split_at_midnight`. Night window may straddle
    midnight (e.g. 22:00–05:00) — when this slicer is called, the input
    is already a single-calendar-date interval, so a wrap-around night
    means anything before night_end is "night" and anything after
    night_start is also "night"; the gap between is "day".
    """
    if night_start is None or night_end is None:
        return [(start, end, False)]

    day = start.date()
    tz = start.tzinfo
    ns = datetime.combine(day, night_start, tzinfo=tz)
    ne = datetime.combine(day, night_end, tzinfo=tz)

    def is_night_at(t: datetime) -> bool:
        # Night window may wrap midnight (22:00-05:00) or be normal (10:00-12:00 weird but allowed).
        if night_start <= night_end:
            return ns <= t < ne
        else:
            # wrap — t is night if t >= ns OR t < ne
            return t >= ns or t < ne

    out: List[Tuple[datetime, datetime, bool]] = []
    cursor = start
    while cursor < end:
        cur_night = is_night_at(cursor)
        # Find next transition point after cursor.
        # Candidate transitions: ns and ne, on this calendar day.
        transitions = sorted(t for t in (ns, ne) if t > cursor and t < end)
        if not transitions:
            out.append((cursor, end, cur_night))
            break
        next_t = transitions[0]
        out.append((cursor, next_t, cur_night))
        cursor = next_t
    return out


# ---------------------------------------------------------------------------
# Day-type classification
# ---------------------------------------------------------------------------


_HOLIDAY = "HOLIDAY"
_REST_DAY = "REST_DAY"
_WEEKDAY = "WEEKDAY"


def _classify_day(
    slice_date: date,
    holidays_by_observed_date: FrozenSet[date],
    weekly_rest_day_dow: int,
    stack_holiday_on_rest_day: str,
) -> Tuple[str, bool]:
    """Returns (day_type, is_holiday_AND_rest_day).

    The second flag matters when stacking is 'ADD' — caller adds rest-day
    multiplier on top of holiday multiplier instead of taking MAX.
    """
    is_holiday = slice_date in holidays_by_observed_date
    is_rest_day = slice_date.isoweekday() == weekly_rest_day_dow
    if is_holiday and is_rest_day:
        if stack_holiday_on_rest_day == "ADD":
            return _HOLIDAY, True
        # MAX path — the holiday classification subsumes rest day.
        return _HOLIDAY, True
    if is_holiday:
        return _HOLIDAY, False
    if is_rest_day:
        return _REST_DAY, False
    return _WEEKDAY, False


# ---------------------------------------------------------------------------
# Tier walker for weekday slices
# ---------------------------------------------------------------------------


def _walk_tiers(
    weekday_tiers: List[CountryOvertimeWeekdayTierRead],
    effective_threshold: Decimal,
    weekly_used: Decimal,
    slice_hours: Decimal,
    is_overtime_forced: bool,
) -> List[Tuple[str, Decimal, Decimal, Decimal, str]]:
    """Returns list of (code, hours, multiplier, weekly_acc_at_emit, notes)
    for this slice. Threshold-based: hours below `effective_threshold`
    go to REG; hours above feed tier 1, then tier 2, etc.

    `is_overtime_forced=True` skips the REG portion entirely (the slice
    was explicitly flagged as OT by the worker + employer-confirmed).
    """
    emitted: List[Tuple[str, Decimal, Decimal, Decimal, str]] = []
    used = weekly_used
    remaining = slice_hours

    # REG portion (skipped if forced OT)
    if not is_overtime_forced:
        room = max(Decimal("0"), effective_threshold - used)
        reg_h = min(remaining, room)
        if reg_h > 0:
            emitted.append((REG, reg_h, Decimal("1.00"), used + reg_h, ""))
            used += reg_h
            remaining -= reg_h

    # Tier walker — tiers are 1-indexed by tier_order, may have up_to_hours=None for "and beyond"
    if remaining <= 0:
        return emitted

    sorted_tiers = sorted(weekday_tiers, key=lambda t: t.tier_order)
    tier_base = effective_threshold  # cumulative threshold where tier 1 starts
    for tier in sorted_tiers:
        if remaining <= 0:
            break
        # tier's hard ceiling within the week
        ceiling = (
            tier_base + tier.up_to_hours
            if tier.up_to_hours is not None
            else None
        )
        # room remaining in this tier
        if ceiling is not None:
            room_in_tier = max(Decimal("0"), ceiling - used)
        else:
            room_in_tier = remaining  # last tier — soaks everything
        tier_h = min(remaining, room_in_tier)
        if tier_h > 0:
            code = f"{OT_WEEKDAY_T}{tier.tier_order}"
            emitted.append((code, tier_h, tier.multiplier, used + tier_h, f"weekday OT tier {tier.tier_order}"))
            used += tier_h
            remaining -= tier_h
        if ceiling is not None:
            tier_base = ceiling
    return emitted


# ---------------------------------------------------------------------------
# Main bucketer
# ---------------------------------------------------------------------------


def _assert_no_overlaps(logs: List[BucketerTimeLog], assume_ot_confirmed: bool = False) -> None:
    """Raise ValueError if any two countable logs overlap in time.

    Only closed logs that will actually be counted are considered —
    unclosed logs (end_utc is None) and unconfirmed overtime are dropped
    downstream, so an overlap involving only those is not a real double-count.
    (When `assume_ot_confirmed`, unconfirmed-OT logs ARE counted, so they're
    included here too.) Adjacency (one ends exactly when the next starts) is allowed.
    """
    countable = [
        lg for lg in logs
        if lg.end_utc is not None and not (lg.is_overtime and not lg.overtime_confirmed and not assume_ot_confirmed)
    ]
    ordered = sorted(countable, key=lambda lg: lg.start_utc)
    for prev, cur in zip(ordered, ordered[1:]):
        if cur.start_utc < prev.end_utc:
            raise ValueError(
                f"overlapping time logs: timelog {prev.timelog_id} "
                f"({prev.start_utc.isoformat()}–{prev.end_utc.isoformat()}) overlaps "
                f"timelog {cur.timelog_id} ({cur.start_utc.isoformat()}–"
                f"{cur.end_utc.isoformat()})"
            )


def bucket(
    *,
    logs: List[BucketerTimeLog],
    breaks_by_log: Dict[int, List[BucketerBreak]],
    rule: CountryOvertimeRuleRead,
    holidays_by_observed_date: FrozenSet[date],
    period_start: date,
    period_end: date,
    weekly_rest_day_dow: int,
    contracted_hours_per_week: Optional[Decimal],
    overtime_eligibility: str,
    monthly_basic: Optional[Decimal],
    company_timezone: str,
    holiday_overrides: Optional[Dict[date, Decimal]] = None,
    assume_ot_confirmed: bool = False,
) -> Tuple[List[BucketedHours], List[str]]:
    """Pure-functional bucketer. Returns (buckets, compliance_flags).

    Caller (payroll_engine in M4) loads `logs` from period_start - 6 days
    through period_end + 1 day to ensure the weekly accumulator is correct
    at period boundaries. This function drops out-of-period buckets before
    returning, but uses the wider window to maintain the accumulator.

    `holiday_overrides` (M6) maps observed_date → multiplier for per-company
    CompanyHolidayRate overrides. When a holiday slice's date has an
    override, it replaces the country's public_holiday_normal_hours_multiplier.
    The override is validated >= statutory floor at write-time (API layer).

    `assume_ot_confirmed` (estimate surface): normally a worker-flagged-OT log
    that the employer hasn't confirmed is DROPPED (conservative for real
    payroll). For the *estimated* payslip — shown before approval — we instead
    treat those logs as confirmed so the worker sees the hours they actually
    worked, rather than a misleading 0.
    """
    holiday_overrides = holiday_overrides or {}
    compliance_flags: List[str] = []

    # ---- Step 0: defensive overlap guard ----
    # A worker cannot be clocked into two shifts at once. Overlapping logs
    # would double-count hours into the weekly accumulator and the buckets,
    # silently over-paying. Write-time validation (api.v1.job) is the primary
    # gate; this assert is defense-in-depth so a bad row can't reach payroll.
    _assert_no_overlaps(logs, assume_ot_confirmed=assume_ot_confirmed)

    # ---- Step 1: eligibility resolution ----
    effective_eligibility = overtime_eligibility
    if overtime_eligibility == "MONTHLY_ELIGIBLE":
        cap = rule.monthly_basic_ot_cap
        if cap is not None and monthly_basic is not None and monthly_basic > cap:
            effective_eligibility = "EXEMPT"
            compliance_flags.append("monthly_basic_above_ot_cap_downgraded_to_exempt")

    if effective_eligibility == "EXEMPT":
        # Single REG bucket aggregating all confirmed hours within period.
        all_hours, source_ids = _all_hours_in_period(
            logs, breaks_by_log, period_start, period_end, company_timezone,
            assume_ot_confirmed=assume_ot_confirmed,
        )
        if all_hours <= 0:
            return [], compliance_flags
        return [
            BucketedHours(
                code=REG,
                hours=all_hours,
                multiplier=Decimal("1.00"),
                counts_in_basic_gross=True,
                source_timelog_ids=tuple(source_ids),
                weekly_accumulator_at_emit=all_hours,
                notes="overtime_eligibility=EXEMPT",
            )
        ], compliance_flags

    # ---- Step 2: effective threshold ----
    if contracted_hours_per_week is not None:
        effective_threshold = min(contracted_hours_per_week, rule.weekly_threshold_h)
    else:
        effective_threshold = rule.weekly_threshold_h

    # ---- Step 3-6: slice every log ----
    all_slices: List[_Slice] = []
    for log in logs:
        if log.end_utc is None:
            continue  # unclosed log — excluded
        if log.is_overtime and not log.overtime_confirmed and not assume_ot_confirmed:
            continue  # unconfirmed OT — drop entirely (kept for estimates)

        start_local = _to_local(log.start_utc, company_timezone)
        end_local = _to_local(log.end_utc, company_timezone)
        if end_local <= start_local:
            continue

        # Step 4: subtract breaks (operate in local tz)
        breaks_local = [
            BucketerBreak(
                timelog_id=b.timelog_id,
                start_utc=_to_local(b.start_utc, company_timezone),
                end_utc=_to_local(b.end_utc, company_timezone),
            )
            for b in breaks_by_log.get(log.timelog_id, [])
        ]
        worked_intervals = _subtract_breaks(start_local, end_local, breaks_local)

        for (ws, we) in worked_intervals:
            # Step 5a: split at midnight boundaries
            for (ds, de) in _split_at_midnight(ws, we):
                # Step 5b: split at night-window boundaries within this day
                for (ns, ne, in_night) in _split_at_night_window(
                    ds, de, rule.night_start, rule.night_end,
                ):
                    all_slices.append(_Slice(
                        timelog_id=log.timelog_id,
                        start_local=ns,
                        end_local=ne,
                        in_night_window=in_night,
                        is_overtime_forced=(log.is_overtime and (log.overtime_confirmed or assume_ot_confirmed)),
                    ))

    # Sort by start time so accumulator advances correctly
    all_slices.sort(key=lambda s: s.start_local)

    # ---- Step 7-10: classify, stack, apply multipliers, accumulate ----
    weekly_acc: Dict[Tuple[int, int], Decimal] = {}  # (iso_year, iso_week) → hours used
    buckets: List[BucketedHours] = []

    for sl in all_slices:
        if sl.observed_date < period_start or sl.observed_date > period_end:
            # Slice is out of period — still consumes the weekly accumulator
            # if in the same iso-week as in-period slices, so we track it
            # before deciding to emit.
            _consume_threshold(weekly_acc, sl, effective_threshold)
            continue

        day_type, _stacked = _classify_day(
            sl.observed_date,
            holidays_by_observed_date,
            weekly_rest_day_dow,
            rule.stack_holiday_on_rest_day,
        )

        # Premium days bypass the weekly threshold logic.
        if day_type == _HOLIDAY:
            mult, code = _holiday_multiplier(rule, sl, all_slices)
            override = holiday_overrides.get(sl.observed_date)
            note = "public holiday"
            if override is not None and override > mult:
                # Per-company override (CompanyHolidayRate) — only applied when
                # it raises the rate (write-time validator guarantees >= floor).
                mult = override
                note = "public holiday (company override)"
            base_bucket = BucketedHours(
                code=code,
                hours=sl.hours_dec,
                multiplier=mult,
                counts_in_basic_gross=False,
                source_timelog_ids=(sl.timelog_id,),
                weekly_accumulator_at_emit=weekly_acc.get(_isoweek_key(sl), Decimal("0")),
                notes=note,
            )
            buckets.extend(_apply_night_premium(rule, sl, base_bucket))
            continue

        if day_type == _REST_DAY:
            base_bucket = BucketedHours(
                code=OT_REST_DAY,
                hours=sl.hours_dec,
                multiplier=rule.rest_day_multiplier,
                counts_in_basic_gross=False,
                source_timelog_ids=(sl.timelog_id,),
                weekly_accumulator_at_emit=weekly_acc.get(_isoweek_key(sl), Decimal("0")),
                notes="weekly rest day",
            )
            buckets.extend(_apply_night_premium(rule, sl, base_bucket))
            continue

        # WEEKDAY — feed the tier walker
        wk_key = _isoweek_key(sl)
        used = weekly_acc.get(wk_key, Decimal("0"))
        emissions = _walk_tiers(
            rule.weekday_tiers,
            effective_threshold,
            used,
            sl.hours_dec,
            sl.is_overtime_forced,
        )
        for (code, h, mult, acc_at, notes) in emissions:
            base_bucket = BucketedHours(
                code=code,
                hours=h,
                multiplier=mult,
                counts_in_basic_gross=(code == REG),
                source_timelog_ids=(sl.timelog_id,),
                weekly_accumulator_at_emit=acc_at,
                notes=notes,
            )
            buckets.extend(_apply_night_premium(rule, sl, base_bucket))
        # Forced OT is "extra" overtime, not regular work, so it must NOT consume
        # the regular weekly threshold. Otherwise a forced-OT slice earlier in the
        # week inflates `used` and pushes a later regular slice's hours into OT
        # tiers (over-paying premium on hours that were never over threshold).
        # Only regular/overflow (non-forced) slices advance the accumulator.
        if not sl.is_overtime_forced:
            weekly_acc[wk_key] = used + sl.hours_dec

    # ---- Step 11: cap warnings ----
    for (yr, wk), used in weekly_acc.items():
        if rule.weekly_total_max_h is not None and used > rule.weekly_total_max_h:
            compliance_flags.append(f"exceeded_weekly_total_max_h:{yr}-W{wk:02d}:{used}")
        if rule.weekly_ot_soft_cap_h is not None:
            ot_h = max(Decimal("0"), used - effective_threshold)
            if ot_h > rule.weekly_ot_soft_cap_h:
                compliance_flags.append(f"exceeded_weekly_ot_soft_cap_h:{yr}-W{wk:02d}:{ot_h}")

    # Merge adjacent buckets with same code+multiplier+source — quality-of-life.
    return _merge_adjacent(buckets), compliance_flags


# ---------------------------------------------------------------------------
# Internal helpers
# ---------------------------------------------------------------------------


def _isoweek_key(sl: _Slice) -> Tuple[int, int]:
    iso = sl.observed_date.isocalendar()
    return (iso[0], iso[1])


def _consume_threshold(
    weekly_acc: Dict[Tuple[int, int], Decimal],
    sl: _Slice,
    threshold: Decimal,
) -> None:
    """For out-of-period slices, just advance the accumulator so that
    in-period slices in the same iso-week see the correct prior usage."""
    key = _isoweek_key(sl)
    weekly_acc[key] = weekly_acc.get(key, Decimal("0")) + sl.hours_dec


def _all_hours_in_period(
    logs: List[BucketerTimeLog],
    breaks_by_log: Dict[int, List[BucketerBreak]],
    period_start: date,
    period_end: date,
    company_timezone: str,
    assume_ot_confirmed: bool = False,
) -> Tuple[Decimal, List[int]]:
    """Sum confirmed hours within [period_start, period_end] in local tz.
    Used by the EXEMPT short-circuit. On the estimate surface
    (`assume_ot_confirmed`), worker-flagged-but-unconfirmed OT hours are
    counted too, matching the non-exempt path — otherwise an EXEMPT employee's
    estimate drops those hours and reads artificially low."""
    total = Decimal("0")
    source_ids: List[int] = []
    for log in logs:
        if log.end_utc is None:
            continue
        if log.is_overtime and not log.overtime_confirmed and not assume_ot_confirmed:
            continue
        start_local = _to_local(log.start_utc, company_timezone)
        end_local = _to_local(log.end_utc, company_timezone)
        if end_local <= start_local:
            continue
        if start_local.date() < period_start or start_local.date() > period_end:
            continue
        breaks_local = [
            BucketerBreak(
                timelog_id=b.timelog_id,
                start_utc=_to_local(b.start_utc, company_timezone),
                end_utc=_to_local(b.end_utc, company_timezone),
            )
            for b in breaks_by_log.get(log.timelog_id, [])
        ]
        for (ws, we) in _subtract_breaks(start_local, end_local, breaks_local):
            total += Decimal((we - ws).total_seconds()) / Decimal(3600)
        source_ids.append(log.timelog_id)
    return total, source_ids


def _holiday_multiplier(
    rule: CountryOvertimeRuleRead,
    sl: _Slice,
    all_slices: List[_Slice],
) -> Tuple[Decimal, str]:
    """Decide normal vs after-hours holiday multiplier. PENDING_M0_VERIFICATION:
    the boundary is interpreted here as "after 8 cumulative daily hours on the
    holiday". M0 lawyer letter / payslip reconciliation may refine this.
    """
    daily_threshold = rule.daily_threshold_h
    if daily_threshold is None:
        return rule.public_holiday_normal_hours_multiplier, OT_HOLIDAY_NORMAL

    # Sum hours on this same observed_date that come before this slice.
    used_today = Decimal("0")
    for other in all_slices:
        if other.observed_date != sl.observed_date:
            continue
        if other.start_local >= sl.start_local:
            continue
        used_today += other.hours_dec

    if used_today >= daily_threshold:
        return rule.public_holiday_after_hours_multiplier, OT_HOLIDAY_AFTER

    # Slice straddles the boundary — for simplicity, use the boundary that
    # contains the slice's midpoint. Tests pin this behavior. A more precise
    # variant would split the slice further at the boundary itself; not
    # worth the complexity in v1.
    midpoint_used = used_today + (sl.hours_dec / Decimal(2))
    if midpoint_used > daily_threshold:
        return rule.public_holiday_after_hours_multiplier, OT_HOLIDAY_AFTER
    return rule.public_holiday_normal_hours_multiplier, OT_HOLIDAY_NORMAL


def _apply_night_premium(
    rule: CountryOvertimeRuleRead,
    sl: _Slice,
    base: BucketedHours,
) -> List[BucketedHours]:
    """Compose the night premium onto a base bucket per the rule's mode.

    REPLACE: substitute the multiplier on the base bucket — unless
    `stack_night_on_premium='NO_STACK'` AND the base is already a
    premium-day bucket (REST_DAY/HOLIDAY).

    ADDITIVE: emit an extra NIGHT_PREMIUM bucket with the delta
    multiplier (night_mult - 1.0), leaving the base unchanged.

    If the slice isn't in the night window or the rule has no night
    multipliers, return the base unchanged.
    """
    if not sl.in_night_window or rule.night_mode is None:
        return [base]
    night_mult = rule.night_multiplier_habitual or rule.night_multiplier_occasional
    if night_mult is None:
        return [base]

    if rule.night_mode == "REPLACE":
        is_premium_base = base.code in (OT_REST_DAY, OT_HOLIDAY_NORMAL, OT_HOLIDAY_AFTER)
        if is_premium_base and rule.stack_night_on_premium == "NO_STACK":
            return [base]  # day-type wins (MG behavior)
        return [
            BucketedHours(
                code=base.code,
                hours=base.hours,
                multiplier=max(base.multiplier, night_mult),
                counts_in_basic_gross=base.counts_in_basic_gross,
                source_timelog_ids=base.source_timelog_ids,
                weekly_accumulator_at_emit=base.weekly_accumulator_at_emit,
                notes=(base.notes + " + night REPLACE").strip(),
            )
        ]

    # ADDITIVE
    extra_mult = night_mult - Decimal("1.00")
    if extra_mult <= 0:
        return [base]
    return [
        base,
        BucketedHours(
            code=NIGHT_PREMIUM,
            hours=base.hours,
            multiplier=extra_mult,
            counts_in_basic_gross=False,
            source_timelog_ids=base.source_timelog_ids,
            weekly_accumulator_at_emit=base.weekly_accumulator_at_emit,
            notes=f"night ADDITIVE on top of {base.code}",
        ),
    ]


def _merge_adjacent(buckets: List[BucketedHours]) -> List[BucketedHours]:
    """Combine consecutive buckets with the same (code, multiplier) and
    overlapping source_timelog_ids into one. Pure cosmetic — easier
    payslip display."""
    if not buckets:
        return []
    out: List[BucketedHours] = [buckets[0]]
    for b in buckets[1:]:
        prev = out[-1]
        if (
            prev.code == b.code
            and prev.multiplier == b.multiplier
            and prev.counts_in_basic_gross == b.counts_in_basic_gross
            and prev.notes == b.notes
        ):
            out[-1] = BucketedHours(
                code=prev.code,
                hours=prev.hours + b.hours,
                multiplier=prev.multiplier,
                counts_in_basic_gross=prev.counts_in_basic_gross,
                source_timelog_ids=tuple(sorted(set(prev.source_timelog_ids + b.source_timelog_ids))),
                weekly_accumulator_at_emit=max(prev.weekly_accumulator_at_emit, b.weekly_accumulator_at_emit),
                notes=prev.notes,
            )
        else:
            out.append(b)
    return out
