"""Tests for actor resolution in get_audit_logs (db_models.crud.company).

The admin Audit Logs view shows WHO acted by resolving each row's numeric
actor_user_id to a name/email at read time (one batched lookup per page)
instead of duplicating that PII into every audit row. Actor-less rows
(system automations, kiosk, anonymous filings) resolve to None.
"""
import uuid

from sqlalchemy import text as sql_text

from db_models.crud.audit import create_audit_log
from db_models.crud.company import get_audit_logs
from core.model import PrivateUser, User, UserType


def _suffix() -> str:
    return uuid.uuid4().hex[:10]


def _mk_user_with_name(db, suffix, first, last) -> User:
    u = User(
        user_type=UserType.private,
        email=f"actor-{suffix}@kontokaz.test",
        user_name=f"actor-{suffix}",
        password_hash="hash",
    )
    db.add(u)
    db.flush()
    p = PrivateUser(user_id=u.user_id, first_name=first, last_name=last)
    db.add(p)
    db.flush()
    return u


def _purge(db, user_ids):
    db.rollback()
    db.execute(sql_text("ALTER TABLE audit_logs DISABLE TRIGGER USER"))
    db.query(User).filter(User.user_id.in_(user_ids)).delete(synchronize_session=False)
    db.execute(sql_text("ALTER TABLE audit_logs ENABLE TRIGGER USER"))
    db.commit()


def test_actor_name_and_email_resolved(db):
    suffix = _suffix()
    actor = _mk_user_with_name(db, suffix, "Jane", "Doe")
    action = f"test.resolve.{suffix}"
    create_audit_log(db, actor.user_id, action, "test", 1, {"k": "v"})

    try:
        res = get_audit_logs(db, action=action)
        assert res["total"] == 1
        row = res["data"][0]
        assert row["actor_user_id"] == actor.user_id
        assert row["actor_name"] == "Jane Doe"
        assert row["actor_email"].startswith(f"actor-{suffix}")
    finally:
        _purge(db, [actor.user_id])


def test_actorless_row_resolves_to_none(db):
    suffix = _suffix()
    action = f"test.system.{suffix}"
    # System/automation action — no human actor.
    create_audit_log(db, None, action, "test", 1, {"reason": "auto"})

    res = get_audit_logs(db, action=action)
    assert res["total"] == 1
    row = res["data"][0]
    assert row["actor_user_id"] is None
    assert row["actor_name"] is None
    assert row["actor_email"] is None
