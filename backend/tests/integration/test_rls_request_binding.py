"""RLS request-binding coverage (M5b Phase 0).

The global async dependency `bind_tenant_context` must set `app.company_id` from
the JWT for every API request, in a way that:
  * a role-holder / owner binds to their company_id;
  * a platform admin binds to the '*' bypass sentinel;
  * an unauthenticated request binds nothing;
  * the value SURVIVES a mid-handler commit (the after_begin bridge re-applies it
    because the async dependency sets the ContextVar in the request context, which
    propagates to the route — the whole point of the cross-transaction fix).

These run against the real Postgres GUC but need no RLS policies (inert).
"""
from fastapi import FastAPI, Depends
from fastapi.testclient import TestClient
from sqlalchemy import text
from sqlalchemy.orm import Session

from core.config import get_db
from core.dependencies import bind_tenant_context
from core.security import create_access_token


def _app() -> TestClient:
    app = FastAPI(dependencies=[Depends(bind_tenant_context)])

    @app.get("/probe")
    def probe(db: Session = Depends(get_db)):
        pre = db.execute(text("SELECT current_setting('app.company_id', true)")).scalar()
        db.commit()  # SET LOCAL resets here; bridge must re-apply on the next txn
        post = db.execute(text("SELECT current_setting('app.company_id', true)")).scalar()
        return {"pre": pre, "post": post}

    return TestClient(app)


def _token(**user_claims) -> str:
    return create_access_token(user_data=user_claims, audience="web")


def test_role_holder_binds_company():
    tok = _token(user_id=2, user_type="private", company_id=7, is_superuser=False)
    r = _app().get("/probe", headers={"Authorization": f"Bearer {tok}"}).json()
    assert r["pre"] == "7"
    assert r["post"] == "7", "tenant must survive a mid-handler commit"


def test_platform_admin_binds_bypass():
    tok = _token(user_id=1, user_type="company", is_superuser=True)
    r = _app().get("/probe", headers={"Authorization": f"Bearer {tok}"}).json()
    assert r["pre"] == "*"
    assert r["post"] == "*"


def test_unauthenticated_binds_nothing():
    r = _app().get("/probe").json()
    assert r["pre"] == ""
    assert r["post"] == ""


def test_no_cross_request_leak():
    """An admin (bypass) request followed by an anonymous request must not let the
    anonymous one inherit '*' — the ContextVar is reset in the dependency finally."""
    c = _app()
    admin = _token(user_id=1, is_superuser=True)
    assert c.get("/probe", headers={"Authorization": f"Bearer {admin}"}).json()["pre"] == "*"
    assert c.get("/probe").json()["pre"] == "", "anonymous request must not inherit a tenant"
