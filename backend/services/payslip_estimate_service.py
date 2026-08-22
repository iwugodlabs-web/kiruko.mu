"""M4 — Estimated payslip rendering.

Distinct from services/payslip_pdf_service:
  * server-determined current month only (no month query param)
  * computes via the existing engine but never persists
  * always uses live statutory rules; stamps the version on the PDF so
    re-downloads explain themselves
  * watermark + red banner + equal-weight pending-review banner are
    rendered from a forked template; cannot be feature-flag-removed
  * no payslip number, no QR, no signature line
  * filename pattern explicitly distinct from the official payslip
"""

from __future__ import annotations

import logging
from datetime import date, datetime, timezone
from decimal import Decimal
from pathlib import Path
from typing import Optional

from sqlalchemy.orm import Session

logger = logging.getLogger(__name__)

from core.model import Company, Job, PrivateUser, TimeLog
from services import one_off_allowances_service, payroll_engine, payroll_rules, salary_resolver
from services.payslip_pdf_service import PdfRenderUnavailable, _format_money


_TEMPLATES_DIR = Path(__file__).resolve().parent.parent / "templates" / "payslips"
_TEMPLATE_BY_COUNTRY = {"MU": "MU/estimated.html"}

_LABELS_EN = {
    "estimated_gross": "Estimated gross",
    "pending_review": "Pending admin review",
    "entries": "entries",
    "hours": "hours",
    "may_decrease": "Final pay may decrease",
    "all_approved": "All clock-ins approved by admin",
    "salary_based": "Fixed salary — clock-ins don't change this amount",
    "clockins_so_far": "Clock-ins so far",
    "clockins_so_far_note": "Value of hours logged to date · doesn't change your fixed salary",
    "employee": "Employee",
    "employer": "Employer",
    "period": "Period",
    "clockins_used": "Clock-ins used",
    "hours_total": "h total",
    "approved": "approved",
    "pending": "pending",
    "earnings": "Earnings",
    "deductions": "Deductions",
    "code": "Code",
    "label": "Label",
    "amount": "Amount",
    "preliminary": "Preliminary",
    "preliminary_lower": "preliminary",
    "estimated_net": "ESTIMATED NET",
    "statutory_rules_label": "Statutory rules",
    "leave_taken": "Leave taken",
    "days": "Days",
    "unpaid": "unpaid",
    "hours_feeding_title": "Hours feeding this estimate",
    "hours_feeding_note": (
        "Rough proportional share of the gross by hours. The finalized "
        "payslip may differ — overtime, leave, and statutory rules adjust "
        "the official total."
    ),
    "col_date": "Date",
    "col_start": "Start",
    "col_end": "End",
    "col_hours": "Hours",
    "col_status": "Status",
    "col_est_amount": "Est. amount",
    "details_truncated_note": "Showing the first 200 entries — open clock-in history for the full list.",
    "bucket_footnote": (
        "The earnings above are now shown per pay band (regular, overtime, "
        "rest-day, public-holiday and night premiums), each at its own rate. "
        "The per-clock-in amounts in this table remain a rough proportional "
        "share of the gross, not the band-level figure."
    ),
}
_LABELS_FR = {
    "estimated_gross": "Brut estimé",
    "pending_review": "En attente de validation",
    "entries": "entrées",
    "hours": "heures",
    "may_decrease": "Le salaire final peut diminuer",
    "all_approved": "Toutes les présences validées",
    "salary_based": "Salaire fixe — les pointages ne modifient pas ce montant",
    "clockins_so_far": "Pointages à ce jour",
    "clockins_so_far_note": "Valeur des heures enregistrées à ce jour · ne modifie pas votre salaire fixe",
    "employee": "Employé",
    "employer": "Employeur",
    "period": "Période",
    "clockins_used": "Présences utilisées",
    "hours_total": "h total",
    "approved": "validées",
    "pending": "en attente",
    "earnings": "Gains",
    "deductions": "Déductions",
    "code": "Code",
    "label": "Libellé",
    "amount": "Montant",
    "preliminary": "Préliminaire",
    "preliminary_lower": "préliminaire",
    "estimated_net": "NET ESTIMÉ",
    "statutory_rules_label": "Règles fiscales",
    "leave_taken": "Congés pris",
    "days": "Jours",
    "unpaid": "non payé",
    "hours_feeding_title": "Heures à la base de cette estimation",
    "hours_feeding_note": (
        "Part proportionnelle approximative du brut selon les heures. "
        "Le bulletin final peut différer — heures supplémentaires, congés "
        "et règles statutaires ajustent le total officiel."
    ),
    "col_date": "Date",
    "col_start": "Début",
    "col_end": "Fin",
    "col_hours": "Heures",
    "col_status": "Statut",
    "col_est_amount": "Montant est.",
    "details_truncated_note": "Affichage des 200 premières entrées — voir l'historique des pointages pour la liste complète.",
    "bucket_footnote": (
        "Les revenus ci-dessus sont désormais présentés par tranche de "
        "rémunération (normale, heures supplémentaires, jour de repos, jour "
        "férié et primes de nuit), chacune à son taux. Les montants par "
        "pointage de ce tableau restent une part proportionnelle approximative "
        "du brut, et non le chiffre par tranche."
    ),
}
_LABELS_MG = {
    "estimated_gross": "Tombany tombatombana",
    "pending_review": "Miandry fanamarinana",
    "entries": "entrées",
    "hours": "ora",
    "may_decrease": "Mety hihena ny vola farany",
    "all_approved": "Voamarina avokoa ny fidirana",
    "salary_based": "Karama raikitra — tsy ovan'ny fidirana ity sandany ity",
    "clockins_so_far": "Fidirana hatreto",
    "clockins_so_far_note": "Sandan'ny ora voarakitra hatramin'izao · tsy manova ny karamanao raikitra",
    "employee": "Mpiasa",
    "employer": "Mpampiasa",
    "period": "Vanim-potoana",
    "clockins_used": "Fidirana ampiasaina",
    "hours_total": "ora total",
    "approved": "voamarina",
    "pending": "miandry",
    "earnings": "Karama",
    "deductions": "Fanesorana",
    "code": "Kaody",
    "label": "Anarana",
    "amount": "Vola",
    "preliminary": "Mialoha",
    "preliminary_lower": "mialoha",
    "estimated_net": "NET TOMBATOMBANA",
    "statutory_rules_label": "Lalàna ara-bola",
    "leave_taken": "Fialana noraisina",
    "days": "Andro",
    "unpaid": "tsy karamaina",
    "hours_feeding_title": "Ora mamokatra ity tombatombana ity",
    "hours_feeding_note": (
        "Ampahany tombatombana avy amin'ny tombany araka ny ora. Mety "
        "hihena na hitombo amin'ny taratasim-karama farany — manova ny "
        "tontaliny ofisialy ny ora fanampiny, ny fialana ary ny lalàna."
    ),
    "col_date": "Daty",
    "col_start": "Fiandohana",
    "col_end": "Fiafarana",
    "col_hours": "Ora",
    "col_status": "Toetra",
    "col_est_amount": "Vola tombany",
    "details_truncated_note": "Mampiseho ny 200 voalohany — jereo ny tantaran'ny fidirana ho an'ny lisitra feno.",
    "bucket_footnote": (
        "Ny karama etsy ambony dia aseho isaky ny sokajy karama izao "
        "(ara-dalàna, ora fanampiny, andro fitsaharana, andro fety ary "
        "tambin'alina), samy manana ny tahany. Ny vola isaky ny fidirana "
        "amin'ity tabilao ity dia mbola ampahany tombatombana amin'ny brut, "
        "fa tsy ny isa isaky ny sokajy."
    ),
}

_BANNER_BY_LOCALE = {
    "en": "ESTIMATED PAYSLIP — NOT OFFICIAL",
    "fr": "FICHE DE PAIE ESTIMATIVE — NON OFFICIELLE",
    "mg": "TARATASIM-KARAMA TOMBATOMBANA — TSY OFISIALY",
}

_DISCLAIMER_FULL = {
    "en": (
        "This is an estimate based on your clock-ins as of {generated_at}. "
        "Figures may change before payroll is finalized. "
        "Not valid for banks, tax filings, immigration, or legal purposes."
    ),
    "fr": (
        "Ceci est une estimation basée sur vos pointages au {generated_at}. "
        "Les montants peuvent changer avant la finalisation de la paie. "
        "Non valable pour les banques, les déclarations fiscales, l'immigration ou un usage juridique."
    ),
    "mg": (
        "Tombatombana izao mifototra amin'ny fidiranao tamin'ny {generated_at}. "
        "Mety hiova ny isa alohan'ny fanamafisana ny karama. "
        "Tsy mahasolo taratasy ofisialy ho an'ny banky, hetra, fifindra-monina na lalàna."
    ),
}

_DISCLAIMER_SHORT = {
    "en": "ESTIMATED · Not valid for banks, tax, immigration, or legal use",
    "fr": "ESTIMATIF · Non valable pour banques, fiscalité, immigration ou usage juridique",
    "mg": "TOMBATOMBANA · Tsy ampiasaina ho an'ny banky, hetra, fifindra-monina",
}


class EstimateUnavailable(Exception):
    """Raised when the PDF cannot be rendered (rare but expected: e.g.,
    employee with no salary assignment yet)."""


def _resolve_labels(locale: str) -> dict:
    return {
        "en": _LABELS_EN, "fr": _LABELS_FR, "mg": _LABELS_MG,
    }.get(locale, _LABELS_EN)


def _resolve_locale(user) -> str:
    """Best-effort locale resolution. Falls back to English."""
    raw = getattr(user, "preferred_locale", None) or "en"
    return raw if raw in {"en", "fr", "mg"} else "en"


def _current_month_range_utc() -> tuple[date, date]:
    """Server-clamped current calendar month (UTC).

    M4 design choice: the endpoint deliberately doesn't accept a `month`
    query param — once the month rolls over, only the official payslip
    exists. Removes the stale-screenshot dispute vector.
    """
    now = datetime.now(timezone.utc).date()
    start = now.replace(day=1)
    if start.month == 12:
        end = date(start.year + 1, 1, 1)
    else:
        end = date(start.year, start.month + 1, 1)
    # Inclusive end for proration helpers
    return start, date(end.year, end.month, end.day) if False else (
        date(start.year, start.month + 1, 1) - __import__("datetime").timedelta(days=1)
        if start.month != 12
        else date(start.year, 12, 31)
    )


def _format_period_label(d: date) -> str:
    return d.strftime("%B %Y")


def _standard_monthly_hours(job, salary) -> Optional[Decimal]:
    """Standard monthly working hours for a salaried worker, derived from the
    employee's *profile* (job schedule) so the implied hourly rate reflects how
    they're actually scheduled.

    Priority:
      1. job.contracted_hours_per_week  → × 52/12
      2. sum of job.work_days values (per-day hours) → weekly × 52/12
      3. salary.monthly_hours (configured fallback)

    Returns None when nothing usable is configured.
    """
    weekly: Optional[Decimal] = None
    if job is not None:
        cw = getattr(job, "contracted_hours_per_week", None)
        if cw:
            try:
                weekly = Decimal(str(cw))
            except (ArithmeticError, ValueError):
                weekly = None
        if weekly is None:
            work_days = getattr(job, "work_days", None)
            if isinstance(work_days, dict):
                total = Decimal("0")
                for v in work_days.values():
                    try:
                        total += Decimal(str(v))
                    except (ArithmeticError, ValueError):
                        continue
                if total > 0:
                    weekly = total
    if weekly and weekly > 0:
        # 52 weeks / 12 months — the standard annualization for a fixed weekly
        # schedule. e.g. 40 h/week → 173.33 h/month.
        return (weekly * Decimal("52") / Decimal("12")).quantize(Decimal("0.01"))

    mh_raw = getattr(salary, "monthly_hours", None) if salary else None
    if mh_raw:
        try:
            mh = Decimal(str(mh_raw))
            if mh > 0:
                return mh
        except (ArithmeticError, ValueError):
            pass
    return None


def _summarize_clockins(
    db: Session, private_user_id: int, period_start: date, period_end: date,
    company_timezone: Optional[str] = None,
) -> dict:
    """Count + hour totals for the period, split by approval state, and
    a per-row detail list so the template can show "hours feeding this
    estimate" with date/start/end/hours/approval. The detail list is
    capped at 200 rows — beyond that, the PDF would be unreadable and
    the user is better served by clock-in history."""
    from datetime import datetime as _dt, time as _time, timezone as _tz
    from services.kiosk_service import KioskService
    from core.model import BreakLog

    start_dt = _dt.combine(period_start, _time.min)
    end_dt = _dt.combine(period_end, _time.max)

    rows = (
        db.query(
            TimeLog.timelog_id,
            TimeLog.hours_worked,
            TimeLog.admin_approved,
            TimeLog.start_time,
            TimeLog.end_time,
            Job.work_start_time,
            Job.work_end_time,
        )
        .join(Job, TimeLog.job_id == Job.job_id)
        .filter(TimeLog.private_user_id == private_user_id)
        .filter(TimeLog.start_time >= start_dt)
        .filter(TimeLog.start_time <= end_dt)
        .order_by(TimeLog.start_time.asc())
        .all()
    )

    # Breaks per timelog — fetched once for all rows in range.
    timelog_ids = [r[0] for r in rows]
    breaks_by_log: dict[int, list] = {}
    if timelog_ids:
        for tid, b_start, b_end in (
            db.query(BreakLog.timelog_id, BreakLog.start_time, BreakLog.end_time)
            .filter(BreakLog.timelog_id.in_(timelog_ids))
            .all()
        ):
            breaks_by_log.setdefault(tid, []).append((b_start, b_end))

    def _row_hours(timelog_id, hrs, st, et, work_start_time, work_end_time) -> Decimal:
        """Hours for one clock-in — always recomputed live from raw
        start/end minus logged breaks, NEVER from the stored hours_worked
        column. An open (never explicitly ended) break is deducted through
        to the shift's own end_time, same rule
        db_models/crud/job.py::update_time_log applies when it persists
        hours_worked. Trusting the stored column here was the actual bug:
        it can be stale for any shift closed out before that rule existed,
        which is exactly why this estimate previously disagreed with
        mobile's own always-live local calculation. Clamped to the job's
        scheduled start same as before — so this doesn't disagree with the
        eventual real payslip over an early clock-in."""
        if st is None or et is None or et <= st:
            # Still-open shift, or missing timestamps — nothing final to
            # report; the stored hrs (if any) isn't reliable here either.
            return Decimal("0.00")
        if st.tzinfo is None:
            st = st.replace(tzinfo=_tz.utc)
        if et.tzinfo is None:
            et = et.replace(tzinfo=_tz.utc)
        break_seconds = 0.0
        for b_start, b_end in breaks_by_log.get(timelog_id, []):
            if b_start is None:
                continue
            effective_end = b_end if b_end is not None else et
            if b_start.tzinfo is None:
                b_start = b_start.replace(tzinfo=_tz.utc)
            if effective_end.tzinfo is None:
                effective_end = effective_end.replace(tzinfo=_tz.utc)
            break_seconds += max((effective_end - b_start).total_seconds(), 0.0)
        raw_seconds = (et - st).total_seconds()
        h = (Decimal(max(raw_seconds - break_seconds, 0.0)) / Decimal(3600)).quantize(Decimal("0.01"))
        effective_start = KioskService.effective_paid_start(
            work_start_time, work_end_time, company_timezone, st,
        )
        if effective_start > st:
            early_seconds = (effective_start - st).total_seconds()
            h = max(Decimal("0.00"), h - Decimal(early_seconds) / Decimal(3600))
        return h

    total_hours = Decimal("0.00")
    approved_hours = Decimal("0.00")
    unapproved_hours = Decimal("0.00")
    approved_count = 0
    unapproved_count = 0
    total_count = len(rows)

    for _id, hrs, approved, st, et, work_start_time, work_end_time in rows:
        h = _row_hours(_id, hrs, st, et, work_start_time, work_end_time)
        total_hours += h
        if approved:
            approved_count += 1
            approved_hours += h
        else:
            unapproved_count += 1
            unapproved_hours += h

    # Per-row details. Times are stored timezone-aware; format as local
    # date / HH:MM so the employee reads them naturally.
    details = []
    for _id, hrs, approved, st, et, work_start_time, work_end_time in rows[:200]:
        h = _row_hours(_id, hrs, st, et, work_start_time, work_end_time)
        details.append({
            "date": st.strftime("%Y-%m-%d") if st else "",
            "start": st.strftime("%H:%M") if st else "",
            "end": et.strftime("%H:%M") if et else "",
            "hours_str": f"{h.quantize(Decimal('0.01'))}",
            "hours_decimal": h,
            "approved": bool(approved),
        })

    return {
        "total_count": total_count,
        "approved_count": approved_count,
        "unapproved_count": unapproved_count,
        "total_hours": f"{total_hours.quantize(Decimal('0.01'))}",
        "approved_hours": f"{approved_hours.quantize(Decimal('0.01'))}",
        "unapproved_hours": f"{unapproved_hours.quantize(Decimal('0.01'))}",
        "total_hours_decimal": total_hours,
        "details": details,
        "details_truncated": total_count > 200,
    }


def build_context(
    db: Session,
    *,
    employee: PrivateUser,
    company: Company,
    job: Optional[Job],
    period_start: date,
    period_end: date,
    locale: str,
) -> dict:
    """Compute the estimated payslip context and statutory rules version."""
    # Estimate ignores admin approval — that's the whole point of the surface.
    #
    # Resolve the salary as of *today* (clamped into the period), not
    # period_start. A worker hired — or whose salary is configured — mid-month
    # has an EmployeeSalaryAssignment whose effective_from is after the 1st;
    # resolving as of period_start would find nothing in force and compute a
    # gross of 0, wrongly blocking the estimate. Using today's in-force salary
    # is the right basis for a current-month estimate (joiner proration still
    # applies downstream). Real payroll is unaffected — it resolves its own
    # as-of date at run time.
    today = datetime.now(timezone.utc).date()
    salary_as_of = min(max(today, period_start), period_end)
    resolved = salary_resolver.resolve_components(db, employee.private_user_id, salary_as_of)

    # Pay basis decides whether clock-in hours actually drive the pay. Only an
    # hourly worker's gross is a function of logged hours; a monthly/daily
    # salary is fixed and independent of clock-ins. The template uses this to
    # avoid the nonsensical "split the monthly salary across clock-in hours"
    # breakdown (and the "final pay may decrease" framing) for salaried staff.
    _job0, _salary0 = payroll_engine._active_job_with_salary(db, employee.private_user_id)  # noqa: SLF001
    pay_basis = (_salary0.pay_basis if _salary0 and _salary0.pay_basis else "monthly").lower()
    pay_is_hours_driven = pay_basis == "hourly"

    # Route the estimate through the bucketed overtime engine when an
    # overtime rule is in force, so the estimate's earnings line up with
    # what the finalized payslip would show (per-bucket multipliers). Falls
    # back to a plain base-rate estimate if no rule exists for this country
    # yet (not-yet-onboarded country) — the estimate must not hard-fail the
    # way create_draft_run does; this is a graceful-degradation fallback,
    # unrelated to any notion of a legacy compute path.
    country_code = company.country_code or "MU"
    overtime_rule = payroll_rules.get_overtime_rule(db, country_code, period_start)
    overtime_rule_read = (
        payroll_rules._overtime_rule_to_read(overtime_rule)  # noqa: SLF001
        if overtime_rule is not None
        else None
    )
    company_tz = getattr(company, "timezone", None) or "Indian/Mauritius"

    payroll_engine._apply_pay_basis(  # noqa: SLF001 — internal-but-stable
        db,
        employee,
        period_start,
        period_end,
        country_code,
        resolved,
        require_approved_clockins=False,
        overtime_rule=overtime_rule_read,
        company_timezone=company_tz,
        # Estimate is shown pre-approval — count worker-flagged OT optimistically
        # so OT-pending shifts aren't dropped to a misleading 0.
        assume_ot_confirmed=True,
    )

    # #18 — fold in one-off allowances scheduled for this period (additional
    # remuneration for additional duty, signing bonuses, etc.) exactly as the
    # run does, so the worker's estimate reflects them and stays equal to the
    # finalized run. Read-only: we list + resolve but never stamp_applied (the
    # estimate must not consume the one-off — only finalize does that).
    _one_offs = one_off_allowances_service.list_pending_for_period(
        db, employee.private_user_id, period_start.year, period_start.month,
    )
    if _one_offs:
        resolved.components.extend(
            one_off_allowances_service.to_resolved_components(_one_offs)
        )

    # Summarize clock-ins up front — the hourly fallback below needs the
    # start/end-derived hour total before earnings are built.
    clockins = _summarize_clockins(
        db, employee.private_user_id, period_start, period_end,
        company_timezone=getattr(company, "timezone", None),
    )

    snapshot = payroll_rules.resolve(db, country_code, period_start)

    # #19 — make the estimate a TRUE preview of the finalized run by applying the
    # same deductions the run applies. Both included here are pure/read-only:
    #   * leave_impact       — unpaid-leave deduction
    #   * absence_deduction  — #17 unclocked-absence deduction (only fires for
    #                          companies opted into clock-driven payroll; presence
    #                          is approval-independent, so the pre-approval
    #                          estimate matches the post-approval run)
    # Loan repayments are intentionally excluded: their helper PERSISTS Repayment
    # rows, and the estimate must never write. The estimate stays
    # "pre-loan-repayment" — its long-standing behavior.
    company_requires_approved = bool(
        getattr(company, "require_approved_clockins_for_payroll", False)
    )

    attendance_details: dict = {}

    def _compute(resolved_now):
        egb = sum(
            (c.amount for c in resolved_now.components
             if c.kind == "earning" and c.is_basic),
            Decimal("0.00"),
        )
        leave_summary = payroll_engine._compute_leave_summary(  # noqa: SLF001
            db, employee.private_user_id, period_start, period_end,
            country_code=country_code,
        )
        leave_impact = payroll_engine._compute_leave_impact_for_period(  # noqa: SLF001
            db, country_code, employee, leave_summary, egb, period_start, period_end,
        )
        absence_deduction = payroll_engine._compute_salaried_absence_for_period(  # noqa: SLF001
            db, country_code, employee, egb, period_start, period_end,
            company_tz, company_requires_approved,
            details_out=attendance_details,
        )
        return payroll_engine.compute_for_resolved(
            resolved_now, snapshot,
            db=db, private_user_id=employee.private_user_id,
            period_start=period_start, country_code=country_code,
            leave_impact=leave_impact,
            absence_deduction=absence_deduction,
        )

    computed = _compute(resolved)

    # Estimate-only hourly fallback. An hourly worker with real, closed
    # shifts can still compute a gross of 0 — e.g. the legacy (no overtime
    # rule) path sums time_logs.hours_worked and skips rows where it's NULL,
    # so shifts whose hours were never persisted contribute nothing. That
    # wrongly trips the "no estimable pay" block. When the engine valued
    # nothing yet the clock-ins carry real start/end-derived hours, fall back
    # to hours × hourly_rate so the estimate reflects work actually done.
    # Only fires when the engine itself produced 0 (no double-count); real
    # payroll is untouched — it keeps using the persisted-hours path.
    if Decimal(str(computed.get("gross") or 0)) <= 0:
        _derived_h = clockins.get("total_hours_decimal") or Decimal("0.00")
        if pay_is_hours_driven and _salary0 and _salary0.hourly_rate and _derived_h > 0:
            _amount = (_derived_h * Decimal(_salary0.hourly_rate)).quantize(Decimal("0.01"))
            payroll_engine._replace_or_add_basic(  # noqa: SLF001
                resolved, _amount, "Hourly wages", "hourly"
            )
            computed = _compute(resolved)

    # Diagnostic — no PII, just the numbers that drive the "no estimable pay"
    # gate. Lets us see why a worker who has clock-ins still computes gross 0.
    try:
        logger.debug(
            "estimate diag: pid=%s period=%s..%s basis=%s hourly_rate=%s "
            "ot_rule=%s clockins_total=%s open_or_zero_hours=%s derived_hours=%s gross=%s",
            employee.private_user_id, period_start, period_end,
            pay_basis,
            (_salary0.hourly_rate if _salary0 else None),
            (overtime_rule_read is not None),
            clockins.get("total_count"),
            sum(1 for d in clockins.get("details", []) if (d.get("hours_decimal") or 0) <= 0),
            clockins.get("total_hours_decimal"),
            computed.get("gross"),
        )
    except Exception:  # diagnostics must never break the request
        logger.exception("estimate diag logging failed")

    currency = computed.get("currency") or "MUR"
    statutory_employee = computed.get("statutory_employee") or {}

    components = computed.get("components") or []
    statutory_codes = set(statutory_employee.keys())

    earnings = []
    for c in components:
        if c.get("kind") != "earning":
            continue
        meta = c.get("meta") or {}
        mult_raw = meta.get("multiplier")
        mult_badge = None
        if mult_raw is not None:
            try:
                m = Decimal(str(mult_raw))
                if m != Decimal("1"):
                    mult_badge = f"{m.normalize():f}×"
            except (ArithmeticError, ValueError):
                mult_badge = None
        hours_raw = meta.get("hours")
        hours_str = None
        if hours_raw is not None:
            try:
                hours_str = f"{Decimal(str(hours_raw)).quantize(Decimal('0.01')).normalize():f}h"
            except (ArithmeticError, ValueError):
                hours_str = None
        earnings.append({
            "code": c.get("code"),
            "label": c.get("label") or c.get("code"),
            "amount_str": _format_money(c.get("amount"), currency),
            "multiplier_badge": mult_badge,
            "hours_str": hours_str,
        })
    deductions: list[dict] = []
    for c in components:
        if c.get("kind") == "deduction":
            deductions.append({
                "code": c.get("code"),
                "label": c.get("label") or c.get("code"),
                "amount_str": _format_money(c.get("amount"), currency),
                "is_statutory": False,
            })
    # Statutory deductions appended (preliminary tag in template).
    for code, amount in statutory_employee.items():
        deductions.append({
            "code": code,
            "label": code.replace("_", " "),
            "amount_str": _format_money(amount, currency),
            "is_statutory": True,
        })

    # Per-clock-in estimated contribution. Only meaningful for hourly pay,
    # where the gross is a function of hours. For a fixed monthly/daily salary,
    # splitting the salary across clock-in hours is nonsensical (it implies one
    # shift "earned" most of the month's pay), so we leave the amount blank and
    # the template hides this section entirely for salaried staff.
    gross_dec = Decimal(str(computed.get("gross") or 0))
    total_h_dec: Decimal = clockins.get("total_hours_decimal") or Decimal("0.00")
    for d in clockins["details"]:
        h = d.get("hours_decimal") or Decimal("0.00")
        if pay_is_hours_driven and total_h_dec > 0 and gross_dec > 0:
            est = (gross_dec * h / total_h_dec).quantize(Decimal("0.01"))
            d["est_amount_str"] = _format_money(est, currency)
        else:
            d["est_amount_str"] = "—"
        # Drop the Decimal so Jinja doesn't try to render it.
        d.pop("hours_decimal", None)
    clockins.pop("total_hours_decimal", None)

    # "Clock-ins so far" — the monetary value of hours logged to date. For
    # hourly staff this already equals the gross. For a salaried worker the
    # gross is the fixed month-end figure, so they otherwise can't see what
    # they've accrued mid-month: value their logged hours at their implied
    # hourly rate (monthly gross ÷ standard monthly hours). Informational only;
    # it does not change their fixed salary.
    clockin_value_str = None
    if not pay_is_hours_driven and gross_dec > 0 and total_h_dec > 0:
        std_monthly_hours = _standard_monthly_hours(job, _salary0)
        if std_monthly_hours and std_monthly_hours > 0:
            implied_hourly = gross_dec / std_monthly_hours
            value_so_far = (implied_hourly * total_h_dec).quantize(Decimal("0.01"))
            clockin_value_str = _format_money(value_so_far, currency)

    # Leave taken in the period (sick / annual / etc.) — same source-of-truth
    # helper as the official payroll engine, so the estimate matches what
    # would land on a finalized payslip.
    leave_summary = payroll_engine._compute_leave_summary(  # noqa: SLF001 — internal-but-stable
        db, employee.private_user_id, period_start, period_end,
        country_code=country_code,
    )

    rules_version = (
        f"{company.country_code or 'MU'} {period_start.strftime('%Y-Q%m')[:6]}"
    )
    # Friendly: 2026-04 → "2026-Q2"
    quarter = (period_start.month - 1) // 3 + 1
    rules_version = f"{company.country_code or 'MU'} {period_start.year}-Q{quarter}"

    labels = _resolve_labels(locale)
    generated_at = datetime.now(timezone.utc).strftime("%Y-%m-%d %H:%M UTC")

    return {
        "locale": locale,
        "labels": labels,
        "banner_top_text": _BANNER_BY_LOCALE.get(locale, _BANNER_BY_LOCALE["en"]),
        "disclaimer_full": _DISCLAIMER_FULL.get(locale, _DISCLAIMER_FULL["en"]).format(
            generated_at=generated_at,
        ),
        "disclaimer_short": _DISCLAIMER_SHORT.get(locale, _DISCLAIMER_SHORT["en"]),
        "rules_version": rules_version,
        "currency": currency,
        "employee": {
            "name": f"{employee.first_name} {employee.last_name}".strip() or "—",
            "passport": employee.pass_port_number or "",
        },
        "employer": {
            "name": company.company_name or "",
            "brn": company.brn or "",
        },
        "period": {
            "label": _format_period_label(period_start),
            "start": period_start.isoformat(),
            "end": period_end.isoformat(),
        },
        "clockins": clockins,
        "leave_summary": leave_summary,
        "earnings": earnings,
        "deductions": deductions,
        "totals": {
            "gross_str": _format_money(computed.get("gross"), currency),
            "net_str": _format_money(computed.get("net_pay"), currency),
        },
        # Whether pay is a function of clock-in hours (hourly) vs a fixed
        # salary (monthly/daily). The template uses this to hide the
        # "hours feeding this estimate" breakdown and the "final pay may
        # decrease" framing for salaried staff, whose pay clock-ins don't move.
        "pay_is_hours_driven": pay_is_hours_driven,
        # Monetary value of hours logged to date (salaried staff only — for
        # hourly this is just the gross). None when it can't be derived.
        "clockin_value_str": clockin_value_str,
        # Numeric gross for the caller's "don't ship a 0-value estimate" gate.
        "gross_decimal": gross_dec,
        # Numeric net (#19) — symmetric with gross_decimal. Lets callers/tests
        # compare the estimate against the finalized run without parsing the
        # formatted net string.
        "net_decimal": Decimal(str(computed.get("net_pay") or 0)),
        # Total derived clock-in hours in the period — lets the caller tell
        # "no clock-ins / open shifts" apart from "worked, but no pay basis
        # configured" when gross is 0.
        "clockin_hours_decimal": total_h_dec,
        # Day-count breakdown behind any ABSENCE_DEDUCTION line in
        # `computed`'s components (see _compute_salaried_absence_for_period's
        # details_out) — {} when the deduction never ran (hourly/daily pay
        # basis, company doesn't require clock-ins, or employee has zero
        # clock-ins at all so absence can't be distinguished from untracked).
        "attendance_details": attendance_details,
        "generated_at": generated_at,
    }


def render_pdf(
    db: Session,
    *,
    employee: PrivateUser,
    company: Company,
    job: Optional[Job],
    period_start: date,
    period_end: date,
    locale: str,
    context: Optional[dict] = None,
) -> bytes:
    """Render the estimated payslip to PDF bytes. Streamed in-memory by
    the caller — never written to disk. Pass a prebuilt `context` (from
    build_context) to avoid recomputing it."""
    try:
        from jinja2 import Environment, FileSystemLoader, select_autoescape
        from weasyprint import HTML
    except ImportError as e:
        raise PdfRenderUnavailable(f"PDF renderer not available: {e}") from e
    except OSError as e:
        raise PdfRenderUnavailable(f"PDF native libs not available: {e}") from e

    rel = _TEMPLATE_BY_COUNTRY.get(company.country_code or "MU", _TEMPLATE_BY_COUNTRY["MU"])
    template_path = _TEMPLATES_DIR / rel
    if not template_path.exists():
        raise PdfRenderUnavailable(f"Template not found: {template_path}")

    env = Environment(
        loader=FileSystemLoader(str(template_path.parent)),
        autoescape=select_autoescape(["html", "xml"]),
    )
    template = env.get_template(template_path.name)

    if context is None:
        context = build_context(
            db,
            employee=employee,
            company=company,
            job=job,
            period_start=period_start,
            period_end=period_end,
            locale=locale,
        )
    html = template.render(**context)
    return HTML(string=html, base_url=str(template_path.parent)).write_pdf()
