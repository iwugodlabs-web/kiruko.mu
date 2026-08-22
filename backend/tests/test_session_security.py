"""Unit tests for core/session_security.py — session device/IP binding and
anomaly detection. Pure logic; audit writes are monkeypatched so no DB/HTTP
round-trip is required."""

from __future__ import annotations

import pytest
from fastapi import HTTPException

import core.session_security as ss


class _FakeRequest:
    """Minimal stand-in for a Starlette Request covering only the attributes
    check_session_anomaly / get_client_ip / device_signal touch."""

    def __init__(self, *, device=None, ip=None, socket_ip="10.0.0.1", path="/x"):
        self.headers = {}
        if device:
            self.headers["X-Device-Id"] = device
        if ip:
            self.headers["X-Forwarded-For"] = ip
        self.client = type("_Client", (), {"host": socket_ip})()
        self.url = type("_URL", (), {"path": path})()


@pytest.fixture
def audit_recorder(monkeypatch):
    calls = []

    def _fake(db, **kwargs):
        calls.append(kwargs)

    monkeypatch.setattr(ss, "_write_anomaly_audit", _fake)
    return calls


def test_session_binding_claims_omits_missing():
    assert ss.session_binding_claims() == {}
    assert ss.session_binding_claims(device="devA") == {"sess_dev": "devA"}
    assert ss.session_binding_claims(ip="1.2.3.4") == {"sess_ip": "1.2.3.4"}
    assert ss.session_binding_claims(device="devA", ip="1.2.3.4") == {
        "sess_dev": "devA",
        "sess_ip": "1.2.3.4",
    }


def test_get_client_ip_prefers_forwarded():
    assert ss.get_client_ip(_FakeRequest(socket_ip="10.0.0.1")) == "10.0.0.1"
    assert ss.get_client_ip(_FakeRequest(ip="9.9.9.9, 8.8.8.8", socket_ip="10.0.0.1")) == "9.9.9.9"


def test_device_signal():
    assert ss.device_signal(_FakeRequest(device="devA")) == "devA"
    assert ss.device_signal(_FakeRequest()) is None


def test_off_mode_is_noop(monkeypatch, audit_recorder):
    monkeypatch.setenv("SESSION_ANOMALY_MODE", "off")
    token = {"user": {"user_id": 1, "sess_dev": "devA", "sess_ip": "1.2.3.4"}}
    ss.check_session_anomaly(None, _FakeRequest(device="devB", ip="5.6.7.8"), token)
    assert audit_recorder == []


def test_legacy_token_is_noop(monkeypatch, audit_recorder):
    monkeypatch.setenv("SESSION_ANOMALY_MODE", "block")
    token = {"user": {"user_id": 1}}
    ss.check_session_anomaly(None, _FakeRequest(device="devB"), token)
    assert audit_recorder == []


def test_matching_device_and_ip_is_noop(monkeypatch, audit_recorder):
    monkeypatch.setenv("SESSION_ANOMALY_MODE", "block")
    token = {"user": {"user_id": 1, "sess_dev": "devA", "sess_ip": "1.2.3.4"}}
    ss.check_session_anomaly(None, _FakeRequest(device="devA", ip="1.2.3.4"), token)
    assert audit_recorder == []


def test_audit_mode_records_ip_change(monkeypatch, audit_recorder):
    monkeypatch.setenv("SESSION_ANOMALY_MODE", "audit")
    token = {"user": {"user_id": 1, "sess_dev": "devA", "sess_ip": "1.2.3.4"}}
    ss.check_session_anomaly(None, _FakeRequest(device="devA", ip="5.6.7.8"), token)
    assert len(audit_recorder) == 1
    assert audit_recorder[0]["dev_changed"] is False
    assert audit_recorder[0]["ip_changed"] is True


def test_block_mode_device_mismatch_raises(monkeypatch, audit_recorder):
    monkeypatch.setenv("SESSION_ANOMALY_MODE", "block")
    token = {"user": {"user_id": 1, "sess_dev": "devA", "sess_ip": "1.2.3.4"}}
    with pytest.raises(HTTPException) as exc:
        ss.check_session_anomaly(None, _FakeRequest(device="devB", ip="1.2.3.4"), token)
    assert exc.value.status_code == 401
    assert len(audit_recorder) == 1
    assert audit_recorder[0]["dev_changed"] is True


def test_block_mode_ip_only_does_not_raise(monkeypatch, audit_recorder):
    monkeypatch.setenv("SESSION_ANOMALY_MODE", "block")
    token = {"user": {"user_id": 1, "sess_dev": "devA", "sess_ip": "1.2.3.4"}}
    ss.check_session_anomaly(None, _FakeRequest(device="devA", ip="5.6.7.8"), token)
    assert len(audit_recorder) == 1
    assert audit_recorder[0]["dev_changed"] is False
    assert audit_recorder[0]["ip_changed"] is True


def test_device_removed_counts_as_mismatch(monkeypatch, audit_recorder):
    monkeypatch.setenv("SESSION_ANOMALY_MODE", "block")
    token = {"user": {"user_id": 1, "sess_dev": "devA"}}
    with pytest.raises(HTTPException):
        ss.check_session_anomaly(None, _FakeRequest(), token)
    assert audit_recorder[0]["dev_changed"] is True
