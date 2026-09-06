"""Document vault — owner-scope (IDOR) + visibility enforcement."""
import asyncio
import json
import uuid

import pytest
from fastapi import HTTPException
from sqlalchemy import text as sql_text
from sqlalchemy.orm import Session

from core.model import Company, User, PrivateUser, DocumentVault, CompanyRole, CompanyUserRole
from api.v1.user import (
    get_vault_documents, get_company_vault_documents, delete_vault_document,
)


def _grant(db, company_id, private_user_id, perms, name="Doc Role", slug="doc_role"):
    """Give a delegated role-holder a CompanyRole with `perms`."""
    db.add(CompanyRole(company_id=company_id, name=name, description="test",
                       is_system=False, permissions=perms))
    db.add(CompanyUserRole(company_id=company_id, private_user_id=private_user_id, role=slug))
    db.commit()


def _run(coro):
    # Fresh loop per call — get_event_loop() reuses a shared loop another test may
    # have closed (→ "coroutine was never awaited" in a full-suite run).
    return asyncio.run(coro)


def _setup(db: Session):
    db.execute(sql_text("SELECT set_config('app.company_id', '*', false)"))
    db.commit()
    sfx = uuid.uuid4().hex[:8]
    owner = User(user_type="company", email=f"v-own-{sfx}@x.com", user_name=f"v-own-{sfx}", password_hash="x")
    db.add(owner); db.flush()
    co = Company(user_id=owner.user_id, company_name=f"V {sfx}", email=f"vco-{sfx}@x.com", brn=f"V_{sfx}", country_code="MU")
    db.add(co); db.flush()

    def emp(tag):
        u = User(user_type="private", email=f"v-{tag}-{sfx}@x.com", user_name=f"v-{tag}-{sfx}", password_hash="x")
        db.add(u); db.flush()
        p = PrivateUser(user_id=u.user_id, first_name=tag, last_name="T", company_id=co.company_id, role="employee")
        db.add(p); db.flush()
        return u, p

    a_user, a = emp("A")
    b_user, b = emp("B")
    # A's vault: one private, one employer_only
    db.add(DocumentVault(private_user_id=a.private_user_id, doc_type="id", name="Private Note", visibility="private"))
    db.add(DocumentVault(private_user_id=a.private_user_id, doc_type="contract", name="Contract", visibility="employer_only"))
    db.commit()
    return owner, co, a_user, a, b_user, b


def _names(resp):
    return {d["name"] for d in json.loads(resp.body)["data"]}


def test_owner_sees_own_private_and_employer_docs(db: Session):
    owner, co, a_user, a, b_user, b = _setup(db)
    resp = _run(get_vault_documents(a.private_user_id, request=None, db=db, current_user=a_user))
    assert _names(resp) == {"Private Note", "Contract"}


def test_other_employee_blocked_idor(db: Session):
    owner, co, a_user, a, b_user, b = _setup(db)
    with pytest.raises(HTTPException) as ei:
        _run(get_vault_documents(a.private_user_id, request=None, db=db, current_user=b_user))
    assert ei.value.status_code == 403


def test_admin_sees_employer_not_private(db: Session):
    owner, co, a_user, a, b_user, b = _setup(db)
    resp = _run(get_vault_documents(a.private_user_id, request=None, db=db, current_user=owner))
    assert _names(resp) == {"Contract"}  # NOT "Private Note"


def test_company_endpoint_excludes_private_and_gates_non_admin(db: Session):
    owner, co, a_user, a, b_user, b = _setup(db)
    # admin (owner) sees only employer-visible docs
    resp = _run(get_company_vault_documents(co.company_id, doc_type=None, db=db, current_user=owner))
    assert _names(resp) == {"Contract"}
    # a regular employee is blocked
    with pytest.raises(HTTPException) as ei:
        _run(get_company_vault_documents(co.company_id, doc_type=None, db=db, current_user=a_user))
    assert ei.value.status_code == 403


def test_delete_idor_blocked(db: Session):
    owner, co, a_user, a, b_user, b = _setup(db)
    doc = db.query(DocumentVault).filter(DocumentVault.private_user_id == a.private_user_id).first()
    with pytest.raises(HTTPException) as ei:
        _run(delete_vault_document(doc.doc_id, request=None, db=db, current_user=b_user))
    assert ei.value.status_code == 403
    # owner can delete their own
    _run(delete_vault_document(doc.doc_id, request=None, db=db, current_user=a_user))
    assert db.query(DocumentVault).filter(DocumentVault.doc_id == doc.doc_id).first() is None


def test_view_documents_role_can_read_employer_docs(db: Session):
    # A delegated role-holder (B) granted view_documents may read A's
    # employer-visible docs — but NOT A's private ones.
    owner, co, a_user, a, b_user, b = _setup(db)
    _grant(db, co.company_id, b.private_user_id, ["view_documents"])
    resp = _run(get_vault_documents(a.private_user_id, request=None, db=db, current_user=b_user))
    assert _names(resp) == {"Contract"}  # employer_only, NOT "Private Note"


def test_no_doc_permission_still_blocked(db: Session):
    # A role WITHOUT view_documents stays blocked (fail-closed).
    owner, co, a_user, a, b_user, b = _setup(db)
    _grant(db, co.company_id, b.private_user_id, ["view_leave"])  # unrelated perm
    with pytest.raises(HTTPException) as ei:
        _run(get_vault_documents(a.private_user_id, request=None, db=db, current_user=b_user))
    assert ei.value.status_code == 403


def test_delete_documents_role_can_delete(db: Session):
    owner, co, a_user, a, b_user, b = _setup(db)
    _grant(db, co.company_id, b.private_user_id, ["delete_documents"])
    doc = db.query(DocumentVault).filter(DocumentVault.private_user_id == a.private_user_id).first()
    _run(delete_vault_document(doc.doc_id, request=None, db=db, current_user=b_user))
    assert db.query(DocumentVault).filter(DocumentVault.doc_id == doc.doc_id).first() is None


def test_company_endpoint_view_documents_role_allowed(db: Session):
    # The company-wide vault (web) honors view_documents too — employer docs only.
    owner, co, a_user, a, b_user, b = _setup(db)
    _grant(db, co.company_id, b.private_user_id, ["view_documents"])
    resp = _run(get_company_vault_documents(co.company_id, doc_type=None, db=db, current_user=b_user))
    assert _names(resp) == {"Contract"}
