"""Country payroll rules engine — resolve, supersede, compute.

The four versioned rule tables (tax_bracket_sets, statutory_deductions,
country_leave_defaults, country_bonus_rules) are append-only at the DB level
(see migration country_payroll_rules_20260427: trigger forbid_rule_mutation).
This module is the only legitimate writer.

Read path:
    snapshot = resolve(db, country_code, period_start)

Write path (the single canonical mutation API):
    new_row = supersede(
        db,
        model=StatutoryDeduction,
        rule_filter={"country_code": "MU", "code": "CSG_EE"},
        new_payload=StatutoryDeductionCreate(...),
        actor_user_id=current_user.user_id,
    )
"""

from __future__ import annotations

from datetime import date, datetime, timezone
from decimal import Decimal
from typing import Any, Dict, List, Mapping, Optional, Type, TypeVar

from sqlalchemy import and_, desc, or_
from sqlalchemy.orm import Session

from core.model import (
    AuditLog,
    Company,
    CountryBonusRule,
    CountryLeaveDefault,
    CountryOvertimeRule,
    CountryOvertimeWeekdayTier,
    PayrollRun,
    StatutoryDeduction,
    TaxBracket,
    TaxBracketSet,
)
from schema.payroll_rules_schema import (
    CountryBonusRuleCreate,
    CountryLeaveDefaultCreate,
    CountryOvertimeRuleRead,
    CountryOvertimeWeekdayTierRead,
    CountryRulesSnapshot,
    StatutoryDeductionCreate,
    TaxBracketLineRead,
    TaxBracketSetCreate,
    TaxBracketSetRead,
    StatutoryDeductionRead,
    CountryLeaveDefaultRead,
    CountryBonusRuleRead,
)


class MissingOvertimeRule(LookupError):
    """Raised by resolve_overtime_rule when no country_overtime_rules row
    is in force on the given date. The caller should translate this to a
    HTTP 422 with `code='NO_OVERTIME_RULE_FOR_COUNTRY'` to halt draft-run
    creation rather than silently apply base-rate-everything (wage theft)."""

    def __init__(self, country_code: str, period_start: date):
        self.country_code = country_code
        self.period_start = period_start
        super().__init__(
            f"No overtime rule active for country={country_code} on {period_start.isoformat()}. "
            "Seed via scripts/seed_overtime_rules_mu.py or supersede an existing rule."
        )


T = TypeVar("T")


# ---------------------------------------------------------------------------
# Resolution — read the rule that was in force on a given date.
# ---------------------------------------------------------------------------


def _active_at(model: Type[T], period_start: date):
    """SQLAlchemy filter clause: row is in force on `period_start`."""
    return and_(
        model.effective_from <= period_start,
        or_(model.effective_to.is_(None), model.effective_to > period_start),
    )


def get_tax_bracket_set(
    db: Session, country_code: str, period_start: date
) -> Optional[TaxBracketSet]:
    return (
        db.query(TaxBracketSet)
        .filter(TaxBracketSet.country_code == country_code)
        .filter(_active_at(TaxBracketSet, period_start))
        .order_by(desc(TaxBracketSet.effective_from))
        .first()
    )


def get_statutory_deductions(
    db: Session, country_code: str, period_start: date
) -> List[StatutoryDeduction]:
    return (
        db.query(StatutoryDeduction)
        .filter(StatutoryDeduction.country_code == country_code)
        .filter(_active_at(StatutoryDeduction, period_start))
        .order_by(StatutoryDeduction.code)
        .all()
    )


def get_leave_defaults(
    db: Session, country_code: str, period_start: date
) -> List[CountryLeaveDefault]:
    return (
        db.query(CountryLeaveDefault)
        .filter(CountryLeaveDefault.country_code == country_code)
        .filter(_active_at(CountryLeaveDefault, period_start))
        .order_by(CountryLeaveDefault.leave_type_code)
        .all()
    )


def get_bonus_rules(
    db: Session, country_code: str, period_start: date
) -> List[CountryBonusRule]:
    return (
        db.query(CountryBonusRule)
        .filter(CountryBonusRule.country_code == country_code)
        .filter(_active_at(CountryBonusRule, period_start))
        .order_by(CountryBonusRule.bonus_code)
        .all()
    )


def get_overtime_rule(
    db: Session, country_code: str, period_start: date
) -> Optional[CountryOvertimeRule]:
    return (
        db.query(CountryOvertimeRule)
        .filter(CountryOvertimeRule.country_code == country_code)
        .filter(_active_at(CountryOvertimeRule, period_start))
        .order_by(desc(CountryOvertimeRule.effective_from))
        .first()
    )


def resolve_overtime_rule(
    db: Session, country_code: str, period_start: date
) -> CountryOvertimeRuleRead:
    """Resolve the overtime rule for a country/period, raising
    `MissingOvertimeRule` if none is in force.

    Used by `create_draft_run` (M4) and `payslip_estimate_service` to
    fail-loudly rather than fall through to base-rate compute.
    """
    rule = get_overtime_rule(db, country_code, period_start)
    if rule is None:
        raise MissingOvertimeRule(country_code, period_start)
    return _overtime_rule_to_read(rule)


def _overtime_rule_to_read(rule: CountryOvertimeRule) -> CountryOvertimeRuleRead:
    return CountryOvertimeRuleRead(
        id=rule.id,
        country_code=rule.country_code,
        effective_from=rule.effective_from,
        effective_to=rule.effective_to,
        superseded_by_id=rule.superseded_by_id,
        version=rule.version,
        source_reference=rule.source_reference,
        change_reason=rule.change_reason,
        notes=rule.notes,
        created_by_user_id=rule.created_by_user_id,
        created_at=rule.created_at,
        weekly_threshold_h=rule.weekly_threshold_h,
        daily_threshold_h=rule.daily_threshold_h,
        rest_day_multiplier=rule.rest_day_multiplier,
        public_holiday_normal_hours_multiplier=rule.public_holiday_normal_hours_multiplier,
        public_holiday_after_hours_multiplier=rule.public_holiday_after_hours_multiplier,
        night_start=rule.night_start,
        night_end=rule.night_end,
        night_multiplier_habitual=rule.night_multiplier_habitual,
        night_multiplier_occasional=rule.night_multiplier_occasional,
        night_mode=rule.night_mode,
        weekly_ot_soft_cap_h=rule.weekly_ot_soft_cap_h,
        weekly_total_max_h=rule.weekly_total_max_h,
        monthly_basic_ot_cap=rule.monthly_basic_ot_cap,
        notional_hourly_divisor=rule.notional_hourly_divisor,
        stack_holiday_on_rest_day=rule.stack_holiday_on_rest_day,
        stack_night_on_premium=rule.stack_night_on_premium,
        week_start_dow=rule.week_start_dow,
        weekday_tiers=[
            CountryOvertimeWeekdayTierRead(
                id=t.id,
                tier_order=t.tier_order,
                up_to_hours=t.up_to_hours,
                multiplier=t.multiplier,
            )
            for t in rule.weekday_tiers
        ],
    )


def list_overtime_rules(
    db: Session, country_code: str
) -> List[CountryOvertimeRuleRead]:
    """All overtime-rule versions for a country, newest effective_from first."""
    rules = (
        db.query(CountryOvertimeRule)
        .filter(CountryOvertimeRule.country_code == country_code)
        .order_by(desc(CountryOvertimeRule.effective_from), desc(CountryOvertimeRule.version))
        .all()
    )
    return [_overtime_rule_to_read(r) for r in rules]


def resolve(
    db: Session, country_code: str, period_start: date
) -> CountryRulesSnapshot:
    """Bundle every rule in force for `country_code` at `period_start`.

    The bundle is what payroll_engine consumes and what payroll_runs
    snapshots into JSONB on finalize.
    """
    bracket_set = get_tax_bracket_set(db, country_code, period_start)
    bracket_set_dto: Optional[TaxBracketSetRead] = None
    if bracket_set is not None:
        bracket_set_dto = TaxBracketSetRead(
            id=bracket_set.id,
            country_code=bracket_set.country_code,
            fiscal_year=bracket_set.fiscal_year,
            label=bracket_set.label,
            effective_from=bracket_set.effective_from,
            effective_to=bracket_set.effective_to,
            superseded_by_id=bracket_set.superseded_by_id,
            version=bracket_set.version,
            source_reference=bracket_set.source_reference,
            change_reason=bracket_set.change_reason,
            created_by_user_id=bracket_set.created_by_user_id,
            created_at=bracket_set.created_at,
            tax_computation_mode=bracket_set.tax_computation_mode,
            brackets=[
                TaxBracketLineRead(
                    id=b.id,
                    bracket_set_id=b.bracket_set_id,
                    order_index=b.order_index,
                    lower_bound=b.lower_bound,
                    upper_bound=b.upper_bound,
                    rate=b.rate,
                    description=b.description,
                )
                for b in bracket_set.brackets
            ],
        )

    # M2 — overtime rule. NULL is allowed in the snapshot (the estimate's
    # no-rule-configured fallback doesn't require it); draft-run creation
    # raises MissingOvertimeRule if a real payroll run needs one and it's missing.
    overtime_rule = get_overtime_rule(db, country_code, period_start)
    overtime_dto = _overtime_rule_to_read(overtime_rule) if overtime_rule is not None else None

    return CountryRulesSnapshot(
        country_code=country_code,
        resolved_for_period_start=period_start,
        resolved_at=datetime.now(timezone.utc),
        tax_bracket_set=bracket_set_dto,
        statutory_deductions=[
            StatutoryDeductionRead.model_validate(d)
            for d in get_statutory_deductions(db, country_code, period_start)
        ],
        leave_defaults=[
            CountryLeaveDefaultRead.model_validate(d)
            for d in get_leave_defaults(db, country_code, period_start)
        ],
        bonus_rules=[
            CountryBonusRuleRead.model_validate(d)
            for d in get_bonus_rules(db, country_code, period_start)
        ],
        overtime=overtime_dto,
    )


# ---------------------------------------------------------------------------
# History — full version chain for the admin timeline view.
# ---------------------------------------------------------------------------


def get_history(
    db: Session,
    model: Type[T],
    rule_filter: Mapping[str, Any],
) -> List[T]:
    """Every version of a single rule, newest first."""
    q = db.query(model)
    for col, val in rule_filter.items():
        q = q.filter(getattr(model, col) == val)
    return q.order_by(desc(model.effective_from), desc(model.version)).all()


# ---------------------------------------------------------------------------
# Supersede — the only legitimate write path.
# ---------------------------------------------------------------------------


import logging

logger = logging.getLogger("kontokaz.payroll_rules")


def open_drafts_affected_by_rule_change(
    db: Session, country_code: str, effective_from: date
) -> List[Dict[str, Any]]:
    """Open (non-finalized, non-cancelled) draft runs in `country_code` whose
    period contains `effective_from`. A rule taking effect mid-period means
    those drafts were computed against the now-superseded rule. We do NOT
    auto-recompute (snapshots are append-only and the admin owns the call) —
    we surface them so the admin can void + recreate, or run the bulk
    recompute-drafts endpoint."""
    rows = (
        db.query(PayrollRun)
        .join(Company, Company.company_id == PayrollRun.company_id)
        .filter(Company.country_code == country_code)
        .filter(PayrollRun.status.notin_(("finalized", "cancelled")))
        .filter(PayrollRun.period_start <= effective_from)
        .filter(PayrollRun.period_end >= effective_from)
        .all()
    )
    return [
        {
            "run_id": r.id,
            "company_id": r.company_id,
            "period_start": r.period_start.isoformat(),
            "period_end": r.period_end.isoformat(),
        }
        for r in rows
    ]


class RuleSupersedeError(ValueError):
    """Raised when supersede() preconditions fail (e.g. effective_from is
    not strictly after the prior row's effective_from)."""


class RuleSupersedeConflictError(RuleSupersedeError):
    """Raised when an optimistic-concurrency check fails: the caller passed
    `expected_latest_version` but the live prior row has a different version
    (another admin superseded in the meantime). The client should refresh
    and re-confirm before retrying."""


def _coerce_payload(payload: Any) -> Dict[str, Any]:
    """Accept either a Pydantic model or a plain dict."""
    if hasattr(payload, "model_dump"):
        return payload.model_dump(exclude_unset=False)
    if isinstance(payload, dict):
        return dict(payload)
    raise TypeError(f"Unsupported payload type {type(payload)!r}")


def _diff(prior: Optional[Any], new_values: Mapping[str, Any]) -> Dict[str, List[Any]]:
    """Field-level diff for the audit log meta JSONB."""
    if prior is None:
        return {k: [None, _jsonable(v)] for k, v in new_values.items()}
    out: Dict[str, List[Any]] = {}
    for k, v in new_values.items():
        old = getattr(prior, k, None)
        if old != v:
            out[k] = [_jsonable(old), _jsonable(v)]
    return out


def _jsonable(v: Any) -> Any:
    if isinstance(v, Decimal):
        return str(v)
    if isinstance(v, (date, datetime)):
        return v.isoformat()
    return v


def supersede(
    db: Session,
    model: Type[T],
    rule_filter: Mapping[str, Any],
    new_payload: Any,
    actor_user_id: Optional[int],
    *,
    bracket_lines: Optional[List[Any]] = None,
    expected_latest_version: Optional[int] = None,
) -> T:
    """Insert a new version of a rule, closing the prior active row.

    Atomicity: the close + insert + audit log entry all happen on the
    caller's `db` session. The caller is responsible for `db.commit()`.

    Returns the newly inserted row (with `version = prior.version + 1`).

    `bracket_lines` is only used when `model` is `TaxBracketSet` — pass the
    list of TaxBracketLine objects to attach to the new set.

    `expected_latest_version` enables optimistic concurrency: if provided,
    the caller is asserting they last saw version=N. When the live prior is
    not at version=N (another admin superseded after the caller's read),
    raise RuleSupersedeConflictError so the caller can prompt for refresh.
    Pass 0 to assert "no version exists yet" — useful for first-time creates
    where the caller wants to fail if someone seeded a row meanwhile.
    """
    payload = _coerce_payload(new_payload)
    new_effective_from: date = payload["effective_from"]

    # Find the currently-active prior row (effective_to IS NULL) matching the filter.
    q = db.query(model).filter(model.effective_to.is_(None))
    for col, val in rule_filter.items():
        q = q.filter(getattr(model, col) == val)
    prior = q.one_or_none()

    if expected_latest_version is not None:
        actual = prior.version if prior is not None else 0
        if actual != expected_latest_version:
            raise RuleSupersedeConflictError(
                f"version conflict: caller expected v{expected_latest_version} "
                f"but live latest is v{actual}. Refresh and retry."
            )

    if prior is not None:
        if new_effective_from <= prior.effective_from:
            raise RuleSupersedeError(
                f"new effective_from {new_effective_from} must be strictly after "
                f"prior effective_from {prior.effective_from}"
            )

    # Build new row. We bypass model __init__ kwargs validation by setting
    # attributes explicitly so subclass-specific columns are preserved.
    new_row_kwargs = {
        k: v
        for k, v in payload.items()
        if k not in ("brackets",)  # bracket lines handled separately
    }
    # Force version + temporal columns
    new_row_kwargs["version"] = (prior.version + 1) if prior is not None else 1
    new_row_kwargs["effective_to"] = None
    new_row_kwargs["superseded_by_id"] = None
    new_row_kwargs["created_by_user_id"] = actor_user_id

    new_row = model(**new_row_kwargs)
    db.add(new_row)
    db.flush()  # populate new_row.id

    # Attach bracket lines if this is a TaxBracketSet supersede.
    if model is TaxBracketSet:
        lines_source = bracket_lines if bracket_lines is not None else payload.get("brackets") or []
        for line in lines_source:
            line_data = _coerce_payload(line) if not isinstance(line, dict) else dict(line)
            db.add(
                TaxBracket(
                    bracket_set_id=new_row.id,
                    order_index=line_data["order_index"],
                    lower_bound=line_data["lower_bound"],
                    upper_bound=line_data.get("upper_bound"),
                    rate=line_data["rate"],
                    description=line_data.get("description"),
                )
            )

    # Close prior row by updating only the two trigger-allowed columns.
    if prior is not None:
        prior.effective_to = new_effective_from
        prior.superseded_by_id = new_row.id

    # Audit log — single row capturing what changed and why.
    diff = _diff(
        prior,
        {k: v for k, v in new_row_kwargs.items() if k not in ("created_by_user_id",)},
    )
    audit_meta = {
        "table": model.__tablename__,
        "rule_filter": dict(rule_filter),
        "version": new_row.version,
        "prior_id": prior.id if prior is not None else None,
        "new_id": new_row.id,
        "effective_from": new_effective_from.isoformat(),
        "effective_to_set_on_prior": new_effective_from.isoformat() if prior is not None else None,
        "source_reference": payload.get("source_reference"),
        "change_reason": payload.get("change_reason"),
        "diff": diff,
    }
    action = "payroll_rule.created" if prior is None else "payroll_rule.superseded"
    db.add(
        AuditLog(
            actor_user_id=actor_user_id,
            action=action,
            target_type=model.__tablename__,
            target_id=str(new_row.id),
            meta=audit_meta,
        )
    )

    # Mid-period rule-change detection (M2). If this rule takes effect inside
    # the period of any open draft run for the country, the admin needs to
    # void + recreate (or bulk-recompute) — we never auto-recompute. Surface
    # the affected runs via audit + logger + a transient attr the endpoint
    # turns into a response header.
    affected: List[Dict[str, Any]] = []
    country_code = rule_filter.get("country_code")
    if country_code:
        affected = open_drafts_affected_by_rule_change(db, country_code, new_effective_from)
    if affected:
        logger.warning(
            "payroll_rule.affects_open_drafts: %s v%s effective %s overlaps %d open draft(s): %s",
            model.__tablename__, new_row.version, new_effective_from.isoformat(),
            len(affected), [a["run_id"] for a in affected],
        )
        db.add(
            AuditLog(
                actor_user_id=actor_user_id,
                action="payroll_rule.affects_open_drafts",
                target_type=model.__tablename__,
                target_id=str(new_row.id),
                meta={"effective_from": new_effective_from.isoformat(), "affected_drafts": affected},
            )
        )
    # Transient (not persisted) — endpoints read this to set a warning header.
    new_row._affected_open_drafts = affected

    db.flush()
    return new_row


# ---------------------------------------------------------------------------
# Pure computation — no DB access. Operates on resolved snapshot data.
# ---------------------------------------------------------------------------


def compute_paye(
    taxable_income: Decimal, brackets: List[TaxBracketLineRead]
) -> Decimal:
    """Progressive PAYE over an ordered list of brackets.

    Brackets must be sorted by `order_index` (or equivalently `lower_bound`).
    A bracket with `upper_bound = None` is the top band.
    """
    if taxable_income <= 0 or not brackets:
        return Decimal("0.00")

    ordered = sorted(brackets, key=lambda b: b.order_index)
    tax = Decimal("0")
    for b in ordered:
        if taxable_income <= b.lower_bound:
            break
        upper = b.upper_bound if b.upper_bound is not None else taxable_income
        slice_top = min(taxable_income, upper)
        slice_amount = slice_top - b.lower_bound
        if slice_amount > 0:
            tax += slice_amount * b.rate

    return tax.quantize(Decimal("0.01"))


def compute_statutory(
    bases_by_code: Mapping[str, Decimal],
    deductions: List[StatutoryDeductionRead],
) -> Dict[str, Decimal]:
    """Apply statutory deductions, looking up each deduction's base by its
    `code` in the per-deduction bases dict.

    `bases_by_code` is built upstream by `payroll_engine.compute_for_resolved`
    by summing each component's amount into every code listed in its
    `statutory_base_codes` (M4). Common keys: `'PAYE'`, `'CSG_EE'`, `'CSG_ER'`,
    `'NSF_EE'`, `'NSF_ER'`.

    Backward-compatible legacy keys also accepted: `'basic'` and `'gross'`
    are looked up via the deduction's `taxable_base` enum if the deduction's
    own `code` isn't present in `bases_by_code` — covers callers that
    haven't migrated to the per-code shape yet (none in-tree, but external
    integrations may).
    """
    from collections import defaultdict

    def _base_for(d) -> Decimal:
        # Prefer per-code base (M4 path); fall back via taxable_base enum.
        base = bases_by_code.get(d.code)
        if base is None:
            if d.taxable_base == "basic":
                base = bases_by_code.get("basic", Decimal("0"))
            else:
                base = bases_by_code.get("gross", Decimal("0"))
        return base

    # Group by code. A SINGLE row per code = "rate on base, capped at
    # threshold_high" (e.g. NSF's contribution ceiling). MULTIPLE rows = a
    # TIERED FLAT RATE: the threshold selects which rate applies to the FULL
    # base, NOT a marginal/capped band. This is how MU CSG works — 1.5%/3%
    # (employee) on total remuneration up to Rs 50,000, stepping to 3%/6% on the
    # whole total once it exceeds the threshold.
    by_code: Dict[str, list] = defaultdict(list)
    for d in deductions:
        by_code[d.code].append(d)

    out: Dict[str, Decimal] = {}
    for code, rows in by_code.items():
        base = _base_for(rows[0])
        if len(rows) > 1:
            tiers = sorted(rows, key=lambda r: (r.threshold_high is None, r.threshold_high or Decimal("0")))
            chosen = next(
                (r for r in tiers if r.threshold_high is None or base <= r.threshold_high),
                tiers[-1],
            )
            out[code] = (base * chosen.rate).quantize(Decimal("0.01"))
            continue
        d = rows[0]
        if d.threshold_low is not None and base < d.threshold_low:
            out[code] = Decimal("0.00")
            continue
        if d.threshold_high is not None and base > d.threshold_high:
            base = d.threshold_high  # ceiling cap (e.g. NSF)
        out[code] = (base * d.rate).quantize(Decimal("0.01"))

    return out


def compute_shadow(
    *,
    taxable_host: Decimal,
    bases_host: Dict[str, Decimal],
    snapshot: "CountryRulesSnapshot",
    fx_rate: Decimal,
    home_paye: Decimal,
    host_currency: str,
) -> Dict[str, Decimal]:
    """Compute the host-country shadow statutory figures for shadow payroll
    (Phase 2, tax-equalization model).

    ``taxable_host`` / ``bases_host`` are the home-country taxable income and
    statutory bases **converted into the host currency** (amounts in host
    units). ``fx_rate`` is base-currency units per 1 host unit, used only to
    express the host tax in base currency for the equalization comparison.

    Shadow PAYE uses a static (FLAT_PERIODIC) application of the host bracket
    table against the converted monthly taxable income — a reporting estimate,
    not a cumulative-withheld number. The employee's real withholding stays the
    home-country cumulative PAYE; host tax is reported and reconciled separately.

    Returns (all Decimal):
        shadow_tax        host statutory income tax, in host currency
        shadow_ss         host statutory employee deductions total, in host currency
        shadow_equalization_due  max(0, host_tax_home - home_paye), in home currency
    """
    host_tax = Decimal("0.00")
    if snapshot.tax_bracket_set is not None and snapshot.tax_bracket_set.brackets:
        host_tax = compute_paye(taxable_host, list(snapshot.tax_bracket_set.brackets))

    host_employee = compute_statutory(
        bases_host,
        [d for d in snapshot.statutory_deductions if d.employer_or_employee == "employee"],
    )
    host_ss = sum(host_employee.values(), Decimal("0.00"))

    # Tax equalization: the employer bears any excess of host tax over the
    # home hypothetical tax. Compare in home currency (base).
    if fx_rate and fx_rate > 0:
        host_tax_home = (host_tax * fx_rate).quantize(Decimal("0.01"))
    else:
        host_tax_home = host_tax  # host currency effectively == home
    shadow_equalization_due = max(
        Decimal("0.00"), (host_tax_home - home_paye).quantize(Decimal("0.01"))
    )

    return {
        "shadow_tax": host_tax.quantize(Decimal("0.01")),
        "shadow_ss": host_ss.quantize(Decimal("0.01")),
        "shadow_equalization_due": shadow_equalization_due,
    }
