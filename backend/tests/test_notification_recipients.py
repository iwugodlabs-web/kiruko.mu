"""Phase 1a — normalized notification model (event + notification_recipients).

Verifies: one event + N recipient rows (deduped), per-user read-state isolation,
and that the wire shape is preserved (incl. meta.timelog_id and per-caller
is_read) so web + mobile need no changes.
"""
from __future__ import annotations

from datetime import datetime


def _mk_user(db, suffix):
    from core.model import User
    u = User(
        user_type="private", email=f"notif-{suffix}@kontokaz.test",
        user_name=f"notif-{suffix}", password_hash="x",
    )
    db.add(u)
    db.commit()
    db.refresh(u)
    return u


def test_create_notification_one_event_one_recipient(db):
    from core.model import NotificationRecipient
    from services.notification_service import NotificationService
    u = _mk_user(db, datetime.utcnow().strftime("%H%M%S%f"))
    event = NotificationService.create_notification(db, u.user_id, "T", "M", "test_type", meta={"x": 1})
    assert event is not None
    assert event.user_id is None  # event row no longer carries a single recipient
    recips = db.query(NotificationRecipient).filter(
        NotificationRecipient.notification_id == event.notification_id
    ).all()
    assert len(recips) == 1
    assert recips[0].user_id == u.user_id
    assert recips[0].is_read is False


def test_fanout_one_event_many_recipients_deduped(db):
    from core.model import NotificationRecipient
    from services.notification_service import NotificationService
    s = datetime.utcnow().strftime("%H%M%S%f")
    a, b = _mk_user(db, f"a{s}"), _mk_user(db, f"b{s}")
    # Duplicate + None must be dropped → exactly two recipient rows.
    event = NotificationService.create_notification_fanout(
        db, [a.user_id, b.user_id, a.user_id, None], "T", "M", "overtime_alert"
    )
    assert event is not None
    recips = db.query(NotificationRecipient).filter(
        NotificationRecipient.notification_id == event.notification_id
    ).all()
    assert {r.user_id for r in recips} == {a.user_id, b.user_id}
    assert len(recips) == 2


def test_per_user_read_state_isolation(db):
    from core.model import NotificationRecipient
    from services.notification_service import NotificationService
    s = datetime.utcnow().strftime("%H%M%S%f")
    a, b = _mk_user(db, f"a{s}"), _mk_user(db, f"b{s}")
    event = NotificationService.create_notification_fanout(db, [a.user_id, b.user_id], "T", "M", "overtime_alert")
    ra = db.query(NotificationRecipient).filter(
        NotificationRecipient.notification_id == event.notification_id,
        NotificationRecipient.user_id == a.user_id,
    ).one()
    ra.is_read = True
    db.commit()
    rb = db.query(NotificationRecipient).filter(
        NotificationRecipient.notification_id == event.notification_id,
        NotificationRecipient.user_id == b.user_id,
    ).one()
    assert rb.is_read is False  # B is unaffected by A marking read


def test_create_notification_enqueues_push_not_inline(db):
    from core.model import User, PushJob
    from services.notification_service import NotificationService
    s = datetime.utcnow().strftime("%H%M%S%f")
    token = f"ExponentPushToken[{s}]"
    u = User(
        user_type="private", email=f"push-{s}@kontokaz.test",
        user_name=f"push-{s}", password_hash="x", expo_push_token=token,
    )
    db.add(u)
    db.commit()
    db.refresh(u)

    NotificationService.create_notification(db, u.user_id, "T", "M", "overtime_alert", meta={"k": 1})

    jobs = db.query(PushJob).filter(PushJob.to_token == token).all()
    assert len(jobs) == 1                       # enqueued, not sent inline
    assert jobs[0].status == "pending"
    assert (jobs[0].data or {}).get("notification_type") == "overtime_alert"


def test_serialize_preserves_wire_shape(db):
    from core.model import Notification, NotificationRecipient
    from api.v1.notification import serialize_notification
    u = _mk_user(db, datetime.utcnow().strftime("%H%M%S%f"))
    n = Notification(title="T", message="M", type="overtime_alert", meta={"timelog_id": 7})
    db.add(n)
    db.flush()
    r = NotificationRecipient(notification_id=n.notification_id, user_id=u.user_id, is_read=True)
    db.add(r)
    db.commit()

    out = serialize_notification(n, r)
    assert out["notification_id"] == n.notification_id
    assert out["user_id"] == u.user_id          # caller's own id
    assert out["is_read"] is True               # caller's own read state
    assert out["type"] == "overtime_alert"
    assert out["notification_type"] == "overtime_alert"
    assert out["meta"] == {"timelog_id": 7}     # mobile's Confirm/Reject buttons read this
    # All fields the web + mobile clients depend on must be present.
    assert {
        "notification_id", "user_id", "title", "message", "type",
        "notification_type", "is_read", "meta", "related_entity_id", "created_at",
    } <= set(out.keys())
