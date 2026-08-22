"""Geofencing v3 — location-based clock-in/out enforcement.

Covers the pure-service decisions (haversine, accuracy gate, mock detection,
QR/Wi-Fi anchors, block/flag/off modes) and the create_time_log integration
(the punch path mobile and kiosk both funnel through).

The shared test company/employee fixtures are session-scoped, so these tests
restore ``geofence_default_mode`` and delete any fences they create.
"""
from __future__ import annotations

import asyncio
from datetime import date, datetime, time, timezone

import pytest
from fastapi import HTTPException
from sqlalchemy.orm import Session

from core.model import Company, CompanyGeofence, Job
from db_models.crud.job import create_time_log
from schema.job_schema import CreateTimeLog, GeoCheckContext
from services.geofence_service import (
    ACCURACY_THRESHOLD_M,
    PunchContext,
    enforce_punch,
    get_company_geofences,
    haversine_m,
    resolve_punch,
)

# HQ fence centre (Mauritius, same coords the kiosk tests use).
HQ_LAT, HQ_LNG = -20.16, 57.50
# ~1.1 km north of HQ — comfortably outside a 200 m fence.
FAR_LAT, FAR_LNG = -20.15, 57.50
FAR_DISTANCE_M = haversine_m(HQ_LAT, HQ_LNG, FAR_LAT, FAR_LNG)
# A second site (BRANCH) ~2.4 km from HQ — proves a company can hold several
# independent fences and that the NEAREST one governs an outside punch.
BRANCH_LAT, BRANCH_LNG = -20.14, 57.51
# ~260 m east of BRANCH: outside its 200 m radius, nearest fence = BRANCH.
NEAR_BRANCH_LAT, NEAR_BRANCH_LNG = -20.14, 57.5125


@pytest.fixture()
def geofenced_company(db: Session, test_company_id: int):
    """Company with geofencing enabled + one HQ fence. Restores mode and
    removes the fence after the test.

    ``set_company_mode(mode)`` and ``set_fence_mode(mode)`` let tests drive
    the master switch and per-fence override independently.
    """
    company = db.query(Company).filter(Company.company_id == test_company_id).one()
    original_mode = company.geofence_default_mode

    fence = CompanyGeofence(
        company_id=test_company_id,
        name="HQ",
        latitude=HQ_LAT,
        longitude=HQ_LNG,
        radius_meters=200,
        mode="block",
        anchor_qr_token="test-qr-123",
        anchor_wifi_bssids=["AA:BB:CC:DD:EE:FF"],
    )
    db.add(fence)
    db.commit()

    def set_company_mode(mode: str):
        company.geofence_default_mode = mode
        db.commit()

    def set_fence_mode(mode: str):
        fence.mode = mode
        db.commit()

    yield company, set_company_mode, set_fence_mode

    company.geofence_default_mode = original_mode
    db.query(CompanyGeofence).filter(
        CompanyGeofence.company_id == test_company_id,
        CompanyGeofence.name == "HQ",
    ).delete(synchronize_session=False)
    db.commit()


def _fences(db: Session, company_id: int):
    return get_company_geofences(company_id, db)


@pytest.fixture()
def branch_fence(db: Session, test_company_id: int):
    """A SECOND site (BRANCH) for the same company — multiple-location lane.

    Complements ``geofenced_company`` (which owns the HQ fence). Removed after
    the test so it can't leak into other companies' assertions.
    """
    fence = CompanyGeofence(
        company_id=test_company_id,
        name="BRANCH",
        latitude=BRANCH_LAT,
        longitude=BRANCH_LNG,
        radius_meters=200,
        mode="block",
    )
    db.add(fence)
    db.commit()
    yield fence
    db.query(CompanyGeofence).filter(
        CompanyGeofence.company_id == test_company_id,
        CompanyGeofence.name == "BRANCH",
    ).delete(synchronize_session=False)
    db.commit()


@pytest.fixture()
def assigned_employee(db: Session, test_employee):
    """test_employee with a configurable home-site assignment, restored after."""
    def _set(fence_id: int):
        test_employee.home_geofence_id = fence_id
        db.commit()
    yield test_employee, _set
    test_employee.home_geofence_id = None
    db.commit()


class TestHaversine:
    def test_known_distance(self):
        assert 110_000 < haversine_m(0, 0, 0, 1) < 112_000

    def test_zero_at_same_point(self):
        assert haversine_m(HQ_LAT, HQ_LNG, HQ_LAT, HQ_LNG) == 0.0

    def test_far_point_is_outside_radius(self):
        assert FAR_DISTANCE_M > 200


class TestResolvePunch:
    def test_disabled_company_never_blocks(self, db, geofenced_company):
        company, set_company_mode, _ = geofenced_company
        set_company_mode("off")
        ctx = PunchContext(latitude=FAR_LAT, longitude=FAR_LNG, accuracy_m=5)
        out = resolve_punch(company, _fences(db, company.company_id), ctx)
        assert out.inside is True
        assert out.mode is None
        assert out.flagged is False

    def test_inside_fence_verified(self, db, geofenced_company):
        company, set_company_mode, _ = geofenced_company
        set_company_mode("block")
        ctx = PunchContext(latitude=HQ_LAT, longitude=HQ_LNG, accuracy_m=5)
        out = resolve_punch(company, _fences(db, company.company_id), ctx)
        assert out.inside is True
        assert out.reason == "inside"
        assert out.verified_by == "gps"
        assert out.flagged is False

    def test_outside_fence_block_mode(self, db, geofenced_company):
        company, set_company_mode, _ = geofenced_company
        set_company_mode("block")
        ctx = PunchContext(latitude=FAR_LAT, longitude=FAR_LNG, accuracy_m=5)
        out = resolve_punch(company, _fences(db, company.company_id), ctx)
        assert out.inside is False
        assert out.mode == "block"
        assert out.flagged is False
        assert out.distance_m == pytest.approx(FAR_DISTANCE_M, rel=0.05)

    def test_outside_fence_flag_mode(self, db, geofenced_company):
        company, set_company_mode, set_fence_mode = geofenced_company
        set_company_mode("flag")
        set_fence_mode("flag")
        ctx = PunchContext(latitude=FAR_LAT, longitude=FAR_LNG, accuracy_m=5)
        out = resolve_punch(company, _fences(db, company.company_id), ctx)
        assert out.inside is False
        assert out.mode == "flag"
        assert out.flagged is True

    def test_unverifiable_accuracy_gate(self, db, geofenced_company):
        company, set_company_mode, _ = geofenced_company
        set_company_mode("block")
        ctx = PunchContext(latitude=HQ_LAT, longitude=HQ_LNG, accuracy_m=ACCURACY_THRESHOLD_M + 10)
        out = resolve_punch(company, _fences(db, company.company_id), ctx)
        assert out.inside is False
        assert out.reason == "unverifiable_accuracy"
        assert out.mode == "block"

    def test_mock_detected_blocks(self, db, geofenced_company):
        company, set_company_mode, _ = geofenced_company
        set_company_mode("block")
        ctx = PunchContext(latitude=HQ_LAT, longitude=HQ_LNG, accuracy_m=5, mock_detected=True)
        out = resolve_punch(company, _fences(db, company.company_id), ctx)
        assert out.inside is False
        assert out.reason == "mock_detected"

    def test_no_location_blocks_in_block_mode(self, db, geofenced_company):
        company, set_company_mode, _ = geofenced_company
        set_company_mode("block")
        out = resolve_punch(company, _fences(db, company.company_id), PunchContext())
        assert out.inside is False
        assert out.reason == "no_location"

    def test_qr_anchor_verifies_outside(self, db, geofenced_company):
        company, set_company_mode, _ = geofenced_company
        set_company_mode("block")
        ctx = PunchContext(latitude=FAR_LAT, longitude=FAR_LNG, accuracy_m=5, qr_token="test-qr-123")
        out = resolve_punch(company, _fences(db, company.company_id), ctx)
        assert out.inside is True
        assert out.verified_by == "qr"
        assert out.flagged is False

    def test_wifi_anchor_verifies_outside(self, db, geofenced_company):
        company, set_company_mode, _ = geofenced_company
        set_company_mode("block")
        ctx = PunchContext(latitude=FAR_LAT, longitude=FAR_LNG, accuracy_m=5, wifi_bssid="aa:bb:cc:dd:ee:ff")
        out = resolve_punch(company, _fences(db, company.company_id), ctx)
        assert out.inside is True
        assert out.verified_by == "wifi"

    def test_kiosk_always_trusted(self, db, geofenced_company):
        company, set_company_mode, _ = geofenced_company
        set_company_mode("block")
        ctx = PunchContext(latitude=FAR_LAT, longitude=FAR_LNG, source="kiosk")
        out = resolve_punch(company, _fences(db, company.company_id), ctx)
        assert out.inside is True
        assert out.verified_by == "kiosk_device"


class TestMultipleSites:
    """A company can hold several fences (HQ, branch, warehouse…): any fence
    verifies an inside punch, and the NEAREST fence governs an outside one."""

    def _hq_id(self, db: Session) -> int:
        return db.query(CompanyGeofence).filter(
            CompanyGeofence.company_id == db.query(CompanyGeofence).filter(
                CompanyGeofence.name == "HQ").one().company_id,
            CompanyGeofence.name == "HQ",
        ).one().geofence_id

    def test_inside_second_site_verified(self, db, geofenced_company, branch_fence):
        company, set_company_mode, _ = geofenced_company
        set_company_mode("block")
        ctx = PunchContext(latitude=BRANCH_LAT, longitude=BRANCH_LNG, accuracy_m=5)
        out = resolve_punch(company, _fences(db, company.company_id), ctx)
        assert out.inside is True
        assert out.fence_id == branch_fence.geofence_id
        assert out.reason == "inside"

    def test_inside_first_site_still_verified_with_second_present(self, db, geofenced_company, branch_fence):
        company, set_company_mode, _ = geofenced_company
        set_company_mode("block")
        ctx = PunchContext(latitude=HQ_LAT, longitude=HQ_LNG, accuracy_m=5)
        out = resolve_punch(company, _fences(db, company.company_id), ctx)
        assert out.inside is True
        assert out.fence_id == self._hq_id(db)
        assert out.reason == "inside"

    def test_nearest_site_mode_governs_outside(self, db, geofenced_company, branch_fence):
        # Permissive company default, but the NEAREST site (BRANCH) is strict.
        company, set_company_mode, _ = geofenced_company
        set_company_mode("flag")
        branch_fence.mode = "block"
        db.commit()
        ctx = PunchContext(latitude=NEAR_BRANCH_LAT, longitude=NEAR_BRANCH_LNG, accuracy_m=5)
        out = resolve_punch(company, _fences(db, company.company_id), ctx)
        assert out.inside is False
        assert out.fence_id == branch_fence.geofence_id
        assert out.mode == "block"
        assert out.flagged is False

    def test_per_site_flag_overrides_strict_default_inside(self, db, geofenced_company, branch_fence):
        # Strict company default, but the BRANCH site opts into flag mode — an
        # inside punch there is allowed and recorded under the per-site mode.
        company, set_company_mode, _ = geofenced_company
        set_company_mode("block")
        branch_fence.mode = "flag"
        db.commit()
        ctx = PunchContext(latitude=BRANCH_LAT, longitude=BRANCH_LNG, accuracy_m=5)
        out = resolve_punch(company, _fences(db, company.company_id), ctx)
        assert out.inside is True
        assert out.mode == "flag"

    def test_create_time_log_with_two_sites_blocks_outside_nearest(self, db, test_employee, geofenced_company, branch_fence):
        # Integration: two active fences, punch outside both near BRANCH →
        # HTTP 403 with BRANCH as the fence in the detail.
        company, set_company_mode, _ = geofenced_company
        set_company_mode("block")
        branch_fence.mode = "block"
        db.commit()
        job = db.query(Job).filter(Job.private_user_id == test_employee.private_user_id).first()
        payload = CreateTimeLog(
            job_id=job.job_id,
            private_user_id=test_employee.private_user_id,
            day_of_week=date.today().strftime("%A"),
            start_time=datetime.combine(date.today(), time(9, 0), tzinfo=timezone.utc),
            end_time=datetime.combine(date.today(), time(9, 2), tzinfo=timezone.utc),
            location={"latitude": NEAR_BRANCH_LAT, "longitude": NEAR_BRANCH_LNG, "accuracy": 5},
            geo_check=GeoCheckContext(accuracy_m=5),
            created_source="mobile",
        )
        from db_models.crud.job import create_time_log
        with pytest.raises(HTTPException) as exc:
            asyncio.run(create_time_log(payload, db=db, client_ip="127.0.0.1"))
        assert exc.value.status_code == 403
        assert exc.value.detail["code"] == "outside_geofence"
        assert exc.value.detail["fence"] == branch_fence.name


class TestHomeSiteEnforcement:
    """An employee assigned a home site is judged against THAT site ONLY —
    clocking in at a different branch is outside and governed by their site's
    mode (block rejects, flag marks). No assignment → any-fence rules."""

    def test_assigned_branch_punch_at_branch_verified(self, db, geofenced_company, branch_fence, assigned_employee):
        company, set_company_mode, _ = geofenced_company
        set_company_mode("block")
        employee, assign = assigned_employee
        assign(branch_fence.geofence_id)
        ctx = PunchContext(latitude=BRANCH_LAT, longitude=BRANCH_LNG, accuracy_m=5)
        out = resolve_punch(company, _fences(db, company.company_id), ctx)
        assert out.inside is True
        assert out.fence_id == branch_fence.geofence_id

    def test_assigned_branch_punch_at_hq_is_outside(self, db, geofenced_company, branch_fence, assigned_employee):
        # Port-Louis employee punches at HQ → outside, judged by the BRANCH fence.
        company, set_company_mode, _ = geofenced_company
        set_company_mode("flag")
        employee, assign = assigned_employee
        assign(branch_fence.geofence_id)
        ctx = PunchContext(latitude=HQ_LAT, longitude=HQ_LNG, accuracy_m=5,
                           home_geofence_id=branch_fence.geofence_id)
        out = resolve_punch(company, _fences(db, company.company_id), ctx)
        assert out.inside is False
        assert out.fence_id == branch_fence.geofence_id
        assert out.mode == "block"   # BRANCH fence mode (default block)
        assert out.flagged is False

    def test_assigned_branch_hq_qr_anchor_does_not_verify(self, db, geofenced_company, branch_fence, assigned_employee):
        # HQ's QR anchor must NOT verify an employee assigned to BRANCH.
        company, set_company_mode, _ = geofenced_company
        set_company_mode("block")
        employee, assign = assigned_employee
        assign(branch_fence.geofence_id)
        ctx = PunchContext(latitude=HQ_LAT, longitude=HQ_LNG, accuracy_m=5, qr_token="test-qr-123",
                           home_geofence_id=branch_fence.geofence_id)
        out = resolve_punch(company, _fences(db, company.company_id), ctx)
        assert out.inside is False
        assert out.reason == "outside"

    def test_assigned_branch_flag_mode_flags_at_other_site(self, db, geofenced_company, branch_fence, assigned_employee):
        company, set_company_mode, _ = geofenced_company
        set_company_mode("block")
        branch_fence.mode = "flag"
        db.commit()
        employee, assign = assigned_employee
        assign(branch_fence.geofence_id)
        ctx = PunchContext(latitude=HQ_LAT, longitude=HQ_LNG, accuracy_m=5,
                           home_geofence_id=branch_fence.geofence_id)
        out = resolve_punch(company, _fences(db, company.company_id), ctx)
        assert out.inside is False
        assert out.flagged is True
        assert out.mode == "flag"

    def test_assigned_hq_punch_at_hq_verified(self, db, geofenced_company, assigned_employee):
        company, set_company_mode, _ = geofenced_company
        set_company_mode("block")
        employee, assign = assigned_employee
        hq_id = db.query(CompanyGeofence).filter(CompanyGeofence.name == "HQ").one().geofence_id
        assign(hq_id)
        ctx = PunchContext(latitude=HQ_LAT, longitude=HQ_LNG, accuracy_m=5)
        out = resolve_punch(company, _fences(db, company.company_id), ctx)
        assert out.inside is True
        assert out.fence_id == hq_id

    def test_deleted_home_site_falls_back_to_any_fence(self, db, geofenced_company, branch_fence, assigned_employee):
        # Soft-deleted home site → fall back to any-active-fence so nobody locks out.
        company, set_company_mode, _ = geofenced_company
        set_company_mode("block")
        employee, assign = assigned_employee
        assign(branch_fence.geofence_id)
        branch_fence.deleted_at = datetime.now(timezone.utc)
        db.commit()
        try:
            ctx = PunchContext(latitude=HQ_LAT, longitude=HQ_LNG, accuracy_m=5)
            out = resolve_punch(company, _fences(db, company.company_id), ctx)
            assert out.inside is True
        finally:
            branch_fence.deleted_at = None
            db.commit()

    def test_inactive_home_site_falls_back_to_any_fence(self, db, geofenced_company, branch_fence, assigned_employee):
        company, set_company_mode, _ = geofenced_company
        set_company_mode("block")
        employee, assign = assigned_employee
        assign(branch_fence.geofence_id)
        branch_fence.active = False
        db.commit()
        try:
            ctx = PunchContext(latitude=HQ_LAT, longitude=HQ_LNG, accuracy_m=5)
            out = resolve_punch(company, _fences(db, company.company_id), ctx)
            assert out.inside is True
        finally:
            branch_fence.active = True
            db.commit()

    def test_create_time_log_assigned_branch_blocks_at_hq(self, db, test_employee, geofenced_company, branch_fence):
        # Integration through the real clock-in path: assigned to BRANCH,
        # punching at HQ → HTTP 403 naming the BRANCH fence.
        company, set_company_mode, _ = geofenced_company
        set_company_mode("block")
        test_employee.home_geofence_id = branch_fence.geofence_id
        db.commit()
        try:
            job = db.query(Job).filter(Job.private_user_id == test_employee.private_user_id).first()
            payload = CreateTimeLog(
                job_id=job.job_id,
                private_user_id=test_employee.private_user_id,
                day_of_week=date.today().strftime("%A"),
                start_time=datetime.combine(date.today(), time(9, 0), tzinfo=timezone.utc),
                end_time=datetime.combine(date.today(), time(9, 2), tzinfo=timezone.utc),
                location={"latitude": HQ_LAT, "longitude": HQ_LNG, "accuracy": 5},
                geo_check=GeoCheckContext(accuracy_m=5),
                created_source="mobile",
            )
            from db_models.crud.job import create_time_log
            with pytest.raises(HTTPException) as exc:
                asyncio.run(create_time_log(payload, db=db, client_ip="127.0.0.1"))
            assert exc.value.status_code == 403
            assert exc.value.detail["code"] == "outside_geofence"
            assert exc.value.detail["fence"] == branch_fence.name
        finally:
            test_employee.home_geofence_id = None
            db.commit()

    def test_create_time_log_assigned_branch_allows_at_branch(self, db, test_employee, geofenced_company, branch_fence):
        company, set_company_mode, _ = geofenced_company
        set_company_mode("block")
        test_employee.home_geofence_id = branch_fence.geofence_id
        db.commit()
        try:
            job = db.query(Job).filter(Job.private_user_id == test_employee.private_user_id).first()
            payload = CreateTimeLog(
                job_id=job.job_id,
                private_user_id=test_employee.private_user_id,
                day_of_week=date.today().strftime("%A"),
                start_time=datetime.combine(date.today(), time(9, 0), tzinfo=timezone.utc),
                end_time=datetime.combine(date.today(), time(9, 2), tzinfo=timezone.utc),
                location={"latitude": BRANCH_LAT, "longitude": BRANCH_LNG, "accuracy": 5},
                geo_check=GeoCheckContext(accuracy_m=5),
                created_source="mobile",
            )
            from db_models.crud.job import create_time_log
            result = asyncio.run(create_time_log(payload, db=db, client_ip="127.0.0.1"))
            assert result is not None
        finally:
            test_employee.home_geofence_id = None
            db.commit()


class TestEnforcePunch:
    def test_block_raises_403(self, db, geofenced_company):
        company, set_company_mode, _ = geofenced_company
        set_company_mode("block")
        ctx = PunchContext(latitude=FAR_LAT, longitude=FAR_LNG, accuracy_m=5)
        with pytest.raises(HTTPException) as exc:
            enforce_punch(company, _fences(db, company.company_id), ctx)
        assert exc.value.status_code == 403
        assert exc.value.detail["code"] == "outside_geofence"

    def test_flag_does_not_raise(self, db, geofenced_company):
        company, set_company_mode, set_fence_mode = geofenced_company
        set_company_mode("flag")
        set_fence_mode("flag")
        ctx = PunchContext(latitude=FAR_LAT, longitude=FAR_LNG, accuracy_m=5)
        out = enforce_punch(company, _fences(db, company.company_id), ctx)
        assert out.flagged is True


class TestCreateTimeLogIntegration:
    def _payload(self, job_id: int, private_user_id: int, d: date, lat: float, lng: float,
                 geo_check: GeoCheckContext | None = None, source: str = "mobile") -> CreateTimeLog:
        return CreateTimeLog(
            job_id=job_id,
            private_user_id=private_user_id,
            day_of_week=d.strftime("%A"),
            start_time=datetime.combine(d, time(9, 0), tzinfo=timezone.utc),
            end_time=datetime.combine(d, time(9, 2), tzinfo=timezone.utc),
            location={"latitude": lat, "longitude": lng, "accuracy": 5},
            geo_check=geo_check,
            created_source=source,
        )

    def _job(self, db: Session, test_employee) -> Job:
        return db.query(Job).filter(Job.private_user_id == test_employee.private_user_id).first()

    def test_blocks_outside_in_block_mode(self, db, test_employee, geofenced_company):
        company, set_company_mode, _ = geofenced_company
        set_company_mode("block")
        job = self._job(db, test_employee)
        payload = self._payload(job.job_id, test_employee.private_user_id, date(2026, 8, 17), FAR_LAT, FAR_LNG)
        with pytest.raises(HTTPException) as exc:
            asyncio.run(create_time_log(payload, db))
        assert exc.value.status_code == 403
        assert exc.value.detail["code"] == "outside_geofence"

    def test_flags_outside_in_flag_mode(self, db, test_employee, geofenced_company):
        company, set_company_mode, set_fence_mode = geofenced_company
        set_company_mode("flag")
        set_fence_mode("flag")
        job = self._job(db, test_employee)
        payload = self._payload(job.job_id, test_employee.private_user_id, date(2026, 8, 17), FAR_LAT, FAR_LNG)
        created = asyncio.run(create_time_log(payload, db))
        try:
            assert created.out_of_geofence is True
            assert created.geofence_check_json["reason"] == "outside"
        finally:
            db.delete(created)
            db.commit()

    def test_inside_allowed(self, db, test_employee, geofenced_company):
        company, set_company_mode, _ = geofenced_company
        set_company_mode("block")
        job = self._job(db, test_employee)
        payload = self._payload(job.job_id, test_employee.private_user_id, date(2026, 8, 17), HQ_LAT, HQ_LNG)
        created = asyncio.run(create_time_log(payload, db))
        try:
            assert created.out_of_geofence is False
        finally:
            db.delete(created)
            db.commit()

    def test_mock_detected_blocks(self, db, test_employee, geofenced_company):
        company, set_company_mode, _ = geofenced_company
        set_company_mode("block")
        job = self._job(db, test_employee)
        payload = self._payload(
            job.job_id, test_employee.private_user_id, date(2026, 8, 17), HQ_LAT, HQ_LNG,
            geo_check=GeoCheckContext(mock_detected=True),
        )
        with pytest.raises(HTTPException) as exc:
            asyncio.run(create_time_log(payload, db))
        assert exc.value.status_code == 403
        assert exc.value.detail["code"] == "mock_detected"

    def test_kiosk_trusted_even_outside(self, db, test_employee, geofenced_company):
        company, set_company_mode, _ = geofenced_company
        set_company_mode("block")
        job = self._job(db, test_employee)
        payload = self._payload(
            job.job_id, test_employee.private_user_id, date(2026, 8, 17), FAR_LAT, FAR_LNG,
            source="kiosk",
        )
        created = asyncio.run(create_time_log(payload, db))
        try:
            assert created.out_of_geofence is False
            assert created.created_source == "kiosk"
        finally:
            db.delete(created)
            db.commit()

    def test_disabled_company_records_outside(self, db, test_employee, geofenced_company):
        company, set_company_mode, _ = geofenced_company
        set_company_mode("off")
        job = self._job(db, test_employee)
        payload = self._payload(job.job_id, test_employee.private_user_id, date(2026, 8, 17), FAR_LAT, FAR_LNG)
        created = asyncio.run(create_time_log(payload, db))
        try:
            assert created.out_of_geofence is False
        finally:
            db.delete(created)
            db.commit()