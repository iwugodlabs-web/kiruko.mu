"""
Audit log CRUD operations
"""
import json
from sqlalchemy.orm import Session
from sqlalchemy import desc, text
from typing import Any, List, Optional, Union
import logging

logger = logging.getLogger(__name__)


def _serialize_meta(details: Any) -> Optional[str]:
    """Normalize the caller's `details` into a valid JSON string for the
    `audit_logs.meta` JSONB column.

    - None        → None (stored as SQL NULL)
    - dict / list → json.dumps(...)
    - str         → if already valid JSON, used as-is; otherwise wrapped as
                    {"detail": "<string>"} so plain free-text breadcrumbs
                    still satisfy the JSONB type.
    - other       → wrapped as {"detail": str(value)}
    """
    if details is None:
        return None
    if isinstance(details, (dict, list)):
        return json.dumps(details, default=str)
    if isinstance(details, str):
        try:
            json.loads(details)
            return details  # caller already supplied valid JSON
        except (ValueError, TypeError):
            return json.dumps({"detail": details})
    return json.dumps({"detail": str(details)}, default=str)


def get_recent_audit_logs(db: Session, limit: int = 10) -> List[dict]:
    """Return recent audit log entries, newest first."""
    result = db.execute(
        text("""
        SELECT id, actor_user_id, action, target_type, target_id, meta, created_at
        FROM audit_logs
        ORDER BY created_at DESC
        LIMIT :limit
        """),
        {"limit": limit},
    )

    logs = []
    for row in result:
        logs.append({
            "id": row[0],
            "user_id": row[1],
            "action": row[2],
            "resource_type": row[3],
            "resource_id": row[4],
            "details": row[5],
            "created_at": row[6].isoformat() if row[6] else None,
        })
    return logs


def create_audit_log(
    db: Session,
    user_id: int,
    action: str,
    resource_type: str,
    resource_id: Optional[int] = None,
    details: Optional[Union[str, dict, list]] = None,
    commit: bool = True,
) -> bool:
    """Insert an audit log row.

    `details` may be a dict, list, JSON-encoded string, or plain string —
    `_serialize_meta` normalizes to a valid JSON literal for the JSONB
    column. Pass `commit=False` from inside a transactional handler so the
    audit row flushes atomically with the destructive action it records
    (plan F2).

    What to audit (allow-list — keep this tight):
      • Any DELETE (force or not) on legal/compliance entities
        (sectors, categories, grades, salary rows, payslips, payroll runs).
      • Any append-only insert (e.g. sector.salary.append) and any void
        (sector.salary.void) — the *reason* is the load-bearing field.
      • Any UPDATE that mutates a legal/compliance column (rate, currency,
        country_code, payroll_run.status, leave.status).
      • Platform-admin role grants / revokes, invites, password resets.
      • Payroll run finalize / reopen, leave approval / rejection.

    What NOT to audit (use `request_logs` or skip entirely):
      • Reads / list endpoints.
      • Validation-failure 4xx responses.
      • Login successes (covered by `request_logs`).
      • Idempotent UPDATEs that changed nothing (compute the diff first; if
        empty, do not call this helper).

    DB-layer guard: `audit_logs` carries BEFORE UPDATE / BEFORE DELETE
    triggers that reject mutation entirely (`reject_audit_log_mutation`).
    A legitimate retention job must `ALTER TABLE audit_logs DISABLE TRIGGER`
    first — that DDL is itself an auditable event.
    """
    db.execute(
        text("""
        INSERT INTO audit_logs (actor_user_id, action, target_type, target_id, meta, created_at)
        VALUES (:actor_user_id, :action, :target_type, :target_id, CAST(:meta AS JSONB), NOW())
        """),
        {
            "actor_user_id": user_id,
            "action": action,
            "target_type": resource_type,
            "target_id": str(resource_id) if resource_id else None,
            "meta": _serialize_meta(details),
        },
    )
    if commit:
        db.commit()
    return True
