"""Database-level invariants on the sponsored_content tables (M1).

These exercise the CHECK constraints + UNIQUE constraints that were
declared in `sponsored_content_tables_20260516.py`. They run against the
test DB so they don't depend on ORM-layer validation — the DB itself
should reject the malformed rows.

Verifies:
  - kind IN ('employer','ad','house')
  - status IN ('draft','active','paused','ended')
  - kind='ad'      requires funding_company_id + paid_amount_cents + paid_currency
  - kind='employer' requires funding_company_id
  - kind='house'   rejects funding_company_id and paid_amount_cents
  - sponsored_content_versions UNIQUE(content_id, version_number)
  - sponsored_content_views UNIQUE(content_id, user_id, view_token)
  - sponsored_content_clicks UNIQUE(content_id, user_id, click_token)
"""
from __future__ import annotations

import uuid

import pytest
from sqlalchemy import text
from sqlalchemy.exc import IntegrityError


def _cleanup(db, content_ids: list[int] | None = None) -> None:
    """Wipe sponsored_content rows created by a test. Cascades handle the rest."""
    if content_ids:
        db.execute(
            text("DELETE FROM sponsored_content WHERE sponsored_content_id = ANY(:ids)"),
            {"ids": content_ids},
        )
    else:
        db.execute(text("DELETE FROM sponsored_content"))
    db.commit()


class TestCheckConstraints:
    def test_rejects_bad_kind(self, db, test_company_id):
        with pytest.raises(IntegrityError) as exc:
            db.execute(
                text(
                    "INSERT INTO sponsored_content (kind, title, body, funding_company_id)"
                    " VALUES ('garbage', 't', 'b', :cid)"
                ),
                {"cid": test_company_id},
            )
            db.commit()
        db.rollback()
        assert "ck_sponsored_content_kind" in str(exc.value)

    def test_rejects_bad_status(self, db, test_company_id):
        with pytest.raises(IntegrityError) as exc:
            db.execute(
                text(
                    "INSERT INTO sponsored_content (kind, status, title, body, funding_company_id)"
                    " VALUES ('employer', 'garbage', 't', 'b', :cid)"
                ),
                {"cid": test_company_id},
            )
            db.commit()
        db.rollback()
        assert "ck_sponsored_content_status" in str(exc.value)

    def test_ad_requires_payment_fields(self, db, test_company_id):
        with pytest.raises(IntegrityError) as exc:
            db.execute(
                text(
                    "INSERT INTO sponsored_content (kind, title, body, funding_company_id)"
                    " VALUES ('ad', 't', 'b', :cid)"  # no paid_amount/paid_currency
                ),
                {"cid": test_company_id},
            )
            db.commit()
        db.rollback()
        assert "ck_sponsored_content_kind_fields" in str(exc.value)

    def test_employer_requires_funding_company(self, db):
        with pytest.raises(IntegrityError) as exc:
            db.execute(
                text("INSERT INTO sponsored_content (kind, title, body) VALUES ('employer', 't', 'b')"),
            )
            db.commit()
        db.rollback()
        assert "ck_sponsored_content_kind_fields" in str(exc.value)

    def test_house_rejects_funding_company(self, db, test_company_id):
        with pytest.raises(IntegrityError) as exc:
            db.execute(
                text(
                    "INSERT INTO sponsored_content (kind, title, body, funding_company_id)"
                    " VALUES ('house', 't', 'b', :cid)"
                ),
                {"cid": test_company_id},
            )
            db.commit()
        db.rollback()
        assert "ck_sponsored_content_kind_fields" in str(exc.value)

    def test_valid_employer_accepted(self, db, test_company_id):
        cid = db.execute(
            text(
                "INSERT INTO sponsored_content (kind, title, body, funding_company_id)"
                " VALUES ('employer', 't', 'b', :cid) RETURNING sponsored_content_id"
            ),
            {"cid": test_company_id},
        ).scalar()
        db.commit()
        assert cid is not None
        _cleanup(db, [cid])

    def test_valid_ad_accepted(self, db, test_company_id):
        cid = db.execute(
            text(
                "INSERT INTO sponsored_content "
                "(kind, title, body, funding_company_id, paid_amount_cents, paid_currency)"
                " VALUES ('ad', 't', 'b', :cid, 10000, 'MUR') RETURNING sponsored_content_id"
            ),
            {"cid": test_company_id},
        ).scalar()
        db.commit()
        assert cid is not None
        _cleanup(db, [cid])

    def test_valid_house_accepted(self, db):
        cid = db.execute(
            text(
                "INSERT INTO sponsored_content (kind, title, body) "
                "VALUES ('house', 't', 'b') RETURNING sponsored_content_id"
            ),
        ).scalar()
        db.commit()
        assert cid is not None
        _cleanup(db, [cid])


class TestUniqueConstraints:
    def _create_employer_with_v1(self, db, test_company_id) -> tuple[int, int]:
        """Helper: create a content row + a v1 version, return (content_id, version_id)."""
        cid = db.execute(
            text(
                "INSERT INTO sponsored_content (kind, title, body, funding_company_id) "
                "VALUES ('employer', 't', 'b', :cid) RETURNING sponsored_content_id"
            ),
            {"cid": test_company_id},
        ).scalar()
        vid = db.execute(
            text(
                "INSERT INTO sponsored_content_versions "
                "(sponsored_content_id, version_number, title, body) "
                "VALUES (:cid, 1, 't', 'b') RETURNING version_id"
            ),
            {"cid": cid},
        ).scalar()
        db.commit()
        return cid, vid

    def test_version_number_unique_per_content(self, db, test_company_id):
        cid, _ = self._create_employer_with_v1(db, test_company_id)
        with pytest.raises(IntegrityError) as exc:
            db.execute(
                text(
                    "INSERT INTO sponsored_content_versions "
                    "(sponsored_content_id, version_number, title, body) "
                    "VALUES (:cid, 1, 'dup', 'dup')"
                ),
                {"cid": cid},
            )
            db.commit()
        db.rollback()
        assert "uq_sponsored_content_versions_content_number" in str(exc.value)
        _cleanup(db, [cid])

    def test_view_token_idempotency(self, db, test_company_id, test_employee_id):
        cid, vid = self._create_employer_with_v1(db, test_company_id)
        token = str(uuid.uuid4())
        # First insert succeeds
        db.execute(
            text(
                "INSERT INTO sponsored_content_views "
                "(sponsored_content_id, version_id, private_user_id, kind, surface, view_token) "
                "VALUES (:cid, :vid, :uid, 'employer', 'home', :tok)"
            ),
            {"cid": cid, "vid": vid, "uid": test_employee_id, "tok": token},
        )
        db.commit()
        # Duplicate (cid, uid, token) raises
        with pytest.raises(IntegrityError) as exc:
            db.execute(
                text(
                    "INSERT INTO sponsored_content_views "
                    "(sponsored_content_id, version_id, private_user_id, kind, surface, view_token) "
                    "VALUES (:cid, :vid, :uid, 'employer', 'home', :tok)"
                ),
                {"cid": cid, "vid": vid, "uid": test_employee_id, "tok": token},
            )
            db.commit()
        db.rollback()
        assert "uq_sponsored_content_views_idempotency" in str(exc.value)
        _cleanup(db, [cid])

    def test_click_token_idempotency(self, db, test_company_id, test_employee_id):
        cid, vid = self._create_employer_with_v1(db, test_company_id)
        token = str(uuid.uuid4())
        db.execute(
            text(
                "INSERT INTO sponsored_content_clicks "
                "(sponsored_content_id, version_id, private_user_id, kind, click_token) "
                "VALUES (:cid, :vid, :uid, 'employer', :tok)"
            ),
            {"cid": cid, "vid": vid, "uid": test_employee_id, "tok": token},
        )
        db.commit()
        with pytest.raises(IntegrityError) as exc:
            db.execute(
                text(
                    "INSERT INTO sponsored_content_clicks "
                    "(sponsored_content_id, version_id, private_user_id, kind, click_token) "
                    "VALUES (:cid, :vid, :uid, 'employer', :tok)"
                ),
                {"cid": cid, "vid": vid, "uid": test_employee_id, "tok": token},
            )
            db.commit()
        db.rollback()
        assert "uq_sponsored_content_clicks_idempotency" in str(exc.value)
        _cleanup(db, [cid])
