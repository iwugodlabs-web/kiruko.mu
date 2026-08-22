"""Internal error detail (raw SQL, driver messages) must never reach clients.

A user hit "Complete Profile" and got a raw `INSERT INTO salaries …` SQLAlchemy
error in an alert. The global handlers in main.py genericize any 5xx (and
uncaught DB/other errors) while logging the real thing server-side, and pass
curated 4xx messages through. These exercise the handler functions directly.
"""
import asyncio

from starlette.requests import Request
from starlette.exceptions import HTTPException
from sqlalchemy.exc import SQLAlchemyError

import main


def _req() -> Request:
    return Request({"type": "http", "method": "POST", "path": "/user/onboard", "headers": []})


def _body(resp) -> str:
    return resp.body.decode()


def test_5xx_http_exception_detail_is_genericized():
    leak = "INSERT INTO salaries (job_id, salary) VALUES (...) -- secret"
    resp = asyncio.run(main.http_exception_handler_override(_req(), HTTPException(status_code=500, detail=leak)))
    assert resp.status_code == 500
    body = _body(resp)
    assert "salaries" not in body and "INSERT" not in body


def test_4xx_curated_detail_passes_through():
    resp = asyncio.run(main.http_exception_handler_override(_req(), HTTPException(status_code=409, detail="Employee already exists")))
    assert resp.status_code == 409
    assert "already exists" in _body(resp)


def test_raw_db_error_is_genericized():
    resp = asyncio.run(main.sqlalchemy_exception_handler(_req(), SQLAlchemyError("INSERT INTO salaries ... boom")))
    assert resp.status_code == 500
    body = _body(resp)
    assert "INSERT" not in body and "salaries" not in body


def test_unexpected_exception_is_genericized():
    resp = asyncio.run(main.unhandled_exception_handler(_req(), Exception("KeyError deep in some service")))
    assert resp.status_code == 500
    assert "KeyError" not in _body(resp)
