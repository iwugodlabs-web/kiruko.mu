"""CRUD layer for Sponsored Content (Employer Announcements + Ads).

One module backing both user-facing concepts. The router layer pins `kind`
server-side (the company-side router writes only kind='employer'; the
platform-admin router writes only 'ad' or 'house'), so this layer never has
to guess intent.

Responsibilities:
  - Per-kind validation (defense-in-depth alongside DB CHECKs).
  - Create with version 1 snapshot.
  - Patch with auto-snapshot of a new SponsoredContentVersion when any of
    the 5 creative fields change (title/body/image_url/cta_label/cta_url),
    plus current_version_id bump.
  - Soft delete (status='ended' + deleted_at).
  - List filtered by funding_company_id (own-company scope) or unfiltered
    (admin moderation view).
  - Day-bucketed stats from the views/clicks/dismissals tables.
  - resolve_user_targeting_attrs(user) — central mapping from a User to the
    attrs the serve algorithm filters on (used by M3, exposed here so the
    truth lives in one place).

Every mutation writes an AuditLog row before commit so the audit trail is
in the same transaction as the data change.
"""

from datetime import datetime, timezone
from typing import Any, Dict, List, Optional, Tuple


def _utcnow() -> datetime:
    """TZ-aware UTC now — matches the DateTime(timezone=True) columns so date
    comparisons don't trip on naive-vs-aware. Used everywhere we compare a
    datetime to a TIMESTAMPTZ row."""
    return datetime.now(timezone.utc)


# ── /serve per-user response cache ────────────────────────────────────────
# Trivial in-process dict, keyed by (user_id, surface). 60s TTL keeps DB
# pressure low on a hot home screen but stays fresh enough that admin
# edits propagate quickly — AND we proactively invalidate on every write
# (create / patch / soft delete / consent / ads_enabled toggle) so edits
# land on the very next mobile fetch.
#
# Lives in the CRUD module (not the router) so the mutation functions can
# bust the cache themselves without routers having to remember.
#
# ⚠️ KNOWN LIMITATION — single-process only.
# This cache is per-worker. The moment you run `uvicorn --workers N` or
# scale to multiple instances behind a load balancer, each worker has its
# own dict and a write on worker A will NOT invalidate worker B. Users
# can then see stale data for up to SERVE_CACHE_TTL_SECONDS if their
# next request lands on a different worker.
#
# Upgrade path when that becomes a problem:
#   1. Add `redis` (or `aioredis`) to requirements.
#   2. Replace this dict with a Redis client. Keys: `serve:{user_id}:{surface}`.
#      Use EXPIRE for the TTL and DEL on invalidate.
#   3. `invalidate_serve_cache()` becomes a SCAN+DEL on the `serve:*` pattern
#      (or use a single Redis key holding a serialized map if SCAN is too slow).
#   4. The CRUD invalidation hooks below stay identical — just the storage
#      backend changes.
# Tests in TestCacheInvalidation lock the contract, not the storage shape.
import time as _time
SERVE_CACHE_TTL_SECONDS = 60
_serve_cache: dict[tuple[int, str], tuple[float, Optional[dict]]] = {}


def cache_get(user_id: int, surface: str) -> tuple[bool, Optional[dict]]:
    """Return (hit, payload). hit=True even on a cached None (a "miss"
    saved to spare the DB the work of recomputing emptiness in a row)."""
    entry = _serve_cache.get((user_id, surface))
    if not entry:
        return False, None
    expires_at, payload = entry
    if _time.monotonic() >= expires_at:
        _serve_cache.pop((user_id, surface), None)
        return False, None
    return True, payload


def cache_put(user_id: int, surface: str, payload: Optional[dict]) -> None:
    _serve_cache[(user_id, surface)] = (
        _time.monotonic() + SERVE_CACHE_TTL_SECONDS,
        payload,
    )


def invalidate_serve_cache() -> None:
    """Clear every cache entry. Called after any admin/employee write that
    could change what /serve returns for some user. Cheap — the cache size
    is bounded by daily-active-users and clearing it is O(n). We don't try
    to be smart about WHICH users are affected; figuring that out reliably
    means walking the targeting JSONB, and clearing all is fine since
    admin writes are infrequent compared to /serve calls."""
    _serve_cache.clear()

from fastapi import HTTPException, status
from sqlalchemy import and_, func, or_
from sqlalchemy.orm import Session

from core.model import (
    AuditLog,
    Company,
    Department,
    Job,
    PrivateUser,
    SponsoredContent,
    SponsoredContentClick,
    SponsoredContentDismissal,
    SponsoredContentVersion,
    SponsoredContentView,
    User,
)


# Fields whose change triggers a new SponsoredContentVersion snapshot.
CREATIVE_FIELDS = ("title", "body", "image_url", "cta_label", "cta_url")

# M17 — split home into two surfaces so employer comms and paid ads
# stop competing in a single slot. Defaults below are applied when a
# caller doesn't pass `surfaces` explicitly. Listed by kind:
#
#   employer  → home_banner   (strip at top of home; HR/payroll comms)
#   ad        → home_card     (hero card below; paid third-party)
#   house     → home_card     (hero card below; Kiruko first-party
#                              + contextual fill for opted-out users)
#
# Route accepts the legacy `home` surface during the rollout window —
# old mobile builds keep working. See SUPPORTED_SURFACES in
# api/v1/sponsored.py and the M17 backfill migration.
DEFAULT_SURFACES_BY_KIND = {
    "employer": ["home_banner"],
    "ad": ["home_card"],
    "house": ["home_card"],
}

VALID_KINDS = frozenset({"employer", "ad", "house"})
VALID_STATUSES = frozenset({"draft", "active", "paused", "ended"})


# ── Per-kind validator ────────────────────────────────────────────────────
def validate_kind_fields(
    *,
    kind: str,
    funding_company_id: Optional[int],
    paid_amount_cents: Optional[int],
    paid_currency: Optional[str],
) -> None:
    """Raise HTTPException 400 if the (kind, fields) tuple violates the
    per-kind invariant. Matches the DB CHECK constraint exactly so callers
    don't see a confusing IntegrityError from Postgres."""
    if kind not in VALID_KINDS:
        raise HTTPException(status_code=400, detail=f"kind must be one of {sorted(VALID_KINDS)}")
    if kind == "ad":
        if not funding_company_id or paid_amount_cents is None or not paid_currency:
            raise HTTPException(
                status_code=400,
                detail="kind='ad' requires funding_company_id, paid_amount_cents, paid_currency",
            )
    elif kind == "employer":
        if not funding_company_id:
            raise HTTPException(
                status_code=400,
                detail="kind='employer' requires funding_company_id",
            )
    elif kind == "house":
        if funding_company_id is not None or paid_amount_cents is not None:
            raise HTTPException(
                status_code=400,
                detail="kind='house' rejects funding_company_id and paid_amount_cents",
            )


def get_enabled_kinds() -> set[str]:
    """Read ENABLED_KINDS env var. Defaults to Phase 1 set (employer + house)."""
    import os
    raw = os.environ.get("ENABLED_KINDS", "employer,house")
    return {k.strip() for k in raw.split(",") if k.strip()}


def require_kind_enabled(kind: str) -> None:
    """Raise 403 if the kind is not in the deployment's ENABLED_KINDS env var.
    Lets ops disable ads instantly by removing 'ad' from the var without a deploy."""
    if kind not in get_enabled_kinds():
        raise HTTPException(
            status_code=403,
            detail=f"kind='{kind}' is not enabled in this deployment",
        )


# ── Targeting resolver ────────────────────────────────────────────────────
def resolve_user_targeting_attrs(user: User, db: Session) -> Dict[str, Any]:
    """Single source of truth for what user attributes the serve algorithm
    matches against. Used by /serve in M3; exposed here so the join paths
    are documented and unit-testable in one place.

    Returns a dict with the keys the targeting JSONB filters look at. Any
    attribute we couldn't resolve comes back as None — callers treat None as
    "no match required" except where the targeting list is explicitly set.
    """
    pu: Optional[PrivateUser] = getattr(user, "private_user", None)
    if pu is None:
        return {
            "private_user_id": None,
            "company_id": None,
            "department_id": None,
            "role": None,
            "country_code": None,
            "job_title": None,
        }

    country_code = None
    if pu.company_id:
        company = db.query(Company).filter(Company.company_id == pu.company_id).first()
        country_code = company.country_code if company else None

    job = (
        db.query(Job)
        .filter(Job.private_user_id == pu.private_user_id)
        .order_by(Job.job_id.desc())
        .first()
    )

    return {
        "private_user_id": pu.private_user_id,
        "company_id": pu.company_id,
        "department_id": pu.department_id,
        "role": pu.role,
        "country_code": country_code,
        "job_title": job.job_title if job else None,
    }


# ── Audit log helper ──────────────────────────────────────────────────────
def _audit(
    db: Session,
    *,
    actor_user_id: Optional[int],
    action: str,
    content_id: int,
    meta: Optional[Dict[str, Any]] = None,
) -> None:
    """Insert an AuditLog row in the current transaction. Caller commits.

    Action namespace: 'sponsored_content.<verb>' (create | update |
    soft_delete | version_snapshot | status_change).
    """
    db.add(
        AuditLog(
            actor_user_id=actor_user_id,
            action=action,
            target_type="sponsored_content",
            target_id=str(content_id),
            meta=meta or {},
        )
    )


# ── Create ────────────────────────────────────────────────────────────────
def create_sponsored_content(
    db: Session,
    *,
    actor_user_id: Optional[int],
    kind: str,
    funding_company_id: Optional[int],
    title: str,
    body: str,
    image_url: Optional[str] = None,
    cta_label: Optional[str] = None,
    cta_url: Optional[str] = None,
    surfaces: Optional[List[str]] = None,
    targeting: Optional[dict] = None,
    start_at: Optional[datetime] = None,
    end_at: Optional[datetime] = None,
    base_priority: Optional[int] = None,
    paid_amount_cents: Optional[int] = None,
    paid_currency: Optional[str] = None,
    payment_notes: Optional[str] = None,
    variant_group: Optional[str] = None,
    variant_label: Optional[str] = None,
    external_advertiser_name: Optional[str] = None,
) -> SponsoredContent:
    """Create a row + snapshot version 1 + set current_version_id, all in one
    transaction. Caller does not need to manage the version table.

    Note (Phase 2 / M10): `require_kind_enabled` is intentionally NOT called
    here. The `ENABLED_KINDS` kill switch gates **serving**, not authoring —
    a platform admin must be able to draft and review an ad campaign before
    flipping the env var that lets it serve. The serve algorithm
    (`serve_one`) filters candidates by `get_enabled_kinds()` so a kind=ad
    row created with `ENABLED_KINDS='employer,house'` simply will not surface
    on /serve until ops adds 'ad'.
    """
    validate_kind_fields(
        kind=kind,
        funding_company_id=funding_company_id,
        paid_amount_cents=paid_amount_cents,
        paid_currency=paid_currency,
    )

    # base_priority defaults differ by kind — employer comms should generally
    # beat ads of similar paid amount; house fills inventory gaps.
    if base_priority is None:
        base_priority = {"employer": 100, "ad": 50, "house": 25}[kind]

    content = SponsoredContent(
        kind=kind,
        funding_company_id=funding_company_id,
        title=title,
        body=body,
        image_url=image_url,
        cta_label=cta_label,
        cta_url=cta_url,
        status="draft",
        surfaces=surfaces or DEFAULT_SURFACES_BY_KIND[kind],
        targeting=targeting or {},
        start_at=start_at or _utcnow(),
        end_at=end_at,
        base_priority=base_priority,
        paid_amount_cents=paid_amount_cents,
        paid_currency=paid_currency,
        payment_notes=payment_notes,
        variant_group=variant_group,
        variant_label=variant_label,
        external_advertiser_name=external_advertiser_name,
        created_by_user_id=actor_user_id,
        updated_by_user_id=actor_user_id,
    )
    db.add(content)
    db.flush()  # populate sponsored_content_id

    v1 = SponsoredContentVersion(
        sponsored_content_id=content.sponsored_content_id,
        version_number=1,
        title=title,
        body=body,
        image_url=image_url,
        cta_label=cta_label,
        cta_url=cta_url,
        created_by_user_id=actor_user_id,
    )
    db.add(v1)
    db.flush()

    content.current_version_id = v1.version_id

    _audit(
        db,
        actor_user_id=actor_user_id,
        action="sponsored_content.create",
        content_id=content.sponsored_content_id,
        meta={"kind": kind, "funding_company_id": funding_company_id},
    )

    db.commit()
    db.refresh(content)
    invalidate_serve_cache()
    return content


# ── Patch (with auto-version snapshot) ────────────────────────────────────
def patch_sponsored_content(
    db: Session,
    *,
    content: SponsoredContent,
    actor_user_id: Optional[int],
    patch: Dict[str, Any],
) -> SponsoredContent:
    """Apply a partial update. If any of the 5 creative fields changed, snapshot
    a new SponsoredContentVersion (next version_number) and bump
    current_version_id. Returns the refreshed row."""
    if content.deleted_at is not None:
        raise HTTPException(status_code=410, detail="Cannot patch a deleted record")

    creative_changed = False
    new_creative: Dict[str, Any] = {}

    for field, value in patch.items():
        if value is None:
            continue
        if field in CREATIVE_FIELDS:
            current_val = getattr(content, field)
            if value != current_val:
                creative_changed = True
                new_creative[field] = value
        if hasattr(content, field):
            setattr(content, field, value)

    # Re-validate the kind invariants after applying (status changes don't
    # affect them, but a future caller might amend paid_amount_cents).
    validate_kind_fields(
        kind=content.kind,
        funding_company_id=content.funding_company_id,
        paid_amount_cents=content.paid_amount_cents,
        paid_currency=content.paid_currency,
    )

    content.updated_by_user_id = actor_user_id
    content.updated_at = _utcnow()

    if creative_changed:
        max_version = (
            db.query(func.max(SponsoredContentVersion.version_number))
            .filter(SponsoredContentVersion.sponsored_content_id == content.sponsored_content_id)
            .scalar()
            or 0
        )
        new_v = SponsoredContentVersion(
            sponsored_content_id=content.sponsored_content_id,
            version_number=max_version + 1,
            title=content.title,
            body=content.body,
            image_url=content.image_url,
            cta_label=content.cta_label,
            cta_url=content.cta_url,
            created_by_user_id=actor_user_id,
        )
        db.add(new_v)
        db.flush()
        content.current_version_id = new_v.version_id

        _audit(
            db,
            actor_user_id=actor_user_id,
            action="sponsored_content.version_snapshot",
            content_id=content.sponsored_content_id,
            meta={"version_number": new_v.version_number, "changed_fields": list(new_creative.keys())},
        )

    _audit(
        db,
        actor_user_id=actor_user_id,
        action="sponsored_content.update",
        content_id=content.sponsored_content_id,
        meta={"patch_keys": list(patch.keys())},
    )

    db.commit()
    db.refresh(content)
    invalidate_serve_cache()
    return content


# ── Soft delete ───────────────────────────────────────────────────────────
def soft_delete_sponsored_content(
    db: Session,
    *,
    content: SponsoredContent,
    actor_user_id: Optional[int],
) -> SponsoredContent:
    if content.deleted_at is not None:
        return content  # idempotent: already deleted
    content.deleted_at = _utcnow()
    content.status = "ended"
    content.updated_by_user_id = actor_user_id
    content.updated_at = _utcnow()

    _audit(
        db,
        actor_user_id=actor_user_id,
        action="sponsored_content.soft_delete",
        content_id=content.sponsored_content_id,
        meta={},
    )

    db.commit()
    db.refresh(content)
    invalidate_serve_cache()
    return content


# ── Auto-expire lapsed campaigns ──────────────────────────────────────────
def expire_lapsed_campaigns(
    db: Session, *, actor_user_id: Optional[int] = None,
) -> int:
    """Flip any active/paused campaign whose `end_at` has passed to
    `status='ended'`. Returns the number of rows transitioned.

    /serve filters by `end_at` directly in its candidate query, so the
    serve algorithm never returns lapsed rows regardless of stored
    status. This helper exists for the ADMIN UI — without it, the
    listings (`/admin/ads`, `/admin/sponsored`) render `Active` for
    days after a campaign's window closes, making the inventory look
    healthier than it is. House #9 is the live example: status='active',
    end_at past, but no impressions and no eligibility.

    Called lazily at the top of the two admin listing handlers — cheap
    when nothing has lapsed (selective + indexed predicate), and the
    only path that cares about stored status accuracy. Idempotent;
    safe to call on every request.

    Drafts are intentionally left alone — they were never serving and
    auto-ending them would discard work-in-progress.
    """
    now = _utcnow()
    expiring = (
        db.query(SponsoredContent)
        .filter(
            SponsoredContent.status.in_(("active", "paused")),
            SponsoredContent.end_at.isnot(None),
            SponsoredContent.end_at < now,
            SponsoredContent.deleted_at.is_(None),
        )
        .all()
    )

    if not expiring:
        return 0

    for c in expiring:
        before = c.status
        c.status = "ended"
        c.updated_by_user_id = actor_user_id
        c.updated_at = now
        _audit(
            db,
            actor_user_id=actor_user_id,  # None = system-initiated lapse
            action="sponsored_content.auto_expire",
            content_id=c.sponsored_content_id,
            meta={
                "before_status": before,
                "end_at": c.end_at.isoformat() if c.end_at else None,
            },
        )

    db.commit()
    invalidate_serve_cache()
    return len(expiring)


# ── Read helpers ──────────────────────────────────────────────────────────
def get_by_id(
    db: Session, content_id: int, *, include_deleted: bool = False
) -> Optional[SponsoredContent]:
    q = db.query(SponsoredContent).filter(SponsoredContent.sponsored_content_id == content_id)
    if not include_deleted:
        q = q.filter(SponsoredContent.deleted_at.is_(None))
    return q.first()


def list_by_company(
    db: Session,
    *,
    company_id: int,
    kind: Optional[str] = None,
    status_filter: Optional[str] = None,
    include_deleted: bool = False,
    limit: int = 100,
    offset: int = 0,
) -> List[SponsoredContent]:
    q = db.query(SponsoredContent).filter(
        SponsoredContent.funding_company_id == company_id
    )
    if kind:
        q = q.filter(SponsoredContent.kind == kind)
    if status_filter:
        q = q.filter(SponsoredContent.status == status_filter)
    if not include_deleted:
        q = q.filter(SponsoredContent.deleted_at.is_(None))
    return q.order_by(SponsoredContent.created_at.desc()).limit(limit).offset(offset).all()


def list_all_admin(
    db: Session,
    *,
    kind: Optional[str] = None,
    status_filter: Optional[str] = None,
    funding_company_id: Optional[int] = None,
    include_deleted: bool = False,
    limit: int = 100,
    offset: int = 0,
) -> List[SponsoredContent]:
    """Moderation listing — platform admins see across all companies and all kinds."""
    q = db.query(SponsoredContent)
    if kind:
        q = q.filter(SponsoredContent.kind == kind)
    if status_filter:
        q = q.filter(SponsoredContent.status == status_filter)
    if funding_company_id is not None:
        q = q.filter(SponsoredContent.funding_company_id == funding_company_id)
    if not include_deleted:
        q = q.filter(SponsoredContent.deleted_at.is_(None))
    return q.order_by(SponsoredContent.created_at.desc()).limit(limit).offset(offset).all()


def list_versions(db: Session, content_id: int) -> List[SponsoredContentVersion]:
    return (
        db.query(SponsoredContentVersion)
        .filter(SponsoredContentVersion.sponsored_content_id == content_id)
        .order_by(SponsoredContentVersion.version_number.asc())
        .all()
    )


# ── Stats ─────────────────────────────────────────────────────────────────
def get_stats(
    db: Session,
    *,
    content_id: int,
    bucket: str = "day",
) -> Dict[str, Any]:
    """Return per-bucket views/clicks/dismissals + totals for a sponsored
    content row. `bucket` is 'day' or 'hour'."""
    if bucket not in ("day", "hour"):
        raise HTTPException(status_code=400, detail="bucket must be 'day' or 'hour'")

    bucket_expr_views = func.date_trunc(bucket, SponsoredContentView.viewed_at).label("bucket")
    views_rows = (
        db.query(bucket_expr_views, func.count().label("c"))
        .filter(SponsoredContentView.sponsored_content_id == content_id)
        .group_by(bucket_expr_views)
        .all()
    )
    bucket_expr_clicks = func.date_trunc(bucket, SponsoredContentClick.clicked_at).label("bucket")
    clicks_rows = (
        db.query(bucket_expr_clicks, func.count().label("c"))
        .filter(SponsoredContentClick.sponsored_content_id == content_id)
        .group_by(bucket_expr_clicks)
        .all()
    )
    bucket_expr_dismissals = func.date_trunc(bucket, SponsoredContentDismissal.dismissed_at).label("bucket")
    dismissals_rows = (
        db.query(bucket_expr_dismissals, func.count().label("c"))
        .filter(SponsoredContentDismissal.sponsored_content_id == content_id)
        .group_by(bucket_expr_dismissals)
        .all()
    )

    buckets_map: Dict[Any, Dict[str, int]] = {}
    for b, c in views_rows:
        buckets_map.setdefault(b, {"views": 0, "clicks": 0, "dismissals": 0})["views"] = c
    for b, c in clicks_rows:
        buckets_map.setdefault(b, {"views": 0, "clicks": 0, "dismissals": 0})["clicks"] = c
    for b, c in dismissals_rows:
        buckets_map.setdefault(b, {"views": 0, "clicks": 0, "dismissals": 0})["dismissals"] = c

    buckets_list = [
        {"bucket": b, "views": v["views"], "clicks": v["clicks"], "dismissals": v["dismissals"]}
        for b, v in sorted(buckets_map.items())
    ]
    total_views = sum(v["views"] for v in buckets_map.values())
    total_clicks = sum(v["clicks"] for v in buckets_map.values())
    total_dismissals = sum(v["dismissals"] for v in buckets_map.values())
    ctr = (total_clicks / total_views) if total_views else 0.0

    return {
        "sponsored_content_id": content_id,
        "bucket_size": bucket,
        "total_views": total_views,
        "total_clicks": total_clicks,
        "total_dismissals": total_dismissals,
        "ctr": ctr,
        "buckets": buckets_list,
    }


# ── Serve algorithm ──────────────────────────────────────────────────────
# Tunable scoring constants. Documented inline so a product change is one
# place. Math: a paid ad needs paid_amount_cents > (base_employer - base_ad)
# * 1000 = ~50,000 (~$500) to outscore an equally-eligible employer
# announcement at parity recency.
#
# Product intent (revised after device testing): a sponsored card stays
# visible to the user until they explicitly dismiss it (mobile-side 24h
# AsyncStorage entry) OR the window closes (start_at/end_at). The serve
# layer NO LONGER auto-hides on "you've already seen this." The previous
# 24h per-content cap, variant_group cap, and global daily cap have all
# been removed — they made testing painful and the user-facing model
# inconsistent ("I dismissed nothing but the card vanished").
BASE_PRIORITY_DEFAULT = {"employer": 100, "ad": 50, "house": 25}
RECENCY_WINDOW_DAYS = 7      # campaigns started in the last week get a boost
RECENCY_BOOST = 30           # added to score when in recency window
FREQUENCY_PENALTY_PER_VIEW = 50  # subtracted per prior view by this user (ranking input only)
# Only views inside this rolling window count toward the penalty. Lifetime
# views would make the penalty permanent — a row a user saw 5× last year
# would lose 250 score forever, drowning it out forever. Windowing the
# lookback lets the penalty *rotate* the winner across a pool: the
# recently-viewed candidate drops below alternatives for a day, then
# recovers. When there's no competing candidate the same card still
# serves repeatedly (penalty is irrelevant with a candidate pool of 1).
FREQUENCY_PENALTY_WINDOW_HOURS = 24


def _passes_targeting(content: SponsoredContent, attrs: Dict[str, Any]) -> bool:
    """Check the content's `targeting` JSONB against the caller's resolved
    attrs. Empty / missing keys = no filter. See targeting source-of-truth
    in SPONSORED_CONTENT_PLAN.md."""
    t = content.targeting or {}

    if content.kind == "employer":
        dept_ids = t.get("department_ids") or []
        if dept_ids and attrs.get("department_id") not in dept_ids:
            return False
        job_titles = t.get("job_titles") or []
        if job_titles and attrs.get("job_title") not in job_titles:
            return False
        return True

    # ad / house — cross-company targeting shape
    company_ids = t.get("company_ids") or []
    if company_ids and attrs.get("company_id") not in company_ids:
        return False
    exclude = t.get("exclude_company_ids") or []
    if exclude and attrs.get("company_id") in exclude:
        return False
    country_codes = t.get("country_codes") or []
    if country_codes and attrs.get("country_code") not in country_codes:
        return False
    roles = t.get("roles") or []
    if roles and attrs.get("role") not in roles:
        return False
    # M14 — department drill-down. Combined AND with company_ids: an ad
    # targeting Acme + dept 5 will only serve to Acme employees who are in
    # department 5. department_id is not scoped to a company at the DB level,
    # so the admin UI groups departments by company to make the picker
    # unambiguous, but the runtime check is a flat membership test.
    department_ids = t.get("department_ids") or []
    if department_ids and attrs.get("department_id") not in department_ids:
        return False
    return True


def _passes_kind_eligibility(content: SponsoredContent, attrs: Dict[str, Any]) -> bool:
    """Kind-specific eligibility beyond targeting.

    Phase 1 ships only `employer` + `house`. The `ad` branch is written for
    forward-compatibility with Phase 2 — it uses `getattr` so it doesn't
    blow up before the Phase 2 migration adds the columns.
    """
    if content.kind == "employer":
        return attrs.get("company_id") == content.funding_company_id
    if content.kind == "house":
        return True
    if content.kind == "ad":
        # Phase 2 gates (not present in DB yet — getattr returns the safe default).
        pu = attrs.get("_private_user_obj")
        company = attrs.get("_company_obj")
        if pu is None or company is None:
            return False
        if getattr(pu, "is_ad_free", False):
            return False
        if getattr(pu, "ads_consent_at", None) is None:
            return False
        if not getattr(company, "ads_enabled", False):
            return False
        return True
    return False


def _score(content: SponsoredContent, *, prior_view_count: int) -> float:
    """Unified ranking. See SPONSORED_CONTENT_PLAN.md serve algorithm step 6.

    The math is intentionally simple: a sum, not a product, so each lever has
    a predictable effect that's easy to debug from a single SQL query against
    the candidate pool.
    """
    from datetime import timedelta

    score = float(content.base_priority or 0)
    score += (content.paid_amount_cents or 0) / 1000.0
    if content.start_at and content.start_at >= (
        _utcnow() - timedelta(days=RECENCY_WINDOW_DAYS)
    ):
        score += RECENCY_BOOST
    score -= FREQUENCY_PENALTY_PER_VIEW * prior_view_count
    return score


def serve_one(
    db: Session, *, user: User, surface: str
) -> Optional[Dict[str, Any]]:
    """Return the single sponsored_content row that wins the slot for this
    caller + surface, or None.

    Master kill switch (`SPONSORED_ENABLED=false`) returns None up front.
    Per-kind kill switch (`ENABLED_KINDS`) filters the candidate pool.

    The returned dict (when non-None) is what the router serializes to the
    client. Contains both `view_token` and `click_token` — server-issued
    UUIDs the client echoes back on /views and /clicks.
    """
    import os
    import uuid

    if os.environ.get("SPONSORED_ENABLED", "true").lower() != "true":
        return None

    enabled = get_enabled_kinds()
    if not enabled:
        return None

    attrs = resolve_user_targeting_attrs(user, db)
    private_user_id = attrs.get("private_user_id")
    if not private_user_id:
        return None  # nothing to serve to a non-private user

    # Stash the live objects for the ad branch (used by Phase 2).
    pu = getattr(user, "private_user", None)
    attrs["_private_user_obj"] = pu
    if attrs.get("company_id"):
        attrs["_company_obj"] = (
            db.query(Company).filter(Company.company_id == attrs["company_id"]).first()
        )
    else:
        attrs["_company_obj"] = None

    now = _utcnow()
    candidates: List[SponsoredContent] = (
        db.query(SponsoredContent)
        .filter(
            SponsoredContent.kind.in_(enabled),
            SponsoredContent.status == "active",
            SponsoredContent.deleted_at.is_(None),
            SponsoredContent.start_at <= now,
            or_(SponsoredContent.end_at.is_(None), SponsoredContent.end_at >= now),
        )
        .all()
    )

    # Filter: surface, kind-eligibility, targeting. NO repeat-view filtering
    # — the card stays visible to the user until they dismiss it (handled
    # on mobile via AsyncStorage) or the window closes (start_at/end_at).
    eligible: List[SponsoredContent] = []
    prior_views_by_content: Dict[int, int] = {}

    for c in candidates:
        if surface not in (c.surfaces or []):
            continue
        if not _passes_kind_eligibility(c, attrs):
            continue
        if not _passes_targeting(c, attrs):
            continue
        eligible.append(c)

    if not eligible:
        return None

    # Recent (last FREQUENCY_PENALTY_WINDOW_HOURS) view count by this user
    # per content. Used as the frequency-penalty input — see commentary on
    # FREQUENCY_PENALTY_WINDOW_HOURS above for why this isn't lifetime.
    if eligible:
        from datetime import timedelta

        ids = [c.sponsored_content_id for c in eligible]
        recent_cutoff = now - timedelta(hours=FREQUENCY_PENALTY_WINDOW_HOURS)
        view_counts = dict(
            db.query(
                SponsoredContentView.sponsored_content_id,
                func.count(SponsoredContentView.view_id),
            )
            .filter(
                SponsoredContentView.private_user_id == private_user_id,
                SponsoredContentView.sponsored_content_id.in_(ids),
                SponsoredContentView.viewed_at >= recent_cutoff,
            )
            .group_by(SponsoredContentView.sponsored_content_id)
            .all()
        )
        for cid in ids:
            prior_views_by_content[cid] = view_counts.get(cid, 0)

    # Score and pick the winner. Random tiebreak via Python's random.shuffle
    # over the top-tier — keeps two equally-scored campaigns from starving
    # each other when the cache window is hot.
    import random

    scored = [
        (_score(c, prior_view_count=prior_views_by_content.get(c.sponsored_content_id, 0)), c)
        for c in eligible
    ]
    scored.sort(key=lambda t: t[0], reverse=True)
    top_score = scored[0][0]
    top_tier = [c for s, c in scored if s == top_score]
    winner = random.choice(top_tier)

    # Resolve current version (the creative actually rendered + attributed).
    version_id = winner.current_version_id
    version: Optional[SponsoredContentVersion] = None
    if version_id:
        version = (
            db.query(SponsoredContentVersion)
            .filter(SponsoredContentVersion.version_id == version_id)
            .first()
        )
    # Fallback to denorm fields if (somehow) no version exists.
    title = version.title if version else winner.title
    body = version.body if version else winner.body
    image_url = version.image_url if version else winner.image_url
    cta_label = version.cta_label if version else winner.cta_label
    cta_url = version.cta_url if version else winner.cta_url

    funding_company_name = None
    if winner.funding_company_id and attrs.get("_company_obj"):
        # Fast path: caller's own company.
        if attrs["_company_obj"].company_id == winner.funding_company_id:
            funding_company_name = attrs["_company_obj"].company_name
    if funding_company_name is None and winner.funding_company_id:
        fc = db.query(Company).filter(
            Company.company_id == winner.funding_company_id
        ).first()
        funding_company_name = fc.company_name if fc else None

    return {
        "sponsored_content_id": winner.sponsored_content_id,
        "version_id": version_id,
        "kind": winner.kind,
        "funding_company_id": winner.funding_company_id,
        "funding_company_name": funding_company_name,
        "external_advertiser_name": winner.external_advertiser_name,
        "title": title,
        "body": body,
        "image_url": image_url,
        "cta_label": cta_label,
        "cta_url": cta_url,
        "view_token": str(uuid.uuid4()),
        "click_token": str(uuid.uuid4()),
        "surface": surface,
    }


# ── View / click / dismissal recording ────────────────────────────────────
def record_view(
    db: Session,
    *,
    sponsored_content_id: int,
    version_id: int,
    private_user_id: int,
    surface: str,
    view_token: str,
) -> bool:
    """Insert a view row. Returns True if a new row was inserted, False if the
    (content_id, user_id, view_token) UNIQUE rejected a duplicate. Increments
    the denorm counter only on a real insert."""
    from sqlalchemy.exc import IntegrityError

    content = db.query(SponsoredContent).filter(
        SponsoredContent.sponsored_content_id == sponsored_content_id
    ).first()
    if content is None:
        raise HTTPException(status_code=404, detail="sponsored_content not found")
    # Stale-cache guard. /serve is cached 60s per user; an admin who
    # soft-deletes during that window will see the deleted row's view_token
    # come back here. Don't pollute stats — treat as a no-op.
    if content.deleted_at is not None:
        return False

    view = SponsoredContentView(
        sponsored_content_id=sponsored_content_id,
        version_id=version_id,
        private_user_id=private_user_id,
        kind=content.kind,
        surface=surface,
        view_token=view_token,
    )
    db.add(view)
    try:
        db.flush()
    except IntegrityError:
        db.rollback()
        return False

    content.view_count = (content.view_count or 0) + 1
    db.commit()
    return True


def record_click(
    db: Session,
    *,
    sponsored_content_id: int,
    version_id: int,
    private_user_id: int,
    click_token: str,
) -> Tuple[bool, Optional[str]]:
    """Insert a click row. Returns (was_new_insert, cta_url).

    The `version_id` echoed by the client comes from the /serve response; the
    server looks up the cta_url from THAT version, not from
    sponsored_content.current_version_id — so if the campaign was edited
    between view and click, attribution + redirect target stay locked to
    what the user actually saw.
    """
    from sqlalchemy.exc import IntegrityError

    version = (
        db.query(SponsoredContentVersion)
        .filter(
            SponsoredContentVersion.version_id == version_id,
            SponsoredContentVersion.sponsored_content_id == sponsored_content_id,
        )
        .first()
    )
    if version is None:
        raise HTTPException(
            status_code=404, detail="version not found for this content"
        )
    content = db.query(SponsoredContent).filter(
        SponsoredContent.sponsored_content_id == sponsored_content_id
    ).first()
    if content is None:
        raise HTTPException(status_code=404, detail="sponsored_content not found")
    # Stale-cache guard — same reasoning as record_view. If the admin
    # soft-deleted because the URL was wrong/malicious, we don't want a
    # cached card to keep redirecting users for up to 60s.
    if content.deleted_at is not None:
        return False, None

    click = SponsoredContentClick(
        sponsored_content_id=sponsored_content_id,
        version_id=version_id,
        private_user_id=private_user_id,
        kind=content.kind,
        click_token=click_token,
    )
    db.add(click)
    try:
        db.flush()
        was_new = True
    except IntegrityError:
        db.rollback()
        was_new = False

    if was_new:
        content.click_count = (content.click_count or 0) + 1
        db.commit()

    return was_new, version.cta_url


def record_dismissal(
    db: Session,
    *,
    sponsored_content_id: int,
    private_user_id: int,
    surface: str,
) -> None:
    content = db.query(SponsoredContent).filter(
        SponsoredContent.sponsored_content_id == sponsored_content_id
    ).first()
    if content is None:
        raise HTTPException(status_code=404, detail="sponsored_content not found")
    # Stale-cache guard — see record_view.
    if content.deleted_at is not None:
        return
    db.add(
        SponsoredContentDismissal(
            sponsored_content_id=sponsored_content_id,
            private_user_id=private_user_id,
            kind=content.kind,
            surface=surface,
        )
    )
    db.commit()


def iter_raw_events_for_csv(
    db: Session, content_id: int
) -> List[Tuple[str, datetime, Optional[int], Optional[int]]]:
    """Yield (event_type, timestamp, private_user_id, version_id) rows for CSV
    export. Used by the export endpoint to stream a flat dump of the campaign's
    views + clicks + dismissals for advertiser reporting."""
    rows: List[Tuple[str, datetime, Optional[int], Optional[int]]] = []
    for v in (
        db.query(SponsoredContentView)
        .filter(SponsoredContentView.sponsored_content_id == content_id)
        .order_by(SponsoredContentView.viewed_at.asc())
        .all()
    ):
        rows.append(("view", v.viewed_at, v.private_user_id, v.version_id))
    for c in (
        db.query(SponsoredContentClick)
        .filter(SponsoredContentClick.sponsored_content_id == content_id)
        .order_by(SponsoredContentClick.clicked_at.asc())
        .all()
    ):
        rows.append(("click", c.clicked_at, c.private_user_id, c.version_id))
    for d in (
        db.query(SponsoredContentDismissal)
        .filter(SponsoredContentDismissal.sponsored_content_id == content_id)
        .order_by(SponsoredContentDismissal.dismissed_at.asc())
        .all()
    ):
        rows.append(("dismissal", d.dismissed_at, d.private_user_id, None))
    rows.sort(key=lambda r: r[1])
    return rows


# ── Phase 2 (M10): consent + per-company ads toggle ──────────────────────
def set_ads_consent(
    db: Session,
    *,
    private_user_id: int,
    accepted: bool,
    policy_version: Optional[str],
    actor_user_id: Optional[int],
) -> PrivateUser:
    """Apply an employee's ads-consent decision.

      accepted=True  → record consent timestamp; clear is_ad_free.
                        /serve will now consider kind='ad' for this user.
      accepted=False → no consent timestamp; set is_ad_free=True.
                        Explicit decline; serve never returns ads.

    The `policy_version` is stored in the AuditLog meta so we can prove which
    privacy-policy revision the user agreed to (DPA Article 7 evidence). The
    column itself isn't versioned — withdrawing + re-consenting overwrites
    the timestamp, which is fine because the AuditLog is the authoritative
    history.
    """
    pu = db.query(PrivateUser).filter(
        PrivateUser.private_user_id == private_user_id
    ).first()
    if pu is None:
        raise HTTPException(status_code=404, detail="private user not found")

    if accepted:
        pu.ads_consent_at = _utcnow()
        pu.is_ad_free = False
    else:
        pu.ads_consent_at = None
        pu.is_ad_free = True

    db.add(
        AuditLog(
            actor_user_id=actor_user_id,
            action="sponsored_content.consent",
            target_type="private_user",
            target_id=str(private_user_id),
            meta={"accepted": accepted, "policy_version": policy_version or ""},
        )
    )
    db.commit()
    db.refresh(pu)
    invalidate_serve_cache()
    return pu


def withdraw_ads_consent(
    db: Session,
    *,
    private_user_id: int,
    actor_user_id: Optional[int],
) -> PrivateUser:
    """DPA withdrawal mechanism. Idempotent — clearing already-null consent is
    a no-op write but still audits (so we have evidence of the withdrawal
    request even if the state didn't change)."""
    pu = db.query(PrivateUser).filter(
        PrivateUser.private_user_id == private_user_id
    ).first()
    if pu is None:
        raise HTTPException(status_code=404, detail="private user not found")

    pu.ads_consent_at = None
    pu.is_ad_free = True

    db.add(
        AuditLog(
            actor_user_id=actor_user_id,
            action="sponsored_content.consent_withdraw",
            target_type="private_user",
            target_id=str(private_user_id),
            meta={},
        )
    )
    db.commit()
    db.refresh(pu)
    invalidate_serve_cache()
    return pu


def set_company_ads_enabled(
    db: Session,
    *,
    company_id: int,
    enabled: bool,
    actor_user_id: int,
) -> Company:
    """Platform-admin toggle: flip a company's `ads_enabled` (the master gate
    that decides whether ANY of that company's employees can see kind='ad').

    Sales-deal workflow: grandfathered customers start at False; flipping to
    True requires a re-signed contract. Toggling here lands instantly (within
    the 60s serve cache).
    """
    co = db.query(Company).filter(Company.company_id == company_id).first()
    if co is None:
        raise HTTPException(status_code=404, detail="company not found")

    before = bool(co.ads_enabled)
    co.ads_enabled = enabled

    db.add(
        AuditLog(
            actor_user_id=actor_user_id,
            action="sponsored_content.ads_enabled_toggle",
            target_type="company",
            target_id=str(company_id),
            meta={"before": before, "after": bool(enabled)},
        )
    )
    db.commit()
    db.refresh(co)
    invalidate_serve_cache()
    return co


# ── Eligibility diagnostic (M16) ──────────────────────────────────────────
# Why this exists: an admin sees a campaign with status='active' inside its
# time window and wonders why /serve never returns it. The reason is usually
# one of the per-kind gates (Company.ads_enabled, PrivateUser.ads_consent_at,
# ENABLED_KINDS, surfaces) that the campaign detail page didn't surface.
# Running each gate against the live deployment and reporting pass/fail in
# one place removes the "ask Claude to run SQL" step.
#
# Pure read-only. Re-runs the same gate checks the serve algorithm runs,
# but aggregated across the funder's employee pool rather than for a single
# caller, since the admin asking is not the audience.
def compute_eligibility(db: Session, *, content_id: int) -> Dict[str, Any]:
    """Run every gate that decides whether `content_id` can be served, and
    return a structured report the web UI renders as a checklist.

    Shape (stable contract — the web component depends on this):
      {
        "content_id": int,
        "kind": "ad" | "employer" | "house",
        "status": str,                    # echo for the panel header
        "summary": "ready" | "blocked",   # any FAIL → blocked
        "checks": [
          { "key": str, "level": "ok"|"fail"|"info",
            "label": str, "detail": str|None,
            "hint": str|None }            # actionable fix when level=='fail'
        ],
        "audience": {                     # kind-specific aggregate
          "funding_company_id": int|None,
          "funding_company_name": str|None,
          "total_employees": int|None,
          "consenting_employees": int|None,   # kind='ad' only
          "ad_free_employees": int|None,      # kind='ad' only
        }
      }
    """
    content = (
        db.query(SponsoredContent)
        .filter(SponsoredContent.sponsored_content_id == content_id)
        .first()
    )
    if content is None:
        raise HTTPException(status_code=404, detail="sponsored_content not found")

    checks: List[Dict[str, Any]] = []
    now = _utcnow()

    # 1. Status — must be 'active' for /serve to consider the row at all.
    if content.status == "active":
        checks.append({
            "key": "status",
            "level": "ok",
            "label": "Status: active",
            "detail": None,
            "hint": None,
        })
    else:
        checks.append({
            "key": "status",
            "level": "fail",
            "label": f"Status: {content.status}",
            "detail": "/serve only considers rows with status='active'.",
            "hint": "Change status to active on this page.",
        })

    # 2. Soft delete.
    if content.deleted_at is not None:
        checks.append({
            "key": "deleted",
            "level": "fail",
            "label": "Soft-deleted",
            "detail": f"deleted_at={content.deleted_at.isoformat()}",
            "hint": "Soft-deleted rows cannot be served. Recreate the campaign.",
        })

    # 3. Time window. start_at is required by the schema; end_at is optional.
    if content.start_at and content.start_at > now:
        delta = content.start_at - now
        checks.append({
            "key": "window",
            "level": "fail",
            "label": "Time window: scheduled",
            "detail": f"start_at is in the future ({content.start_at.isoformat()}).",
            "hint": f"Will start serving in {_format_duration(delta)}.",
        })
    elif content.end_at and content.end_at < now:
        delta = now - content.end_at
        checks.append({
            "key": "window",
            "level": "fail",
            "label": "Time window: closed",
            "detail": f"end_at passed ({content.end_at.isoformat()}).",
            "hint": f"Extend end_at — window closed {_format_duration(delta)} ago.",
        })
    else:
        if content.end_at:
            detail = (
                f"now is within {content.start_at.isoformat()} "
                f"… {content.end_at.isoformat()}"
            )
        else:
            detail = f"started {content.start_at.isoformat()}, no end_at set"
        checks.append({
            "key": "window",
            "level": "ok",
            "label": "Time window: live",
            "detail": detail,
            "hint": None,
        })

    # 4. ENABLED_KINDS — deployment-level kind toggle.
    enabled = get_enabled_kinds()
    if content.kind in enabled:
        checks.append({
            "key": "enabled_kinds",
            "level": "ok",
            "label": f"ENABLED_KINDS: '{content.kind}' is enabled",
            "detail": f"This deployment serves: {sorted(enabled)}",
            "hint": None,
        })
    else:
        checks.append({
            "key": "enabled_kinds",
            "level": "fail",
            "label": f"ENABLED_KINDS: '{content.kind}' is disabled",
            "detail": f"This deployment serves: {sorted(enabled)}",
            "hint": (
                f"Set the ENABLED_KINDS env var to include '{content.kind}' "
                "and restart the backend."
            ),
        })

    # 5. Surfaces — must be non-empty, else /serve has nothing to match.
    if not content.surfaces:
        checks.append({
            "key": "surfaces",
            "level": "fail",
            "label": "Surfaces: none",
            "detail": "Empty surfaces list — /serve filters by surface, so this row never matches.",
            "hint": "Set at least one surface (typically 'home').",
        })
    else:
        checks.append({
            "key": "surfaces",
            "level": "ok",
            "label": f"Surfaces: {', '.join(content.surfaces)}",
            "detail": None,
            "hint": None,
        })

    # 6. Per-kind gates + audience aggregate.
    audience: Dict[str, Any] = {
        "funding_company_id": content.funding_company_id,
        "funding_company_name": None,
        "total_employees": None,
        "consenting_employees": None,
        "ad_free_employees": None,
    }
    funder: Optional[Company] = None
    if content.funding_company_id:
        funder = (
            db.query(Company)
            .filter(Company.company_id == content.funding_company_id)
            .first()
        )
        if funder:
            audience["funding_company_name"] = funder.company_name

    if content.kind == "ad":
        # 6a. Company.ads_enabled — the master kill switch the user kept
        #     tripping on. Surface this LOUDLY when off.
        if funder is None:
            checks.append({
                "key": "ads_enabled",
                "level": "fail",
                "label": "Company ads_enabled: funder missing",
                "detail": f"funding_company_id={content.funding_company_id} not found.",
                "hint": "Fix the funder reference.",
            })
        elif funder.ads_enabled:
            checks.append({
                "key": "ads_enabled",
                "level": "ok",
                "label": f"Company ads_enabled: {funder.company_name} is allowed",
                "detail": None,
                "hint": None,
            })
        else:
            checks.append({
                "key": "ads_enabled",
                "level": "fail",
                "label": f"Company ads_enabled: {funder.company_name} is OFF",
                "detail": (
                    f"{funder.company_name} has ads_enabled=false — no employee "
                    "of this company can be the advertiser on an ad served via "
                    "Kiruko. (This gate is set by platform staff per the "
                    "advertising contract, not by the company itself.)"
                ),
                "hint": (
                    f"Toggle ads_enabled on /admin/employers/{funder.company_id} "
                    "(Third-party ads control)."
                ),
            })

        # 6b. Per-employee gates aggregated over the *fully* targeted audience.
        #
        # Earlier versions of this only filtered on `company_ids`, which made
        # the audience count misleading for any campaign that further
        # narrowed by department / country / role. Example caught in the
        # field: ad #14 targeted Hands PLC + dept #2 + country MU. Company
        # filter alone yielded 2 employees; the real eligible audience after
        # department filter was 1. Admins read "2 targeted" and assumed they
        # had a pool to convert, when actually there was only one person and
        # they'd already opted out.
        #
        # Mirror every predicate that `_passes_targeting` checks at serve
        # time, so the audience aggregate matches reality.
        t = content.targeting or {}
        target_company_ids = t.get("company_ids") or []
        exclude_company_ids = t.get("exclude_company_ids") or []
        target_department_ids = t.get("department_ids") or []
        target_country_codes = t.get("country_codes") or []
        target_roles = t.get("roles") or []

        q = db.query(PrivateUser)
        if target_company_ids:
            q = q.filter(PrivateUser.company_id.in_(target_company_ids))
        if exclude_company_ids:
            q = q.filter(~PrivateUser.company_id.in_(exclude_company_ids))
        if target_department_ids:
            q = q.filter(PrivateUser.department_id.in_(target_department_ids))
        if target_roles:
            q = q.filter(PrivateUser.role.in_(target_roles))
        if target_country_codes:
            # country_code lives on Company, not PrivateUser — join through.
            # Inner join is safe: a PrivateUser with company_id IS NULL can
            # never match country targeting anyway (no company → no country).
            q = q.join(Company, PrivateUser.company_id == Company.company_id).filter(
                Company.country_code.in_(target_country_codes)
            )

        total = q.count()
        consenting = q.filter(PrivateUser.ads_consent_at.isnot(None)).count()
        ad_free = q.filter(PrivateUser.is_ad_free.is_(True)).count()
        audience["total_employees"] = total
        audience["consenting_employees"] = consenting
        audience["ad_free_employees"] = ad_free

        if total == 0:
            checks.append({
                "key": "audience",
                "level": "fail",
                "label": "Audience: zero employees match targeting",
                "detail": (
                    "No PrivateUser rows are in the allow-listed companies — "
                    "even with every other gate green, no one can be served."
                ),
                "hint": (
                    "Broaden targeting.company_ids, or leave it empty to "
                    "target every employee on the platform."
                ),
            })
        elif consenting == 0:
            checks.append({
                "key": "consent",
                "level": "fail",
                "label": f"Per-employee consent: 0 of {total} have consented",
                "detail": (
                    "kind='ad' requires PrivateUser.ads_consent_at IS NOT NULL "
                    "for each viewer (DPA Art. 7). No targeted employee has "
                    "accepted yet, so /serve will return null for everyone."
                ),
                "hint": (
                    "Employees see the AdsConsentModal on the home screen "
                    "once the Company.ads_enabled gate above is on."
                ),
            })
        else:
            eligible_n = max(consenting - ad_free, 0)
            checks.append({
                "key": "consent",
                "level": "info",
                "label": (
                    f"Per-employee consent: {consenting} of {total} consented, "
                    f"{ad_free} ad-free → ~{eligible_n} eligible"
                ),
                "detail": (
                    "Counts PrivateUser.ads_consent_at IS NOT NULL and excludes "
                    "is_ad_free=true. Targeting filters (country/role/dept) may "
                    "narrow this further at serve time."
                ),
                "hint": None,
            })

    elif content.kind == "employer":
        # Employer announcements only reach employees of the funding company.
        # Audience aggregate = employees of that company.
        if funder is None:
            checks.append({
                "key": "funder",
                "level": "fail",
                "label": "Funder company missing",
                "detail": f"funding_company_id={content.funding_company_id} not found.",
                "hint": "Fix the funder reference.",
            })
        else:
            total = (
                db.query(PrivateUser)
                .filter(PrivateUser.company_id == funder.company_id)
                .count()
            )
            audience["total_employees"] = total
            if total == 0:
                checks.append({
                    "key": "audience",
                    "level": "fail",
                    "label": f"Audience: {funder.company_name} has 0 employees",
                    "detail": "No PrivateUser rows belong to the funder company.",
                    "hint": "Onboard employees, or this announcement reaches no one.",
                })
            else:
                checks.append({
                    "key": "audience",
                    "level": "info",
                    "label": (
                        f"Audience: {total} employee(s) at {funder.company_name}"
                    ),
                    "detail": (
                        "Targeting (department_ids/job_titles) may narrow this "
                        "further at serve time."
                    ),
                    "hint": None,
                })

    elif content.kind == "house":
        # House cards have no per-funder gate — they're the platform's own
        # creative. The only audience filter is targeting (country/company).
        checks.append({
            "key": "house",
            "level": "info",
            "label": "House card — no advertiser gate",
            "detail": "House inventory bypasses Company.ads_enabled and per-employee consent.",
            "hint": None,
        })

    summary = "blocked" if any(c["level"] == "fail" for c in checks) else "ready"
    return {
        "content_id": content.sponsored_content_id,
        "kind": content.kind,
        "status": content.status,
        "summary": summary,
        "checks": checks,
        "audience": audience,
    }


def _format_duration(delta) -> str:
    """Render a timedelta as 'X days', 'X hours', or 'X minutes' — whichever
    is the largest non-zero unit. For the eligibility panel's "scheduled in"
    / "closed N ago" hints."""
    total_seconds = int(delta.total_seconds())
    if total_seconds < 0:
        total_seconds = -total_seconds
    days = total_seconds // 86400
    if days >= 1:
        return f"{days} day{'s' if days != 1 else ''}"
    hours = total_seconds // 3600
    if hours >= 1:
        return f"{hours} hour{'s' if hours != 1 else ''}"
    minutes = total_seconds // 60
    if minutes >= 1:
        return f"{minutes} minute{'s' if minutes != 1 else ''}"
    return "less than a minute"
