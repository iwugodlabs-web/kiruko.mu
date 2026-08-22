"""The payroll-run link on a concern (UserRight.payroll_run_id).

Verifies a concern can be tied to a payroll run, and that voiding/deleting
the run nulls the link (ondelete=SET NULL) rather than deleting the concern.
"""
from datetime import date, datetime

from sqlalchemy import text as sql_text
from sqlalchemy.orm import Session


def test_concern_links_to_run_and_set_null_on_delete(db: Session):
    from core.model import Company, PayrollRun, PrivateUser, User, UserRight

    db.execute(sql_text("SELECT set_config('app.company_id', '*', false)"))
    db.commit()
    sfx = datetime.utcnow().strftime("%H%M%S%f")

    owner = User(user_type="company", email=f"cpl-{sfx}@kontokaz.test", user_name=f"cpl-{sfx}", password_hash="x")
    db.add(owner); db.flush()
    co = Company(user_id=owner.user_id, company_name=f"CPL {sfx}", email=f"cplco-{sfx}@kontokaz.test", brn=f"CPL_{sfx}", country_code="MU")
    db.add(co); db.flush()
    emp = User(user_type="private", email=f"cplemp-{sfx}@kontokaz.test", user_name=f"cplemp-{sfx}", password_hash="x")
    db.add(emp); db.flush()
    priv = PrivateUser(user_id=emp.user_id, first_name="C", last_name="P", company_id=co.company_id, role="employee", pass_port_number=f"CPL_{sfx}")
    db.add(priv); db.flush()
    run = PayrollRun(company_id=co.company_id, period_start=date(2026, 4, 1), period_end=date(2026, 4, 30))
    db.add(run); db.flush()
    ur = UserRight(
        private_user_id=priv.private_user_id,
        title="Query about my April 2026 payslip",
        category="payroll", issue_description="why is it lower", contact_method="email",
        urgency_level="low", accept_terms_and_conditions=True, acknowledge_information=True,
        agreed_to_be_contacted=True, status="received", expected_outcome="please review",
        payroll_run_id=run.id,
    )
    db.add(ur); db.commit()
    rid, run_id = ur.right_id, run.id

    try:
        db.expire_all()
        assert db.query(UserRight).filter(UserRight.right_id == rid).one().payroll_run_id == run_id

        # Voiding/deleting the run must NULL the link, not delete the concern.
        db.delete(db.query(PayrollRun).filter(PayrollRun.id == run_id).one())
        db.commit()
        db.expire_all()
        fresh = db.query(UserRight).filter(UserRight.right_id == rid).one()
        assert fresh is not None, "concern must survive a voided run"
        assert fresh.payroll_run_id is None, "link must be SET NULL on run delete"
    finally:
        db.rollback()
        db.query(UserRight).filter(UserRight.right_id == rid).delete()
        db.query(PrivateUser).filter(PrivateUser.private_user_id == priv.private_user_id).delete()
        db.query(Company).filter(Company.company_id == co.company_id).delete()
        db.query(User).filter(User.user_id.in_([owner.user_id, emp.user_id])).delete()
        db.commit()
