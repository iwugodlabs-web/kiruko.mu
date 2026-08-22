"""Append-only audit log for the Concerns subsystem.

Every concern endpoint MUST call `log()` for both reads and writes. Reads
write `action='viewed'`; mutations write the specific action (`status_changed`,
`note_added`, `escalated`, etc.) with structured details.

The `concern_audit_log` table is partitioned by month (PostgreSQL native
PARTITION BY RANGE on created_at) — see Migration 1.A. The partitioning is
transparent to this service; INSERTs route to the right partition automatically.

Failure mode: audit writes use a nested try so they NEVER block the main
request. A failed audit log is bad (we've lost a forensic record) but a 500
returned to the user because audit logging blew up is worse. Failures are
logged at WARNING; if they spike, the monitoring alert fires.
"""

from __future__ import annotations

import logging
from typing import Any, Mapping, Optional

from sqlalchemy.orm import Session

from core.concern_states import ActorKind
from core.model import ConcernAuditLog

logger = logging.getLogger(__name__)


# Canonical action names. Free-form strings would drift; keep them centralised.
ACTION_VIEWED = "viewed"
ACTION_CREATED = "created"
ACTION_STATUS_CHANGED = "status_changed"
ACTION_NOTE_ADDED = "note_added"
ACTION_MESSAGE_SENT = "message_sent"
ACTION_ESCALATED = "escalated"
ACTION_CLOSED = "closed"
ACTION_PURGED = "purged"
ACTION_EXPORTED = "exported"
ACTION_PORTAL_LOOKUP = "portal_lookup"
ACTION_TRIAGE_DISMISSED = "triage_dismissed"


def log(
    db: Session,
    right_id: int,
    actor_kind: str,
    action: str,
    actor_user_id: Optional[int] = None,
    details: Optional[Mapping[str, Any]] = None,
    ip: Optional[str] = None,
    commit: bool = True,
) -> None:
    """Write one audit row. Best-effort; swallows errors with a warning.

    `commit=False` is the right choice when the caller is inside a transaction
    that will commit the main mutation; the audit row joins that transaction.
    Default is True so ad-hoc callers don't have to remember.
    """
    try:
        if actor_kind not in {a.value for a in ActorKind}:
            # Don't reject — audit logging must not block — but flag it loudly
            # so the offending caller gets fixed.
            logger.warning(
                "concern_audit.log: unknown actor_kind=%r for right_id=%s action=%s; "
                "writing anyway",
                actor_kind, right_id, action,
            )

        row = ConcernAuditLog(
            right_id=right_id,
            actor_user_id=actor_user_id,
            actor_kind=actor_kind,
            action=action,
            details=dict(details) if details is not None else None,
            ip=ip,
        )
        db.add(row)
        if commit:
            db.commit()
    except Exception as e:  # noqa: BLE001
        # Best-effort. Roll back the half-added audit row so the session is
        # usable for whatever the caller does next, then swallow.
        try:
            db.rollback()
        except Exception:
            pass
        logger.warning(
            "concern_audit.log failed (non-fatal) right_id=%s action=%s: %s",
            right_id, action, e,
        )
