"""P4 deny-by-default SWEEP (COMPANY-RBAC-PLAN.md).

With COMPANY_RBAC_ENABLED on, a management-role employee whose role grants NO
permissions must be denied on EVERY company-scoped GET route. This is the
coverage gate: any company route that returns 2xx for that user is a leak.

`KNOWN_UNGATED_PREFIXES` lists routes not yet migrated to a permission gate —
they're expected to still let the empty-perm admin through (today's behavior).
The list must shrink to empty before COMPANY_RBAC_ENABLED is turned on in prod;
when it's empty this test proves full deny-by-default coverage.
"""
from __future__ import annotations

import uuid

import pytest
from sqlalchemy.orm import sessionmaker

# Sensitive company-scoped surfaces — matched by path SUBSTRING (real paths use
# /api/v1/companies/{id}/... and /api/v1/company/{id}/...). A zero-permission
# management employee must be denied on every one of these GET routes.
# NOTE: "/departments" GET is intentionally public (onboarding lookups of dept
# names — low sensitivity); its writes are gated. So it's excluded here.
SENSITIVE_SUBSTRINGS = (
    "/salary-structures", "/salary-components", "/leave-types", "/time-logs",
    "/bonus-liability", "/payroll", "/payslips", "/dashboard",
    "/reports", "/announcements", "/overtime", "/roles", "/permissions",
    "/compliance/company",
)

# Empty: every sensitive company GET route is now permission-gated. If this grows
# again, the flag must NOT be turned on until it's back to empty.
KNOWN_UNGATED_PREFIXES: tuple = ()


def _is_company_get(path: str) -> bool:
    if "/admin/" in path or path.startswith("/api/v1/admin"):
        return False  # platform-admin surface, gated separately
    # Self-service "view your own data" routes — authorized by "this is you",
    # not by company-wide permissions, so a zero-permission employee is
    # SUPPOSED to get their own 2xx here (same category as /departments
    # above: intentionally not gated, not "not yet migrated"). Matches
    # /private-users/me/payslips/estimate and its .pdf sibling.
    if "/private-users/me/" in path:
        return False
    return any(s in path for s in SENSITIVE_SUBSTRINGS)


def _dummy_path(path: str) -> str:
    """Replace {param} placeholders with a non-existent id so the route resolves
    but the resource lookup can't succeed (404 is fine — it's not a 2xx leak)."""
    out = []
    for seg in path.split("/"):
        if seg.startswith("{") and seg.endswith("}"):
            out.append("999999999")
        else:
            out.append(seg)
    return "/".join(out)


@pytest.fixture()
def empty_perm_client(_engine, db, test_company_id):
    """A TestClient impersonating a management employee whose company role grants
    NO permissions, with COMPANY_RBAC_ENABLED on."""
    from fastapi import Depends as _Depends
    from fastapi.testclient import TestClient
    from sqlalchemy.orm import Session
    from core import config as core_config
    from core.dependencies import get_current_user
    from core.model import User, PrivateUser, CompanyRole
    from core.company_user_role import CompanyUserRole
    from main import app

    s = uuid.uuid4().hex[:8]
    u = User(user_type="private", email=f"sweep-{s}@kontokaz.test",
             user_name=f"sweep-{s}", password_hash="x")
    db.add(u); db.flush()
    p = PrivateUser(user_id=u.user_id, first_name="Sweep", last_name="Test",
                    company_id=test_company_id, pass_port_number=f"SW_{s}", role="manager")
    db.add(p); db.flush()
    db.add(CompanyRole(company_id=test_company_id, name="Empty Role",
                       description="no perms", is_system=False, permissions=[]))
    db.add(CompanyUserRole(company_id=test_company_id, private_user_id=p.private_user_id,
                           role="empty_role"))
    db.commit()
    uid = u.user_id

    SessionFactory = sessionmaker(autocommit=False, autoflush=False, bind=_engine)

    def _override_db():
        d = SessionFactory()
        try:
            yield d
        finally:
            d.close()

    def _override_user(d: Session = _Depends(core_config.get_db)) -> User:
        return d.query(User).filter(User.user_id == uid).one()

    app.dependency_overrides[core_config.get_db] = _override_db
    app.dependency_overrides[get_current_user] = _override_user
    client = TestClient(app, raise_server_exceptions=False)
    yield client, test_company_id
    app.dependency_overrides.clear()


def test_company_get_routes_deny_empty_permission(empty_perm_client, monkeypatch):
    monkeypatch.setenv("COMPANY_RBAC_ENABLED", "true")
    client, company_id = empty_perm_client
    from main import app

    leaks = []
    for route in app.routes:
        path = getattr(route, "path", "")
        methods = getattr(route, "methods", set()) or set()
        if "GET" not in methods:
            continue
        if not _is_company_get(path):
            continue
        if path.startswith(KNOWN_UNGATED_PREFIXES):
            continue
        url = _dummy_path(path) + f"?company_id={company_id}"
        resp = client.get(url)
        # 2xx = the empty-permission user got data → a leak. 401/403/404/422 are fine.
        if resp.status_code in (200, 201, 204):
            leaks.append((path, resp.status_code))

    assert not leaks, (
        "Company GET routes leaked to a zero-permission user "
        f"(COMPANY_RBAC_ENABLED on): {leaks}"
    )
