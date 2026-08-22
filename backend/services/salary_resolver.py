"""Resolve an employee's salary components for a payroll period.

The single canonical entry point used by the (future) payroll engine, by
the bonus engine, and by the salary preview UI:

    resolved = resolve_components(db, private_user_id=123, period_start=date(2026, 5, 1))

Resolution algorithm:
  1. Find the EmployeeSalaryAssignment in force on `period_start`
     (effective_from <= period_start AND (effective_to IS NULL OR effective_to > period_start)).
  2. Read all SalaryStructureLine rows for the assignment's structure, with
     SalaryComponent metadata.
  3. Apply EmployeeSalaryOverride rows by component_id — overrides win.
  4. Components without an amount (formula-only — Phase 2) are skipped with
     a logged warning; MVP supports constants only.

Returns a ResolvedSalary populated with one ResolvedComponent per line.
"""

from __future__ import annotations

import logging
from datetime import date
from decimal import Decimal
from typing import Optional

from sqlalchemy import and_, desc, or_
from sqlalchemy.orm import Session, joinedload

from core.model import (
    EmployeeSalaryAssignment,
    EmployeeSalaryOverride,
    PrivateUser,
    SalaryComponent,
    SalaryStructure,
    SalaryStructureLine,
)
from schema.salary_structure_schema import ResolvedComponent, ResolvedSalary
from services import formula_evaluator


logger = logging.getLogger(__name__)


def infer_statutory_base_codes(
    *, kind: str, is_basic: bool, is_taxable: bool, explicit: Optional[list] = None
) -> list[str]:
    """Resolve a component's statutory_base_codes (M4).

    If `explicit` is set (non-empty), use it as-is. Otherwise infer:
      * deduction kind → []
      * is_basic       → ["PAYE","CSG_EE","CSG_ER","NSF_EE","NSF_ER"]
      * non-basic taxable → ["PAYE","CSG_EE","CSG_ER"] (no NSF — historically basic-only)
      * otherwise → []

    The inference is a best-effort fallback for components created before
    M4. New components written via the API or by the bonus engine should
    set explicit lists.
    """
    if explicit:
        return list(explicit)
    if kind != "earning":
        return []
    if is_basic:
        return ["PAYE", "CSG_EE", "CSG_ER", "NSF_EE", "NSF_ER"]
    if is_taxable:
        return ["PAYE", "CSG_EE", "CSG_ER"]
    return []


def build_structure_snapshot(
    db: Session, structure_id: int
) -> Optional[dict]:
    """Build a JSON-serializable snapshot of a structure for freezing on
    an assignment (M3).

    Format:
        {
            "structure_id": int,
            "structure_name": str,
            "snapshotted_at": ISO8601,
            "lines": [
                {
                    "component_id": int,
                    "code": str,
                    "label": str,
                    "kind": str,
                    "category": str,
                    "is_basic": bool,
                    "is_taxable": bool,
                    "is_recurring": bool,
                    "is_one_off": bool,
                    "prorate_on_partial_month": bool,
                    "amount": str | null,        # Decimal serialized as string
                    "formula_expression": str | null,
                    "order_index": int,
                },
                ...
            ]
        }

    Returns None if the structure has no lines (caller should still write
    a structure_id pointer; resolver will return [] in that case).
    """
    from datetime import datetime as _dt, timezone as _tz

    structure = (
        db.query(SalaryStructure)
        .filter(SalaryStructure.id == structure_id)
        .one_or_none()
    )
    if structure is None:
        return None

    lines = (
        db.query(SalaryStructureLine)
        .options(joinedload(SalaryStructureLine.component))
        .filter(SalaryStructureLine.structure_id == structure_id)
        .order_by(SalaryStructureLine.order_index, SalaryStructureLine.id)
        .all()
    )

    return {
        "structure_id": structure.id,
        "structure_name": structure.name,
        "snapshotted_at": _dt.now(_tz.utc).isoformat(),
        "lines": [
            {
                "component_id": line.component.id,
                "code": line.component.code,
                "label": line.component.label,
                "kind": line.component.kind,
                "category": line.component.category,
                "is_basic": bool(line.component.is_basic),
                "is_taxable": bool(line.component.is_taxable),
                "is_recurring": bool(line.component.is_recurring),
                "is_one_off": bool(line.component.is_one_off),
                "prorate_on_partial_month": bool(line.component.prorate_on_partial_month),
                "frequency": line.component.frequency,
                "value_type": line.component.value_type,
                "statutory_base_codes": list(line.component.statutory_base_codes or []),
                "amount": str(line.amount) if line.amount is not None else None,
                "formula_expression": line.formula_expression,
                "order_index": line.order_index,
            }
            for line in lines
        ],
    }


def get_active_assignment(
    db: Session, private_user_id: int, period_start: date
) -> Optional[EmployeeSalaryAssignment]:
    """The assignment in force on `period_start`, or None."""
    return (
        db.query(EmployeeSalaryAssignment)
        .filter(EmployeeSalaryAssignment.private_user_id == private_user_id)
        .filter(
            and_(
                EmployeeSalaryAssignment.effective_from <= period_start,
                or_(
                    EmployeeSalaryAssignment.effective_to.is_(None),
                    EmployeeSalaryAssignment.effective_to > period_start,
                ),
            )
        )
        .order_by(desc(EmployeeSalaryAssignment.effective_from))
        .first()
    )


def resolve_components(
    db: Session, private_user_id: int, period_start: date,
    period_end: Optional[date] = None,
) -> ResolvedSalary:
    """Resolve all salary components for an employee on a given date.

    If the employee has no active assignment, returns ResolvedSalary with an
    empty `components` list and `assignment_id=None`. Caller decides whether
    that's an error (e.g. payroll run) or expected (e.g. preview UI).

    When ``period_end`` is given (a payroll run), a mid-period JOINER whose
    assignment becomes effective AFTER period_start but within the period is
    resolved from that assignment — otherwise they'd be silently dropped from
    their joining month's run. Proration (Job.first_date_of_employment) then
    scales the pay to the days actually worked.
    """
    assignment = get_active_assignment(db, private_user_id, period_start)
    if assignment is None and period_end is not None:
        assignment = (
            db.query(EmployeeSalaryAssignment)
            .filter(EmployeeSalaryAssignment.private_user_id == private_user_id)
            .filter(EmployeeSalaryAssignment.effective_from > period_start)
            .filter(EmployeeSalaryAssignment.effective_from <= period_end)
            .filter(
                or_(
                    EmployeeSalaryAssignment.effective_to.is_(None),
                    EmployeeSalaryAssignment.effective_to > period_start,
                )
            )
            .order_by(EmployeeSalaryAssignment.effective_from.asc())
            .first()
        )
    if assignment is None:
        return ResolvedSalary(
            private_user_id=private_user_id,
            period_start=period_start,
            assignment_id=None,
            structure_id=None,
            currency="MUR",
            components=[],
        )

    snapshot = assignment.structure_snapshot
    has_snapshot = isinstance(snapshot, dict) and snapshot.get("lines")

    # NOTE: an assignment with structure_id=None and no snapshot (an
    # "overrides-only" assignment — see create_assignment's 422 check, which
    # requires at least one override in that case) falls through to the
    # `else` branch below, where the live-structure query naturally returns
    # no rows for a None structure_id. `effective` ends up `[]`, and the
    # override-merge step further down appends its overrides as new lines.
    # (Previously this short-circuited to an empty ResolvedSalary here,
    # before the overrides were ever read — silently dropping them.)

    # Build list of effective lines (denormalized representation that both
    # snapshot and live-structure paths produce). Each item is a dict with:
    #   component_id, code, label, kind, category, is_basic, is_taxable,
    #   amount, formula_expression, source
    if has_snapshot:
        # M3 path — read from the frozen JSONB. Live structure edits don't
        # retroactively change this assignment's resolved values.
        effective = [
            {
                "component_id": ln["component_id"],
                "code": ln["code"],
                "label": ln["label"],
                "kind": ln["kind"],
                "category": ln["category"],
                "is_basic": ln["is_basic"],
                "is_taxable": ln["is_taxable"],
                "prorate_on_partial_month": ln.get("prorate_on_partial_month", True),
                "frequency": ln.get("frequency", "monthly"),
                "value_type": ln.get("value_type", "amount"),
                "statutory_base_codes": infer_statutory_base_codes(
                    kind=ln["kind"],
                    is_basic=ln["is_basic"],
                    is_taxable=ln["is_taxable"],
                    explicit=ln.get("statutory_base_codes"),
                ),
                "amount": Decimal(ln["amount"]) if ln.get("amount") is not None else None,
                "formula_expression": ln.get("formula_expression"),
                "source": "structure",
            }
            for ln in snapshot.get("lines", [])
            if ln.get("amount") is not None or ln.get("formula_expression")
        ]
    else:
        # Legacy path — live structure read. Used for pre-M3 assignments
        # until the backfill script populates their snapshots.
        lines = (
            db.query(SalaryStructureLine)
            .options(joinedload(SalaryStructureLine.component))
            .filter(SalaryStructureLine.structure_id == assignment.structure_id)
            .order_by(SalaryStructureLine.order_index, SalaryStructureLine.id)
            .all()
        )
        effective = []
        for line in lines:
            c = line.component
            if line.amount is None and not line.formula_expression:
                continue
            effective.append({
                "component_id": c.id,
                "code": c.code,
                "label": c.label,
                "kind": c.kind,
                "category": c.category,
                "is_basic": bool(c.is_basic),
                "is_taxable": bool(c.is_taxable),
                "prorate_on_partial_month": bool(c.prorate_on_partial_month),
                "frequency": c.frequency,
                "value_type": c.value_type,
                "statutory_base_codes": infer_statutory_base_codes(
                    kind=c.kind,
                    is_basic=bool(c.is_basic),
                    is_taxable=bool(c.is_taxable),
                    explicit=list(c.statutory_base_codes or []),
                ),
                "amount": line.amount,
                "formula_expression": line.formula_expression,
                "source": "structure",
            })

    # Apply per-employee overrides (which still live in the live table — they
    # are applied on top of the snapshot or live structure equally).
    overrides = {
        ov.component_id: ov
        for ov in db.query(EmployeeSalaryOverride)
        .filter(EmployeeSalaryOverride.assignment_id == assignment.id)
        .all()
    }
    if overrides:
        matched_ids: set[int] = set()
        for line in effective:
            ov = overrides.get(line["component_id"])
            if ov is None:
                continue
            matched_ids.add(line["component_id"])
            if ov.amount is not None:
                line["amount"] = ov.amount
                line["formula_expression"] = None
                line["source"] = "override"
            elif ov.formula_expression:
                line["amount"] = None
                line["formula_expression"] = ov.formula_expression
                line["source"] = "override"

        # An override can also ADD a component that isn't on the employee's
        # base structure at all (e.g. a one-off allowance nobody else on
        # their structure has, or the whole "overrides-only" assignment
        # case above). Those never match a line in `effective`, so without
        # this they'd be silently dropped instead of paid.
        extra_ids = [cid for cid in overrides if cid not in matched_ids]
        if extra_ids:
            extra_components = (
                db.query(SalaryComponent)
                .filter(SalaryComponent.id.in_(extra_ids))
                .all()
            )
            for c in extra_components:
                ov = overrides[c.id]
                if ov.amount is None and not ov.formula_expression:
                    continue
                effective.append({
                    "component_id": c.id,
                    "code": c.code,
                    "label": c.label,
                    "kind": c.kind,
                    "category": c.category,
                    "is_basic": bool(c.is_basic),
                    "is_taxable": bool(c.is_taxable),
                    "prorate_on_partial_month": bool(c.prorate_on_partial_month),
                    "frequency": c.frequency,
                    "value_type": c.value_type,
                    "statutory_base_codes": infer_statutory_base_codes(
                        kind=c.kind,
                        is_basic=bool(c.is_basic),
                        is_taxable=bool(c.is_taxable),
                        explicit=list(c.statutory_base_codes or []),
                    ),
                    "amount": ov.amount,
                    "formula_expression": ov.formula_expression,
                    "source": "override",
                })

    # Build context for formula evaluation. period_days = days in the period_start month.
    import calendar as _calendar
    period_days = _calendar.monthrange(period_start.year, period_start.month)[1]
    context = {"period_days": Decimal(period_days)}

    items = [
        (line["code"], line["amount"], line["formula_expression"]) for line in effective
    ]

    try:
        values = formula_evaluator.evaluate_dag(items, context=context)
    except formula_evaluator.FormulaError as e:
        # Save-time validation (M1) should catch malformed formulas. This is a
        # defense-in-depth fallback for legacy data.
        logger.error("salary_resolver: formula evaluation failed: %s", e)
        values = {}

    # value_type='percent_of_basic' — resolve against the structure-defined
    # BASIC amount. NOTE: for pay_basis='daily'/'hourly' employees, BASIC is
    # replaced AFTER this by payroll_engine._apply_pay_basis, so a percent-of-
    # basic component there reflects the structure's BASIC, not the final
    # daily/hourly-computed one. Flagged as a known limitation, not silently
    # wrong — those pay bases don't typically carry percent-of-basic lines.
    basic_line = next((l for l in effective if l["is_basic"] and l["code"] in values), None)
    if basic_line is not None:
        basic_amount = values[basic_line["code"]]
        for line in effective:
            if line["is_basic"] or line.get("value_type") != "percent_of_basic":
                continue
            if line["code"] not in values:
                continue
            # Keep the raw percentage-points figure around (in `meta`) — the
            # UI edits/displays THIS, not the resolved rand amount, otherwise
            # re-saving an unchanged edit would silently overwrite the percent
            # with the last computed total.
            line["meta"] = {"value_type": "percent_of_basic", "percent": str(values[line["code"]])}
            values[line["code"]] = (values[line["code"]] * basic_amount / Decimal(100)).quantize(Decimal("0.01"))

    resolved: list[ResolvedComponent] = []
    for line in effective:
        if line["code"] not in values:
            continue
        resolved.append(
            ResolvedComponent(
                component_id=line["component_id"],
                code=line["code"],
                label=line["label"],
                kind=line["kind"],
                category=line["category"],
                amount=values[line["code"]],
                meta=line.get("meta"),
                is_taxable=line["is_taxable"],
                is_basic=line["is_basic"],
                source=line["source"],
                statutory_base_codes=line.get("statutory_base_codes", []),
                frequency=line.get("frequency", "monthly"),
                value_type=line.get("value_type", "amount"),
                prorate_on_partial_month=line.get("prorate_on_partial_month", True),
            )
        )

    return ResolvedSalary(
        private_user_id=private_user_id,
        period_start=period_start,
        assignment_id=assignment.id,
        structure_id=assignment.structure_id,
        currency=assignment.currency,
        components=resolved,
    )


def suggest_structure_for(
    db: Session, employee: PrivateUser
) -> Optional[SalaryStructure]:
    """Auto-pick the best-matching SalaryStructure for an employee (M2).

    Priority (most specific → least):
      1. exact triple match (dept + role + grade)
      2. dept + role
      3. dept + grade
      4. dept only
      5. role + grade
      6. grade only
      7. role only
      8. company default (is_default=true)
      9. None — caller decides whether to error or skip auto-assignment

    "Role" maps to `private_users.role` (e.g. 'employee', 'manager'). "Grade"
    is the FK to `sector_grades` set on the employee — currently inferred via
    the employee's department/sector chain only if explicitly assigned. For
    now, suggestion uses department + role (PrivateUser.role) and leaves
    grade resolution as None unless the caller passes it.

    Returns the matching SalaryStructure or None.
    """
    if employee.company_id is None:
        return None

    # Inputs we'll match against. Grade is hard to derive from the current
    # schema (no employee→grade FK), so we leave it None unless future code
    # extends PrivateUser. Department + role are available today.
    dept = employee.department_id
    role = employee.role
    grade = None  # placeholder for when employee→grade is wired (see Module 4)

    company_id = employee.company_id

    def _query(filters: dict):
        # Auto-suggest never resurrects archived structures.
        q = (
            db.query(SalaryStructure)
            .filter(SalaryStructure.company_id == company_id)
            .filter(SalaryStructure.archived_at.is_(None))
        )
        for col, val in filters.items():
            attr = getattr(SalaryStructure, col)
            if val is None:
                q = q.filter(attr.is_(None))
            else:
                q = q.filter(attr == val)
        return q.order_by(SalaryStructure.name).first()

    # 1. Exact triple
    if dept is not None and role is not None and grade is not None:
        hit = _query({
            "default_for_department_id": dept,
            "default_for_role": role,
            "default_for_sector_grade_id": grade,
        })
        if hit:
            return hit

    # 2. dept + role
    if dept is not None and role is not None:
        hit = _query({
            "default_for_department_id": dept,
            "default_for_role": role,
            "default_for_sector_grade_id": None,
        })
        if hit:
            return hit

    # 3. dept + grade
    if dept is not None and grade is not None:
        hit = _query({
            "default_for_department_id": dept,
            "default_for_role": None,
            "default_for_sector_grade_id": grade,
        })
        if hit:
            return hit

    # 4. dept only
    if dept is not None:
        hit = _query({
            "default_for_department_id": dept,
            "default_for_role": None,
            "default_for_sector_grade_id": None,
        })
        if hit:
            return hit

    # 5. role + grade
    if role is not None and grade is not None:
        hit = _query({
            "default_for_department_id": None,
            "default_for_role": role,
            "default_for_sector_grade_id": grade,
        })
        if hit:
            return hit

    # 6. grade only
    if grade is not None:
        hit = _query({
            "default_for_department_id": None,
            "default_for_role": None,
            "default_for_sector_grade_id": grade,
        })
        if hit:
            return hit

    # 7. role only
    if role is not None:
        hit = _query({
            "default_for_department_id": None,
            "default_for_role": role,
            "default_for_sector_grade_id": None,
        })
        if hit:
            return hit

    # 8. Company default
    return (
        db.query(SalaryStructure)
        .filter(
            SalaryStructure.company_id == company_id,
            SalaryStructure.is_default.is_(True),
        )
        .first()
    )


def gross_earnings(resolved: ResolvedSalary) -> Decimal:
    """Sum of all 'earning' kind components."""
    return sum(
        (c.amount for c in resolved.components if c.kind == "earning"),
        Decimal("0.00"),
    )


def basic_amount(resolved: ResolvedSalary) -> Decimal:
    """The basic component's amount, or 0 if none flagged is_basic."""
    for c in resolved.components:
        if c.is_basic:
            return c.amount
    return Decimal("0.00")
