"""Statutory remittance — aggregation (PAYE/CSG/NSF) + PDF render."""
import uuid
from datetime import date

import pytest
from sqlalchemy import text as sql_text
from sqlalchemy.orm import Session

from core.model import Company, User, PrivateUser, PayrollRun, Payslip
from api.v1.payroll import _remittance_data


def _fixture(db: Session, *, finalized: bool = True) -> int:
    """A company with a (finalized) April-2026 run + 2 payslips with known
    statutory values. Returns company_id."""
    db.execute(sql_text("SELECT set_config('app.company_id', '*', false)"))
    db.commit()
    sfx = uuid.uuid4().hex[:8]
    owner = User(user_type="company", email=f"rem-{sfx}@example.com", user_name=f"rem-{sfx}", password_hash="x")
    db.add(owner); db.flush()
    co = Company(user_id=owner.user_id, company_name=f"REM {sfx}", email=f"remco-{sfx}@example.com", brn=f"REM_{sfx}", country_code="MU")
    db.add(co); db.flush()

    emps = []
    for i in range(2):
        u = User(user_type="private", email=f"rem-emp{i}-{sfx}@example.com", user_name=f"rem-emp{i}-{sfx}", password_hash="x")
        db.add(u); db.flush()
        pu = PrivateUser(user_id=u.user_id, first_name=f"Emp{i}", last_name="Test", company_id=co.company_id, role="employee")
        db.add(pu); db.flush()
        emps.append(pu)

    run = PayrollRun(
        company_id=co.company_id, period_start=date(2026, 4, 1), period_end=date(2026, 4, 30),
        status="finalized" if finalized else "draft", currency="MUR",
    )
    db.add(run); db.flush()

    db.add(Payslip(
        payroll_run_id=run.id, private_user_id=emps[0].private_user_id,
        gross="40000", net_pay="38000", paye="1000",
        statutory_employee={"CSG_EE": "60", "NSF_EE": "30"},
        statutory_employer={"CSG_ER": "120", "NSF_ER": "90"}, currency="MUR",
    ))
    db.add(Payslip(
        payroll_run_id=run.id, private_user_id=emps[1].private_user_id,
        gross="30000", net_pay="29000", paye="500",
        statutory_employee={"CSG_EE": "40", "NSF_EE": "20"},
        statutory_employer={"CSG_ER": "80", "NSF_ER": "60"}, currency="MUR",
    ))
    db.commit()
    return co.company_id


def test_remittance_aggregates_paye_and_statutory(db: Session):
    cid = _fixture(db)
    data = _remittance_data(db, cid, 2026, 4)

    assert data["finalized"] is True
    assert data["employee_count"] == 2
    assert data["paye_total"] == "1500.00"  # 1000 + 500

    by_code = {s["code"]: s for s in data["statutory"]}
    assert by_code["CSG"]["employee"] == "100.00"   # 60 + 40
    assert by_code["CSG"]["employer"] == "200.00"   # 120 + 80
    assert by_code["CSG"]["total"] == "300.00"
    assert by_code["NSF"]["employee"] == "50.00"    # 30 + 20
    assert by_code["NSF"]["employer"] == "150.00"   # 90 + 60

    # grand total = PAYE + all statutory (EE+ER) = 1500 + 300 + 200
    assert data["grand_total"] == "2000.00"
    assert len(data["employees"]) == 2


def test_remittance_includes_adjustments(db: Session):
    cid = _fixture(db)
    run = db.query(PayrollRun).filter(PayrollRun.company_id == cid).one()
    original = db.query(Payslip).filter(Payslip.payroll_run_id == run.id).first()
    # a correction that adds +Rs 10 employee CSG
    db.add(Payslip(
        payroll_run_id=run.id, private_user_id=original.private_user_id,
        is_adjustment=True, parent_payslip_id=original.id,
        gross="0", net_pay="0", paye="0",
        statutory_employee={"CSG_EE": "10"}, statutory_employer={}, currency="MUR",
    ))
    db.commit()

    data = _remittance_data(db, cid, 2026, 4)
    by_code = {s["code"]: s for s in data["statutory"]}
    assert by_code["CSG"]["employee"] == "110.00"  # 100 + the 10 correction


def test_remittance_no_finalized_run(db: Session):
    cid = _fixture(db, finalized=False)
    data = _remittance_data(db, cid, 2026, 4)
    assert data["finalized"] is False
    assert data["grand_total"] == "0.00"
    assert data["employee_count"] == 0


def test_remittance_pdf_renders(db: Session):
    from services import remittance_pdf
    cid = _fixture(db)
    company = db.query(Company).filter(Company.company_id == cid).one()
    data = _remittance_data(db, cid, 2026, 4)
    try:
        pdf = remittance_pdf.render(data, company)
    except remittance_pdf.PdfRenderUnavailable as e:
        pytest.skip(f"WeasyPrint unavailable: {e}")
    assert pdf[:4] == b"%PDF"
    assert len(pdf) > 1000
