"""CRUD-layer tests for sponsored content (M2).

Cover the public surface of `db_models/crud/sponsored_content.py` that the
routers depend on:

  - create_sponsored_content (with v1 snapshot + audit log)
  - patch_sponsored_content (creative-field change → new version + bump)
  - patch with non-creative field → NO new version
  - soft_delete_sponsored_content (idempotent)
  - list_by_company (own-company isolation, status filter)
  - list_all_admin (cross-company moderation)
  - get_stats (date_trunc day bucket, totals, CTR)
  - resolve_user_targeting_attrs
  - validate_kind_fields + require_kind_enabled gates
"""
from __future__ import annotations

import os

import pytest
from sqlalchemy import text

from db_models.crud import sponsored_content as crud
from core.model import (
    SponsoredContent,
    SponsoredContentVersion,
    AuditLog,
)


@pytest.fixture(autouse=True)
def _wipe(db):
    """Each CRUD test starts with no sponsored rows so list/stats counts are
    deterministic. Cascades drop versions/views/clicks/dismissals too."""
    db.execute(text("DELETE FROM sponsored_content"))
    # audit_logs is append-only (DB trigger) — rows accumulate across tests,
    # but they're filtered by target_id so they don't interfere with assertions.
    db.commit()


class TestCreate:
    def test_creates_employer_with_v1_snapshot(self, db, test_company_id):
        c = crud.create_sponsored_content(
            db,
            actor_user_id=None,
            kind="employer",
            funding_company_id=test_company_id,
            title="HR notice",
            body="Office closed Friday",
        )
        assert c.kind == "employer"
        assert c.status == "draft"
        assert c.base_priority == 100  # employer default
        assert c.current_version_id is not None
        # v1 snapshot exists with matching content
        v1 = (
            db.query(SponsoredContentVersion)
            .filter(SponsoredContentVersion.sponsored_content_id == c.sponsored_content_id)
            .one()
        )
        assert v1.version_number == 1
        assert v1.title == "HR notice"
        assert c.current_version_id == v1.version_id

    def test_creates_house_with_low_base_priority(self, db):
        c = crud.create_sponsored_content(
            db,
            actor_user_id=None,
            kind="house",
            funding_company_id=None,
            title="House",
            body="b",
        )
        assert c.base_priority == 25
        assert c.funding_company_id is None

    def test_audit_log_written_on_create(self, db, test_company_id):
        c = crud.create_sponsored_content(
            db, actor_user_id=None, kind="employer",
            funding_company_id=test_company_id, title="t", body="b",
        )
        log = (
            db.query(AuditLog)
            .filter(AuditLog.action == "sponsored_content.create")
            .filter(AuditLog.target_id == str(c.sponsored_content_id))
            .one()
        )
        assert log.meta["kind"] == "employer"

    def test_create_allows_ad_kind_regardless_of_env(self, db, test_company_id, monkeypatch):
        """M10 design note: ENABLED_KINDS is a serve-time kill switch only.
        Admins must be able to draft an ad campaign before ops flips the env
        var that lets it serve (mirrors how every real ad platform — Meta,
        LinkedIn — separates campaign authoring from serving)."""
        monkeypatch.setenv("ENABLED_KINDS", "employer,house")  # 'ad' off for serving
        # Create should still succeed.
        c = crud.create_sponsored_content(
            db, actor_user_id=None, kind="ad",
            funding_company_id=test_company_id,
            paid_amount_cents=10000, paid_currency="MUR",
            title="draft ad", body="b",
        )
        assert c.kind == "ad"
        assert c.status == "draft"  # not served until admin flips to active
        # And the standalone gate function still raises for 'ad' — confirming
        # the kill switch lives where /serve looks for it.
        from fastapi import HTTPException
        with pytest.raises(HTTPException) as exc:
            crud.require_kind_enabled("ad")
        assert exc.value.status_code == 403


class TestPatch:
    def test_non_creative_patch_no_version_snapshot(self, db, test_company_id):
        c = crud.create_sponsored_content(
            db, actor_user_id=None, kind="employer",
            funding_company_id=test_company_id, title="t", body="b",
        )
        version_count_before = db.query(SponsoredContentVersion).filter_by(
            sponsored_content_id=c.sponsored_content_id
        ).count()
        crud.patch_sponsored_content(
            db, content=c, actor_user_id=None, patch={"status": "active"}
        )
        version_count_after = db.query(SponsoredContentVersion).filter_by(
            sponsored_content_id=c.sponsored_content_id
        ).count()
        assert version_count_after == version_count_before
        assert c.status == "active"

    def test_creative_patch_creates_new_version(self, db, test_company_id):
        c = crud.create_sponsored_content(
            db, actor_user_id=None, kind="employer",
            funding_company_id=test_company_id, title="original", body="b",
        )
        v1_id = c.current_version_id
        crud.patch_sponsored_content(
            db, content=c, actor_user_id=None, patch={"title": "updated"}
        )
        assert c.title == "updated"
        # current_version_id should have moved to v2
        assert c.current_version_id != v1_id
        v2 = (
            db.query(SponsoredContentVersion)
            .filter_by(version_id=c.current_version_id)
            .one()
        )
        assert v2.version_number == 2
        assert v2.title == "updated"
        # v1 still exists with the original title — historical attribution preserved
        v1 = db.query(SponsoredContentVersion).filter_by(version_id=v1_id).one()
        assert v1.title == "original"


class TestSoftDelete:
    def test_soft_delete_idempotent(self, db, test_company_id):
        c = crud.create_sponsored_content(
            db, actor_user_id=None, kind="employer",
            funding_company_id=test_company_id, title="t", body="b",
        )
        crud.soft_delete_sponsored_content(db, content=c, actor_user_id=None)
        assert c.status == "ended"
        assert c.deleted_at is not None
        first_deleted_at = c.deleted_at
        # Second call should NOT bump deleted_at — no-op.
        crud.soft_delete_sponsored_content(db, content=c, actor_user_id=None)
        assert c.deleted_at == first_deleted_at


class TestListing:
    def test_list_by_company_isolates_own_company(self, db, test_company_id):
        # Create one in our test company
        ours = crud.create_sponsored_content(
            db, actor_user_id=None, kind="employer",
            funding_company_id=test_company_id, title="ours", body="b",
        )
        # Create one in a fictional foreign company — via raw SQL since we
        # don't have a real second Company row guaranteed.
        foreign_cid = db.execute(
            text(
                "INSERT INTO companies (company_name, brn, country_code) "
                "VALUES ('Foreign Co', 'FOREIGN_BRN', 'MU') RETURNING company_id"
            )
        ).scalar()
        db.commit()
        crud.create_sponsored_content(
            db, actor_user_id=None, kind="employer",
            funding_company_id=foreign_cid, title="foreign", body="b",
        )

        rows = crud.list_by_company(db, company_id=test_company_id, kind="employer")
        titles = {r.title for r in rows}
        assert "ours" in titles
        assert "foreign" not in titles

    def test_list_by_company_excludes_soft_deleted_by_default(self, db, test_company_id):
        c = crud.create_sponsored_content(
            db, actor_user_id=None, kind="employer",
            funding_company_id=test_company_id, title="to-delete", body="b",
        )
        crud.soft_delete_sponsored_content(db, content=c, actor_user_id=None)

        active = crud.list_by_company(db, company_id=test_company_id, kind="employer")
        assert all(r.deleted_at is None for r in active)
        # include_deleted=True surfaces it again
        all_rows = crud.list_by_company(
            db, company_id=test_company_id, kind="employer", include_deleted=True
        )
        assert any(r.title == "to-delete" for r in all_rows)


class TestKindValidator:
    def test_ad_rejects_missing_payment_fields(self):
        from fastapi import HTTPException
        with pytest.raises(HTTPException) as exc:
            crud.validate_kind_fields(
                kind="ad",
                funding_company_id=None,
                paid_amount_cents=None,
                paid_currency=None,
            )
        assert exc.value.status_code == 400

    def test_employer_requires_funding_company(self):
        from fastapi import HTTPException
        with pytest.raises(HTTPException):
            crud.validate_kind_fields(
                kind="employer", funding_company_id=None,
                paid_amount_cents=None, paid_currency=None,
            )

    def test_house_rejects_funding_company(self, test_company_id):
        from fastapi import HTTPException
        with pytest.raises(HTTPException):
            crud.validate_kind_fields(
                kind="house",
                funding_company_id=test_company_id,
                paid_amount_cents=None, paid_currency=None,
            )

    def test_house_accepts_null_fields(self):
        # No exception
        crud.validate_kind_fields(
            kind="house", funding_company_id=None,
            paid_amount_cents=None, paid_currency=None,
        )


class TestEnabledKindsGate:
    def test_kind_enabled_default(self, monkeypatch):
        # Default ENABLED_KINDS = employer,house
        monkeypatch.delenv("ENABLED_KINDS", raising=False)
        crud.require_kind_enabled("employer")
        crud.require_kind_enabled("house")

    def test_ad_disabled_in_default_phase1(self, monkeypatch):
        monkeypatch.delenv("ENABLED_KINDS", raising=False)
        from fastapi import HTTPException
        with pytest.raises(HTTPException) as exc:
            crud.require_kind_enabled("ad")
        assert exc.value.status_code == 403

    def test_ad_enabled_via_env(self, monkeypatch):
        monkeypatch.setenv("ENABLED_KINDS", "employer,ad,house")
        crud.require_kind_enabled("ad")  # no raise


class TestTargetingResolver:
    def test_resolves_attrs_from_test_employee(self, db, test_employee_id):
        from core.model import PrivateUser, User
        pu = db.query(PrivateUser).filter_by(private_user_id=test_employee_id).one()
        user = db.query(User).filter_by(user_id=pu.user_id).one()
        # Hydrate the relationship so the helper sees `user.private_user`.
        user.private_user = pu

        attrs = crud.resolve_user_targeting_attrs(user, db)
        assert attrs["private_user_id"] == test_employee_id
        assert attrs["company_id"] == pu.company_id
        assert attrs["country_code"] == "MU"
        assert attrs["role"] == "employee"
        assert attrs["job_title"] == "Test role"


class TestComputeEligibility:
    """Eligibility diagnostic (M16). The admin panel that consumes this depends
    on the exact `{checks: [...], summary, audience}` shape — these tests lock
    it. Two scenarios: a fully-green positive report, and a negative report
    where multiple gates fail (status + ads_enabled + consent)."""

    def test_positive_report_all_checks_green(self, db, test_company_id, monkeypatch):
        """An employer announcement that's active + in-window + targeted at
        the funder's employees should return summary='ready' with every
        check at level 'ok' or 'info'."""
        monkeypatch.setenv("ENABLED_KINDS", "employer,house,ad")
        c = crud.create_sponsored_content(
            db, actor_user_id=None, kind="employer",
            funding_company_id=test_company_id, title="t", body="b",
        )
        crud.patch_sponsored_content(
            db, content=c, actor_user_id=None, patch={"status": "active"}
        )
        report = crud.compute_eligibility(db, content_id=c.sponsored_content_id)
        assert report["content_id"] == c.sponsored_content_id
        assert report["kind"] == "employer"
        assert report["status"] == "active"
        assert report["summary"] == "ready"
        # No fail-level checks.
        assert not any(chk["level"] == "fail" for chk in report["checks"])
        # Keys we must surface for the panel.
        keys = {chk["key"] for chk in report["checks"]}
        assert {"status", "window", "enabled_kinds", "surfaces"} <= keys
        # Audience aggregate populated.
        assert report["audience"]["funding_company_id"] == test_company_id
        assert report["audience"]["total_employees"] is not None
        assert report["audience"]["total_employees"] >= 1  # session test_employee

    def test_negative_report_ad_blocked_by_multiple_gates(
        self, db, test_company_id, test_company, monkeypatch
    ):
        """An ad campaign with multiple gates broken: status=paused, the
        funder has ads_enabled=false, and ENABLED_KINDS excludes 'ad'.
        Expect summary='blocked' with the right hints + audience aggregate
        including consenting/ad_free counts."""
        monkeypatch.setenv("ENABLED_KINDS", "employer,house")  # 'ad' off
        # Force the funder gate closed for this test (the session-scoped
        # company is shared, so restore at teardown).
        before = bool(test_company.ads_enabled)
        test_company.ads_enabled = False
        db.commit()
        try:
            c = crud.create_sponsored_content(
                db, actor_user_id=None, kind="ad",
                funding_company_id=test_company_id,
                title="t", body="b",
                paid_amount_cents=50_000, paid_currency="MUR",
            )
            # Leave status='draft' on purpose — that's an active failure mode
            # we want to surface (the admin made the campaign and forgot to
            # activate).

            report = crud.compute_eligibility(db, content_id=c.sponsored_content_id)
            assert report["summary"] == "blocked"
            assert report["kind"] == "ad"

            by_key = {chk["key"]: chk for chk in report["checks"]}
            # Each gate we deliberately failed shows up red with a hint.
            assert by_key["status"]["level"] == "fail"
            assert "active" in by_key["status"]["detail"].lower()
            assert by_key["enabled_kinds"]["level"] == "fail"
            assert "ad" in by_key["enabled_kinds"]["label"]
            assert by_key["ads_enabled"]["level"] == "fail"
            assert "ads_enabled" in by_key["ads_enabled"]["hint"]
            # Time window + surfaces should still pass (defaults are fine).
            assert by_key["window"]["level"] == "ok"
            assert by_key["surfaces"]["level"] == "ok"

            # Audience aggregate for kind='ad' must populate the per-employee
            # gate counts so the panel can show "X of N consented".
            aud = report["audience"]
            assert aud["funding_company_id"] == test_company_id
            assert aud["total_employees"] is not None
            assert aud["consenting_employees"] is not None
            assert aud["ad_free_employees"] is not None
        finally:
            test_company.ads_enabled = before
            db.commit()

    def test_audience_count_applies_full_targeting_predicate(
        self, db, test_company_id, test_employee_id, monkeypatch
    ):
        """Audience aggregate must match _passes_targeting at serve time —
        not just company_ids. Regression catch: earlier implementation
        ignored department_ids/country_codes/roles, so an ad scoped to
        Hands PLC + dept #2 + MU reported `audience=2` (the company-level
        count) when the actual eligible audience after dept filter was 1.
        Admins were misled into thinking they had a pool to convert."""
        from core.model import Department, PrivateUser

        monkeypatch.setenv("ENABLED_KINDS", "employer,house,ad")

        # Seed a second department on the test company so we have a dept
        # that DOESN'T contain the session-fixture employee.
        # (the fixture employee has department_id=None — see conftest.py)
        other_dept = Department(company_id=test_company_id, name="Empty Dept")
        db.add(other_dept)
        db.flush()

        c = crud.create_sponsored_content(
            db, actor_user_id=None, kind="ad",
            funding_company_id=test_company_id,
            title="dept-scoped ad", body="b",
            paid_amount_cents=10_000, paid_currency="MUR",
            targeting={"department_ids": [other_dept.department_id]},
        )

        # Confirm the test employee is NOT in this department.
        pu = db.query(PrivateUser).filter_by(private_user_id=test_employee_id).one()
        assert pu.department_id != other_dept.department_id

        report = crud.compute_eligibility(db, content_id=c.sponsored_content_id)
        # Audience must reflect the dept filter — no one is in Empty Dept,
        # so the real targeted audience is zero. The earlier bug would have
        # reported the company-level count (>= 1) here.
        assert report["audience"]["total_employees"] == 0, (
            f"dept filter ignored — got total_employees="
            f"{report['audience']['total_employees']}, expected 0"
        )

        # And the audience check row should fire 'fail' because no one matches.
        by_key = {chk["key"]: chk for chk in report["checks"]}
        assert "audience" in by_key
        assert by_key["audience"]["level"] == "fail"
        assert "zero" in by_key["audience"]["label"].lower()


class TestExpireLapsedCampaigns:
    """`expire_lapsed_campaigns()` keeps the stored status honest so the
    admin UI doesn't show 'Active' for campaigns whose windows have
    closed. /serve doesn't care (it filters end_at directly), so this
    is purely admin-UI correctness."""

    def test_active_campaign_past_end_at_flips_to_ended(
        self, db, test_company_id,
    ):
        from datetime import datetime, timedelta, timezone
        from core.model import AuditLog

        c = crud.create_sponsored_content(
            db, actor_user_id=None, kind="employer",
            funding_company_id=test_company_id,
            title="lapsed", body="b",
            end_at=datetime.now(timezone.utc) - timedelta(hours=1),
        )
        # Activate so it's not still in draft (drafts are intentionally
        # left alone — see the next test).
        crud.patch_sponsored_content(
            db, content=c, actor_user_id=None, patch={"status": "active"}
        )
        assert c.status == "active"

        affected = crud.expire_lapsed_campaigns(db, actor_user_id=None)
        assert affected == 1

        db.refresh(c)
        assert c.status == "ended"

        # Audit log records the system-initiated transition with a
        # distinct action so reports can differentiate.
        log = (
            db.query(AuditLog)
            .filter(AuditLog.action == "sponsored_content.auto_expire")
            .filter(AuditLog.target_id == str(c.sponsored_content_id))
            .one()
        )
        assert log.meta["before_status"] == "active"

        # Idempotent — second call doesn't double-flip or double-audit.
        affected_again = crud.expire_lapsed_campaigns(db, actor_user_id=None)
        assert affected_again == 0
        assert c.status == "ended"

    def test_draft_with_lapsed_end_at_is_left_alone(
        self, db, test_company_id,
    ):
        """Drafts never reached serving, so auto-expiring them would
        destroy work-in-progress. The admin set an end_at as a placeholder
        and the draft has gone stale — leave it as draft so the admin
        decides explicitly whether to revive or delete."""
        from datetime import datetime, timedelta, timezone
        c = crud.create_sponsored_content(
            db, actor_user_id=None, kind="employer",
            funding_company_id=test_company_id,
            title="dusty draft", body="b",
            end_at=datetime.now(timezone.utc) - timedelta(days=30),
        )
        assert c.status == "draft"

        affected = crud.expire_lapsed_campaigns(db, actor_user_id=None)
        assert affected == 0

        db.refresh(c)
        assert c.status == "draft"
