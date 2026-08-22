"""Phase 3 — per-user notification preferences + delivery enforcement."""
from __future__ import annotations

import asyncio
from datetime import datetime


def _mk_user(db, suffix, token=None):
    from core.model import User
    u = User(
        user_type="private", email=f"pref-{suffix}@kontokaz.test",
        user_name=f"pref-{suffix}", password_hash="x", expo_push_token=token,
    )
    db.add(u)
    db.commit()
    db.refresh(u)
    return u


def test_get_preferences_defaults_all_on(db):
    from api.v1.notification import get_notification_preferences
    u = _mk_user(db, datetime.utcnow().strftime("%H%M%S%f"))
    res = asyncio.run(get_notification_preferences(db=db, current_user=u))
    cats = {p["category"] for p in res["preferences"]}
    assert cats == {"leave", "overtime", "attendance", "compliance", "disputes", "general"}
    assert all(p["in_app"] and p["push"] for p in res["preferences"])


def test_put_then_get_round_trip(db):
    from api.v1.notification import (
        get_notification_preferences, update_notification_preferences,
        PreferencesPayload, PreferenceItem,
    )
    u = _mk_user(db, datetime.utcnow().strftime("%H%M%S%f"))
    payload = PreferencesPayload(preferences=[PreferenceItem(category="overtime", in_app=False, push=True)])
    asyncio.run(update_notification_preferences(payload=payload, db=db, current_user=u))
    res = asyncio.run(get_notification_preferences(db=db, current_user=u))
    ot = next(p for p in res["preferences"] if p["category"] == "overtime")
    assert ot["in_app"] is False and ot["push"] is True


def test_muted_in_app_suppresses_recipient_row(db):
    from core.model import NotificationPreference, NotificationRecipient
    from services.notification_service import NotificationService
    s = datetime.utcnow().strftime("%H%M%S%f")
    a, b = _mk_user(db, f"a{s}"), _mk_user(db, f"b{s}")
    db.add(NotificationPreference(user_id=a.user_id, category="overtime", in_app=False, push=True))
    db.commit()

    event = NotificationService.create_notification_fanout(db, [a.user_id, b.user_id], "T", "M", "overtime_alert")
    recip_users = {
        r.user_id for r in db.query(NotificationRecipient).filter(
            NotificationRecipient.notification_id == event.notification_id
        ).all()
    }
    assert a.user_id not in recip_users   # muted the in-app channel
    assert b.user_id in recip_users       # default-on


def test_muted_push_keeps_in_app_drops_push(db):
    from core.model import NotificationPreference, NotificationRecipient, PushJob
    from services.notification_service import NotificationService
    s = datetime.utcnow().strftime("%H%M%S%f")
    token = f"ExponentPushToken[{s}]"
    a = _mk_user(db, f"a{s}", token=token)
    db.add(NotificationPreference(user_id=a.user_id, category="overtime", in_app=True, push=False))
    db.commit()

    event = NotificationService.create_notification_fanout(db, [a.user_id], "T", "M", "overtime_alert")
    # In-app row kept...
    assert db.query(NotificationRecipient).filter(
        NotificationRecipient.notification_id == event.notification_id,
        NotificationRecipient.user_id == a.user_id,
    ).count() == 1
    # ...but no push enqueued.
    assert db.query(PushJob).filter(PushJob.to_token == token).count() == 0
