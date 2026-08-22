"""RLS enforcement for the extension migration (rls_extend_tables_20260624).

Same model as April's test_rls.py: SET ROLE kiruko_app + set app.company_id,
then a tenant must see only its own company's rows. Covers a sample across the
extension's shapes:
  * denormalized one-hop  -> time_logs (via jobs), leaves (via private_users)
  * denormalized two-hop  -> break_logs (via time_logs -> jobs)
  * direct company_id      -> jobs, schedules

Also checks the auto-populate trigger: rows are created via the ORM (which has no
company_id column for the denormalized tables), so the BEFORE-INSERT trigger must
fill it — otherwise isolation would fail. Savepoint rolled back; needs superuser.
"""
import datetime as dt
import uuid

import pytest
from sqlalchemy import text
from sqlalchemy.orm import Session

from core.model import (
    BreakLog, Company, Job, Leave, PrivateUser, Schedule, TimeLog, User,
)


@pytest.fixture
def _superuser_required(db: Session):
    if not db.execute(text(
            "SELECT rolsuper FROM pg_roles WHERE rolname = current_user")).scalar():
        pytest.skip("needs a superuser connection to SET ROLE kiruko_app")


def _chain(db: Session, tag: str):
    sfx = uuid.uuid4().hex[:8]
    owner = User(user_type="company", email=f"{tag}-{sfx}@x.com",
                 user_name=f"{tag}-{sfx}", password_hash="x")
    db.add(owner); db.flush()
    co = Company(user_id=owner.user_id, company_name=f"{tag} {sfx}",
                 email=f"{tag}co-{sfx}@x.com", brn=f"{tag}_{sfx}", country_code="MU")
    db.add(co); db.flush()
    eu = User(user_type="private", email=f"{tag}e-{sfx}@x.com",
              user_name=f"{tag}e-{sfx}", password_hash="x")
    db.add(eu); db.flush()
    pu = PrivateUser(user_id=eu.user_id, first_name="E", last_name="E",
                     company_id=co.company_id, role="employee")
    db.add(pu); db.flush()
    job = Job(private_user_id=pu.private_user_id, company_id=co.company_id, work_days=[])
    db.add(job); db.flush()
    # NOTE: TimeLog/BreakLog/Leave have no company_id on the ORM model — the DB
    # trigger must populate it on insert.
    tl = TimeLog(job_id=job.job_id, private_user_id=pu.private_user_id, location="s")
    db.add(tl); db.flush()
    bl = BreakLog(timelog_id=tl.timelog_id, start_time=dt.datetime(2026, 1, 1, 12, 0))
    db.add(bl); db.flush()
    lv = Leave(private_user_id=pu.private_user_id, leave_type="annual",
               start_date=dt.date(2026, 2, 1), end_date=dt.date(2026, 2, 2))
    db.add(lv); db.flush()
    sc = Schedule(title="T", company_id=co.company_id, location="s",
                  start_time=dt.datetime(2026, 1, 1, 9, 0),
                  end_time=dt.datetime(2026, 1, 1, 17, 0))
    db.add(sc); db.flush()
    return co, {
        ("time_logs", "timelog_id"): tl.timelog_id,
        ("break_logs", "break_id"): bl.break_id,
        ("leaves", "leave_id"): lv.leave_id,
        ("jobs", "job_id"): job.job_id,
        ("schedules", "schedule_id"): sc.schedule_id,
        ("companies", "company_id"): co.company_id,
    }


def test_extension_rls_enforcement(db: Session, _superuser_required):
    db.execute(text("SELECT set_config('app.company_id', '*', false)"))
    co_a, ids_a = _chain(db, "A")
    co_b, ids_b = _chain(db, "B")
    db.flush()

    # Sanity: the trigger populated company_id on the denormalized rows.
    for tbl in ("time_logs", "break_logs", "leaves"):
        nulls = db.execute(text(f"SELECT count(*) FROM {tbl} WHERE company_id IS NULL")).scalar()
        assert nulls == 0, f"{tbl}: BEFORE-INSERT trigger failed to populate company_id"

    conn = db.connection()
    conn.execute(text("SAVEPOINT e"))
    try:
        conn.execute(text("SET LOCAL ROLE kiruko_app"))
        conn.execute(text(f"SET LOCAL app.company_id = '{co_a.company_id}'"))
        for (tbl, pk), a_id in ids_a.items():
            b_id = ids_b[(tbl, pk)]
            seen = {r[0] for r in conn.execute(text(f"SELECT {pk} FROM {tbl}")).fetchall()}
            assert a_id in seen, f"{tbl}: own row must be visible"
            assert b_id not in seen, f"{tbl}: other company's row must be HIDDEN"

        conn.execute(text("SET LOCAL app.company_id = '*'"))
        for (tbl, pk), a_id in ids_a.items():
            b_id = ids_b[(tbl, pk)]
            allv = {r[0] for r in conn.execute(text(f"SELECT {pk} FROM {tbl}")).fetchall()}
            assert {a_id, b_id} <= allv, f"{tbl}: '*' bypass must see all"
    finally:
        conn.execute(text("RESET ROLE"))
        conn.execute(text("ROLLBACK TO SAVEPOINT e"))
