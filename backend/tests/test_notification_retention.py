"""Phase 4 — notification retention sweep (purge_old_notifications)."""
from __future__ import annotations

from datetime import datetime, timezone, timedelta


def _mk_user(db, suffix):
    from core.model import User
    u = User(
        user_type="private", email=f"ret-{suffix}@kontokaz.test",
        user_name=f"ret-{suffix}", password_hash="x",
    )
    db.add(u)
    db.commit()
    db.refresh(u)
    return u


def _event_with_recipient(db, user_id, *, is_read, age_days):
    from core.model import Notification, NotificationRecipient
    ts = datetime.now(timezone.utc) - timedelta(days=age_days)
    e = Notification(title="t", message="m", type="general", created_at=ts)
    db.add(e)
    db.flush()
    db.add(NotificationRecipient(
        notification_id=e.notification_id, user_id=user_id, is_read=is_read, created_at=ts,
    ))
    db.commit()
    return e


def test_purge_old_read_only(db):
    from core.model import Notification, NotificationRecipient
    from services.notification_service import NotificationService
    s = datetime.utcnow().strftime("%H%M%S%f")
    u = _mk_user(db, s)

    # Capture ids up front — the purge commits, which expires the ORM objects.
    old_read_id = _event_with_recipient(db, u.user_id, is_read=True, age_days=100).notification_id    # purged
    old_unread_id = _event_with_recipient(db, u.user_id, is_read=False, age_days=100).notification_id  # kept (unread)
    recent_read_id = _event_with_recipient(db, u.user_id, is_read=True, age_days=1).notification_id    # kept (recent)

    deleted = NotificationService.purge_old_notifications(db, days=90)
    assert deleted >= 1

    # Old + read: recipient gone, and the now-orphaned event gone too.
    assert db.query(NotificationRecipient).filter(
        NotificationRecipient.notification_id == old_read_id
    ).count() == 0
    assert db.query(Notification).filter(
        Notification.notification_id == old_read_id
    ).count() == 0

    # Old + unread: kept.
    assert db.query(NotificationRecipient).filter(
        NotificationRecipient.notification_id == old_unread_id
    ).count() == 1
    # Recent + read: kept.
    assert db.query(NotificationRecipient).filter(
        NotificationRecipient.notification_id == recent_read_id
    ).count() == 1
