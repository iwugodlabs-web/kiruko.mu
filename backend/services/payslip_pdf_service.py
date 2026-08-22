"""Payslip PDF rendering (M21).

Pure rendering layer — given a Payslip + its run + employee + employer
context, produce PDF bytes. No I/O beyond reading the Jinja2 template
and rasterizing through WeasyPrint. Uploading + persisting `pdf_url` /
`hash_sha256` lives in `jobs/payslip_pdf.py`, which calls into here.

Country resolution: today only Mauritius has a template. The service
falls back to MU/default.html for any country code; once additional
countries ship, register them in the `_TEMPLATE_REGISTRY` map below.

Graceful degradation: if WeasyPrint isn't installed (e.g., the host is
missing libcairo / libpango), `render_pdf` raises `PdfRenderUnavailable`
and the caller logs + skips. Finalize must NOT fail just because PDF
generation fails — the run is the source of truth, the PDF is a
derived artifact.
"""

from __future__ import annotations

import hashlib
import logging
import os
from datetime import datetime, timezone
from decimal import Decimal
from pathlib import Path
from typing import Optional

from sqlalchemy.orm import Session

from core.model import Company, Job, PayrollRun, Payslip, PrivateUser


logger = logging.getLogger(__name__)


_TEMPLATES_DIR = Path(__file__).resolve().parent.parent / "templates" / "payslips"
_TEMPLATE_REGISTRY = {
    "MU": "MU/default.html",
}
# Correction notes (is_adjustment payslips) render through a dedicated template
# that frames every figure as a signed change + a previous→new reconciliation.
_CORRECTION_TEMPLATE_REGISTRY = {
    "MU": "MU/correction.html",
}

# Money fields that carry a signed delta on an adjustment payslip, with the
# label shown on the correction note. Order = display order.
_CORRECTION_DELTA_FIELDS = [
    ("gross", "Gross / Brut"),
    ("paye", "PAYE"),
    ("allowances_total", "Allowances / Indemnités"),
    ("bonus", "Bonus / Prime"),
    ("loan_repayments", "Loan repayments / Remboursements de prêt"),
    ("leave_impact", "Leave impact / Impact congés"),
]


# Human-readable labels for common Mauritius statutory codes. Falls back to
# the code itself if not in the dict.
_STATUTORY_LABELS = {
    "CSG_EE": "Contribution Sociale Généralisée (employee)",
    "CSG_ER": "Contribution Sociale Généralisée (employer)",
    "NSF_EE": "National Savings Fund (employee)",
    "NSF_ER": "National Savings Fund (employer)",
    "NPF_EE": "National Pensions Fund (employee)",
    "NPF_ER": "National Pensions Fund (employer)",
}


class PdfRenderUnavailable(Exception):
    """Raised when WeasyPrint or a system dep (libcairo / libpango) is
    missing, so callers can log + skip without bringing down finalize."""


def _format_money(value, currency: str = "MUR") -> str:
    if value is None:
        return ""
    try:
        d = Decimal(value)
    except Exception:  # pragma: no cover - defensive
        return str(value)
    # Print with thousands separators and exactly 2dp; currency is shown
    # separately in the layout so we omit it here.
    sign = "-" if d < 0 else ""
    abs_d = abs(d)
    formatted = f"{abs_d:,.2f}"
    return f"{sign}{formatted}"


def _format_signed(value, currency: str = "MUR") -> str:
    """Like _format_money but always shows an explicit +/− — used for the
    deltas on a correction note so a positive change reads as a gain."""
    try:
        d = Decimal(value) if value is not None else Decimal("0")
    except Exception:  # pragma: no cover - defensive
        return str(value)
    sign = "+" if d >= 0 else "−"
    return f"{sign}{abs(d):,.2f}"


def _build_context(
    *,
    payslip: Payslip,
    run: PayrollRun,
    employee: PrivateUser,
    company: Company,
    job: Optional[Job],
) -> dict:
    currency = run.currency or "MUR"
    components = payslip.components or []

    earnings = [
        {
            "code": c.get("code"),
            "label": c.get("label"),
            "kind": c.get("kind"),
            "category": c.get("category"),
            "is_basic": c.get("is_basic", False),
            "amount_str": _format_money(c.get("amount"), currency),
        }
        for c in components
        if c.get("kind") == "earning"
    ]
    deductions = [
        {
            "code": c.get("code"),
            "label": c.get("label"),
            "amount_str": _format_money(c.get("amount"), currency),
        }
        for c in components
        if c.get("kind") == "deduction"
    ]

    statutory_employee = sorted(
        ((k, _format_money(v, currency)) for k, v in (payslip.statutory_employee or {}).items()),
        key=lambda kv: kv[0],
    )
    statutory_employer = sorted(
        ((k, _format_money(v, currency)) for k, v in (payslip.statutory_employer or {}).items()),
        key=lambda kv: kv[0],
    )

    period_label_en = run.period_start.strftime("%B %Y")

    employee_name = f"{employee.first_name} {employee.last_name}".strip()

    return {
        "payslip": {
            "id": payslip.id,
        },
        "run": {
            "id": run.id,
            "currency": currency,
            "status": run.status,
            "finalized_at": run.finalized_at.strftime("%Y-%m-%d %H:%M UTC") if run.finalized_at else None,
        },
        "period": {
            "label_en": period_label_en,
            "start": run.period_start.isoformat(),
            "end": run.period_end.isoformat(),
        },
        "employee": {
            "name": employee_name or "—",
            "passport": employee.pass_port_number or "",
            "role": (job.job_title if job else "") or "",
            "employment_type": (employee.employment_type or "full_time").replace("_", " "),
            "fte": str(employee.fte) if employee.fte is not None else "1.000",
        },
        "employer": {
            "name": company.company_name or "",
            "brn": company.brn or "",
            "address": company.address or "",
        },
        "earnings": earnings,
        "deductions": deductions,
        # Per-type leave taken in the period (sick, annual, ...). Engine
        # populates this on draft creation via _compute_leave_summary.
        "leave_summary": payslip.leave_summary or [],
        "statutory_employee": statutory_employee,
        "statutory_employer": statutory_employer,
        "statutory_labels": _STATUTORY_LABELS,
        "totals": {
            "gross_str": _format_money(payslip.gross, currency),
            "paye_str": _format_money(payslip.paye, currency),
            "deductions_str": _format_money(payslip.deductions_total, currency),
            "net_pay_str": _format_money(payslip.net_pay, currency),
        },
        "generated_at": datetime.now(timezone.utc).strftime("%Y-%m-%d %H:%M UTC"),
        # hash_sha256 is set by the caller (jobs.payslip_pdf) after the
        # render so the document can include its own hash. Two-pass.
        "hash_sha256": None,
    }


def _build_correction_context(
    *,
    payslip: Payslip,
    run: PayrollRun,
    employee: PrivateUser,
    company: Company,
    job: Optional[Job],
    parent: Optional[Payslip],
    prior_delta_net: Decimal,
) -> dict:
    """Context for a correction note. Every money field on `payslip` is a
    signed delta vs the original; `parent` is the original payslip and
    `prior_delta_net` is the sum of net deltas from adjustments booked BEFORE
    this one (so the previous→new reconciliation stays correct when an
    employee's payslip is corrected more than once)."""
    currency = run.currency or "MUR"

    def _d(v) -> Decimal:
        try:
            return Decimal(v) if v is not None else Decimal("0")
        except Exception:
            return Decimal("0")

    # Itemized changes — only the money fields that actually moved, plus any
    # statutory deltas stored on the adjustment.
    deltas = []
    for field, label in _CORRECTION_DELTA_FIELDS:
        amt = _d(getattr(payslip, field, None))
        if amt != 0:
            deltas.append({"label": label, "amount_str": _format_signed(amt, currency), "positive": amt >= 0})
    for code, v in sorted((payslip.statutory_employee or {}).items()):
        amt = _d(v)
        if amt != 0:
            deltas.append({"label": f"{_STATUTORY_LABELS.get(code, code)}", "amount_str": _format_signed(amt, currency), "positive": amt >= 0})

    delta_net = _d(payslip.net_pay)
    parent_net = _d(parent.net_pay) if parent is not None else Decimal("0")
    before_net = parent_net + prior_delta_net  # effective net just before this correction
    after_net = before_net + delta_net

    return {
        "payslip": {"id": payslip.id},
        "original": {
            "id": parent.id if parent is not None else (payslip.parent_payslip_id or "—"),
        },
        "correction": {
            "reason": payslip.adjustment_reason or "",
            "issued_at": payslip.created_at.strftime("%Y-%m-%d %H:%M UTC") if payslip.created_at else None,
        },
        "run": {
            "id": run.id,
            "currency": currency,
            "status": run.status,
        },
        "period": {
            "label_en": run.period_start.strftime("%B %Y"),
            "start": run.period_start.isoformat(),
            "end": run.period_end.isoformat(),
        },
        "employee": {
            "name": f"{employee.first_name} {employee.last_name}".strip() or "—",
            "passport": employee.pass_port_number or "",
            "role": (job.job_title if job else "") or "",
        },
        "employer": {
            "name": company.company_name or "",
            "brn": company.brn or "",
            "address": company.address or "",
        },
        "deltas": deltas,
        "net": {
            "before_str": _format_money(before_net, currency),
            "delta_str": _format_signed(delta_net, currency),
            "delta_abs_str": _format_money(abs(delta_net), currency),
            "delta_positive": delta_net >= 0,
            "after_str": _format_money(after_net, currency),
        },
        "generated_at": datetime.now(timezone.utc).strftime("%Y-%m-%d %H:%M UTC"),
        "hash_sha256": None,
    }


def _resolve_template(country_code: str, *, is_adjustment: bool = False) -> Path:
    registry = _CORRECTION_TEMPLATE_REGISTRY if is_adjustment else _TEMPLATE_REGISTRY
    rel = registry.get(country_code, registry["MU"])
    return _TEMPLATES_DIR / rel


def render_pdf(
    db: Session,
    *,
    payslip: Payslip,
    run: Optional[PayrollRun] = None,
    employee: Optional[PrivateUser] = None,
    company: Optional[Company] = None,
    job: Optional[Job] = None,
) -> bytes:
    """Render `payslip` to PDF bytes. Resolves missing relations from `db`
    if the caller didn't preload them. Raises PdfRenderUnavailable if
    WeasyPrint or its native deps are missing."""
    try:
        from jinja2 import Environment, FileSystemLoader, select_autoescape
        from weasyprint import HTML
    except ImportError as e:  # pragma: no cover - environmental
        raise PdfRenderUnavailable(f"PDF renderer not available: {e}") from e
    except OSError as e:  # native libs missing on Linux/macOS hosts
        raise PdfRenderUnavailable(f"PDF native libs not available: {e}") from e

    if run is None:
        run = db.query(PayrollRun).filter(PayrollRun.id == payslip.payroll_run_id).one()
    if employee is None:
        employee = (
            db.query(PrivateUser)
            .filter(PrivateUser.private_user_id == payslip.private_user_id)
            .one()
        )
    if company is None:
        company = db.query(Company).filter(Company.company_id == run.company_id).one()
    if job is None and payslip.job_id is not None:
        job = db.query(Job).filter(Job.job_id == payslip.job_id).one_or_none()

    is_adjustment = bool(getattr(payslip, "is_adjustment", False))
    template_path = _resolve_template(company.country_code or "MU", is_adjustment=is_adjustment)
    if not template_path.exists():
        raise PdfRenderUnavailable(f"Template not found: {template_path}")

    env = Environment(
        loader=FileSystemLoader(str(template_path.parent)),
        autoescape=select_autoescape(["html", "xml"]),
    )
    template = env.get_template(template_path.name)

    if is_adjustment:
        parent = None
        if payslip.parent_payslip_id is not None:
            parent = db.query(Payslip).filter(Payslip.id == payslip.parent_payslip_id).one_or_none()
        # Sum of net deltas from adjustments booked before this one, so a
        # second correction's "previous net" reflects the first.
        prior_delta_net = Decimal("0")
        if parent is not None:
            for a in db.query(Payslip).filter(
                Payslip.parent_payslip_id == parent.id,
                Payslip.is_adjustment.is_(True),
                Payslip.id < payslip.id,
            ).all():
                try:
                    prior_delta_net += Decimal(a.net_pay or 0)
                except Exception:
                    pass
        context = _build_correction_context(
            payslip=payslip, run=run, employee=employee, company=company, job=job,
            parent=parent, prior_delta_net=prior_delta_net,
        )
    else:
        context = _build_context(
            payslip=payslip, run=run, employee=employee, company=company, job=job
        )

    # Two-pass render: first pass generates body bytes used to compute the
    # SHA-256, second pass embeds that hash into the document footer. The
    # hash is on the *first-pass* HTML (deterministic, reproducible) — the
    # second pass with the hash burned in is what we ship. Only the second
    # pass's bytes leave this function.
    first_pass_html = template.render(**context)
    body_hash = hashlib.sha256(first_pass_html.encode("utf-8")).hexdigest()
    context["hash_sha256"] = body_hash
    final_html = template.render(**context)

    pdf_bytes = HTML(
        string=final_html,
        base_url=str(template_path.parent),
    ).write_pdf()
    return pdf_bytes


def compute_pdf_hash(pdf_bytes: bytes) -> str:
    """SHA-256 over the PDF bytes themselves — independent of the body
    hash burned into the document. Used to populate `payslips.hash_sha256`
    so a downstream auditor can verify a stored PDF matches the database
    record byte-for-byte."""
    return hashlib.sha256(pdf_bytes).hexdigest()
