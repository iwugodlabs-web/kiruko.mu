"""IDOR security lane — by-id WRITE routes in api/v1/job.py must refuse a caller
from another company.

Each of these routes takes a resource id (job/timelog/schedule/salary) but NOT a
company_id in the path. Before this lane they performed the mutation without
checking the resource belonged to the caller's company, so an owner of company B
could mutate company A's jobs/time-logs/schedules by id. The fix resolves each
resource's company and calls assert_company_access.

Strategy: build company A (with a job + time-log + schedule + salary) and a
separate company B owner. B reaches for A's objects by id; each must be refused
(403/404). A positive control proves A's own owner is still allowed.
"""
import asyncio
import uuid
from datetime import datetime

import pytest
from fastapi import HTTPException
from sqlalchemy import text as sql_text
from sqlalchemy.orm import Session

from core.model import Company, Job, PrivateUser, Schedule, Salary, TimeLog, User
from api.v1 import job as job_api


def _run(coro):
    return asyncio.run(coro)


def _fake_request():
    """Minimal StandaloneApplication-style Request stub — update_time_log_endpoint
    reads only `request.client.host` for the geofence IP cross-check."""
    return type("FakeRequest", (), {"client": type("FakeClient", (), {"host": "127.0.0.1"})()})()


def _company_with_objects(db: Session):
    """Company A holding a job/time-log/schedule/salary, plus a company B owner."""
    db.execute(sql_text("SELECT set_config('app.company_id', '*', false)"))
    db.commit()
    sfx = uuid.uuid4().hex[:8]

    # Company A + owner
    owner_a = User(user_type="company", email=f"a-own-{sfx}@x.com",
                   user_name=f"a-own-{sfx}", password_hash="x")
    db.add(owner_a); db.flush()
    co_a = Company(user_id=owner_a.user_id, company_name=f"A {sfx}",
                   email=f"aco-{sfx}@x.com", brn=f"A_{sfx}", country_code="MU")
    db.add(co_a); db.flush()

    # An employee + job in company A
    emp_u = User(user_type="private", email=f"a-emp-{sfx}@x.com",
                 user_name=f"a-emp-{sfx}", password_hash="x")
    db.add(emp_u); db.flush()
    emp = PrivateUser(user_id=emp_u.user_id, first_name="Aa", last_name="Tt",
                      company_id=co_a.company_id, role="employee")
    db.add(emp); db.flush()
    job = Job(private_user_id=emp.private_user_id, company_id=co_a.company_id,
              work_days=[], employer_brn=co_a.brn)
    db.add(job); db.flush()
    tl = TimeLog(job_id=job.job_id, private_user_id=emp.private_user_id, location="site")
    db.add(tl)
    sched = Schedule(title="Task", company_id=co_a.company_id, location="site",
                     start_time=datetime(2026, 1, 1, 9, 0),
                     end_time=datetime(2026, 1, 1, 17, 0))
    db.add(sched)
    sal = Salary(job_id=job.job_id)
    db.add(sal); db.commit()

    # Company B + owner (the attacker context)
    owner_b = User(user_type="company", email=f"b-own-{sfx}@x.com",
                   user_name=f"b-own-{sfx}", password_hash="x")
    db.add(owner_b); db.flush()
    co_b = Company(user_id=owner_b.user_id, company_name=f"B {sfx}",
                   email=f"bco-{sfx}@x.com", brn=f"B_{sfx}", country_code="MU")
    db.add(co_b); db.commit()

    for o in (owner_a, owner_b, job, tl, sched, sal):
        db.refresh(o)
    return owner_a, owner_b, job, tl, sched, sal


# (name, callable) — each runs as owner_b reaching for company A's object by id.
_CASES = [
    ("update_job_simple",
     lambda db, b, job, tl, sched, sal: _run(job_api.update_job_profile_simple(
         job.job_id, {"job_title": "x"}, current_user=b, db=db))),
    ("delete_job",
     lambda db, b, job, tl, sched, sal: _run(job_api.delete_job_profile(
         job.job_id, current_user=b, db=db))),
    ("update_salary",
     lambda db, b, job, tl, sched, sal: _run(job_api.update_salary_endpoint(
         sal.salary_id, {"base_salary": 1}, current_user=b, db=db))),
    ("update_time_log",
     lambda db, b, job, tl, sched, sal: _run(job_api.update_time_log_endpoint(
         tl.timelog_id, {"location": "moved"}, current_user=b, db=db, request=_fake_request()))),
    ("start_break",
     lambda db, b, job, tl, sched, sal: _run(job_api.start_break_endpoint(
         tl.timelog_id, current_user=b, db=db))),
    ("confirm_overtime",
     lambda db, b, job, tl, sched, sal: _run(job_api.confirm_overtime_endpoint(
         tl.timelog_id, db=db, current_user=b))),
    ("reject_overtime",
     lambda db, b, job, tl, sched, sal: _run(job_api.reject_overtime_endpoint(
         tl.timelog_id, db=db, current_user=b))),
    ("delete_schedule",
     lambda db, b, job, tl, sched, sal: _run(job_api.delete_schedule_endpoint(
         sched.schedule_id, current_user=b, db=db))),
    ("approve_verification",
     lambda db, b, job, tl, sched, sal: _run(job_api.approve_employee_verification(
         job.job_id, current_user=b, db=db))),
    ("reject_verification",
     lambda db, b, job, tl, sched, sal: _run(job_api.reject_employee_verification(
         job.job_id, {"reason": "x"}, current_user=b, db=db))),
    ("patch_job_details",
     lambda db, b, job, tl, sched, sal: _run(job_api.patch_job_details(
         job.job_id, {"job_title": "z"}, current_user=b, db=db))),
]


@pytest.mark.parametrize("name,call", _CASES, ids=[c[0] for c in _CASES])
def test_job_write_idor_blocked(db: Session, name, call):
    owner_a, owner_b, job, tl, sched, sal = _company_with_objects(db)
    with pytest.raises(HTTPException) as ei:
        call(db, owner_b, job, tl, sched, sal)
    assert ei.value.status_code in (403, 404), \
        f"{name} did not refuse cross-company access (got no error)"


def test_owner_can_patch_own_job(db: Session):
    """Positive control — company A's own owner is still allowed to patch A's job,
    so the guard isn't simply blocking everyone."""
    owner_a, owner_b, job, tl, sched, sal = _company_with_objects(db)
    out = _run(job_api.patch_job_details(
        job.job_id, {"job_title": "ok"}, current_user=owner_a, db=db))
    assert out["job_id"] == job.job_id
    assert out.get("job_title") == "ok"


def test_reassign_to_foreign_company_blocked(db: Session):
    """A patch that tries to move the job into company B must be refused even when
    the caller (A's owner) can edit the job — the TARGET company is foreign."""
    owner_a, owner_b, job, tl, sched, sal = _company_with_objects(db)
    foreign_company_id = db.query(Company).filter(
        Company.user_id == owner_b.user_id).one().company_id
    with pytest.raises(HTTPException) as ei:
        _run(job_api.patch_job_details(
            job.job_id, {"company_id": foreign_company_id}, current_user=owner_a, db=db))
    assert ei.value.status_code in (403, 404)
