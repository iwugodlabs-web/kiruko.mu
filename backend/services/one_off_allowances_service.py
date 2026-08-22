"""Service for ad-hoc one-off payslip line items.

The payroll_engine consumes `list_pending_for_period()` during draft creation
to fold one-offs into the resolved component list, and calls
`stamp_applied()` during finalize so a row can't be paid twice.
"""

from __future__ import annotations

from decimal import Decimal
from typing import List

from sqlalchemy.orm import Session, joinedload

from core.model import EmployeeOneOffAllowance, SalaryComponent
from services.salary_resolver import ResolvedComponent


ADDITIONAL_DUTY_CODE = "ADDITIONAL_DUTY"
AD_HOC_DEDUCTION_CODE = "AD_HOC_DEDUCTION"


def ensure_additional_duty_component(db: Session, company_id: int) -> SalaryComponent:
    """#18 — return the company's canonical "Additional duty" earning component,
    creating it on first use. Additional remuneration for additional duty is
    taxable income (subject to NPF/CSG/PAYE) and sits on top of basic, never
    inside it — so the component is is_taxable=True, is_basic=False, is_one_off.

    Idempotent: keyed on (company_id, ADDITIONAL_DUTY_CODE). Caller flushes/commits.
    """
    existing = (
        db.query(SalaryComponent)
        .filter(
            SalaryComponent.company_id == company_id,
            SalaryComponent.code == ADDITIONAL_DUTY_CODE,
        )
        .one_or_none()
    )
    if existing is not None:
        return existing
    comp = SalaryComponent(
        company_id=company_id,
        code=ADDITIONAL_DUTY_CODE,
        label="Additional duty",
        kind="earning",
        category="earning.additional_duty",
        is_basic=False,
        is_taxable=True,
        is_recurring=False,
        is_one_off=True,
    )
    db.add(comp)
    db.flush()
    return comp


def ensure_ad_hoc_deduction_component(db: Session, company_id: int) -> SalaryComponent:
    """Mirrors ensure_additional_duty_component for the deduction side: return
    the company's canonical "Ad-hoc deduction" component, creating it on first
    use, so admins can dock a specific employee's pay for a one-time reason
    (damaged equipment, till shortfall, etc.) without first defining a
    deduction component in the company's salary-structure catalog. The
    required `notes` on each grant is what makes an individual line legible —
    the component itself stays generic on purpose.

    Idempotent: keyed on (company_id, AD_HOC_DEDUCTION_CODE). Caller flushes/commits.
    """
    existing = (
        db.query(SalaryComponent)
        .filter(
            SalaryComponent.company_id == company_id,
            SalaryComponent.code == AD_HOC_DEDUCTION_CODE,
        )
        .one_or_none()
    )
    if existing is not None:
        return existing
    comp = SalaryComponent(
        company_id=company_id,
        code=AD_HOC_DEDUCTION_CODE,
        label="Ad-hoc deduction",
        kind="deduction",
        category="deduction.ad_hoc",
        is_basic=False,
        is_taxable=False,
        is_recurring=False,
        is_one_off=True,
    )
    db.add(comp)
    db.flush()
    return comp


def list_pending_for_period(
    db: Session,
    private_user_id: int,
    year: int,
    month: int,
) -> List[EmployeeOneOffAllowance]:
    """One-offs scheduled for (year, month) that have not yet been stamped
    onto a payslip."""
    return (
        db.query(EmployeeOneOffAllowance)
        .options(joinedload(EmployeeOneOffAllowance.component))
        .filter(
            EmployeeOneOffAllowance.private_user_id == private_user_id,
            EmployeeOneOffAllowance.payable_in_year == year,
            EmployeeOneOffAllowance.payable_in_month == month,
            EmployeeOneOffAllowance.applied_to_payslip_id.is_(None),
        )
        .order_by(EmployeeOneOffAllowance.id)
        .all()
    )


def to_resolved_components(
    one_offs: List[EmployeeOneOffAllowance],
) -> List[ResolvedComponent]:
    """Convert one-off rows into ResolvedComponent so they fold cleanly into
    the engine alongside structure components.

    The `source` field is set to 'one_off' so the engine can distinguish them
    in audit / payslip line items.
    """
    from services.salary_resolver import infer_statutory_base_codes

    out: List[ResolvedComponent] = []
    for o in one_offs:
        c: SalaryComponent = o.component
        out.append(
            ResolvedComponent(
                component_id=c.id,
                code=c.code,
                label=c.label,
                kind=c.kind,
                category=c.category,
                amount=Decimal(o.amount),
                is_taxable=c.is_taxable,
                is_basic=False,  # one-offs are never the basic salary
                source="one_off",
                # M4: pick up the component's explicit list, with inference
                # fallback for legacy components that don't have one set.
                statutory_base_codes=infer_statutory_base_codes(
                    kind=c.kind,
                    is_basic=False,
                    is_taxable=c.is_taxable,
                    explicit=list(c.statutory_base_codes or []),
                ),
            )
        )
    return out


def stamp_applied(
    db: Session, one_offs: List[EmployeeOneOffAllowance], payslip_id: int
) -> None:
    """Mark each one-off as applied to a finalized payslip so it can't be
    picked up again. Caller commits."""
    for o in one_offs:
        o.applied_to_payslip_id = payslip_id
    db.flush()
