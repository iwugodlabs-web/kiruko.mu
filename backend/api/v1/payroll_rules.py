"""Admin API for the country payroll rules engine.

Read endpoints expose snapshots and history. The single write endpoint per
rule type calls the supersede() service — there is intentionally no PUT/DELETE,
since rules are append-only.
"""

from datetime import date, timezone
from decimal import Decimal
from typing import List, Optional

from fastapi import APIRouter, Depends, Header, HTTPException, Response, status
from sqlalchemy.orm import Session

from core import config
from core.model import (
    CountryBonusRule,
    CountryLeaveDefault,
    PublicHoliday,
    StatutoryDeduction,
    TaxBracketSet,
)
from api.v1.admin import require_platform_admin
from core.idempotency import require_idempotency_key
from core.step_up import require_step_up_token
from services import payroll_engine
from services import payroll_rules as rules_service
from services.payroll_rules import RuleSupersedeConflictError, RuleSupersedeError


def _set_affected_drafts_header(response: Response, new_row) -> None:
    """If the supersede landed inside open drafts' periods, surface their ids
    in a response header so the admin UI can warn + offer recompute. M2:
    we never auto-recompute."""
    affected = getattr(new_row, "_affected_open_drafts", None) or []
    if affected:
        response.headers["X-Affected-Open-Draft-Runs"] = ",".join(
            str(a["run_id"]) for a in affected
        )


def _raise_supersede(e: RuleSupersedeError) -> None:
    """Translate a service error into the right 409 shape.

    Concurrency conflicts get a structured payload so clients can show a
    dedicated "rule changed, refresh" dialog; other supersede errors are
    rendered as a plain message string.
    """
    if isinstance(e, RuleSupersedeConflictError):
        raise HTTPException(
            status_code=409,
            detail={"code": "version_conflict", "message": str(e)},
        )
    raise HTTPException(status_code=409, detail=str(e))
from schema.payroll_rules_schema import (
    CountryBonusRuleCreate,
    CountryBonusRuleRead,
    CountryLeaveDefaultCreate,
    CountryLeaveDefaultRead,
    CountryOvertimeRuleRead,
    CountryRulesSnapshot,
    OvertimeReconcileBucket,
    OvertimeReconcileRequest,
    OvertimeReconcileResponse,
    PublicHolidayCreate,
    PublicHolidayRead,
    PublicHolidayUpdate,
    StatutoryDeductionCreate,
    StatutoryDeductionRead,
    TaxBracketLineRead,
    TaxBracketSetCreate,
    TaxBracketSetRead,
)


router = APIRouter(prefix="/payroll-rules", tags=["Payroll Rules"])


# ---------------------------------------------------------------------------
# Resolved snapshot — the canonical "as-of" call.
# ---------------------------------------------------------------------------


@router.get("/{country_code}/snapshot", response_model=CountryRulesSnapshot)
def get_snapshot(
    country_code: str,
    period_start: date,
    db: Session = Depends(config.get_db),
    current_user=Depends(require_platform_admin),
) -> CountryRulesSnapshot:
    """All rules in force on `period_start` for `country_code`."""
    return rules_service.resolve(db, country_code.upper(), period_start)


# ---------------------------------------------------------------------------
# Tax bracket sets
# ---------------------------------------------------------------------------


def _bracket_set_to_read(bs: TaxBracketSet) -> TaxBracketSetRead:
    return TaxBracketSetRead(
        id=bs.id,
        country_code=bs.country_code,
        fiscal_year=bs.fiscal_year,
        label=bs.label,
        effective_from=bs.effective_from,
        effective_to=bs.effective_to,
        superseded_by_id=bs.superseded_by_id,
        version=bs.version,
        source_reference=bs.source_reference,
        change_reason=bs.change_reason,
        created_by_user_id=bs.created_by_user_id,
        created_at=bs.created_at,
        tax_computation_mode=bs.tax_computation_mode,
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
            for b in bs.brackets
        ],
    )


@router.get("/{country_code}/tax-bracket-sets", response_model=List[TaxBracketSetRead])
def list_tax_bracket_sets(
    country_code: str,
    db: Session = Depends(config.get_db),
    current_user=Depends(require_platform_admin),
):
    rows = rules_service.get_history(
        db, TaxBracketSet, {"country_code": country_code.upper()}
    )
    return [_bracket_set_to_read(r) for r in rows]


@router.post(
    "/{country_code}/tax-bracket-sets",
    response_model=TaxBracketSetRead,
    status_code=status.HTTP_201_CREATED,
)
def supersede_tax_bracket_set(
    country_code: str,
    payload: TaxBracketSetCreate,
    response: Response,
    db: Session = Depends(config.get_db),
    current_user=Depends(require_platform_admin),
    _idempotency_key: str = Depends(require_idempotency_key),
    _step_up: str = Depends(require_step_up_token("rule_supersede")),
    x_expected_latest_version: Optional[int] = Header(None, alias="X-Expected-Latest-Version"),
):
    if payload.country_code.upper() != country_code.upper():
        raise HTTPException(
            status_code=400,
            detail="country_code in path must match payload",
        )
    try:
        new_row = rules_service.supersede(
            db,
            model=TaxBracketSet,
            rule_filter={
                "country_code": country_code.upper(),
                "fiscal_year": payload.fiscal_year,
            },
            new_payload=payload,
            actor_user_id=current_user.user_id,
            expected_latest_version=x_expected_latest_version,
        )
        _set_affected_drafts_header(response, new_row)
        db.commit()
        db.refresh(new_row)
        return _bracket_set_to_read(new_row)
    except RuleSupersedeError as e:
        db.rollback()
        _raise_supersede(e)


# ---------------------------------------------------------------------------
# Statutory deductions
# ---------------------------------------------------------------------------


@router.get(
    "/{country_code}/statutory-deductions", response_model=List[StatutoryDeductionRead]
)
def list_statutory_deductions(
    country_code: str,
    code: Optional[str] = None,
    db: Session = Depends(config.get_db),
    current_user=Depends(require_platform_admin),
):
    rule_filter = {"country_code": country_code.upper()}
    if code:
        rule_filter["code"] = code
    rows = rules_service.get_history(db, StatutoryDeduction, rule_filter)
    return [StatutoryDeductionRead.model_validate(r) for r in rows]


@router.post(
    "/{country_code}/statutory-deductions",
    response_model=StatutoryDeductionRead,
    status_code=status.HTTP_201_CREATED,
)
def supersede_statutory_deduction(
    country_code: str,
    payload: StatutoryDeductionCreate,
    response: Response,
    db: Session = Depends(config.get_db),
    current_user=Depends(require_platform_admin),
    _idempotency_key: str = Depends(require_idempotency_key),
    _step_up: str = Depends(require_step_up_token("rule_supersede")),
    x_expected_latest_version: Optional[int] = Header(None, alias="X-Expected-Latest-Version"),
):
    if payload.country_code.upper() != country_code.upper():
        raise HTTPException(status_code=400, detail="country_code in path must match payload")
    try:
        new_row = rules_service.supersede(
            db,
            model=StatutoryDeduction,
            rule_filter={"country_code": country_code.upper(), "code": payload.code},
            new_payload=payload,
            actor_user_id=current_user.user_id,
            expected_latest_version=x_expected_latest_version,
        )
        _set_affected_drafts_header(response, new_row)
        db.commit()
        db.refresh(new_row)
        return StatutoryDeductionRead.model_validate(new_row)
    except RuleSupersedeError as e:
        db.rollback()
        _raise_supersede(e)


# ---------------------------------------------------------------------------
# Country leave defaults
# ---------------------------------------------------------------------------


@router.get(
    "/{country_code}/leave-defaults", response_model=List[CountryLeaveDefaultRead]
)
def list_leave_defaults(
    country_code: str,
    leave_type_code: Optional[str] = None,
    db: Session = Depends(config.get_db),
    current_user=Depends(require_platform_admin),
):
    rule_filter = {"country_code": country_code.upper()}
    if leave_type_code:
        rule_filter["leave_type_code"] = leave_type_code
    rows = rules_service.get_history(db, CountryLeaveDefault, rule_filter)
    return [CountryLeaveDefaultRead.model_validate(r) for r in rows]


@router.post(
    "/{country_code}/leave-defaults",
    response_model=CountryLeaveDefaultRead,
    status_code=status.HTTP_201_CREATED,
)
def supersede_leave_default(
    country_code: str,
    payload: CountryLeaveDefaultCreate,
    response: Response,
    db: Session = Depends(config.get_db),
    current_user=Depends(require_platform_admin),
    _idempotency_key: str = Depends(require_idempotency_key),
    _step_up: str = Depends(require_step_up_token("rule_supersede")),
    x_expected_latest_version: Optional[int] = Header(None, alias="X-Expected-Latest-Version"),
):
    if payload.country_code.upper() != country_code.upper():
        raise HTTPException(status_code=400, detail="country_code in path must match payload")
    try:
        new_row = rules_service.supersede(
            db,
            model=CountryLeaveDefault,
            rule_filter={
                "country_code": country_code.upper(),
                "leave_type_code": payload.leave_type_code,
            },
            new_payload=payload,
            actor_user_id=current_user.user_id,
            expected_latest_version=x_expected_latest_version,
        )
        _set_affected_drafts_header(response, new_row)
        db.commit()
        db.refresh(new_row)
        return CountryLeaveDefaultRead.model_validate(new_row)
    except RuleSupersedeError as e:
        db.rollback()
        _raise_supersede(e)


# ---------------------------------------------------------------------------
# Country bonus rules
# ---------------------------------------------------------------------------


@router.get(
    "/{country_code}/bonus-rules", response_model=List[CountryBonusRuleRead]
)
def list_bonus_rules(
    country_code: str,
    bonus_code: Optional[str] = None,
    db: Session = Depends(config.get_db),
    current_user=Depends(require_platform_admin),
):
    rule_filter = {"country_code": country_code.upper()}
    if bonus_code:
        rule_filter["bonus_code"] = bonus_code
    rows = rules_service.get_history(db, CountryBonusRule, rule_filter)
    return [CountryBonusRuleRead.model_validate(r) for r in rows]


# ---------------------------------------------------------------------------
# Overtime rules (read-only; superseded via seeders, not the admin UI yet)
# ---------------------------------------------------------------------------


@router.get(
    "/{country_code}/overtime-rules", response_model=List[CountryOvertimeRuleRead]
)
def list_overtime_rules(
    country_code: str,
    db: Session = Depends(config.get_db),
    current_user=Depends(require_platform_admin),
):
    """All overtime-rule versions for a country, newest first."""
    return rules_service.list_overtime_rules(db, country_code.upper())


@router.post(
    "/{country_code}/overtime/reconcile", response_model=OvertimeReconcileResponse
)
def reconcile_overtime(
    country_code: str,
    payload: OvertimeReconcileRequest,
    db: Session = Depends(config.get_db),
    current_user=Depends(require_platform_admin),
):
    """M0 ground-truthing: bucket a hand-entered payslip through the real
    overtime engine against the live seeded country rule, so an admin can
    compare the engine's output to a real payslip without the terminal
    script. Platform-admin only — this validates the statutory rule itself."""
    from datetime import datetime as _dt, time as _time, timedelta as _td
    from core.model import PublicHoliday
    from services import overtime_engine

    cc = country_code.upper()
    rule = rules_service.resolve_overtime_rule(db, cc, payload.period_start)

    logs = []
    for i, ci in enumerate(payload.clock_ins):
        try:
            sh, sm = [int(x) for x in ci.start_hhmm.split(":")]
            eh, em = [int(x) for x in ci.end_hhmm.split(":")]
        except (ValueError, IndexError):
            raise HTTPException(status_code=400, detail=f"clock-in {i}: bad HH:MM time")
        start = _dt.combine(ci.date, _time(sh, sm), tzinfo=timezone.utc)
        end = _dt.combine(ci.date, _time(eh, em), tzinfo=timezone.utc)
        if end <= start:
            end += _td(days=1)
        logs.append(overtime_engine.BucketerTimeLog(
            timelog_id=i, start_utc=start, end_utc=end,
            is_overtime=ci.is_overtime, overtime_confirmed=ci.overtime_confirmed,
        ))

    holidays = frozenset(
        (h.observed_date or h.date)
        for h in db.query(PublicHoliday)
        .filter(PublicHoliday.country_code == cc)
        .filter(PublicHoliday.date >= payload.period_start - _td(days=7))
        .filter(PublicHoliday.date <= payload.period_end + _td(days=1))
        .all()
    )

    monthly_basic = payload.monthly_basic if payload.overtime_eligibility == "MONTHLY_ELIGIBLE" else None
    try:
        buckets, flags = overtime_engine.bucket(
            logs=logs, breaks_by_log={}, rule=rule,
            holidays_by_observed_date=holidays,
            period_start=payload.period_start, period_end=payload.period_end,
            weekly_rest_day_dow=payload.weekly_rest_day_dow,
            contracted_hours_per_week=payload.contracted_hours_per_week,
            overtime_eligibility=payload.overtime_eligibility,
            monthly_basic=monthly_basic,
            company_timezone=payload.company_timezone or "Etc/UTC",
        )
    except ValueError as e:
        raise HTTPException(status_code=400, detail=str(e))

    if payload.overtime_eligibility == "MONTHLY_ELIGIBLE":
        if payload.monthly_basic is None or payload.contracted_hours_per_week is None:
            raise HTTPException(status_code=400, detail="MONTHLY_ELIGIBLE needs monthly_basic + contracted_hours_per_week")
        rate = payload.monthly_basic / (payload.contracted_hours_per_week * Decimal(52) / Decimal(12))
    else:
        rate = payload.hourly_rate

    out = [
        OvertimeReconcileBucket(
            code=b.code,
            label=payroll_engine._bucket_label(b.code),  # noqa: SLF001
            hours=b.hours,
            multiplier=b.multiplier,
            amount=b.amount(rate),
        )
        for b in buckets
    ]
    total = sum((b.amount for b in out), Decimal("0.00"))
    return OvertimeReconcileResponse(
        buckets=out,
        total=total,
        rule_version=rule.version,
        rule_effective_from=rule.effective_from,
        compliance_flags=flags,
    )


@router.get("/{country_code}/overtime/reconcile/prefill")
def reconcile_prefill(
    country_code: str,
    private_user_id: int,
    period_start: date,
    period_end: date,
    db: Session = Depends(config.get_db),
    current_user=Depends(require_platform_admin),
):
    """READ-ONLY convenience: fill the reconcile form from a real employee's
    contract + clock-ins for a period, so an admin doesn't hand-transcribe.

    Touches ZERO payroll-engine compute — pure reads of Job/Salary/Company/
    TimeLog. The contract fields map ~1:1 onto the form (Job already carries
    overtime_eligibility / weekly_rest_day_dow / contracted_hours_per_week).
    Clock-ins are converted to the company's local wall-clock to match what a
    human reads off a payslip. Returns an OvertimeReconcileRequest-shaped dict."""
    from datetime import datetime as _dt, time as _time, timedelta as _td
    from zoneinfo import ZoneInfo
    from core.model import PrivateUser, Job, Salary, Company, TimeLog

    pu = db.query(PrivateUser).filter(PrivateUser.private_user_id == private_user_id).one_or_none()
    if pu is None:
        raise HTTPException(status_code=404, detail="Employee not found")

    job = (
        db.query(Job)
        .filter(Job.private_user_id == private_user_id)
        .order_by(Job.job_id.desc())
        .first()
    )
    if job is None:
        raise HTTPException(status_code=404, detail="Employee has no job record")

    salary = (
        db.query(Salary)
        .filter(Salary.job_id == job.job_id)
        .order_by(Salary.created_at.desc())
        .first()
    )

    company = db.query(Company).filter(Company.company_id == pu.company_id).one_or_none()
    tz_name = (company.timezone if company and getattr(company, "timezone", None) else "Indian/Mauritius")
    try:
        tz = ZoneInfo(tz_name)
    except Exception:
        tz_name, tz = "Etc/UTC", ZoneInfo("Etc/UTC")

    # Clock-ins in the period, converted to local wall-clock. Loose DB window
    # (±1 day) then a precise local-date filter in Python.
    lo = _dt.combine(period_start, _time.min, tzinfo=timezone.utc) - _td(days=1)
    hi = _dt.combine(period_end, _time.max, tzinfo=timezone.utc) + _td(days=1)
    rows = (
        db.query(TimeLog)
        .filter(TimeLog.private_user_id == private_user_id)
        .filter(TimeLog.start_time.isnot(None), TimeLog.end_time.isnot(None))
        .filter(TimeLog.start_time >= lo, TimeLog.start_time <= hi)
        .order_by(TimeLog.start_time.asc())
        .all()
    )
    clock_ins = []
    for r in rows:
        st = r.start_time.astimezone(tz)
        et = r.end_time.astimezone(tz)
        if not (period_start <= st.date() <= period_end):
            continue
        clock_ins.append({
            "date": st.date().isoformat(),
            "start_hhmm": st.strftime("%H:%M"),
            "end_hhmm": et.strftime("%H:%M"),
            "is_overtime": bool(r.is_overtime),
            "overtime_confirmed": bool(r.overtime_confirmed_by_employer),
        })

    return {
        "employee_name": f"{pu.first_name or ''} {pu.last_name or ''}".strip() or f"#{private_user_id}",
        "period_start": period_start.isoformat(),
        "period_end": period_end.isoformat(),
        "hourly_rate": str(salary.hourly_rate) if salary and salary.hourly_rate is not None else "0",
        "weekly_rest_day_dow": job.weekly_rest_day_dow or 7,
        "overtime_eligibility": job.overtime_eligibility or "HOURLY",
        "monthly_basic": str(salary.salary) if salary and salary.salary is not None else None,
        "contracted_hours_per_week": str(job.contracted_hours_per_week) if job.contracted_hours_per_week is not None else None,
        "company_timezone": tz_name,
        "clock_ins": clock_ins,
    }


@router.get(
    "/{country_code}/holidays", response_model=List[PublicHolidayRead]
)
def list_public_holidays(
    country_code: str,
    year: Optional[int] = None,
    db: Session = Depends(config.get_db),
    current_user=Depends(require_platform_admin),
):
    """Public-holiday calendar for a country (defaults to current year)."""
    from datetime import datetime as _dt

    q = db.query(PublicHoliday).filter(
        PublicHoliday.country_code == country_code.upper()
    )
    if year is None:
        year = _dt.now().year
    q = q.filter(PublicHoliday.year == year)
    return q.order_by(PublicHoliday.date).all()


def _audit_holiday(db: Session, actor_user_id: Optional[int], action: str, holiday_id, meta: dict) -> None:
    """Best-effort audit entry for platform-level holiday-calendar edits."""
    try:
        from core.model import AuditLog

        db.add(AuditLog(
            actor_user_id=actor_user_id,
            action=action,
            target_type="public_holiday",
            target_id=str(holiday_id),
            meta=meta,
        ))
        db.commit()
    except Exception:
        db.rollback()


@router.post(
    "/{country_code}/holidays", response_model=PublicHolidayRead,
    status_code=status.HTTP_201_CREATED,
)
def create_public_holiday(
    country_code: str,
    payload: PublicHolidayCreate,
    db: Session = Depends(config.get_db),
    current_user=Depends(require_platform_admin),
):
    """Add a public holiday to a country's calendar."""
    holiday = PublicHoliday(
        country_code=country_code.upper(),
        name=payload.name.strip(),
        date=payload.date,
        observed_date=payload.observed_date,
        year=payload.date.year,
        is_recurring=payload.is_recurring,
    )
    db.add(holiday)
    db.commit()
    db.refresh(holiday)
    _audit_holiday(db, current_user.user_id, "public_holiday_created", holiday.holiday_id,
                   {"country_code": country_code.upper(), "name": holiday.name, "date": str(holiday.date)})
    return holiday


@router.put(
    "/{country_code}/holidays/{holiday_id}", response_model=PublicHolidayRead
)
def update_public_holiday(
    country_code: str,
    holiday_id: int,
    payload: PublicHolidayUpdate,
    db: Session = Depends(config.get_db),
    current_user=Depends(require_platform_admin),
):
    holiday = db.query(PublicHoliday).filter(
        PublicHoliday.holiday_id == holiday_id,
        PublicHoliday.country_code == country_code.upper(),
    ).first()
    if holiday is None:
        raise HTTPException(status_code=404, detail="Holiday not found")
    changed = payload.dict(exclude_unset=True)
    for field, value in changed.items():
        setattr(holiday, field, value)
    if "date" in changed and changed["date"] is not None:
        holiday.year = changed["date"].year
    db.commit()
    db.refresh(holiday)
    _audit_holiday(db, current_user.user_id, "public_holiday_updated", holiday_id,
                   {"changed_fields": {k: str(v) for k, v in changed.items()}})
    return holiday


@router.delete(
    "/{country_code}/holidays/{holiday_id}", status_code=status.HTTP_204_NO_CONTENT
)
def delete_public_holiday(
    country_code: str,
    holiday_id: int,
    db: Session = Depends(config.get_db),
    current_user=Depends(require_platform_admin),
):
    holiday = db.query(PublicHoliday).filter(
        PublicHoliday.holiday_id == holiday_id,
        PublicHoliday.country_code == country_code.upper(),
    ).first()
    if holiday is None:
        raise HTTPException(status_code=404, detail="Holiday not found")
    meta = {"country_code": country_code.upper(), "name": holiday.name, "date": str(holiday.date)}
    db.delete(holiday)
    db.commit()
    _audit_holiday(db, current_user.user_id, "public_holiday_deleted", holiday_id, meta)
    return None


@router.post(
    "/{country_code}/bonus-rules",
    response_model=CountryBonusRuleRead,
    status_code=status.HTTP_201_CREATED,
)
def supersede_bonus_rule(
    country_code: str,
    payload: CountryBonusRuleCreate,
    response: Response,
    db: Session = Depends(config.get_db),
    current_user=Depends(require_platform_admin),
    _idempotency_key: str = Depends(require_idempotency_key),
    _step_up: str = Depends(require_step_up_token("rule_supersede")),
    x_expected_latest_version: Optional[int] = Header(None, alias="X-Expected-Latest-Version"),
):
    if payload.country_code.upper() != country_code.upper():
        raise HTTPException(status_code=400, detail="country_code in path must match payload")
    try:
        new_row = rules_service.supersede(
            db,
            model=CountryBonusRule,
            rule_filter={
                "country_code": country_code.upper(),
                "bonus_code": payload.bonus_code,
            },
            new_payload=payload,
            actor_user_id=current_user.user_id,
            expected_latest_version=x_expected_latest_version,
        )
        _set_affected_drafts_header(response, new_row)
        db.commit()
        db.refresh(new_row)
        return CountryBonusRuleRead.model_validate(new_row)
    except RuleSupersedeError as e:
        db.rollback()
        _raise_supersede(e)
