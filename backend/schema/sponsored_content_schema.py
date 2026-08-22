"""Pydantic schemas for Sponsored Content (employer announcements + ads).

The same shapes back both user-facing concepts:
  - kind='employer' is exposed via /api/v1/announcements/* (company admins)
  - kind='ad'       is exposed via /admin/ads/* (platform admins, Phase 2)
  - kind='house'    is exposed via /admin/ads/house (platform admins)

Per-kind invariants are enforced at THREE layers (defense in depth):
  1. Pydantic validators here (catch malformed requests early).
  2. CRUD-layer validator (catch programmer mistakes from internal callers).
  3. DB CHECK constraint (final backstop; rejects rows the layers above missed).

See SPONSORED_CONTENT_PLAN.md.
"""

from datetime import datetime
from typing import Any, List, Optional

from pydantic import BaseModel, Field, model_validator


VALID_KINDS = {"employer", "ad", "house"}
VALID_STATUSES = {"draft", "active", "paused", "ended"}


# ── Targeting ─────────────────────────────────────────────────────────────
class EmployerTargeting(BaseModel):
    """Targeting shape for kind='employer' (within the funding company only)."""
    department_ids: Optional[List[int]] = None
    job_titles: Optional[List[str]] = None


class AdTargeting(BaseModel):
    """Targeting shape for kind='ad' or kind='house' (cross-company).

    `department_ids` (added M14) lets a platform admin narrow an ad to
    specific departments WITHIN the allow-listed companies — e.g.
    "Acme Corp's Engineering team only". The serve algorithm treats this
    as an AND with `company_ids`: a user must be in BOTH an allow-listed
    company AND a target department to qualify. Department IDs are not
    inherently scoped to a company in the DB, so admins picking dept IDs
    from one company won't accidentally serve to a same-numbered dept in
    another company unless they intend to."""
    company_ids: Optional[List[int]] = None
    exclude_company_ids: Optional[List[int]] = None
    country_codes: Optional[List[str]] = None
    roles: Optional[List[str]] = None
    department_ids: Optional[List[int]] = None


# ── Create / Update shapes ────────────────────────────────────────────────
class SponsoredContentCreate(BaseModel):
    """Generic create body. Per-kind invariants enforced in model_validator.

    Routers pin `kind` server-side from the route (the company-side router
    forces kind='employer'; the platform-admin router forces 'ad' or 'house').
    Clients never get to pick `kind` freely.
    """
    kind: str = Field(pattern="^(employer|ad|house)$")
    funding_company_id: Optional[int] = None  # required for employer + ad; null for house
    title: str = Field(min_length=1, max_length=255)
    body: str = Field(min_length=1)
    image_url: Optional[str] = None
    cta_label: Optional[str] = Field(default=None, max_length=100)
    cta_url: Optional[str] = None
    # Default is None (not ["home"]) so the CRUD layer can pick the
    # right surface based on `kind`: employer → home_banner, ad/house
    # → home_card. Old clients that explicitly pass ["home"] still work
    # — the route accepts that surface as a legacy alias during the M17
    # rollout window.
    surfaces: Optional[List[str]] = None
    targeting: dict = Field(default_factory=dict)
    start_at: Optional[datetime] = None
    end_at: Optional[datetime] = None
    base_priority: Optional[int] = None
    paid_amount_cents: Optional[int] = None        # required when kind='ad'
    paid_currency: Optional[str] = Field(default=None, max_length=3)
    payment_notes: Optional[str] = None
    variant_group: Optional[str] = Field(default=None, max_length=36)
    variant_label: Optional[str] = Field(default=None, max_length=10)
    # M18 — display attribution for `kind='house'` slots sold to external
    # advertisers (e.g. "Spar", "MCB Juice"). Null on Kiruko first-party
    # house cards. The mobile SponsoredCard renders "from {name}" instead
    # of the hardcoded "from Kiruko" fallback when set.
    external_advertiser_name: Optional[str] = Field(default=None, max_length=255)

    @model_validator(mode="after")
    def _check_kind_invariants(self):
        if self.kind == "ad":
            if self.funding_company_id is None or self.paid_amount_cents is None or not self.paid_currency:
                raise ValueError(
                    "kind='ad' requires funding_company_id, paid_amount_cents, and paid_currency"
                )
        elif self.kind == "employer":
            if self.funding_company_id is None:
                raise ValueError("kind='employer' requires funding_company_id")
        elif self.kind == "house":
            if self.funding_company_id is not None or self.paid_amount_cents is not None:
                raise ValueError(
                    "kind='house' rejects funding_company_id and paid_amount_cents"
                )
        if self.cta_url and not self.cta_url.startswith("https://"):
            raise ValueError("cta_url must be an https:// URL")
        # Defensive: a typo here ("transposed the dates") would silently
        # produce a campaign /serve's window query never matches — admin
        # sees status='active' but no traffic and no error. Reject at the
        # schema layer so they get a 422 they can act on.
        if self.start_at is not None and self.end_at is not None and self.end_at <= self.start_at:
            raise ValueError("end_at must be after start_at")
        return self


class SponsoredContentPatch(BaseModel):
    """Partial update. Changing any of the five creative fields triggers a new
    `SponsoredContentVersion` snapshot in the CRUD layer."""
    title: Optional[str] = Field(default=None, min_length=1, max_length=255)
    body: Optional[str] = Field(default=None, min_length=1)
    image_url: Optional[str] = None
    cta_label: Optional[str] = Field(default=None, max_length=100)
    cta_url: Optional[str] = None
    status: Optional[str] = Field(default=None, pattern="^(draft|active|paused|ended)$")
    surfaces: Optional[List[str]] = None
    targeting: Optional[dict] = None
    start_at: Optional[datetime] = None
    end_at: Optional[datetime] = None
    base_priority: Optional[int] = None
    paid_amount_cents: Optional[int] = None
    paid_currency: Optional[str] = Field(default=None, max_length=3)
    payment_notes: Optional[str] = None
    variant_group: Optional[str] = Field(default=None, max_length=36)
    variant_label: Optional[str] = Field(default=None, max_length=10)
    # M18 — see SponsoredContentCreate for context.
    external_advertiser_name: Optional[str] = Field(default=None, max_length=255)

    @model_validator(mode="after")
    def _check_cta(self):
        if self.cta_url and not self.cta_url.startswith("https://"):
            raise ValueError("cta_url must be an https:// URL")
        if self.start_at is not None and self.end_at is not None and self.end_at <= self.start_at:
            raise ValueError("end_at must be after start_at")
        return self


# ── Output shapes ─────────────────────────────────────────────────────────
class SponsoredContentVersionOut(BaseModel):
    version_id: int
    version_number: int
    title: str
    body: str
    image_url: Optional[str] = None
    cta_label: Optional[str] = None
    cta_url: Optional[str] = None
    created_at: datetime
    created_by_user_id: Optional[int] = None

    class Config:
        from_attributes = True


class SponsoredContentOut(BaseModel):
    sponsored_content_id: int
    kind: str
    funding_company_id: Optional[int] = None
    title: str
    body: str
    image_url: Optional[str] = None
    cta_label: Optional[str] = None
    cta_url: Optional[str] = None
    current_version_id: Optional[int] = None
    status: str
    surfaces: Any
    targeting: Any
    start_at: datetime
    end_at: Optional[datetime] = None
    base_priority: int
    paid_amount_cents: Optional[int] = None
    paid_currency: Optional[str] = None
    payment_notes: Optional[str] = None
    variant_group: Optional[str] = None
    variant_label: Optional[str] = None
    external_advertiser_name: Optional[str] = None
    view_count: int
    click_count: int
    created_at: datetime
    updated_at: datetime
    deleted_at: Optional[datetime] = None

    class Config:
        from_attributes = True


class StatsBucket(BaseModel):
    """One time-bucket of metrics."""
    bucket: datetime
    views: int
    clicks: int
    dismissals: int


class SponsoredContentStats(BaseModel):
    sponsored_content_id: int
    bucket_size: str  # 'day' | 'hour'
    total_views: int
    total_clicks: int
    total_dismissals: int
    ctr: float
    buckets: List[StatsBucket]


class ImageUploadResponse(BaseModel):
    url: str
