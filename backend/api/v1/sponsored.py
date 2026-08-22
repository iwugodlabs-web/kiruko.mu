"""Employee-facing sponsored-content endpoints.

Mobile hits this router on every home render. The four endpoints:

  GET  /sponsored/serve?surface=home — return at most one winner + idempotency tokens
  POST /sponsored/views               — log impression (idempotent via view_token)
  POST /sponsored/clicks              — log click, lock to served version, 302 redirect
  POST /sponsored/dismissals          — log dismissal (quality signal; no cap effect)

The /serve hot path is wrapped in an in-process per-user TTL cache (60s) — the
mobile may fetch home twice in quick succession (e.g. screen re-mount); we
return the same response so the same view_token serializes as a single
impression. A multi-worker deployment will run this cache per-worker, which
is fine — the underlying DB UNIQUE constraints guarantee correctness even
if caches diverge.

Kill switches:
  SPONSORED_ENABLED=false      master kill — /serve returns None for everyone
  ENABLED_KINDS='employer,house'  per-kind kill (Phase 2 adds 'ad')

Click URL validation:
  cta_url must start with https://. If CLICK_HOST_ALLOWLIST is set
  (comma-separated hostnames), the URL's host must be in the allowlist.
  Without an allowlist this is an open redirect by design — the platform
  Ad Content Policy is what gates which URLs admins are allowed to enter.
"""

import logging
import os
from typing import Any, Optional
from urllib.parse import urlparse

from fastapi import APIRouter, Depends, HTTPException, Query, status
from pydantic import BaseModel, Field
from sqlalchemy.orm import Session

from core import config
from core.dependencies import get_current_user
from core.model import User
from db_models.crud import sponsored_content as crud

logger = logging.getLogger(__name__)

router = APIRouter(prefix="/sponsored", tags=["Sponsored"])


# M17 — the home screen is split into two slots so employer comms and
# paid ads stop competing for the same rank. `home_banner` carries the
# employer announcement strip at the top; `home_card` carries the
# `ad`/`house` hero card below. Both come from the same /serve endpoint
# called with different surface params, so the existing ranking + cache
# work unchanged per-slot.
#
# `home` is kept here for the rollout window only: until every mobile
# client is on the M17 build, treat it as a legacy alias the route
# accepts. Drop it once analytics show <0.5% of /serve hits asking for
# the legacy surface.
SUPPORTED_SURFACES = {"home", "home_banner", "home_card"}

# Per-user /serve response cache (60s TTL) lives in the CRUD module so
# write functions can bust it themselves — see `cache_get`, `cache_put`,
# and `invalidate_serve_cache` in db_models.crud.sponsored_content. Any
# admin/employee mutation (create/patch/soft-delete/consent/ads-enabled
# toggle) automatically clears every cached slot, so edits land on the
# very next mobile fetch.


# ── Click allowlist boot warning ─────────────────────────────────────────
# Surface a clear log line at import time when the click-redirect allowlist
# is unset. Without it the /sponsored/clicks endpoint is an OPEN REDIRECT to
# any https://* URL admin staff put in cta_url. That's tolerable in Phase 1
# (no third-party advertisers; Kiruko staff are the only authors), but
# ops should set CLICK_HOST_ALLOWLIST before Phase 2 ships ads.
if not os.environ.get("CLICK_HOST_ALLOWLIST", "").strip():
    logger.warning(
        "CLICK_HOST_ALLOWLIST is unset — /sponsored/clicks will redirect to any "
        "https:// URL. Acceptable for Phase 1; set this env var (comma-separated "
        "hostnames) before enabling kind='ad'."
    )


# ── Click URL validator ──────────────────────────────────────────────────
def _validate_cta_url(url: Optional[str]) -> str:
    """Return the URL if safe; raise 400 if not. Used by /clicks before issuing
    the redirect — Pydantic also validates at create time, but this is the
    runtime gate since an admin could in theory set the URL via PATCH."""
    if not url:
        raise HTTPException(status_code=400, detail="cta_url is empty")
    parsed = urlparse(url)
    if parsed.scheme != "https":
        raise HTTPException(status_code=400, detail="cta_url must be https://")
    if not parsed.hostname:
        raise HTTPException(status_code=400, detail="cta_url has no host")
    allow = os.environ.get("CLICK_HOST_ALLOWLIST", "").strip()
    if allow:
        allowed_hosts = {h.strip().lower() for h in allow.split(",") if h.strip()}
        if parsed.hostname.lower() not in allowed_hosts:
            raise HTTPException(
                status_code=400,
                detail=f"cta_url host '{parsed.hostname}' not in allowlist",
            )
    return url


# ── /serve ────────────────────────────────────────────────────────────────
@router.get("/serve")
def serve(
    surface: str = Query(default="home"),
    current_user: User = Depends(get_current_user),
    db: Session = Depends(config.get_db),
):
    """Return the single sponsored card to render for this caller on `surface`,
    or `null` if no eligible candidate.

    Response shape on hit:
        {
          "sponsored_content_id": int,
          "version_id": int,
          "kind": "employer" | "ad" | "house",
          "funding_company_id": int | null,
          "funding_company_name": str | null,
          "title": str, "body": str,
          "image_url": str | null, "cta_label": str | null, "cta_url": str | null,
          "view_token": str (server-issued UUID — echo on /views),
          "click_token": str (server-issued UUID — echo on /clicks),
          "surface": "home"
        }

    Response on miss: `null`.
    """
    if surface not in SUPPORTED_SURFACES:
        raise HTTPException(
            status_code=400, detail=f"unsupported surface '{surface}'"
        )

    hit, cached = crud.cache_get(current_user.user_id, surface)
    if hit:
        return cached

    payload = crud.serve_one(db, user=current_user, surface=surface)
    crud.cache_put(current_user.user_id, surface, payload)
    return payload


# ── /views ────────────────────────────────────────────────────────────────
class ViewIn(BaseModel):
    sponsored_content_id: int
    version_id: int
    view_token: str = Field(min_length=1, max_length=36)
    surface: str = "home"


@router.post("/views", status_code=status.HTTP_201_CREATED)
def log_view(
    body: ViewIn,
    current_user: User = Depends(get_current_user),
    db: Session = Depends(config.get_db),
):
    """Log an impression. Idempotent — the (content_id, user_id, view_token)
    UNIQUE makes a duplicate POST a no-op."""
    pu = getattr(current_user, "private_user", None)
    if pu is None:
        raise HTTPException(status_code=403, detail="employee account required")
    if body.surface not in SUPPORTED_SURFACES:
        raise HTTPException(status_code=400, detail=f"unsupported surface '{body.surface}'")

    was_new = crud.record_view(
        db,
        sponsored_content_id=body.sponsored_content_id,
        version_id=body.version_id,
        private_user_id=pu.private_user_id,
        surface=body.surface,
        view_token=body.view_token,
    )
    return {"ok": True, "deduplicated": not was_new}


# ── /clicks ───────────────────────────────────────────────────────────────
class ClickIn(BaseModel):
    sponsored_content_id: int
    version_id: int
    click_token: str = Field(min_length=1, max_length=36)


@router.post("/clicks")
def log_click(
    body: ClickIn,
    current_user: User = Depends(get_current_user),
    db: Session = Depends(config.get_db),
):
    """Log a click and return the version's `cta_url` as JSON.

    Looks up the URL from the named `version_id` — not from
    sponsored_content.current_version_id — so an edit between view and click
    does NOT change where the user lands.

    Returns `{ok: true, redirect_url: str}`. The mobile client opens
    `redirect_url` via `Linking.openURL`. A 302 redirect was the original
    design but React Native's XHR auto-follows redirects with no way to
    disable, which strips the Location header before axios sees it; JSON
    works the same on every platform.
    """
    pu = getattr(current_user, "private_user", None)
    if pu is None:
        raise HTTPException(status_code=403, detail="employee account required")

    was_new, cta_url = crud.record_click(
        db,
        sponsored_content_id=body.sponsored_content_id,
        version_id=body.version_id,
        private_user_id=pu.private_user_id,
        click_token=body.click_token,
    )
    # Stale-cache: /serve is cached 60s per user. If the admin soft-deleted
    # the row between serve and click, record_click returns (False, None)
    # without logging. Surface that to the client as "no redirect, no error"
    # so the UI just doesn't navigate — same UX as an aborted tap.
    if cta_url is None:
        return {"ok": False, "redirect_url": None, "deduplicated": False}
    # Validate at click time — admins may have edited; the URL might have
    # changed shape between creation and now.
    url = _validate_cta_url(cta_url)
    return {"ok": True, "redirect_url": url, "deduplicated": not was_new}


# ── /dismissals ──────────────────────────────────────────────────────────
class DismissalIn(BaseModel):
    sponsored_content_id: int
    surface: str = "home"


@router.post("/dismissals", status_code=status.HTTP_201_CREATED)
def log_dismissal(
    body: DismissalIn,
    current_user: User = Depends(get_current_user),
    db: Session = Depends(config.get_db),
):
    """Log a dismiss. The quality signal we'll use to A/B placement and pause
    poorly-received campaigns. Not idempotent — a user dismissing twice
    counts as two dismissals, which is fine because the mobile only fires
    once per card render anyway."""
    pu = getattr(current_user, "private_user", None)
    if pu is None:
        raise HTTPException(status_code=403, detail="employee account required")
    if body.surface not in SUPPORTED_SURFACES:
        raise HTTPException(status_code=400, detail=f"unsupported surface '{body.surface}'")

    crud.record_dismissal(
        db,
        sponsored_content_id=body.sponsored_content_id,
        private_user_id=pu.private_user_id,
        surface=body.surface,
    )
    return {"ok": True}


# ── /consent (Phase 2 / M10) ─────────────────────────────────────────────
# Two endpoints, mirroring the consumer-side ads consent contract used on
# mobile (AdsConsentModal + Settings → Ad preferences):
#
#   POST   /sponsored/consent  — first-launch modal answer (accept OR decline)
#   DELETE /sponsored/consent  — withdrawal via Settings toggle
#
# Both write AuditLog rows for DPA Article 7 evidence. The serve algorithm
# checks `ads_consent_at IS NOT NULL` AND `is_ad_free == false` before
# considering kind='ad' candidates, so toggling either flag takes effect on
# the next /serve (within the 60s cache TTL).
class ConsentIn(BaseModel):
    accepted: bool
    policy_version: Optional[str] = None  # privacy-policy revision the user saw


@router.get("/consent")
def get_consent(
    current_user: User = Depends(get_current_user),
    db: Session = Depends(config.get_db),
):
    """Return the caller's current consent state (M13).

    Authoritative server-side read — mobile uses this on the Settings → Ad
    preferences screen so the toggle reflects reality after a device switch
    or a withdrawal made through a different surface, AND on the first-
    launch consent modal so we can suppress the prompt entirely when the
    user's company has ads turned off (no point asking for consent for
    something the user can never see anyway).

    The serve gate checks `ads_consent_at IS NOT NULL AND is_ad_free=false`
    AND `Company.ads_enabled=true`; we surface all three so the mobile can
    short-circuit identically without a second round-trip.
    """
    pu = getattr(current_user, "private_user", None)
    if pu is None:
        raise HTTPException(status_code=403, detail="employee account required")

    # Pull the master company toggle. Default False on lookup miss — a
    # detached employee (company_id=NULL) and a missing Company row both
    # mean "no ads should show", which is the safe direction.
    from core.model import Company
    company_ads_enabled = False
    if pu.company_id:
        co = db.query(Company).filter(Company.company_id == pu.company_id).first()
        company_ads_enabled = bool(co.ads_enabled) if co else False

    return {
        "ok": True,
        "ads_consent_at": pu.ads_consent_at.isoformat() if pu.ads_consent_at else None,
        "is_ad_free": bool(pu.is_ad_free),
        "company_ads_enabled": company_ads_enabled,
    }


@router.post("/consent", status_code=status.HTTP_201_CREATED)
def post_consent(
    body: ConsentIn,
    current_user: User = Depends(get_current_user),
    db: Session = Depends(config.get_db),
):
    """Apply the employee's first-launch ads-consent decision.

      accepted=true  → ads_consent_at = now;  is_ad_free = false
      accepted=false → ads_consent_at = null; is_ad_free = true  (explicit decline)

    Writing both flags symmetrically keeps the /serve gate simple: ads are
    only eligible when consent_at IS NOT NULL AND is_ad_free=false. The
    AuditLog row records `policy_version` so we can prove which revision the
    user agreed to even if they later withdraw."""
    pu = getattr(current_user, "private_user", None)
    if pu is None:
        raise HTTPException(status_code=403, detail="employee account required")

    updated = crud.set_ads_consent(
        db,
        private_user_id=pu.private_user_id,
        accepted=body.accepted,
        policy_version=body.policy_version,
        actor_user_id=current_user.user_id,
    )
    return {
        "ok": True,
        "ads_consent_at": updated.ads_consent_at.isoformat() if updated.ads_consent_at else None,
        "is_ad_free": updated.is_ad_free,
    }


@router.delete("/consent")
def delete_consent(
    current_user: User = Depends(get_current_user),
    db: Session = Depends(config.get_db),
):
    """DPA withdrawal — clears consent + flips is_ad_free=true. Idempotent."""
    pu = getattr(current_user, "private_user", None)
    if pu is None:
        raise HTTPException(status_code=403, detail="employee account required")

    updated = crud.withdraw_ads_consent(
        db,
        private_user_id=pu.private_user_id,
        actor_user_id=current_user.user_id,
    )
    return {
        "ok": True,
        "ads_consent_at": None,
        "is_ad_free": updated.is_ad_free,
    }
