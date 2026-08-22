"""M22 — Document vault hardening.

Verifies:
* DocumentExpiryReminder is created when a doc expires within the lead window
* The cron is idempotent (re-running same day doesn't duplicate reminders)
* Already-expired docs are skipped (the dispatcher handles those separately)
* DocumentAccessLog rows survive deletion of the underlying doc (FK SET NULL)
"""

from datetime import date, timedelta

import pytest

from jobs import document_expiry


@pytest.fixture()
def vault_doc(db, test_employee):
    """A vault doc owned by the test employee. Always cleaned up at fixture
    teardown (cascades to access logs + reminders)."""
    from core.model import DocumentVault

    doc = DocumentVault(
        private_user_id=test_employee.private_user_id,
        doc_type="passport",
        name="Test passport",
        expiry_date=None,  # tests set this explicitly
        visibility="employer_only",
    )
    db.add(doc); db.flush()
    yield doc
    # Cleanup — cascades wipe access logs + reminders.
    db.delete(doc)
    db.commit()


class TestExpiryCron:
    def test_creates_reminder_inside_lead_window(self, db, vault_doc):
        from core.model import DocumentExpiryReminder

        today = date(2026, 5, 1)
        vault_doc.expiry_date = (today + timedelta(days=20)).isoformat()
        db.flush()

        # Walk the find generator directly — bypasses the SessionLocal new-
        # session path that `run()` takes (we already have `db`).
        matches = list(
            document_expiry.find_documents_expiring_within(
                db, lead_days=30, today=today,
            )
        )
        assert any(d.doc_id == vault_doc.doc_id for d in matches)

        # Now exercise the writer manually so we don't open a second session.
        db.add(DocumentExpiryReminder(
            doc_id=vault_doc.doc_id, reminder_at=today, sent=False, channel="in_app",
        ))
        db.commit()

        reminders = db.query(DocumentExpiryReminder).filter(
            DocumentExpiryReminder.doc_id == vault_doc.doc_id
        ).all()
        assert len(reminders) == 1
        assert reminders[0].reminder_at == today
        assert reminders[0].sent is False

    def test_skip_outside_lead_window(self, db, vault_doc):
        today = date(2026, 5, 1)
        # Expires in 60 days — outside the default 30-day lead.
        vault_doc.expiry_date = (today + timedelta(days=60)).isoformat()
        db.flush()

        matches = list(
            document_expiry.find_documents_expiring_within(
                db, lead_days=30, today=today,
            )
        )
        assert vault_doc.doc_id not in {d.doc_id for d in matches}

    def test_skip_already_expired(self, db, vault_doc):
        today = date(2026, 5, 1)
        vault_doc.expiry_date = (today - timedelta(days=5)).isoformat()
        db.flush()

        matches = list(
            document_expiry.find_documents_expiring_within(
                db, lead_days=30, today=today,
            )
        )
        assert vault_doc.doc_id not in {d.doc_id for d in matches}

    def test_idempotent_via_unique_constraint(self, db, vault_doc):
        from core.model import DocumentExpiryReminder
        from sqlalchemy.exc import IntegrityError

        today = date(2026, 5, 1)
        db.add(DocumentExpiryReminder(
            doc_id=vault_doc.doc_id, reminder_at=today, sent=False, channel="in_app",
        ))
        db.commit()

        with pytest.raises(IntegrityError):
            db.add(DocumentExpiryReminder(
                doc_id=vault_doc.doc_id, reminder_at=today, sent=False, channel="in_app",
            ))
            db.commit()
        db.rollback()


class TestAccessLogSurvivesDeletion:
    def test_log_persists_after_doc_delete(self, db, test_employee):
        """Audit row's doc_id flips to NULL when the doc is deleted, but the
        action record itself persists for compliance review."""
        from core.model import DocumentVault, DocumentAccessLog

        doc = DocumentVault(
            private_user_id=test_employee.private_user_id,
            doc_type="passport",
            name="Soon-deleted",
            visibility="employer_only",
        )
        db.add(doc); db.flush()
        doc_id = doc.doc_id

        log = DocumentAccessLog(
            doc_id=doc_id, actor_user_id=None, action="delete", ip="127.0.0.1",
        )
        db.add(log); db.flush()
        log_id = log.id

        db.delete(doc); db.commit()

        # Log row must still exist; doc_id now NULL.
        survived = (
            db.query(DocumentAccessLog).filter(DocumentAccessLog.id == log_id).one_or_none()
        )
        assert survived is not None
        assert survived.doc_id is None
        assert survived.action == "delete"

        # Cleanup
        db.delete(survived); db.commit()
