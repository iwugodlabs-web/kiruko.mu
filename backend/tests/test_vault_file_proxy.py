"""Vault file proxy — same-origin previews for mobile (backend-only fix).

Raw S3/Spaces object URLs fail inside the shipped mobile WebView/pdf.js on
CORS while loading fine in a browser tab. The list endpoints therefore hand
out proxy URLs (GET /user/vault/doc/{id}/file?token=…) that stream bytes
same-origin with visibility enforced per view — no mobile build required.

Covers:
  * list endpoints rewrite file_url → proxy URL (owner + company views)
  * view-token minting honors visibility (owner/admin/role/stranger)
  * the file endpoint streams bytes, re-checks visibility, rejects
    tampered/foreign tokens and missing files
  * OTP-minted sessions bind the same RLS tenant claims as password logins
    (services.user_service.resolve_token_identity)
  * LocalStorage.download_bytes round-trip + path-traversal refusal
"""
import asyncio
import json
import uuid

import pytest
from fastapi import HTTPException
from sqlalchemy import text as sql_text
from sqlalchemy.orm import Session
from starlette.requests import Request

from api.v1.user import (
    get_vault_documents, get_company_vault_documents,
    mint_vault_view_token, serve_vault_file,
)
from core.model import Company, User, PrivateUser, DocumentVault
from services.storage_service import LocalStorage, S3Storage


def _run(coro):
    return asyncio.run(coro)


def _req():
    return Request({
        "type": "http", "http_version": "1.1", "method": "GET",
        "scheme": "https", "server": ("api.kiruko.mu", 443),
        "path": "/", "headers": [(b"host", b"api.kiruko.mu")],
    })


def _setup(db: Session):
    db.execute(sql_text("SELECT set_config('app.company_id', '*', false)"))
    db.commit()
    sfx = uuid.uuid4().hex[:8]
    owner = User(user_type="company", email=f"p-own-{sfx}@x.com", user_name=f"p-own-{sfx}", password_hash="x")
    db.add(owner); db.flush()
    co = Company(user_id=owner.user_id, company_name=f"P {sfx}", email=f"pco-{sfx}@x.com", brn=f"P_{sfx}", country_code="MU")
    db.add(co); db.flush()

    def emp(tag):
        u = User(user_type="private", email=f"p-{tag}-{sfx}@x.com", user_name=f"p-{tag}-{sfx}", password_hash="x")
        db.add(u); db.flush()
        p = PrivateUser(user_id=u.user_id, first_name=tag, last_name="T", company_id=co.company_id, role="employee")
        db.add(p); db.flush()
        return u, p

    a_user, a = emp("A")
    b_user, b = emp("B")
    shared = DocumentVault(
        private_user_id=a.private_user_id, doc_type="contract", name="Contract",
        visibility="employer_only", file_url="https://files.example.test/vault/x.pdf",
        file_name="x.pdf", file_mime="application/pdf",
    )
    admin_only = DocumentVault(
        private_user_id=a.private_user_id, doc_type="contract", name="HR Only",
        visibility="company_admin", file_url="https://files.example.test/vault/y.pdf",
        file_name="y.pdf", file_mime="application/pdf",
    )
    meta_only = DocumentVault(
        private_user_id=a.private_user_id, doc_type="other", name="No File",
        visibility="employer_only",
    )
    db.add_all([shared, admin_only, meta_only])
    db.commit()
    return owner, co, a_user, a, b_user, b, shared, admin_only, meta_only


def _data(resp):
    return json.loads(resp.body)["data"]


def _collect_body(resp):
    chunks = []

    async def _drain():
        async for chunk in resp.body_iterator:
            chunks.append(chunk if isinstance(chunk, bytes) else chunk.encode())
    asyncio.run(_drain())
    return b"".join(chunks)


# ── list endpoints hand out proxy URLs ────────────────────────────────────────

def test_owner_list_rewrites_file_url_to_proxy(db: Session):
    owner, co, a_user, a, b_user, b, shared, admin_only, meta_only = _setup(db)
    rows = {d["name"]: d for d in _data(_run(
        get_vault_documents(a.private_user_id, request=_req(), db=db, current_user=a_user)))}
    assert set(rows) == {"Contract", "No File"}  # company_admin hidden from owner
    proxy = rows["Contract"]["file_url"]
    assert proxy.startswith(
        f"https://api.kiruko.mu/api/v1/user/vault/doc/{shared.doc_id}/file?token=")
    assert "files.example.test" not in proxy  # raw S3 URL must not leak
    assert rows["No File"]["file_url"] is None  # metadata-only docs untouched


def test_company_list_rewrites_file_url_to_proxy(db: Session):
    owner, co, a_user, a, b_user, b, shared, admin_only, meta_only = _setup(db)
    rows = {d["name"]: d for d in _data(_run(
        get_company_vault_documents(co.company_id, request=_req(), doc_type=None, db=db, current_user=owner)))}
    # Company-wide list includes metadata-only employer docs too.
    assert set(rows) == {"Contract", "HR Only", "No File"}
    assert rows["Contract"]["file_url"].startswith("https://api.kiruko.mu/api/v1/user/vault/doc/")
    assert rows["HR Only"]["file_url"].startswith("https://api.kiruko.mu/api/v1/user/vault/doc/")
    assert rows["No File"]["file_url"] is None
    assert rows["Contract"]["visibility"] == "employer_only"
    assert rows["HR Only"]["visibility"] == "company_admin"


# ── view-token minting honors visibility ──────────────────────────────────────

def test_view_token_owner_ok_stranger_blocked(db: Session):
    owner, co, a_user, a, b_user, b, shared, admin_only, meta_only = _setup(db)
    resp = _run(mint_vault_view_token(shared.doc_id, db=db, current_user=a_user))
    assert json.loads(resp.body)["data"]["view_token"]
    with pytest.raises(HTTPException) as ei:
        _run(mint_vault_view_token(shared.doc_id, db=db, current_user=b_user))
    assert ei.value.status_code == 403


def test_view_token_admin_only_hidden_from_owner(db: Session):
    owner, co, a_user, a, b_user, b, shared, admin_only, meta_only = _setup(db)
    with pytest.raises(HTTPException) as ei:
        _run(mint_vault_view_token(admin_only.doc_id, db=db, current_user=a_user))
    assert ei.value.status_code == 403
    # …but the admin can mint it.
    resp = _run(mint_vault_view_token(admin_only.doc_id, db=db, current_user=owner))
    assert json.loads(resp.body)["data"]["view_token"]


# ── file endpoint streams + enforces ──────────────────────────────────────────

def _local_service(tmp_path, payload: bytes):
    target = tmp_path / "vault" / "9"
    target.mkdir(parents=True)
    (target / "x.pdf").write_bytes(payload)
    return LocalStorage(base_path=str(tmp_path))


def test_file_proxy_streams_bytes(db: Session, tmp_path, monkeypatch):
    owner, co, a_user, a, b_user, b, shared, admin_only, meta_only = _setup(db)
    payload = b"%PDF-1.4 fake-bytes"
    monkeypatch.setattr("api.v1.user.get_storage_service",
                        lambda: _local_service(tmp_path, payload))
    # Point the doc at the local file (form: /uploads/<relpath>).
    shared.file_url = "/uploads/vault/9/x.pdf"
    shared.file_mime = "application/pdf"
    db.commit()
    token = json.loads(_run(
        mint_vault_view_token(shared.doc_id, db=db, current_user=a_user)).body)["data"]["view_token"]
    resp = _run(serve_vault_file(shared.doc_id, request=_req(), token=token, db=db))
    assert resp.status_code == 200
    assert resp.media_type == "application/pdf"
    assert resp.headers["content-disposition"].startswith("inline;")
    assert _collect_body(resp) == payload


def test_file_proxy_rejects_foreign_and_tampered_tokens(db: Session, tmp_path, monkeypatch):
    owner, co, a_user, a, b_user, b, shared, admin_only, meta_only = _setup(db)
    monkeypatch.setattr("api.v1.user.get_storage_service",
                        lambda: _local_service(tmp_path, b"zzz"))
    shared.file_url = "/uploads/vault/9/x.pdf"
    db.commit()
    owner_token = json.loads(_run(
        mint_vault_view_token(shared.doc_id, db=db, current_user=a_user)).body)["data"]["view_token"]
    # Token bound to doc A must not open doc B.
    with pytest.raises(HTTPException) as ei:
        _run(serve_vault_file(admin_only.doc_id, request=_req(), token=owner_token, db=db))
    assert ei.value.status_code == 401
    # Garbage token.
    with pytest.raises(HTTPException) as ei:
        _run(serve_vault_file(shared.doc_id, request=_req(), token="nope", db=db))
    assert ei.value.status_code == 401
    # No file attached → 404 (mint first: metadata doc is still visible).
    meta_token = json.loads(_run(
        mint_vault_view_token(meta_only.doc_id, db=db, current_user=a_user)).body)["data"]["view_token"]
    with pytest.raises(HTTPException) as ei:
        _run(serve_vault_file(meta_only.doc_id, request=_req(), token=meta_token, db=db))
    assert ei.value.status_code == 404


def test_file_proxy_rechecks_visibility_at_serve_time(db: Session, tmp_path, monkeypatch):
    """A doc narrowed to admin-only AFTER the token was minted stops serving."""
    owner, co, a_user, a, b_user, b, shared, admin_only, meta_only = _setup(db)
    monkeypatch.setattr("api.v1.user.get_storage_service",
                        lambda: _local_service(tmp_path, b"zzz"))
    shared.file_url = "/uploads/vault/9/x.pdf"
    db.commit()
    token = json.loads(_run(
        mint_vault_view_token(shared.doc_id, db=db, current_user=a_user)).body)["data"]["view_token"]
    shared.visibility = "company_admin"
    db.commit()
    with pytest.raises(HTTPException) as ei:
        _run(serve_vault_file(shared.doc_id, request=_req(), token=token, db=db))
    assert ei.value.status_code == 403


# ── explicit `shared` visibility ──────────────────────────────────────────────

def test_shared_visibility_seen_by_owner_and_admin_not_stranger(db: Session):
    """Web uploads save `shared`; owner + admin see it, strangers 403."""
    owner, co, a_user, a, b_user, b, shared, admin_only, meta_only = _setup(db)
    doc = DocumentVault(
        private_user_id=a.private_user_id, doc_type="contract", name="Shared Doc",
        visibility="shared", file_url="https://files.example.test/vault/s.pdf",
        file_name="s.pdf", file_mime="application/pdf",
    )
    db.add(doc)
    db.commit()
    owner_names = {d["name"] for d in _data(_run(
        get_vault_documents(a.private_user_id, request=_req(), db=db, current_user=a_user)))}
    assert "Shared Doc" in owner_names
    admin_names = {d["name"] for d in _data(_run(
        get_vault_documents(a.private_user_id, request=_req(), db=db, current_user=owner)))}
    assert "Shared Doc" in admin_names
    with pytest.raises(HTTPException) as ei:
        _run(mint_vault_view_token(doc.doc_id, db=db, current_user=b_user))
    assert ei.value.status_code == 403
    # Legacy employer_only rows keep identical access.
    assert "Contract" in owner_names and "Contract" in admin_names


# ── OTP sessions bind the same tenant claims as password logins ───────────────

def test_resolve_token_identity_mirrors_login_paths():
    from types import SimpleNamespace
    from services.user_service import resolve_token_identity
    emp = SimpleNamespace(private_user=SimpleNamespace(company_id=7, private_user_id=9), company=None)
    assert resolve_token_identity(emp) == {"company_id": 7, "private_user_id": 9}
    owner = SimpleNamespace(private_user=None, company=SimpleNamespace(company_id=3))
    assert resolve_token_identity(owner) == {"company_id": 3, "private_user_id": None}
    linked = SimpleNamespace(
        private_user=SimpleNamespace(company_id=None, private_user_id=5), company=None)
    assert resolve_token_identity(linked) == {"company_id": None, "private_user_id": 5}
    # Same helper feeds the OTP path — key parity is the regression guard.
    from api.v1.auth_otp import _otp_token_identity
    assert _otp_token_identity(emp) == {"company_id": 7, "private_user_id": 9}


# ── storage download_bytes ────────────────────────────────────────────────────

def test_local_download_roundtrip_and_traversal_refusal(tmp_path):
    svc = LocalStorage(base_path=str(tmp_path))
    (tmp_path / "vault").mkdir()
    (tmp_path / "vault" / "a.pdf").write_bytes(b"hello")
    assert svc.download_bytes("/uploads/vault/a.pdf") == b"hello"
    assert svc.download_bytes("/uploads/vault/missing.pdf") is None
    assert svc.download_bytes("/uploads/../secret.txt") is None
    assert svc.download_bytes(None) is None


def test_s3_key_parsing():
    svc = S3Storage.__new__(S3Storage)  # pure URL parsing — no client needed
    assert svc._key_from_url(
        "https://bucket.t3.storageapi.dev/vault/2/f.pdf") == "vault/2/f.pdf"
    assert svc._key_from_url("") is None
