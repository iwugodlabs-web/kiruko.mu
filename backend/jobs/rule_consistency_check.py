"""Daily consistency check for the country payroll rules engine.

Verifies the temporal invariants that supersede() relies on:

  1. No two active rows for the same rule key at the same time
     (overlapping effective_from/effective_to ranges).
  2. Every closed row (effective_to IS NOT NULL) has a superseded_by_id.
  3. Every superseded_by_id points to a real row that has the next-higher
     version for the same rule key.
  4. Version numbers per rule key are dense (1, 2, 3, ...) with no gaps.

The DB-level trigger forbid_rule_mutation already prevents ad-hoc UPDATEs
to protected columns, so violations here would imply a bug in supersede()
itself or out-of-band INSERTs. Findings are logged to audit_logs as
'payroll_rule.consistency_violation' so ops can alert on them.

Run from backend/:
    .venv/bin/python -m jobs.rule_consistency_check
Or schedule via cron / k8s CronJob daily.
"""

from __future__ import annotations

from dataclasses import dataclass, field
from typing import Any, Dict, List, Tuple, Type

from sqlalchemy import asc
from sqlalchemy.orm import Session

from core.config import get_db
from core.model import (
    AuditLog,
    CountryBonusRule,
    CountryLeaveDefault,
    StatutoryDeduction,
    TaxBracketSet,
)


# (Model, columns that together identify a single "rule key" — the version chain group)
RULE_GROUPS: List[Tuple[Type[Any], Tuple[str, ...]]] = [
    (TaxBracketSet, ("country_code", "fiscal_year")),
    (StatutoryDeduction, ("country_code", "code")),
    (CountryLeaveDefault, ("country_code", "leave_type_code")),
    (CountryBonusRule, ("country_code", "bonus_code")),
]


@dataclass
class CheckReport:
    table: str
    rule_key: Dict[str, Any]
    violations: List[str] = field(default_factory=list)


def _check_chain(rows: List[Any], table: str, rule_key: Dict[str, Any]) -> CheckReport:
    """Validate one version chain (rows already sorted by version ASC)."""
    rep = CheckReport(table=table, rule_key=rule_key)

    # Versions dense 1..N
    expected = list(range(1, len(rows) + 1))
    actual = [r.version for r in rows]
    if actual != expected:
        rep.violations.append(f"version sequence not dense: expected {expected}, got {actual}")

    for i, row in enumerate(rows):
        is_last = i == len(rows) - 1

        # 1. Closed-row invariants
        if not is_last:
            if row.effective_to is None:
                rep.violations.append(
                    f"row id={row.id} v{row.version} is non-terminal but effective_to IS NULL"
                )
            if row.superseded_by_id is None:
                rep.violations.append(
                    f"row id={row.id} v{row.version} is non-terminal but superseded_by_id IS NULL"
                )
            else:
                successor = rows[i + 1]
                if row.superseded_by_id != successor.id:
                    rep.violations.append(
                        f"row id={row.id} v{row.version} superseded_by_id={row.superseded_by_id} "
                        f"does not point at next-version row id={successor.id}"
                    )
        else:
            # Active (latest) row: must be open.
            if row.effective_to is not None:
                rep.violations.append(
                    f"row id={row.id} v{row.version} is the highest version but effective_to is set"
                )
            if row.superseded_by_id is not None:
                rep.violations.append(
                    f"row id={row.id} v{row.version} is the highest version but superseded_by_id is set"
                )

        # 2. Range adjacency: row[i].effective_to == row[i+1].effective_from
        if not is_last:
            successor = rows[i + 1]
            if row.effective_to != successor.effective_from:
                rep.violations.append(
                    f"gap or overlap between v{row.version} and v{successor.version}: "
                    f"v{row.version}.effective_to={row.effective_to} vs "
                    f"v{successor.version}.effective_from={successor.effective_from}"
                )

    return rep


def run(db: Session, *, write_audit: bool = True) -> List[CheckReport]:
    """Walk every rule chain in every versioned table and return reports.

    `write_audit=True` writes one audit_log row per chain that has any
    violations, with the full violation list in meta.
    """
    all_reports: List[CheckReport] = []

    for model, key_cols in RULE_GROUPS:
        # Group all rows by rule key.
        rows = db.query(model).order_by(asc(model.version)).all()
        chains: Dict[Tuple[Any, ...], List[Any]] = {}
        for r in rows:
            key = tuple(getattr(r, c) for c in key_cols)
            chains.setdefault(key, []).append(r)

        for key, chain in chains.items():
            rule_key_dict = dict(zip(key_cols, key))
            chain.sort(key=lambda r: r.version)
            rep = _check_chain(chain, model.__tablename__, rule_key_dict)
            all_reports.append(rep)

            if rep.violations and write_audit:
                db.add(
                    AuditLog(
                        actor_user_id=None,
                        action="payroll_rule.consistency_violation",
                        target_type=model.__tablename__,
                        target_id=None,
                        meta={"rule_key": rule_key_dict, "violations": rep.violations},
                    )
                )

    if write_audit:
        db.commit()

    return all_reports


def main() -> None:
    db: Session = next(get_db())
    try:
        reports = run(db)
        bad = [r for r in reports if r.violations]
        ok = len(reports) - len(bad)
        print(f"Checked {len(reports)} rule chain(s): {ok} clean, {len(bad)} with violations.")
        for r in bad:
            print(f"  ⚠ {r.table} {r.rule_key}")
            for v in r.violations:
                print(f"      - {v}")
        if bad:
            raise SystemExit(1)
    finally:
        db.close()


if __name__ == "__main__":
    main()
