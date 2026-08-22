"""Public reporter portal — anonymous (and named) reporters return to a
case via case_id + PIN, exchange messages with the handler, and trigger
appeals. No user authentication is required because anonymous reporters
by definition have no identity to authenticate; the case_id+PIN pair is
the access credential.

Endpoints (mounted under /api/v1/portal/concerns):

  POST /lookup                     case_id + pin → short-lived JWT
  GET  /{case_id}                  Authenticated → case substance + thread
  POST /{case_id}/messages         Authenticated → reporter posts a message
  POST /{case_id}/appeal           Authenticated → resolved/rejected → appealed

Defense-in-depth (M2 plan checklist):
- Per-case + per-IP rate limits via `services.concern_portal_security`.
- 1h case lockout after 10 failed PIN attempts.
- hCaptcha required after 3 IP failures (env-flagged; see `services.hcaptcha`).
- Constant-time response: lookup ALWAYS returns 200 with a uniform body so
  unknown-case, wrong-PIN, rate-limited, and locked are indistinguishable.
- KONTOKAZ_CONCERNS_KILL=true returns 503 from every endpoint.
- Every lookup attempt is audit-logged with `action='portal_lookup'` and a
  `success` flag in details.
- Internal-only fields (`internal_notes`, `assigned_to`, `closed_by`,
  `case_pin_hash`, audit log itself) are NEVER exposed via portal responses.
"""

from __future__ import annotations

import logging
import os
from datetime import datetime, timedelta, timezone
from typing import Any, Dict, List, Optional

from fastapi import APIRouter, Body, Depends, File, Header, HTTPException, Request, UploadFile, status
from pydantic import BaseModel, Field
from sqlalchemy.orm import Session

from core import config
from core.concern_states import ActorKind, ConcernStatus, StateTransitionError, validate_transition
from core.security import create_access_token, decode_token
from services import concern_audit, concern_pin, concern_portal_security, hcaptcha

logger = logging.getLogger(__name__)

router = APIRouter(prefix="/portal/concerns", tags=["Concerns Portal"])


# ── Kill-switch ─────────────────────────────────────────────────────────────
def _kill_switch_active() -> bool:
    return os.getenv("KONTOKAZ_CONCERNS_KILL", "false").strip().lower() in ("1", "true", "yes")


def _ensure_alive() -> None:
    if _kill_switch_active():
        # Generic 503; reveals nothing about why.
        raise HTTPException(
            status_code=status.HTTP_503_SERVICE_UNAVAILABLE,
            detail="Service temporarily unavailable.",
        )


# ── Request / response shapes ───────────────────────────────────────────────
class LookupRequest(BaseModel):
    case_id: int = Field(..., gt=0)
    pin: str = Field(..., min_length=1, max_length=64)
    captcha_token: Optional[str] = Field(None, max_length=4096)


class LookupResponse(BaseModel):
    """Uniform response shape so unknown-case / wrong-PIN / rate-limited /
    locked cases are indistinguishable to the caller. `captcha_required`
    is the only legitimate signal we leak (the UI needs it to render the
    widget on the next attempt)."""
    ok: bool
    captcha_required: bool = False
    token: Optional[str] = None
    expires_at: Optional[str] = None


class MessagePost(BaseModel):
    body: str = Field(..., min_length=1, max_length=8000)
    # Optional pre-uploaded attachment URL obtained via the portal-scoped
    # upload endpoint below. Reporters paste a screenshot or supporting
    # doc into the thread without breaking anonymity. Closes audit gap #21.
    attachment_url: Optional[str] = Field(default=None, max_length=2048)


# ── Scoped JWT helpers ──────────────────────────────────────────────────────
PORTAL_TOKEN_TTL_MINUTES = 30


def _mint_portal_token(case_id: int) -> tuple[str, datetime]:
    expires_at = datetime.utcnow() + timedelta(minutes=PORTAL_TOKEN_TTL_MINUTES)
    token = create_access_token(
        user_data={"case_id": case_id, "kind": "concern_portal"},
        expiry=timedelta(minutes=PORTAL_TOKEN_TTL_MINUTES),
        audience="concern_portal",
    )
    return token, expires_at


def _portal_case_id_from_header(authorization: Optional[str]) -> int:
    """Extract and validate the case_id from a portal-scoped Bearer token.
    Raises HTTPException(401) on any failure with a uniform message."""
    if not authorization or not authorization.lower().startswith("bearer "):
        raise HTTPException(status_code=401, detail="Invalid or expired token.")
    token = authorization.split(None, 1)[1].strip()
    payload = decode_token(token)
    if not payload:
        raise HTTPException(status_code=401, detail="Invalid or expired token.")
    if payload.get("aud") != "concern_portal":
        raise HTTPException(status_code=401, detail="Invalid or expired token.")
    user_data = payload.get("user") or {}
    case_id = user_data.get("case_id")
    if not isinstance(case_id, int) or case_id <= 0:
        raise HTTPException(status_code=401, detail="Invalid or expired token.")
    return case_id


def _require_portal_case(
    case_id_from_path: int,
    authorization: Optional[str] = Header(None),
) -> int:
    """Dependency: confirms the JWT case_id matches the path case_id."""
    token_case_id = _portal_case_id_from_header(authorization)
    if token_case_id != case_id_from_path:
        # The token is for a different case → 401 (not 403; we don't even
        # acknowledge the path case_id exists).
        raise HTTPException(status_code=401, detail="Invalid or expired token.")
    return token_case_id


# ── Endpoints ───────────────────────────────────────────────────────────────
@router.post("/lookup", response_model=LookupResponse)
async def lookup(
    body: LookupRequest,
    request: Request,
    db: Session = Depends(config.get_db),
):
    """Verify case_id + PIN. Returns a short-lived case-scoped JWT on success.

    ALWAYS returns HTTP 200 with a uniform body. The `ok` flag indicates
    success; `captcha_required` indicates whether a captcha must accompany
    the next attempt.
    """
    _ensure_alive()

    ip = (request.client.host if request and request.client else "unknown")

    # Pre-verify gate — covers lockouts and rate limits.
    gate = concern_portal_security.check_lookup_allowed(body.case_id, ip)

    if not gate.allowed:
        # Rate-limited / locked. Audit and return uniform failure.
        # Don't even touch the DB — keeps timing flat.
        concern_audit.log(
            db,
            right_id=body.case_id,
            actor_kind=ActorKind.REPORTER.value,
            action=concern_audit.ACTION_PORTAL_LOOKUP,
            details={
                "success": False,
                "reason": gate.reason,
                "captcha_required": gate.captcha_required,
            },
            ip=ip,
        )
        return LookupResponse(ok=False, captcha_required=gate.captcha_required)

    # Captcha gate (only enforced once IP_FAIL_BEFORE_CAPTCHA failures
    # accumulated for this IP in the window).
    if gate.captcha_required and not hcaptcha.verify(body.captcha_token, remote_ip=ip):
        concern_portal_security.record_attempt(body.case_id, ip, success=False)
        concern_audit.log(
            db,
            right_id=body.case_id,
            actor_kind=ActorKind.REPORTER.value,
            action=concern_audit.ACTION_PORTAL_LOOKUP,
            details={"success": False, "reason": "captcha_failed"},
            ip=ip,
        )
        return LookupResponse(ok=False, captcha_required=True)

    # Verify against the bcrypt hash. Constant-time even if the case doesn't
    # exist: we still call concern_pin.verify() against an empty hash so the
    # timing matches a real-but-wrong PIN.
    from core.model import UserRight as URModel
    case = db.query(URModel).filter(URModel.right_id == body.case_id).first()
    stored_hash = (case.case_pin_hash if case else None) or ""
    success = concern_pin.verify(concern_pin.normalize(body.pin), stored_hash)

    concern_portal_security.record_attempt(body.case_id, ip, success=success)
    concern_audit.log(
        db,
        right_id=body.case_id,
        actor_kind=ActorKind.REPORTER.value,
        action=concern_audit.ACTION_PORTAL_LOOKUP,
        details={"success": success, "case_existed": case is not None},
        ip=ip,
    )

    if not success:
        return LookupResponse(ok=False, captcha_required=gate.captcha_required)

    token, expires_at = _mint_portal_token(body.case_id)
    return LookupResponse(
        ok=True,
        captcha_required=False,
        token=token,
        expires_at=expires_at.replace(tzinfo=timezone.utc).isoformat(),
    )


@router.get("/{case_id}")
async def get_case(
    case_id: int,
    request: Request,
    authorization: Optional[str] = Header(None),
    db: Session = Depends(config.get_db),
):
    """Return the case substance + message thread for the authenticated
    reporter. Internal handler-only fields are stripped:
        - case_pin_hash, internal_notes, assigned_to, closed_by
        - audit log
        - any other admin-side surface

    Anonymous status is preserved: the response never embeds the
    reporter's identity, even when the underlying row is non-anonymous.
    """
    _ensure_alive()
    _require_portal_case(case_id, authorization)

    from core.model import UserRight as URModel, ConcernMessage as CMModel
    case = db.query(URModel).filter(URModel.right_id == case_id).first()
    if case is None:
        # Token said this case_id existed at the moment of lookup; if it's
        # gone now (race / purge), respond uniformly.
        raise HTTPException(status_code=404, detail="Case not found.")

    # Audit the view.
    ip = (request.client.host if request and request.client else None)
    concern_audit.log(
        db,
        right_id=case_id,
        actor_kind=ActorKind.REPORTER.value,
        action=concern_audit.ACTION_VIEWED,
        details={"surface": "portal"},
        ip=ip,
    )

    messages = (
        db.query(CMModel)
        .filter(CMModel.right_id == case_id)
        .order_by(CMModel.created_at.asc())
        .all()
    )

    return {
        "case_id": case.right_id,
        "title": case.title,
        "category": case.category,
        "status": case.status,
        "channel": case.channel,
        "urgency_level": case.urgency_level,
        "is_anonymous": bool(case.is_anonymous),
        "issue_description": case.issue_description,
        "expected_outcome": case.expected_outcome,
        "occurrence_description": case.occurrence_description,
        "date_of_occurrence": case.date_of_occurrence.isoformat() if case.date_of_occurrence else None,
        "attachment_url": case.attachment_url,
        "attachment_scan_result": case.attachment_scan_result,
        "resolution": case.resolution,  # employee may see the resolution text
        "created_at": case.created_at.isoformat() if case.created_at else None,
        "updated_at": case.updated_at.isoformat() if case.updated_at else None,
        "acknowledged_at": case.acknowledged_at.isoformat() if case.acknowledged_at else None,
        "closed_at": case.closed_at.isoformat() if case.closed_at else None,
        "escalated_to_external_at": (
            case.escalated_to_external_at.isoformat() if case.escalated_to_external_at else None
        ),
        "escalated_reason": case.escalated_reason,
        "messages": [
            {
                "message_id": m.message_id,
                "author_kind": m.author_kind,
                # Reporter sees the handler's posts — but never the handler's
                # personal user_id (could de-anonymise an internal investigator).
                "body": m.body,
                "attachment_url": m.attachment_url,
                "created_at": m.created_at.isoformat() if m.created_at else None,
            }
            for m in messages
        ],
    }


@router.post("/{case_id}/messages", status_code=201)
async def post_message(
    case_id: int,
    request: Request,
    body: MessagePost = Body(...),
    authorization: Optional[str] = Header(None),
    db: Session = Depends(config.get_db),
):
    """Reporter posts a message into the thread. Sends a push to the assigned
    handler (or the company's admins / Kiruko queue, depending on channel)."""
    _ensure_alive()
    _require_portal_case(case_id, authorization)

    from core.model import UserRight as URModel, ConcernMessage as CMModel
    case = db.query(URModel).filter(URModel.right_id == case_id).first()
    if case is None:
        raise HTTPException(status_code=404, detail="Case not found.")

    msg = CMModel(
        right_id=case_id,
        author_kind=ActorKind.REPORTER.value,
        author_user_id=None,  # anonymous reporters have no user_id; named ones don't expose it via portal
        body=body.body,
        attachment_url=body.attachment_url or None,
    )
    db.add(msg)
    db.commit()
    db.refresh(msg)

    ip = (request.client.host if request and request.client else None)
    concern_audit.log(
        db,
        right_id=case_id,
        actor_kind=ActorKind.REPORTER.value,
        action=concern_audit.ACTION_MESSAGE_SENT,
        details={"message_id": msg.message_id, "surface": "portal"},
        ip=ip,
    )

    # M8 closeout — dedicated push to the handler side.
    try:
        from services.notification_service import NotificationService
        NotificationService.notify_handler_reporter_message(db, case)
    except Exception as e:  # noqa: BLE001
        logger.warning("concerns_portal: notify on message failed (non-fatal): %s", e)

    return {
        "ok": True,
        "message_id": msg.message_id,
        "created_at": msg.created_at.isoformat() if msg.created_at else None,
    }


@router.post("/{case_id}/messages/attachments", status_code=201)
async def upload_portal_message_attachment(
    case_id: int,
    file: UploadFile = File(...),
    authorization: Optional[str] = Header(None),
    db: Session = Depends(config.get_db),
):
    """Scan + store an attachment for a reporter-posted thread message.

    Scoped JWT required (same as `/{case_id}/messages`). Returns the URL
    the caller then passes back in the subsequent `POST /messages`
    payload's `attachment_url` field. Closes audit gap #21 for the portal
    surface (the in-app + handler equivalent lives at
    `POST /concerns/messages/attachments`).
    """
    _ensure_alive()
    _require_portal_case(case_id, authorization)

    from services import attachment_scanner
    from services.storage_service import get_storage_service

    file_bytes = await file.read()
    scan_result = attachment_scanner.scan(file_bytes, file.content_type)
    if not scan_result.accepted:
        logger.warning(
            "Portal thread attachment rejected: case_id=%s filename=%s mime=%s reason=%s",
            case_id,
            getattr(file, "filename", "?"),
            file.content_type,
            scan_result.reason,
        )
        raise HTTPException(status_code=415, detail=scan_result.reason or "Attachment rejected.")

    import io
    from starlette.datastructures import UploadFile as StarletteUploadFile
    wrapped = StarletteUploadFile(
        filename=file.filename,
        headers=file.headers,
        file=io.BytesIO(file_bytes),
    )
    storage_service = get_storage_service()
    url = await storage_service.upload_file(wrapped, folder="concern_messages")
    if not url:
        raise HTTPException(status_code=500, detail="Attachment upload failed.")
    return {
        "attachment_url": url,
        "scan_result": scan_result.db_value,
    }


@router.post("/{case_id}/appeal", status_code=200)
async def appeal(
    case_id: int,
    request: Request,
    authorization: Optional[str] = Header(None),
    db: Session = Depends(config.get_db),
):
    """Reporter triggers a `resolved → appealed` or `rejected → appealed`
    transition. The only state change the portal exposes; other transitions
    are handler-driven via PATCH /disputes/{id}.
    """
    _ensure_alive()
    _require_portal_case(case_id, authorization)

    from core.model import UserRight as URModel
    case = db.query(URModel).filter(URModel.right_id == case_id).first()
    if case is None:
        raise HTTPException(status_code=404, detail="Case not found.")

    try:
        validate_transition(
            case.status, ConcernStatus.APPEALED.value, ActorKind.REPORTER.value
        )
    except StateTransitionError as e:
        # 409 with the state-machine's explanation — the reporter is allowed
        # to know that an appeal isn't legal from the current state.
        raise HTTPException(status_code=409, detail=str(e))

    previous = case.status
    case.status = ConcernStatus.APPEALED.value
    db.commit()
    db.refresh(case)

    ip = (request.client.host if request and request.client else None)
    concern_audit.log(
        db,
        right_id=case_id,
        actor_kind=ActorKind.REPORTER.value,
        action=concern_audit.ACTION_STATUS_CHANGED,
        details={"from": previous, "to": case.status, "surface": "portal_appeal"},
        ip=ip,
    )

    # M8 closeout — reuse the handler push helper. Appeal is a state
    # change FROM the reporter's side, and the handler-message helper is
    # the right shape (wakes up the assigned handler / Kiruko queue).
    try:
        from services.notification_service import NotificationService
        NotificationService.notify_handler_reporter_message(db, case)
    except Exception as e:  # noqa: BLE001
        logger.warning("concerns_portal: notify on appeal failed (non-fatal): %s", e)

    return {"ok": True, "status": case.status}
