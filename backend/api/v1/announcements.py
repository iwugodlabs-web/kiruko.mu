"""Company-side router for Employer Announcements (kind='employer' only).

Auth: every write enforces (a) caller is a company admin, (b) the target
sponsored_content row's funding_company_id equals the caller's company. Cross-
company reads/writes are 403.

Per-kind discipline: every create/patch here forces `kind='employer'`. The
underlying CRUD module is shared with the platform-admin /admin/ads/* router
(which handles 'ad' and 'house'), but this router never produces or reads
those kinds — that's the user-facing concept separation.

Phase 1 scope. Phase 2 adds ads + consent on /api/v1/sponsored/* but doesn't
touch this file.
"""

import csv
import io
import logging
from typing import Any, Optional

from fastapi import APIRouter, Depends, File, HTTPException, Query, UploadFile, status
from fastapi.responses import StreamingResponse
from sqlalchemy.orm import Session

from core import config
from core.dependencies import get_current_user
from core.model import Company, SponsoredContent, User
from core.roles import is_company_admin_for
from db_models.crud import sponsored_content as crud
from schema.sponsored_content_schema import (
    ImageUploadResponse,
    SponsoredContentCreate,
    SponsoredContentOut,
    SponsoredContentPatch,
    SponsoredContentVersionOut,
)
from services.storage_service import get_storage_service

logger = logging.getLogger(__name__)

router = APIRouter(prefix="/announcements", tags=["Announcements"])


# Image-upload limits (mirror SPONSORED_CONTENT_PLAN.md operational rules).
ALLOWED_IMAGE_MIMES = {"image/jpeg", "image/png", "image/webp"}
MAX_IMAGE_BYTES = 2 * 1024 * 1024  # 2 MB
MAX_IMAGE_DIM = 2000               # px (each axis)


# ── Auth helpers ──────────────────────────────────────────────────────────
def _resolve_caller_company_id(user: User) -> int:
    """Return the company_id the caller is acting on behalf of, or 403.

    Two valid sources:
      1. Company owner: the User row has a one-to-one Company.
      2. PrivateUser with an admin-level role: user.private_user.company_id.

    Cross-company admins (a single User who manages multiple companies via
    CompanyUserRole) are not supported here — they'd need a company_id query
    param to disambiguate, which Phase 1 doesn't ship.
    """
    company = getattr(user, "company", None)
    if company is not None:
        return company.company_id
    pu = getattr(user, "private_user", None)
    if pu is not None and pu.company_id is not None:
        return pu.company_id
    raise HTTPException(
        status_code=status.HTTP_403_FORBIDDEN,
        detail="No company context for caller",
    )


def _require_company_admin(
    db: Session = Depends(config.get_db),
    current_user: User = Depends(get_current_user),
) -> tuple[User, int]:
    """Resolve + authorize. Returns (user, company_id). Raises 403 otherwise.

    RBAC flag on ⇒ requires the manage_announcements permission (owner/admin
    bypass inside). Flag off ⇒ company admin/manager as today."""
    company_id = _resolve_caller_company_id(current_user)
    from core.permission_guards import company_rbac_enabled, assert_company_permission
    if company_rbac_enabled():
        assert_company_permission(current_user, company_id, "manage_announcements", db)
        return current_user, company_id
    if not is_company_admin_for(current_user, company_id, db):
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="Company admin role required",
        )
    return current_user, company_id


def _load_owned(
    db: Session, content_id: int, company_id: int, *, include_deleted: bool = False
) -> SponsoredContent:
    """Fetch a sponsored_content row, 404 if missing, 403 if not owned by the
    caller's company, 400 if it isn't kind='employer' (shouldn't be reachable
    through this router but is a cheap defense)."""
    content = crud.get_by_id(db, content_id, include_deleted=include_deleted)
    if content is None:
        raise HTTPException(status_code=404, detail="Announcement not found")
    if content.kind != "employer":
        # This row exists but belongs to /admin/ads/* — don't leak.
        raise HTTPException(status_code=404, detail="Announcement not found")
    if content.funding_company_id != company_id:
        raise HTTPException(status_code=403, detail="Not owned by your company")
    return content


# ── Routes ────────────────────────────────────────────────────────────────
@router.post("/upload-image", response_model=ImageUploadResponse)
async def upload_image(
    file: UploadFile = File(...),
    auth: tuple = Depends(_require_company_admin),
):
    """Upload an image for use as the sponsored card's `image_url`. Validates
    mime + size + dimensions, then stores via the project's BaseStorage
    (local in dev, S3 in prod). Returns the resulting URL — the caller submits
    it back as part of the create/patch body."""
    _user, company_id = auth

    if file.content_type not in ALLOWED_IMAGE_MIMES:
        raise HTTPException(
            status_code=400,
            detail=f"image mime must be one of {sorted(ALLOWED_IMAGE_MIMES)}",
        )

    blob = await file.read()
    if len(blob) > MAX_IMAGE_BYTES:
        raise HTTPException(status_code=413, detail="image exceeds 2 MB")

    try:
        from PIL import Image
        with Image.open(io.BytesIO(blob)) as img:
            w, h = img.size
            if w > MAX_IMAGE_DIM or h > MAX_IMAGE_DIM:
                raise HTTPException(
                    status_code=400,
                    detail=f"image must be <= {MAX_IMAGE_DIM}x{MAX_IMAGE_DIM}",
                )
    except HTTPException:
        raise
    except Exception:
        raise HTTPException(status_code=400, detail="invalid image")

    # Rewind for the storage backend (Pillow consumed the BytesIO).
    file.file = io.BytesIO(blob)
    storage = get_storage_service()
    folder = f"sponsored/employer/{company_id}"
    url = await storage.upload_file(file, folder=folder)
    if not url:
        raise HTTPException(status_code=500, detail="image upload failed")
    return ImageUploadResponse(url=url)


@router.post("", response_model=SponsoredContentOut, status_code=status.HTTP_201_CREATED)
def create_announcement(
    payload: SponsoredContentCreate,
    auth: tuple = Depends(_require_company_admin),
    db: Session = Depends(config.get_db),
):
    """Create a kind='employer' announcement for the caller's company.

    The route pins funding_company_id + kind server-side regardless of what
    the client sent — this prevents a malicious client from posting on behalf
    of another company. The Pydantic create body accepts those fields so
    /admin/ads/* (Phase 2) can reuse the same shape.
    """
    user, company_id = auth

    return SponsoredContentOut.model_validate(
        crud.create_sponsored_content(
            db,
            actor_user_id=user.user_id,
            kind="employer",
            funding_company_id=company_id,
            title=payload.title,
            body=payload.body,
            image_url=payload.image_url,
            cta_label=payload.cta_label,
            cta_url=payload.cta_url,
            surfaces=payload.surfaces,
            targeting=payload.targeting,
            start_at=payload.start_at,
            end_at=payload.end_at,
            base_priority=payload.base_priority,
            variant_group=payload.variant_group,
            variant_label=payload.variant_label,
        )
    )


@router.get("", response_model=list[SponsoredContentOut])
def list_announcements(
    status_filter: Optional[str] = Query(default=None, alias="status"),
    include_deleted: bool = Query(default=False),
    limit: int = Query(default=50, le=200),
    offset: int = Query(default=0, ge=0),
    auth: tuple = Depends(_require_company_admin),
    db: Session = Depends(config.get_db),
):
    """List the caller's company's employer announcements."""
    _user, company_id = auth
    rows = crud.list_by_company(
        db,
        company_id=company_id,
        kind="employer",
        status_filter=status_filter,
        include_deleted=include_deleted,
        limit=limit,
        offset=offset,
    )
    return [SponsoredContentOut.model_validate(r) for r in rows]


@router.get("/{content_id}", response_model=SponsoredContentOut)
def get_announcement(
    content_id: int,
    auth: tuple = Depends(_require_company_admin),
    db: Session = Depends(config.get_db),
):
    _user, company_id = auth
    return SponsoredContentOut.model_validate(_load_owned(db, content_id, company_id))


@router.patch("/{content_id}", response_model=SponsoredContentOut)
def patch_announcement(
    content_id: int,
    patch: SponsoredContentPatch,
    auth: tuple = Depends(_require_company_admin),
    db: Session = Depends(config.get_db),
):
    user, company_id = auth
    content = _load_owned(db, content_id, company_id)
    updated = crud.patch_sponsored_content(
        db,
        content=content,
        actor_user_id=user.user_id,
        patch=patch.model_dump(exclude_unset=True),
    )
    return SponsoredContentOut.model_validate(updated)


@router.delete("/{content_id}", response_model=SponsoredContentOut)
def delete_announcement(
    content_id: int,
    auth: tuple = Depends(_require_company_admin),
    db: Session = Depends(config.get_db),
):
    """Soft delete (status='ended' + deleted_at). Idempotent — calling on an
    already-deleted row returns the row unchanged."""
    user, company_id = auth
    content = _load_owned(db, content_id, company_id, include_deleted=True)
    return SponsoredContentOut.model_validate(
        crud.soft_delete_sponsored_content(
            db, content=content, actor_user_id=user.user_id
        )
    )


@router.get("/{content_id}/versions", response_model=list[SponsoredContentVersionOut])
def list_announcement_versions(
    content_id: int,
    auth: tuple = Depends(_require_company_admin),
    db: Session = Depends(config.get_db),
):
    _user, company_id = auth
    _load_owned(db, content_id, company_id, include_deleted=True)  # ownership check only
    return [SponsoredContentVersionOut.model_validate(v) for v in crud.list_versions(db, content_id)]


@router.get("/{content_id}/stats")
def get_announcement_stats(
    content_id: int,
    bucket: str = Query(default="day", pattern="^(day|hour)$"),
    auth: tuple = Depends(_require_company_admin),
    db: Session = Depends(config.get_db),
):
    _user, company_id = auth
    _load_owned(db, content_id, company_id, include_deleted=True)
    return crud.get_stats(db, content_id=content_id, bucket=bucket)


@router.get("/{content_id}/export.csv")
def export_announcement_csv(
    content_id: int,
    auth: tuple = Depends(_require_company_admin),
    db: Session = Depends(config.get_db),
):
    """CSV dump of raw events (views + clicks + dismissals) for the campaign,
    sorted chronologically. Used by company admins for offline reporting."""
    _user, company_id = auth
    _load_owned(db, content_id, company_id, include_deleted=True)

    rows = crud.iter_raw_events_for_csv(db, content_id)

    def _generate():
        buf = io.StringIO()
        w = csv.writer(buf)
        w.writerow(["event_type", "timestamp", "private_user_id", "version_id"])
        yield buf.getvalue()
        buf.seek(0)
        buf.truncate(0)
        for ev_type, ts, pu_id, ver_id in rows:
            w.writerow([ev_type, ts.isoformat() if ts else "", pu_id or "", ver_id or ""])
            yield buf.getvalue()
            buf.seek(0)
            buf.truncate(0)

    return StreamingResponse(
        _generate(),
        media_type="text/csv",
        headers={
            "Content-Disposition": f'attachment; filename="announcement_{content_id}.csv"'
        },
    )
