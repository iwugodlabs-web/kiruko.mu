"""Per-company feature entitlements ("modules").

A module is an opt-in paid capability that a platform admin switches on for
one company at a time, e.g. Field Sales & Commissions. Paid modules default to
OFF: a company has the module only if an explicit `company_modules` row says
`enabled=true`. This is the single source of truth used by:

  - `require_module(...)` (FastAPI dependency gate on the module's routes)
  - `GET /companies/{id}/modules` (lets the web/mobile clients hide the UI)
  - the platform-admin employer detail toggle

Add a new paid module by adding one entry to `MODULES`; nothing else needs to
change to make it toggleable.
"""

from __future__ import annotations

from datetime import datetime, timezone
from typing import Any, Dict, List, Optional

from sqlalchemy.orm import Session


MODULES: Dict[str, Dict[str, Any]] = {
    "field_sales": {
        "label": "Field Sales & Commissions",
        "description": (
            "Field catalog, sales capture, commission plans, and commission "
            "payroll runs."
        ),
        # Paid module: off unless a company_modules row turns it on.
        "default_enabled": False,
    },
}


def known_modules() -> List[str]:
    return list(MODULES.keys())


def is_known_module(module_key: str) -> bool:
    return module_key in MODULES


def is_module_enabled(db: Session, company_id: int, module_key: str) -> bool:
    """True when `module_key` is active for `company_id`.

    Unknown keys are always False so a typo can't silently grant a feature.
    A missing row falls back to the registry default (False for paid modules).
    """
    from core.model import CompanyModule

    if module_key not in MODULES:
        return False
    row = (
        db.query(CompanyModule)
        .filter(
            CompanyModule.company_id == company_id,
            CompanyModule.module_key == module_key,
        )
        .one_or_none()
    )
    if row is None:
        return bool(MODULES[module_key].get("default_enabled", False))
    return bool(row.enabled)


def list_company_modules(db: Session, company_id: int) -> List[Dict[str, Any]]:
    """Every registered module with this company's resolved state."""
    from core.model import CompanyModule

    rows = {
        r.module_key: r
        for r in db.query(CompanyModule)
        .filter(CompanyModule.company_id == company_id)
        .all()
    }
    out: List[Dict[str, Any]] = []
    for key, meta in MODULES.items():
        row = rows.get(key)
        enabled = bool(row.enabled) if row else bool(meta.get("default_enabled", False))
        out.append(
            {
                "module_key": key,
                "label": meta["label"],
                "description": meta["description"],
                "enabled": enabled,
                "enabled_at": row.enabled_at.isoformat()
                if row and row.enabled_at
                else None,
            }
        )
    return out


def set_company_module(
    db: Session,
    *,
    company_id: int,
    module_key: str,
    enabled: bool,
    actor_user_id: Optional[int],
) -> "Any":
    """Flip a module on/off for one company. Idempotent. Returns the row.

    Raises `KeyError` for an unknown module_key so callers can 400 cleanly.
    """
    from core.model import CompanyModule

    if module_key not in MODULES:
        raise KeyError(module_key)

    row = (
        db.query(CompanyModule)
        .filter(
            CompanyModule.company_id == company_id,
            CompanyModule.module_key == module_key,
        )
        .one_or_none()
    )
    now = datetime.now(timezone.utc)
    if row is None:
        row = CompanyModule(
            company_id=company_id,
            module_key=module_key,
            enabled=enabled,
            changed_by_user_id=actor_user_id,
            enabled_at=now if enabled else None,
            disabled_at=None if enabled else now,
        )
        db.add(row)
    else:
        if enabled and not row.enabled:
            row.enabled_at = now
        if not enabled and row.enabled:
            row.disabled_at = now
        row.enabled = enabled
        row.changed_by_user_id = actor_user_id
    db.flush()
    return row
