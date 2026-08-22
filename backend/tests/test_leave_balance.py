"""Tests for services.leave_balance.compute_leave_balance."""
from datetime import date, datetime, timezone

from sqlalchemy import text as sql_text
from sqlalchemy.orm import Session

from services.leave_balance import compute_leave_balance


def _seed(db: Session, *, days_per_year=22, accrual_method="annual", is_paid=True):
    from core.model import Company, Leave, LeaveType, PrivateUser, User

    db.execute(sql_text("SELECT set_config('app.company_id', '*', false)"))
    db.commit()
    suffix = datetime.utcnow().strftime("%H%M%S%f")

    owner = User(user_type="company", email=f"lv-owner-{suffix}@kontokaz.test",
                 user_name=f"lv-owner-{suffix}", password_hash="x")
    db.add(owner); db.flush()
    co = Company(user_id=owner.user_id, company_name=f"LvCo {suffix}",
                 email=f"lvco-{suffix}@kontokaz.test", brn=f"LV_{suffix}", country_code="MU")
    db.add(co); db.flush()
    emp = User(user_type="private", email=f"lv-emp-{suffix}@kontokaz.test",
               user_name=f"lv-emp-{suffix}", password_hash="x")
    db.add(emp); db.flush()
    priv = PrivateUser(user_id=emp.user_id, first_name="Leave", last_name="Taker",
                       company_id=co.company_id, role="employee",
                       pass_port_number=f"LV_PASS_{suffix}")
    db.add(priv); db.flush()
    lt = LeaveType(company_id=co.company_id, code="annual", label="Annual leave",
                   is_paid=is_paid, is_active=True, accrual_method=accrual_method,
                   days_per_year=days_per_year, accrual_rate_days_per_month="1.833")
    db.add(lt); db.flush()
    # An approved 5-day leave (1–5 Jun 2026 inclusive) of this type.
    lv = Leave(private_user_id=priv.private_user_id, leave_type="annual",
               leave_type_id=lt.id, start_date=date(2026, 6, 1), end_date=date(2026, 6, 5),
               status="approved", approved_at=datetime.now(timezone.utc))
    db.add(lv); db.commit()
    return {"owner_email": owner.email, "emp_email": emp.email, "company_id": co.company_id,
            "priv_id": priv.private_user_id, "passport": priv.pass_port_number}


def _cleanup(db: Session, ctx: dict):
    db.rollback()
    db.execute(sql_text("DELETE FROM leaves WHERE private_user_id=:p"), {"p": ctx["priv_id"]})
    db.execute(sql_text("DELETE FROM leave_types WHERE company_id=:c"), {"c": ctx["company_id"]})
    db.execute(sql_text("DELETE FROM private_users WHERE pass_port_number=:p"), {"p": ctx["passport"]})
    db.execute(sql_text("DELETE FROM companies WHERE company_id=:c"), {"c": ctx["company_id"]})
    db.execute(sql_text("DELETE FROM users WHERE email IN (:e1, :e2)"),
               {"e1": ctx["owner_email"], "e2": ctx["emp_email"]})
    db.commit()


def test_annual_balance_entitlement_taken_remaining(db: Session):
    ctx = _seed(db, days_per_year=22, accrual_method="annual")
    try:
        res = compute_leave_balance(db, ctx["priv_id"], 2026)
        annual = next(b for b in res["balances"] if b["code"] == "annual")
        assert annual["entitlement"] == 22.0
        assert annual["taken"] == 5.0  # 1–5 Jun inclusive
        assert annual["remaining"] == 17.0
    finally:
        _cleanup(db, ctx)


def test_unpaid_types_are_excluded(db: Session):
    ctx = _seed(db, is_paid=False)
    try:
        res = compute_leave_balance(db, ctx["priv_id"], 2026)
        assert all(b["code"] != "annual" for b in res["balances"])
    finally:
        _cleanup(db, ctx)


def test_monthly_accrual_caps_at_days_per_year(db: Session):
    # Rate 1.833/mo × 12 = 21.996 → capped at days_per_year (22 here), and the
    # whole-year accrual should not exceed the annual cap.
    ctx = _seed(db, days_per_year=22, accrual_method="monthly")
    try:
        res = compute_leave_balance(db, ctx["priv_id"], 2025)  # past year → 12 months
        annual = next(b for b in res["balances"] if b["code"] == "annual")
        assert annual["entitlement"] <= 22.0
    finally:
        _cleanup(db, ctx)
