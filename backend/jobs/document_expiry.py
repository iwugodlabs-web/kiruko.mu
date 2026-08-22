"""Daily document-expiry reminder cron (M22).

Scans `document_vault` for documents whose `expiry_date` falls within
the configured lead window (default 30 days) and creates one
DocumentExpiryReminder per (doc, today) — idempotent via the unique
constraint on (doc_id, reminder_at).

Designed to run once per day. Notification dispatch (push, email) is
intentionally OUT OF scope here — this job creates the *intent*; a
separate dispatcher reads `sent=false` rows and emits to the channel.
That split keeps the cron deterministic + lets ops re-trigger
dispatch independently if a delivery system has a hiccup.

Run from the command line:

    python -m jobs.document_expiry              # default 30-day window
    python -m jobs.document_expiry 60           # custom 60-day window
"""

from __future__ import annotations

import logging
import sys
from datetime import date
from typing import Iterable

from sqlalchemy.orm import Session

from core import config
from core.model import DocumentExpiryReminder, DocumentVault


logger = logging.getLogger(__name__)


def _parse_expiry(value: str | None) -> date | None:
    """document_vault.expiry_date is a YYYY-MM-DD string. Be lenient on
    null/blank/garbage rather than crashing the whole cron."""
    if not value:
        return None
    try:
        return date.fromisoformat(value.strip()[:10])
    except (ValueError, AttributeError):
        return None


def find_documents_expiring_within(
    db: Session, *, lead_days: int = 30, today: date | None = None
) -> Iterable[DocumentVault]:
    """Yield vault rows whose expiry_date falls in (today, today+lead_days].

    Already-expired docs (expiry < today) are skipped — they should have
    been flagged in a prior run and don't need a fresh reminder. The
    dispatcher can surface them separately if needed.
    """
    today = today or date.today()
    horizon = date.fromordinal(today.toordinal() + lead_days)

    docs = db.query(DocumentVault).filter(DocumentVault.expiry_date.isnot(None)).all()
    for d in docs:
        exp = _parse_expiry(d.expiry_date)
        if exp is None:
            continue
        if today <= exp <= horizon:
            yield d


def run(lead_days: int = 30, today: date | None = None) -> dict:
    """Create one DocumentExpiryReminder per matching doc. Returns counts.

    Idempotent: a reminder for (doc_id, today) that already exists is
    silently skipped (the UNIQUE constraint catches the duplicate).
    """
    SessionLocal = config.get_session_local()
    if SessionLocal is None:
        raise RuntimeError("No DB session available — check POSTGRES_* env vars")

    today = today or date.today()
    db: Session = SessionLocal()
    created = 0
    skipped = 0
    failed = 0
    try:
        for doc in find_documents_expiring_within(db, lead_days=lead_days, today=today):
            existing = (
                db.query(DocumentExpiryReminder)
                .filter(
                    DocumentExpiryReminder.doc_id == doc.doc_id,
                    DocumentExpiryReminder.reminder_at == today,
                )
                .one_or_none()
            )
            if existing is not None:
                skipped += 1
                continue
            try:
                db.add(DocumentExpiryReminder(
                    doc_id=doc.doc_id,
                    reminder_at=today,
                    sent=False,
                    channel="in_app",
                ))
                db.flush()
                created += 1
            except Exception as e:  # noqa: BLE001
                db.rollback()
                failed += 1
                logger.warning(
                    "document_expiry: failed to create reminder for doc %s: %s",
                    doc.doc_id, e,
                )
        db.commit()
        return {
            "today": today.isoformat(),
            "lead_days": lead_days,
            "created": created,
            "skipped": skipped,
            "failed": failed,
        }
    finally:
        db.close()


if __name__ == "__main__":
    logging.basicConfig(level=logging.INFO, format="%(asctime)s %(levelname)s %(name)s — %(message)s")
    args = sys.argv[1:]
    lead = 30
    if len(args) == 1:
        lead = int(args[0])
    elif len(args) > 1:
        print("Usage: python -m jobs.document_expiry [LEAD_DAYS]", file=sys.stderr)
        sys.exit(2)

    import json
    print(json.dumps(run(lead_days=lead), indent=2))
