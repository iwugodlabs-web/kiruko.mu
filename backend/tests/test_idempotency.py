"""Tests for M6 — Idempotency-Key middleware + dependency.

Covers:
  * `compute_request_hash` is deterministic
  * `lookup_cached` / `store_cached` round-trip
  * Concurrent duplicate write handled via PK conflict (no exception leak)
  * `require_idempotency_key` dependency raises 400 on missing/empty/oversized
  * Middleware end-to-end via FastAPI TestClient: replay returns cached body,
    body-mismatch on same key returns 409, missing header on a required
    endpoint returns 400, GET passes through unchanged.
"""

from __future__ import annotations

import json
from datetime import datetime
from typing import Optional

import pytest
from fastapi import Depends, FastAPI, HTTPException
from fastapi.testclient import TestClient
from pydantic import BaseModel
from sqlalchemy import text as sql_text
from sqlalchemy.orm import Session, sessionmaker

from core.idempotency import (
    IdempotencyMiddleware,
    compute_request_hash,
    lookup_cached,
    require_idempotency_key,
    store_cached,
)


# ---------------------------------------------------------------------------
# Pure helpers
# ---------------------------------------------------------------------------


class TestComputeRequestHash:
    def test_deterministic(self):
        assert compute_request_hash(b'{"a":1}') == compute_request_hash(b'{"a":1}')

    def test_different_bodies_different_hashes(self):
        assert compute_request_hash(b'{"a":1}') != compute_request_hash(b'{"a":2}')

    def test_empty_body(self):
        h = compute_request_hash(b"")
        assert isinstance(h, str)
        assert len(h) == 64  # SHA-256 hex

    def test_none_treated_as_empty(self):
        assert compute_request_hash(None) == compute_request_hash(b"")  # type: ignore[arg-type]


# ---------------------------------------------------------------------------
# DB round-trip
# ---------------------------------------------------------------------------


class TestStoreLookup:
    def test_round_trip(self, db: Session):
        suffix = datetime.utcnow().strftime("%H%M%S%f")
        key = f"test-key-{suffix}"
        try:
            store_cached(
                db,
                key=key,
                method="POST",
                path="/api/v1/test/round-trip",
                user_id=None,
                request_hash="abc123",
                response_status=201,
                response_body={"ok": True, "value": 42},
            )

            cached = lookup_cached(db, key, "POST", "/api/v1/test/round-trip")
            assert cached is not None
            assert cached["request_hash"] == "abc123"
            assert cached["response_status"] == 201
            assert cached["response_body"] == {"ok": True, "value": 42}
        finally:
            db.execute(
                sql_text("DELETE FROM idempotency_keys WHERE key = :k"),
                {"k": key},
            )
            db.commit()

    def test_lookup_miss_returns_none(self, db: Session):
        cached = lookup_cached(db, "definitely-not-a-real-key", "POST", "/x")
        assert cached is None

    def test_concurrent_duplicate_silently_handled(self, db: Session):
        suffix = datetime.utcnow().strftime("%H%M%S%f")
        key = f"dup-key-{suffix}"
        try:
            # First write
            store_cached(
                db,
                key=key, method="POST", path="/x",
                user_id=None, request_hash="h1",
                response_status=200, response_body={"a": 1},
            )

            # Second write with the SAME PK — should NOT raise
            store_cached(
                db,
                key=key, method="POST", path="/x",
                user_id=None, request_hash="h2",
                response_status=200, response_body={"a": 2},
            )

            # The first write wins (the second was a no-op)
            cached = lookup_cached(db, key, "POST", "/x")
            assert cached["request_hash"] == "h1"
        finally:
            db.execute(sql_text("DELETE FROM idempotency_keys WHERE key=:k"), {"k": key})
            db.commit()


# ---------------------------------------------------------------------------
# `require_idempotency_key` dependency
# ---------------------------------------------------------------------------


class TestRequireDependency:
    def test_returns_stripped_key(self):
        assert require_idempotency_key(idempotency_key="abc-123") == "abc-123"
        assert require_idempotency_key(idempotency_key="  abc-123  ") == "abc-123"

    def test_raises_400_on_none(self):
        with pytest.raises(HTTPException) as exc:
            require_idempotency_key(idempotency_key=None)
        assert exc.value.status_code == 400
        assert "Idempotency-Key" in exc.value.detail

    def test_raises_400_on_empty(self):
        with pytest.raises(HTTPException) as exc:
            require_idempotency_key(idempotency_key="")
        assert exc.value.status_code == 400

    def test_raises_400_on_whitespace(self):
        with pytest.raises(HTTPException) as exc:
            require_idempotency_key(idempotency_key="   ")
        assert exc.value.status_code == 400

    def test_raises_400_on_oversized(self):
        with pytest.raises(HTTPException) as exc:
            require_idempotency_key(idempotency_key="a" * 81)
        assert exc.value.status_code == 400


# ---------------------------------------------------------------------------
# Middleware integration via FastAPI TestClient
# ---------------------------------------------------------------------------


class _ItemRequest(BaseModel):
    name: str
    qty: int


def _build_test_app(_engine):
    """Build a tiny FastAPI app with the IdempotencyMiddleware attached and
    one optional + one required endpoint. Side-effect counter lets us
    assert the handler ran (or didn't)."""
    SessionFactory = sessionmaker(autocommit=False, autoflush=False, bind=_engine)
    app = FastAPI()
    app.add_middleware(IdempotencyMiddleware, session_factory=SessionFactory)

    counters = {"create": 0, "required": 0}

    @app.get("/ping")
    def ping():
        return {"pong": True}

    @app.post("/create")
    def create(payload: _ItemRequest):
        counters["create"] += 1
        return {"name": payload.name, "qty": payload.qty, "executed_count": counters["create"]}

    @app.post("/required")
    def required_endpoint(
        payload: _ItemRequest,
        _idem: str = Depends(require_idempotency_key),
    ):
        counters["required"] += 1
        return {"id": counters["required"]}

    return app, counters


@pytest.fixture()
def integration_client(_engine, db: Session):
    """Spin up the test app + cleanup any keys it creates."""
    app, counters = _build_test_app(_engine)
    client = TestClient(app)
    yield client, counters
    # Cleanup: wipe any test keys
    db.execute(
        sql_text(
            "DELETE FROM idempotency_keys WHERE path IN ('/create', '/required')"
        )
    )
    db.commit()


class TestMiddlewareIntegration:
    def test_no_header_passes_through(self, integration_client):
        client, counters = integration_client
        resp = client.post("/create", json={"name": "x", "qty": 1})
        assert resp.status_code == 200
        assert resp.json() == {"name": "x", "qty": 1, "executed_count": 1}

    def test_replay_returns_cached(self, integration_client):
        client, counters = integration_client
        body = {"name": "test", "qty": 5}
        headers = {"Idempotency-Key": "replay-test-1"}

        # First call — handler runs
        first = client.post("/create", json=body, headers=headers)
        assert first.status_code == 200
        first_data = first.json()
        assert first_data["executed_count"] == 1

        # Replay — handler should NOT run again
        second = client.post("/create", json=body, headers=headers)
        assert second.status_code == 200
        assert second.json() == first_data, (
            "Replay should return the original cached response unchanged"
        )
        assert counters["create"] == 1, "Handler ran twice — middleware didn't cache"

    def test_body_mismatch_on_same_key_returns_409(self, integration_client):
        client, counters = integration_client
        headers = {"Idempotency-Key": "mismatch-test"}

        # First call
        first = client.post("/create", json={"name": "a", "qty": 1}, headers=headers)
        assert first.status_code == 200

        # Second call with SAME key but DIFFERENT body
        second = client.post("/create", json={"name": "b", "qty": 2}, headers=headers)
        assert second.status_code == 409
        assert "different request body" in second.json()["detail"].lower()
        assert counters["create"] == 1  # handler did not run a second time

    def test_required_endpoint_400_without_header(self, integration_client):
        client, counters = integration_client
        resp = client.post("/required", json={"name": "x", "qty": 1})
        assert resp.status_code == 400
        assert counters["required"] == 0

    def test_required_endpoint_with_header_works(self, integration_client):
        client, counters = integration_client
        resp = client.post(
            "/required",
            json={"name": "x", "qty": 1},
            headers={"Idempotency-Key": "required-1"},
        )
        assert resp.status_code == 200
        assert counters["required"] == 1

    def test_get_passes_through_unchanged(self, integration_client):
        client, counters = integration_client
        resp = client.get("/ping", headers={"Idempotency-Key": "ignored"})
        assert resp.status_code == 200
        assert resp.json() == {"pong": True}
