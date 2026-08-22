# Kontokaz Sponsored Content (Employer Announcements + In-App Advertising)

## Context

Kontokaz wants two user-facing features on the mobile app's private home screen:

1. **Employer Announcements** — a company communicating with its own employees (HR notices, perks, training). First-party, trusted, part of the existing platform subscription, not opt-outable.
2. **In-App Advertising** — third-party paid advertising from one company to another company's employees. Commercial, lower trust, consent-gated for DPA compliance, opt-outable via the B2B ad-free perk.

These remain **conceptually distinct in UX, management, billing, and compliance** — but live in **one unified backend table** with a `kind` discriminator. This matches the pattern every real platform converges on (Meta, LinkedIn, X, Reddit, Pinterest, Google) and avoids the structural costs of two parallel systems: code duplication, schema drift, lazy 50/50 interleaving instead of real ranking, fragmented frequency caps, and analytics that require unions.

The user-facing separation is preserved through: separate management UIs per kind (company admins only see Announcements; platform admins only see Ads); per-kind validation rules; per-kind labels on the rendered card; independent kill switches. The user never knows they share infrastructure.

**Phasing**: Phase 1 ships the full unified system but with only `kind='employer'` and `kind='house'` enabled (no payment, no consent, no advertiser onboarding needed). Phase 2 enables `kind='ad'` — a small delta because the data model, surface, ranking, and tracking pipeline are already built. Estimates: Phase 1 ~1 week; Phase 2 ~2 weeks (down from ~3 in the two-system design).

Infrastructure in place: web admin at `web/ivor-web/src/app/(platform)/admin/` (`RoleGuard`-protected); platform-admin gate at `backend/api/v1/admin.py:56-84`; mobile home (`mobile/app/private_dashboard/home.tsx`) has the card-based layout where a sponsored card slots between `PaySummary` (~line 1611) and `EarningsVsExpenses` (~line 1629).

## Locked decisions

- **Unified backend table** (`sponsored_content`) with `kind: 'employer' | 'ad' | 'house'` discriminator.
- **Separate management UIs per kind**: company admins manage `kind='employer'` for their own company; platform admins manage `kind='ad'` and `kind='house'`. Each UI is kind-locked — Announcements UI never creates an ad row, Ads UI never creates an announcement row.
- **Unified ranking** on `/serve` (no 50/50 random): `score = base_priority + paid_amount_signal + recency_boost − frequency_penalty`.
- **Surface**: home feed only (Phase 1+2). No interstitials. No sponsored notifications.
- **Phase 1 enabled kinds**: `employer`, `house`. **Phase 2 enables**: `ad`.
- **Ad-removal is B2B-only** (employer pays Kontokaz off-app for `is_ad_free` per seat). No consumer transaction → Apple Guideline 3.1.1 (IAP) does not apply.
- **Default `Company.ads_enabled` at Phase 2 migration**: `false` for existing companies (grandfathered); `true` for new signups after launch, disclosed in contract.

## Data model (`backend/core/model.py`)

Place near `Notification` (~line 430).

```python
class SponsoredContent(Base):
    __tablename__ = "sponsored_content"
    sponsored_content_id: UUID (pk)
    kind: str (indexed)                          # 'employer' | 'ad' | 'house'
    funding_company_id: UUID | None (fk → companies, indexed)
        # 'employer': equals the company posting to its own employees
        # 'ad':       the paying advertiser
        # 'house':    null
    title, body: str                              # denormalized from current_version
    image_url, cta_label, cta_url: str | None
    current_version_id: UUID | None (fk → sponsored_content_versions)
    status: str (indexed)                        # 'draft' | 'active' | 'paused' | 'ended'
    surfaces: JSONB                              # ['home']
    targeting: JSONB                             # shape varies by kind, see below
    start_at, end_at: datetime (TZ-aware, indexed)
    base_priority: int                           # ranking input; defaults: employer=100, ad=50, house=25
    paid_amount_cents: int | None                # required for kind='ad', null otherwise
    paid_currency: str | None                    # ISO 4217; required for kind='ad'
    payment_notes: str | None
    variant_group: UUID | null                   # A/B testing
    variant_label: str | null
    view_count, click_count: int                 # denorm counters
    created_by_user_id, updated_by_user_id: UUID (fk → users)
    created_at, updated_at
    deleted_at: datetime | None                  # soft delete

    # DB CHECK constraints:
    #   kind='ad'       ⇒ funding_company_id IS NOT NULL AND paid_amount_cents IS NOT NULL AND paid_currency IS NOT NULL
    #   kind='employer' ⇒ funding_company_id IS NOT NULL
    #   kind='house'    ⇒ funding_company_id IS NULL AND paid_amount_cents IS NULL

class SponsoredContentVersion(Base):
    version_id, sponsored_content_id (fk), version_number,
    title, body, image_url, cta_label, cta_url,
    created_at, created_by_user_id
    # UNIQUE (sponsored_content_id, version_number)

class SponsoredContentView(Base):
    view_id, sponsored_content_id, version_id, private_user_id,
    kind,                                        # denormalized for analytics partitioning
    surface, view_token, viewed_at
    # UNIQUE (sponsored_content_id, private_user_id, view_token) — idempotency

class SponsoredContentClick(Base):
    click_id, sponsored_content_id, version_id, private_user_id, kind,
    click_token, clicked_at
    # UNIQUE (sponsored_content_id, private_user_id, click_token) — idempotency
    # version_id is required: client echoes back the version_id from the /serve response
    # so click attribution stays with the creative version the user actually saw,
    # even if the campaign was edited (new version) between view and click.

class SponsoredContentDismissal(Base):
    dismissal_id, sponsored_content_id, private_user_id, kind, surface, dismissed_at
```

### Targeting JSONB shape (varies by kind)

- `kind='employer'`: `{ department_ids?: [...], job_titles?: [...] }` — within the funding company only.
- `kind='ad'`: `{ company_ids?: [...], exclude_company_ids?: [...], country_codes?: ["MU","MG",...], roles?: [...] }`.
- `kind='house'`: same shape as ad targeting (broad reach for Kontokaz platform-wide).

Validation enforced in API serializers per kind.

**Note on `industries`**: deliberately omitted. `Company` does not have an `industry` or `sector_id` column today; only `country_code` and other fields exist (`backend/core/model.py:118-150`). A `Sector` table exists (`model.py:664`) but isn't linked from `Company`. Adding industry targeting would require a schema addition (`Company.sector_id`) — out of scope for Phase 2. If product wants industry targeting later, add the FK then.

### `Company` and `PrivateUser` extensions (Phase 2 migration only)

- `Company.ads_enabled: bool` — default `False` for rows existing at Phase 2 migration (grandfather); default `True` going forward via column default.
- `PrivateUser.is_ad_free: bool` (default `False`) — set when employer paid the B2B perk.
- `PrivateUser.ads_consent_at: datetime | None` — null until consented to ads profiling.

**Phase 1 ships zero changes to `Company` or `PrivateUser`.**

### Indexes
- `sponsored_content(kind, status, start_at, end_at)` — serve hot-path.
- `sponsored_content(funding_company_id, kind, status)` — admin list filters.
- `sponsored_content(variant_group)` — variant cap collapsing.
- `sponsored_content_versions(sponsored_content_id, version_number)` UNIQUE.
- `sponsored_content_views(private_user_id, kind, viewed_at DESC)` — frequency caps.
- `sponsored_content_views(sponsored_content_id, private_user_id, view_token)` UNIQUE.
- `sponsored_content_clicks(sponsored_content_id, private_user_id, click_token)` UNIQUE.

### Targeting source-of-truth (VERIFIED against `backend/core/model.py`)

- `targeting.country_codes` → `Company.country_code` (String(2), FK → `countries.code`, default `'MU'`) at `backend/core/model.py:132`, joined via `PrivateUser.company_id` (Integer FK at line 71, ondelete SET NULL).
- `targeting.industries` → **omitted in Phase 1+2.** `Company` has no industry / sector column today.
- `targeting.roles` → `PrivateUser.role` (String(20), default `'employee'`) at `backend/core/model.py:74`. (Fine-grained `CompanyUserRole` exists but is a multi-row join — too complex for v1 targeting; use the simple `role` field.)
- `targeting.job_titles` → `Job.job_title` (String) at `backend/core/model.py:249`, joined via `Job.private_user_id`.
- `targeting.department_ids` → `PrivateUser.department_id` (FK → departments, nullable, ondelete SET NULL) at `backend/core/model.py:72`.

Encode the mapping in one place: `backend/db_models/crud/sponsored_content.py::resolve_user_targeting_attrs(user)`.

## Serve algorithm (`backend/api/v1/sponsored.py`)

`GET /api/v1/sponsored/serve?surface=home` → 0 or 1 sponsored content row.

```
1. Read ENABLED_KINDS env var (default 'employer,house'; Phase 2: 'employer,ad,house').
2. Candidates = sponsored_content WHERE
     kind IN ENABLED_KINDS
     AND status='active' AND deleted_at IS NULL
     AND start_at <= now() <= COALESCE(end_at, now())
     AND surface ∈ surfaces.

3. Per-candidate eligibility filter:
   - kind='employer' → funding_company_id == caller.company_id;
     targeting.department_ids empty OR caller.department_id ∈ ...;
     targeting.job_ids empty OR caller.job_id ∈ ...
   - kind='ad'       → caller.is_ad_free == false
                       AND caller.company.ads_enabled == true
                       AND caller.ads_consent_at IS NOT NULL
                       AND (targeting.company_ids empty OR caller.company_id ∈ ...)
                       AND caller.company_id ∉ targeting.exclude_company_ids
                       AND targeting.countries / industries / roles match
   - kind='house'    → targeting matches like ad (no consent/opt-out gate; house is platform comms)

4. Drop candidates seen by caller in last 24h (or whose variant_group sibling was seen).
5. If caller has hit GLOBAL_DAILY_CAP (default 3) views today across all kinds → return None.
6. Score each remaining candidate:
     score = base_priority
           + (paid_amount_cents OR 0) / 1000.0      # bidding signal; 0 for non-ads
           + recency_boost                          # +30 if start_at within last 7d
           - frequency_penalty                      # -50 per prior view by this user
7. Pick highest score (random tiebreak).
8. Resolve current_version_id → version row.
9. Return {sponsored_content_id, version_id, kind, funding_company info, creative fields, view_token, click_token}. (Both tokens are server-issued UUIDs; the client echoes them back on /views and /clicks for idempotency + version-locked attribution.)
```

Cached per-user 60s in-process (or Redis if available). Mobile request times out at 3s; on failure or empty → render nothing.

## Backend routes

### Employee-facing (`backend/api/v1/sponsored.py`, gated by `get_current_user`)

- `GET  /api/v1/sponsored/serve?surface=home`
- `POST /api/v1/sponsored/views`        — `{sponsored_content_id, version_id, view_token, surface}`. Idempotent via UNIQUE.
- `POST /api/v1/sponsored/clicks`       — body: `{sponsored_content_id, version_id, click_token}`. Idempotent via UNIQUE. Server fetches `cta_url` from the named `version_id` (not from `current_version_id`, so attribution stays with the creative the user actually saw), validates (`https://`-only + optional host allowlist), then 302-redirects + logs.
- `POST /api/v1/sponsored/dismissals`
- `POST /api/v1/sponsored/consent`      — (Phase 2) `{accepted: bool, policy_version: str}`. Sets `ads_consent_at`. AuditLog.
- `DELETE /api/v1/sponsored/consent`    — (Phase 2) clears consent; sets `is_ad_free=True` until re-consent.

### Company-side Announcements (`backend/api/v1/announcements.py`, gated by `CompanyUserRole` admin/owner)

Auth layer enforces: `funding_company_id == caller's company` and `kind == 'employer'` for both reads and writes.

- `POST   /api/v1/announcements/upload-image` — multipart upload via existing `backend/services/storage_service.py::S3Storage.upload_file()`. Key: `sponsored/{kind}/{id}/{uuid}.{ext}`. Returns the `https://{bucket}.s3.amazonaws.com/{key}` URL the form then submits. Validation: mime in {image/jpeg, image/png, image/webp}, ≤2 MB, ≤2000×2000.
- `POST   /api/v1/announcements`
- `GET    /api/v1/announcements`              — own company, kind='employer' only.
- `GET    /api/v1/announcements/{id}`
- `PATCH  /api/v1/announcements/{id}`         — creative-field change → snapshot a new `SponsoredContentVersion`.
- `GET    /api/v1/announcements/{id}/versions`
- `GET    /api/v1/announcements/{id}/stats?bucket=day`
- `GET    /api/v1/announcements/{id}/export.csv`
- `DELETE /api/v1/announcements/{id}`         — soft delete.

### Platform-admin Ads + House (`backend/api/v1/admin.py`, gated by `require_platform_admin()`)

Auth layer enforces: `kind IN ('ad', 'house')` for both reads and writes from this router. Platform admins can read all kinds (for moderation visibility) via a separate `GET /admin/sponsored` endpoint.

- `POST   /admin/ads/upload-image`
- `POST   /admin/ads/campaigns`               — creates kind='ad'.
- `POST   /admin/ads/house`                   — creates kind='house'.
- `GET    /admin/ads/campaigns`               — kind='ad' only.
- `GET    /admin/sponsored`                   — moderation view across all kinds.
- `GET    /admin/ads/campaigns/{id}`
- `PATCH  /admin/ads/campaigns/{id}`          — creative change → new version.
- `GET    /admin/ads/campaigns/{id}/versions`
- `GET    /admin/ads/campaigns/{id}/stats?bucket=day`
- `GET    /admin/ads/campaigns/{id}/export.csv`
- `DELETE /admin/ads/campaigns/{id}`
- `POST   /admin/companies/{id}/ads-enabled`  — flip per-company flag (sales-deal grandfathering / B2B perk activation).

Every admin write logs to existing `AuditLog`. Register both routers in `backend/main.py`.

## Web UI (`web/ivor-web/`)

Two separate sections — neither sees the other's kind.

Each new admin route wrapped in the existing `<RoleGuard>` component (`web/ivor-web/src/app/(platform)/components/RoleGuard.tsx`) — props are `requiredRole`, `minCompanyRole`, `fallbackPath`. Company-side announcement routes use `minCompanyRole='company_admin'`; platform-admin routes use `requiredRole={['platform_admin']}`.

### Company-side: `src/app/(platform)/announcements/`
- `page.tsx` — list of own-company announcements; status/date filters.
- `new/page.tsx` — create form (title, body, image upload, CTA, surface, department/job targeting, dates, optional variant_group). **Live mobile preview pane** rendering the SponsoredCard at 320px frame.
- `[id]/page.tsx` — edit (creative change warns about new version) + stats panel (views/clicks/dismissals/CTR over time) + version history table + CSV export + duplicate.
- New service module `services/announcements.ts`.

### Platform-admin: `src/app/(platform)/admin/ads/` and `/admin/ads/house/`
- Same shape as company-side but with additional fields: advertiser company picker, paid_amount + currency, payment_notes, full cross-company targeting (allow-list, block-list, country, industry, role), **"I've reviewed against the Ad Content Policy" checkbox** (release blocker requires the policy doc itself).
- House announcements use a simpler form (no advertiser, no payment).
- Moderation view at `/admin/sponsored` showing all kinds with filters.
- Per-company `ads_enabled` toggle accessible from `/admin/employers/{id}`.

## Mobile (`mobile/`)

### Component: `mobile/components/SponsoredCard.tsx`
Single component, `kind`-aware:
- `kind='employer'` → "From {company name}" label, no Sponsored pill.
- `kind='ad'`       → "Sponsored — From {advertiser name}" with explicit Sponsored pill.
- `kind='house'`    → "From Kontokaz" label.
- Visual chrome identical across kinds (title, body, image, CTA, dismiss).
- Accessibility: container `accessibilityLabel` includes kind context; image alt text; focusable dismiss with label.
- Image-failure fallback: hide image area cleanly.
- Dark mode variants match adjacent home cards.
- Animation: `Animated.View entering={FadeInUp}` matching adjacent cards.
- **Mockup pending — DESIGN BLOCKER** for engineering kickoff.

### API client: `mobile/api/sponsored.ts`
- `fetchForSurface(surface)`, `logView`, `logClick`, `logDismissal`, and (Phase 2) `postConsent`, `withdrawConsent`.
- All calls through `mobile/services/apiClient.tsx` (mandatory per CLAUDE.md).

### Edits
- `mobile/app/private_dashboard/home.tsx`:
  - On mount, fire `fetchForSurface('home')` **in parallel** with existing dashboard fetches; never block render.
  - On response, check AsyncStorage dismiss-record (24h TTL, scoped by `sponsored_content_id`). If not dismissed → render `<SponsoredCard kind={resp.kind} ... />` **after line 1620 (the closing `</Animated.View>` wrapping `<PaySummary>`) and before line 1622 (`<ProfileProgress>`).** Wrap the new card in `<Animated.View entering={FadeInUp.duration(800).delay(500)}>` to match the visual rhythm of adjacent cards (`SlideInRight` on PaySummary @ delay 400, `FadeInUp` on ClockHistory @ delay 600). Note: there is a `<ProfileProgress>` (lines 1622-1626) and `<EarningsVsExpenses>` (lines 1628-1634) between PaySummary and the rest of the feed — the card slots between PaySummary and ProfileProgress, NOT directly between PaySummary and EarningsVsExpenses as previously drafted.
  - `logView` on first paint (`onLayout` one-shot via ref guard).
  - CTA tap → server-side click endpoint (logs + validates + 302).
  - Dismiss → `logDismissal` + AsyncStorage entry with 24h TTL.
- `mobile/app/private_dashboard/settings.tsx` (**Phase 2 only**):
  - New "Ad preferences" row → screen with free `is_ad_free` toggle (DPA withdrawal mechanism). Below it: copy explaining the employer-paid ad-free perk.
- `mobile/components/AdsConsentModal.tsx` (**Phase 2 only**) — one-time consent on first launch after Phase 2 ships. Declining → no ads. Accepting → ads. Calls `/api/v1/sponsored/consent`. AuditLog'd.

## Operational

- **Kill switches**:
  - `SPONSORED_ENABLED` env var (master kill).
  - `ENABLED_KINDS` env var (per-kind: e.g. `'employer,house'` disables ads instantly).
  - Single point of failure mitigated: removing 'ad' from `ENABLED_KINDS` does not affect employer/house.
- **AuditLog** on every admin write and (Phase 2) every consent event.
- **Monitoring**: `/serve` p95 latency + error rate. Mobile timeouts (3s) silently render no card.
- **Retention**: `sponsored_content_views` older than 90 days roll up to a daily aggregate table (Phase 1.5 cron).
- **Anomaly alerting** (Phase 1.5): weekly email — to company admins for their announcements, to platform admins for ads + house. Flag active rows with zero views in 24h.
- **Image storage**: existing S3 bucket from `backend/.env`. Paths: `sponsored/{kind}/{id}/{uuid}.{ext}`.
- **Click redirect security**: `/sponsored/clicks` 302-redirects to `cta_url`. Validation rules — `https://` only, optional host allowlist configurable via env, never allow `javascript:` / `data:` / relative URLs. Open redirects without a host allowlist are a phishing risk; decide before launch whether to require allowlist.

## Phasing

### Phase 1 (~1 week) — ships `kind='employer'` and `kind='house'`
- All schema (full `sponsored_content` + companions) lands in one migration.
- `Company.ads_enabled` and `PrivateUser.is_ad_free` / `ads_consent_at` columns NOT added yet.
- Routes: company-side Announcements API + platform-admin House API + employee-facing /serve, /views, /clicks, /dismissals.
- Web: Announcements section (company) + House section (admin) + moderation view.
- Mobile: SponsoredCard, slot orchestrator, AsyncStorage dismiss tracking. No consent modal, no settings opt-out (no ads to opt out of yet).
- `ENABLED_KINDS='employer,house'` in env.

### Phase 2 (~2 weeks) — enables `kind='ad'`
- Migration: add `Company.ads_enabled`, `PrivateUser.is_ad_free`, `PrivateUser.ads_consent_at`. Backfill `Company.ads_enabled=false` for existing rows (grandfather).
- Routes: platform-admin Ads API + consent endpoints on /sponsored.
- Web: Ads section (admin). Per-company `ads_enabled` toggle on Employers admin.
- Mobile: AdsConsentModal + Settings → Ad preferences row.
- `ENABLED_KINDS='employer,ad,house'` in env.
- **Release blockers (non-software)**: privacy policy update; Ad Content Policy doc; advertiser onboarding/contract process; B2B ad-free perk pricing.

## Build milestones

Each milestone is independently testable / demoable. Dependencies noted. Estimates are focused-engineer days; multiply by ~1.5 for real-world pace with reviews and interruptions.

### Phase 1 milestones (~6 engineering days)

#### M1 — Schema & migrations (0.5 day · no dependencies) ✅
- [x] Alembic revision: create `sponsored_content` table with all columns + CHECK constraints (`kind='ad'` ⇒ funding/paid fields not null, etc.)
- [x] Alembic revision: create `sponsored_content_versions` + UNIQUE(sponsored_content_id, version_number)
- [x] Alembic revision: create `sponsored_content_views` + UNIQUE(sponsored_content_id, private_user_id, view_token)
- [x] Alembic revision: create `sponsored_content_clicks` + UNIQUE(sponsored_content_id, private_user_id, click_token)
- [x] Alembic revision: create `sponsored_content_dismissals`
- [x] Add indexes (kind+status+start_at+end_at, funding_company_id+kind+status, variant_group, views_user_kind_viewed_at, etc.)
- [x] `alembic upgrade head` runs clean against dev DB
- [x] `alembic downgrade -1` reverses cleanly

**Shipped**: `backend/alembic/versions/sponsored_content_tables_20260516.py` (revision `sponsored_tables_20260516`); ORM models added to `backend/core/model.py` between `Notification` and `BreakLog`. CHECK constraints verified against real inserts (5 invalid rows rejected, 3 valid rows accepted).

#### M2 — Backend CRUD + admin write endpoints (1 day · depends on M1) ✅
- [x] `backend/db_models/crud/sponsored_content.py` with `resolve_user_targeting_attrs(user)` joining Company/Job/Department
- [x] Per-kind validator helper (rejects `kind='ad'` when not in Phase 1 ENABLED_KINDS)
- [x] Image upload endpoint via existing `S3Storage.upload_file()` with mime/size/dimension validation
- [x] Company-side: `POST /api/v1/announcements`
- [x] Company-side: `GET /api/v1/announcements` (own company only)
- [x] Company-side: `GET /api/v1/announcements/{id}` with stats + version history
- [x] Company-side: `PATCH /api/v1/announcements/{id}` — creative change snapshots new `SponsoredContentVersion`
- [x] Company-side: `GET /api/v1/announcements/{id}/versions`
- [x] Company-side: `GET /api/v1/announcements/{id}/stats?bucket=day`
- [x] Company-side: `GET /api/v1/announcements/{id}/export.csv`
- [x] Company-side: `DELETE /api/v1/announcements/{id}` (soft delete)
- [x] Platform-admin: `POST /admin/ads/house` (creates kind='house')
- [x] Platform-admin: `GET /admin/sponsored` (moderation view across kinds)
- [x] AuditLog write on every mutation (action / target_type / target_id / meta)
- [x] Demo: curl creates employer + house announcements; PATCH bumps current_version_id; DELETE soft-deletes; AuditLog rows visible

**Shipped**:
- `backend/schema/sponsored_content_schema.py` — Pydantic `SponsoredContentCreate / Patch / Out`, per-kind invariant validator at the schema layer.
- `backend/db_models/crud/sponsored_content.py` — `create_sponsored_content`, `patch_sponsored_content` (auto-snapshots a new `SponsoredContentVersion` only when one of the 5 creative fields changed), `soft_delete_sponsored_content`, `list_by_company`, `list_all_admin`, `list_versions`, `get_stats` (date_trunc buckets), `iter_raw_events_for_csv`, plus the `resolve_user_targeting_attrs(user, db)` mapping (single source of truth for the M3 serve algorithm), `validate_kind_fields`, `require_kind_enabled`.
- `backend/api/v1/announcements.py` — company-side router with `/upload-image` (PIL-validated, ≤2 MB, ≤2000×2000), CRUD + versions + stats + CSV export. Auth: `_require_company_admin` resolves caller's company and enforces `is_company_admin_for`.
- `backend/api/v1/admin.py` — added `POST /admin/ads/house` and `GET /admin/sponsored` (moderation view), gated by `require_platform_admin`.
- Registered the new router in `backend/api/v1/__init__.py`.
- 8 routes live at `/api/v1/announcements/*` and `/api/v1/admin/ads/house`, `/api/v1/admin/sponsored`.
- Smoke-test against dev DB exercises: employer+house creation with correct kind-specific defaults; non-creative PATCH preserves version count; creative PATCH snapshots v2 and bumps `current_version_id`; soft delete sets `status='ended' + deleted_at`; cross-company isolation; validator rejects malformed ads; `ENABLED_KINDS` env gate blocks `'ad'` by default; 6 AuditLog rows written across the test path.

#### M3 — Backend /serve + employee tracking endpoints (1 day · depends on M2) ✅
- [x] `backend/api/v1/sponsored.py` registered in `main.py`
- [x] `GET /api/v1/sponsored/serve?surface=home` with full ranking + caps + variant_group collapsing
- [x] Per-user 60s response cache
- [x] `ENABLED_KINDS` and `SPONSORED_ENABLED` env vars wired (kill switches)
- [x] `POST /api/v1/sponsored/views` — idempotent via UNIQUE on view_token
- [x] `POST /api/v1/sponsored/clicks` — body `{sponsored_content_id, version_id, click_token}`; fetches cta_url from named version; https-only + host allowlist; returns `{ok, redirect_url}` JSON (NOT 302 — mobile XHR auto-follows redirects with no off-switch)
- [x] `POST /api/v1/sponsored/dismissals`
- [x] Demo: hand-curled employee token gets back JSON; duplicate view_token = idempotent; click 302s to correct URL even after edit; kill switches work

**Shipped**:
- Added serve algorithm + view/click/dismissal recorders to `backend/db_models/crud/sponsored_content.py`: `serve_one`, `record_view`, `record_click`, `record_dismissal`, plus helpers `_passes_targeting`, `_passes_kind_eligibility`, `_seen_recently_ids`, `_seen_variant_groups`, `_global_daily_view_count`, `_score`. Ranking constants (`BASE_PRIORITY_DEFAULT`, `RECENCY_WINDOW_DAYS`, `RECENCY_BOOST`, `FREQUENCY_PENALTY_PER_VIEW`, `GLOBAL_DAILY_CAP`) tunable at the top of the module.
- New `backend/api/v1/sponsored.py` with `/serve` (in-process per-(user,surface) TTL cache, 60s), `/views` (idempotent via DB UNIQUE), `/clicks` (validates https + optional `CLICK_HOST_ALLOWLIST` env, returns the version's stored URL as JSON — NOT current_version_id, so attribution survives edits; NOT 302 because RN XHR auto-follows), `/dismissals`.
- Phase 1 ad eligibility branch coded with `getattr` defaults so it compiles before the M9 schema changes that add `is_ad_free` / `ads_consent_at` / `ads_enabled` (the kind='ad' branch is unreachable in Phase 1 since `ENABLED_KINDS` defaults to `'employer,house'`).
- TZ-aware UTC helper `_utcnow()` introduced — eight `datetime.utcnow()` sites and one naive `datetime.combine` migrated to TZ-aware to match `DateTime(timezone=True)` columns.
- Smoke test against dev PG covers all 13 cases: master kill switch, per-kind kill (house-only), default ranking (employer > house), surface filter, cross-company isolation, department targeting, 24h per-content cap, view idempotency, click idempotency, **version-locked click attribution** (edit to v2 → click on v1 still returns v1's URL), dismissal recording, global daily cap, app boot with all 5 sponsored routes registered.

#### M4 — Web admin: company-side Announcements UI (1.5 days · depends on M2) ✅
- [x] `web/ivor-web/services/announcements.ts`
- [x] `(platform)/dashboard/announcements/page.tsx` — list with status filter
- [x] `(platform)/dashboard/announcements/new/page.tsx` — form (title/body/image/CTA/dates/targeting/variant_group)
- [x] Live mobile preview pane (320px frame) rendering the SponsoredCard
- [x] `(platform)/dashboard/announcements/[id]/page.tsx` — edit form + stats charts + version history + CSV export + duplicate button
- [x] Edit warns user when creative change will create a new version
- [x] Wrap routes in `<RoleGuard minCompanyRole='company_admin' />`
- [x] Nav entry added
- [x] `tsc --noEmit` and `eslint` clean on all new files; pre-existing errors in `services/api.tsx` are unrelated.

**Shipped**:
- `web/ivor-web/services/announcements.ts` — typed wrappers over all 8 backend endpoints (`listAnnouncements`, `getAnnouncement`, `createAnnouncement`, `patchAnnouncement`, `deleteAnnouncement`, `listAnnouncementVersions`, `getAnnouncementStats`, `uploadAnnouncementImage`, `announcementCsvUrl`).
- `src/app/(platform)/dashboard/announcements/page.tsx` — list with status filter chips (`all/draft/active/paused/ended`), per-row CTR, end (soft delete) button. Empty + loading states. RoleGuard wraps.
- `src/app/(platform)/dashboard/announcements/new/page.tsx` — create page using shared `AnnouncementForm` in `mode='create'`.
- `src/app/(platform)/dashboard/announcements/[id]/page.tsx` — header with Export CSV / Duplicate / End buttons; stats panel with SVG bar chart (views + clicks per day) and CTR/dismissals; version history sidebar showing the current version highlighted; the same `AnnouncementForm` in `mode='edit'`.
- `src/app/(platform)/dashboard/announcements/components/AnnouncementForm.tsx` — shared create/edit form. Detects when a creative field (title/body/image_url/cta_label/cta_url) differs from the loaded snapshot and shows an inline amber warning explaining a new `SponsoredContentVersion` will be created on save. Image upload calls `/announcements/upload-image` with client-side ≤2 MB pre-check.
- `src/app/(platform)/dashboard/announcements/components/SponsoredCardPreview.tsx` — 320px phone-shaped frame rendering a faithful preview of how the card will look on the mobile home feed (with sandwich-style filler cards above/below to convey spacing). `kind`-aware label ("From {company}" for employer).
- `Sidebar.tsx` — added `Megaphone` icon entry between Reports and Documents in the company-section nav.

#### M5 — Web admin: platform/house UI (0.5 day · depends on M2) ✅
- [x] `(platform)/admin/ads/house/` — create + list (no advertiser, no payment)
- [x] `(platform)/admin/sponsored/` — moderation view across all kinds with kind filter
- [x] Wrap routes in `<RoleGuard requiredRole={['platform_admin']} />`
- [x] Nav entry added (House Content + Sponsored Moderation under admin section)
- [x] `tsc --noEmit` and `eslint` clean on all new files.

**Shipped**:
- `web/ivor-web/services/sponsored-admin.ts` — typed wrappers: `createHouseAnnouncement`, `listSponsoredModeration` (kind / status / funding_company_id / include_deleted filters). Maps `status` → `status_filter` query param to match the backend's non-aliased route.
- `src/app/(platform)/admin/ads/house/page.tsx` — list + inline expandable create form (Title, Body, Image upload, CTA label/URL, country-code allowlist CSV, dates). Reuses `SponsoredCardPreview` with `kind='house'`. List columns: title, status, views, clicks, created, End action.
- `src/app/(platform)/admin/sponsored/page.tsx` — read-only moderation view. Filter chips for kind (all/employer/house/ad) and status (all/draft/active/paused/ended), plus a Company-ID text filter and Include-deleted toggle. Summary tiles count rows per kind. Color-coded kind + status pills. ID, Funder, Views, Clicks columns.
- `Sidebar.tsx` — added `House Content` (Megaphone) and `Sponsored Moderation` (Eye) entries under the admin section, both gated by `requiredRoles: ['platform_admin']`.
- Known Phase-1 limitation noted inline on the house page: status flips and deletes require company ownership (the `/admin/ads/house` delete + status routes land in M11/Phase 2); house rows can still be created/listed/observed today.

#### M6 — Mobile SponsoredCard component (0.5 day · independent — can parallelize with M2-M5) ✅
- [x] `mobile/components/SponsoredCard.tsx` with `kind` prop ('employer' | 'ad' | 'house')
- [x] Kind-aware label ("From {company}" / SPONSORED pill + "From {advertiser}" / "From Kontokaz")
- [x] Image-fail fallback (hide image area, no broken icon)
- [x] Dark mode variants (palette flip via `useColorScheme()`)
- [x] Accessibility: container `accessibilityLabel`, image alt, focusable Dismiss + CTA with labels
- [x] Animation: `Animated.View entering={FadeInUp.duration(800).delay(500)}`
- [x] i18n keys (`sponsored.from / fromKontokaz / sponsoredPill / dismiss / imageA11y`) in EN, FR, MG (+ scaffold AR, ES)
- [x] Component tests: all 3 kinds; image OK/fail; CTA + dismiss callbacks; onView idempotency; dark mode

**Shipped**:
- `mobile/components/SponsoredCard.tsx` — single component with three on-screen treatments, controlled by `kind`. Image hides gracefully on `onError`; `forceImageFailed` prop is a test seam so suites can render the fallback path without a real broken URL. Dark mode swaps a 7-color palette object — surface, text, subtext, divider, dismiss icon, CTA bg + text — to match adjacent home cards without bespoke per-card styling.
- `mobile/types/ITranslationSchema.d.ts` — added `sponsored` namespace (5 keys).
- `mobile/app/locales/{en,fr,mg,ar,es}.ts` — translations added for the 5 keys; MG translations are best-effort consistent with the existing MG header comment.
- `mobile/tests/__tests__/SponsoredCard.test.tsx` — 10 passing tests via `react-test-renderer`.
- `mobile/__mocks__/{react-native-reanimated.js,@gluestack-ui/themed.js,@expo/vector-icons.js}` — project-root auto-applied mocks. Necessary because `nativewind/babel` injects `_ReactNativeCSSInterop` references into any test file that uses inline `jest.mock(name, () => ({...}))` factories with JSX/arrow functions, tripping jest's hoist guard. File-based mocks dodge the transform entirely.

**Test results**: 10/10 pass in 2.4s. Covers: kind=employer no-pill label, kind=ad SPONSORED pill + advertiser, kind=house "From Kontokaz" (ignores fundingCompanyName), image render, image-fail fallback, onClickThrough fires with URL, onDismiss fires, onView idempotent across repeat onLayout calls, dark mode renders content correctly, ad accessibility label includes kind+source+title.

#### M7 — Mobile API client + home.tsx integration (1 day · depends on M3 + M6) ✅
- [x] `mobile/api/sponsored.ts` — `fetchForSurface`, `logView`, `logClickAndResolveUrl`, `logDismissal`; routed through `services/apiClient`
- [x] `home.tsx`: fires `fetchForSurface('home')` via `useSponsoredSlot('home')` hook — parallel with existing dashboard fetches, never blocks render
- [x] SponsoredCard slots after PaySummary's closing `Animated.View` and before `<ProfileProgress>` (between original lines 1620 / 1622)
- [x] AsyncStorage dismiss tracking (24h TTL keyed by `sponsored_content_id`) in `useSponsoredSlot`
- [x] `onLayout`-guarded `/views` POST — `SponsoredCard` calls `recordView`, hook's ref-guard prevents duplicate logs across rapid remounts
- [x] CTA tap → server `/clicks` endpoint resolves redirect URL from `version_id` (locked to served creative), `Linking.openURL` on the resolved URL
- [x] 3-second timeout on `/serve` — failures silently render no card
- [x] Zero eslint warnings, zero new tsc errors on M7 files

**Shipped**:
- `mobile/api/sponsored.ts` — typed wrappers (`ServedSponsoredContent`, `LogViewInput`, `LogClickInput`, `LogDismissalInput`). `fetchForSurface` returns `null` on any failure / non-200 / timeout (graceful degradation). `logClickAndResolveUrl` reads `redirect_url` out of the JSON body of `POST /clicks` (the endpoint deliberately does NOT 302 — React Native's XHR auto-follows redirects and strips the `Location` header before user code can read it, so the round-trip is JSON-based) and the caller does `Linking.openURL(...)` with the returned URL.
- `mobile/app/hooks/useSponsoredSlot.ts` — single hook the home screen calls. Returns `{content, loading, recordView, dismiss}`. Persists dismissals in AsyncStorage with a 24h TTL keyed by `sponsored_content_id`; expired entries are auto-cleaned on read. The dismiss handler fires both the local persist AND the server `/dismissals` POST (quality signal for the platform).
- `mobile/app/private_dashboard/home.tsx` — imports `SponsoredCard` + `useSponsoredSlot` + `logClickAndResolveUrl`. Hook invocation lives next to the other state hooks at line ~673. Card renders conditionally on `sponsoredSlot.content` between the PaySummary `Animated.View` (now line 1633) and the `<ProfileProgress>` (now line 1671). CTA `onClickThrough` is an inline async handler that calls `logClickAndResolveUrl`, awaits the server-resolved URL, then `Linking.openURL`s.

#### M8 — Phase 1 polish + verification (0.5 day · depends on M1-M7) ✅
- [x] All Phase 1 unit tests pass — **61/61 pytest cases green** across `test_sponsored_constraints.py` (11), `test_sponsored_crud.py` (17), `test_sponsored_serve.py` (24), `test_sponsored_routes.py` (9)
- [x] CRUD-layer integration coverage: auth gating via `_require_company_admin`, `record_view`/`record_click` idempotency tests, version-locked click attribution test (the critical one — edit v1→v2, click v1, server returns v1's URL not v2's)
- [x] Mobile snapshot tests pass — **10/10** in `mobile/tests/__tests__/SponsoredCard.test.tsx`
- [x] **`tsc --noEmit`** clean on all new files (web + mobile). Pre-existing errors in `services/api.tsx` are unrelated.
- [x] EN/FR/MG translations present for all 5 `sponsored.*` keys (AR/ES scaffolded with English fallback strings)
- [x] Kill switches documented in `backend/api/v1/sponsored.py` module docstring + verified by unit test (`TestKillSwitches::test_master_kill_switch`, `test_enabled_kinds_filter`)
- [x] `CLICK_HOST_ALLOWLIST` boot warning fires when env is unset (confirmed by capturing logger output at import time)
- [x] App boots clean with 12 sponsored-related routes registered
- [ ] Live end-to-end demo against a running stack (uvicorn + web + mobile sim) — NOT yet performed; the layered tests cover the same code paths but a real-device walkthrough hasn't been done

**Shipped**:
- `backend/tests/test_sponsored_constraints.py` — DB CHECK + UNIQUE constraint tests (11 cases). Verifies kind enum, status enum, the per-kind field invariants, and the three UNIQUE constraints (version_number, view_token idempotency, click_token idempotency).
- `backend/tests/test_sponsored_crud.py` — CRUD layer (17 cases): create flow with v1 snapshot + audit log; non-creative PATCH preserves version count; creative PATCH snapshots a new version preserving v1's text; soft delete idempotent; cross-company isolation; include_deleted filter; per-kind validator gates; ENABLED_KINDS env gate; resolve_user_targeting_attrs returns the right shape; **+ stale-cache `deleted_at` guards on `record_view`/`record_click`/`record_dismissal`** locking in the round-5 fix.
- `backend/tests/test_sponsored_serve.py` — serve algorithm (24 cases): both kill switches, ENABLED_KINDS filter, ranking (employer > house), surface filter, cross-company isolation, department targeting, 24h per-content cap, variant_group sibling cap, global daily cap, view idempotency with counter check, version-locked click attribution, click idempotency with counter check, **+ ranking ladder** (paid_amount weight / recency boost / frequency penalty all asserted against `_score`), **+ status/date-window exclusions** (paused, draft, past end_at, future start_at, soft-deleted all return None from `/serve`), **+ pause→house fallback transition**, **+ job_title targeting** (positive + negative match), **+ stale-cache view/click drops on soft-deleted content**.
- `backend/tests/test_sponsored_routes.py` — HTTP-layer auth + contract tests (9 cases) using FastAPI TestClient with `dependency_overrides`: unauthenticated 401, cross-company GET returns 403/404 (never 200 with another company's row), cross-company list excludes foreign rows, non-platform-admin blocked from `/admin/ads/house`, non-platform-admin blocked from `/admin/sponsored`, **`/sponsored/clicks` returns 200 JSON with `redirect_url` (NOT a 302) — the RN XHR contract**, **date-range validator rejects `end_at <= start_at` with 422 on both create and patch (positive + negative)**, happy-path create+list end-to-end through the router.
- `mobile/tests/__tests__/useSponsoredSlot.test.ts` — slot orchestrator (6 cases) using `react-test-renderer` + a thin harness component (no `@testing-library/react-native` dep added): fetch on mount → exposes payload, null payload → null content, `dismiss()` clears + persists to AsyncStorage + posts to server, 24h TTL suppresses subsequent mounts, expired entry is cleaned up and content is re-served, `recordView` is idempotent across multiple invocations within the same hook lifetime.
- `backend/api/v1/sponsored.py` — added boot-time warning logged at import when `CLICK_HOST_ALLOWLIST` is unset. Acceptable for Phase 1 (no third-party advertisers); will be a release blocker check at Phase 2 launch.
- `web/ivor-web/src/app/(platform)/dashboard/announcements/page.tsx` — closed the M4 scope drift by adding the originally-spec'd **date range filter** (created_at, inclusive of end day) and **bulk pause/end actions** (per-row checkboxes + sticky action bar showing selection count). Sequential per-row backend calls — no bulk endpoint was in M2's scope.

**Final test tally**: **61 backend pytest cases + 16 mobile jest cases = 77 tests, all green.** Persistent on CI. Replaces the throwaway smoke scripts from M1-M3.

**Round-3 flow audit findings (after the user asked to re-check the flow)**:

- **Mobile click flow was BROKEN.** `logClickAndResolveUrl` relied on `axios.maxRedirects: 0` to capture the server's `302 Location` header. But `maxRedirects` is a Node-only option — React Native's `axios` uses `XMLHttpRequest`, which auto-follows redirects with no off-switch. In production the Location header would have been stripped before axios saw it; `Linking.openURL` would never have fired and clicks would have done nothing visible. **Fix**: `POST /sponsored/clicks` now returns `200 {ok, redirect_url, deduplicated}` JSON instead of a 302. Same backend behavior (records the click, validates the URL); just a different envelope. The mobile client reads `res.data.redirect_url`. New regression test `test_click_returns_redirect_url_in_json_not_302` asserts the contract.
- **Create→activate UX was awkward.** The create form didn't expose `status`; admins had to save (defaults to draft), land on the detail page, find the Status dropdown, then save again. Easy to forget. **Fix**: Status field is now visible in `mode='create'` too. Defaults to `'draft'` so existing behavior is unchanged for cautious users; an admin who picks `'active'` gets a one-step publish (the form POSTs to create, then PATCHes the status — status is not a creative field so no extra version is snapshotted). The status dropdown labels now explain each state's user-visible effect.

**Round-4 flow audit findings (on user re-prompt)**:

- **Plan/code drift on `/clicks` description** — checklist still said "302". Updated to "JSON `{ok, redirect_url}`".
- **CTA pill visual misfire.** SponsoredCard gated the pill on `(ctaLabel || ctaUrl)` — a card with a label but no URL rendered an interactive pill whose tap was a silent no-op. **Fix**: gate on `ctaUrl` only. Label without URL is misconfiguration; hiding the pill makes it visible to the admin.
- **Soft-deleted edit dead-end.** Detail page rendered the full edit form for soft-deleted announcements; Save always errored with HTTP 410 (backend rejects PATCH on `deleted_at IS NOT NULL`). **Fix**: detail page now shows an amber banner explaining the announcement was ended, points the admin at the Duplicate button to bring content back. Form is hidden entirely so there's no clickable Save.
- **Stale-cache impressions / clicks / dismissals.** `/serve` is cached 60s per user. If an admin soft-deleted in that window — typically because the URL was wrong or the content was bad — a previously-served card on a mobile would still log a view, return a redirect URL, and record a dismissal. Stats pollution + a redirect bypass on content the admin explicitly pulled. **Fix**: `record_view`, `record_click`, `record_dismissal` all return early with no DB write when `content.deleted_at IS NOT NULL`. `/clicks` returns `{ok: false, redirect_url: null}` for the soft-deleted-since-serve case so mobile just doesn't navigate. New regression tests `test_stale_cache_view_is_dropped_for_soft_deleted_content` and `test_stale_cache_click_returns_none_url` lock in the contract.

**Round-5 flow audit findings (on user re-prompt × 3)**:

- **Datetime-local roundtrip lost the timezone.** `fromAnnouncement` did `a.start_at.slice(0, 16)` — chopping an ISO UTC string and handing it to `<input type="datetime-local">`, which interprets the value as local time. Result: admin in MU (UTC+4) picks 14:30, edits, sees 10:30 in the picker. "Fix" it back → stored as 06:30Z. Date drifts 4h on every edit. **Fix**: new helper `isoToLocalInput` parses through `Date` and re-formats local fields so the roundtrip is lossless.
- **`end_at <= start_at` silently accepted.** Schema took any two ISO datetimes. A transposed-dates typo would create an "active" campaign that `/serve`'s `start_at <= now <= end_at` filter could never satisfy — born invisible, no error. **Fix**: Pydantic validator on both `SponsoredContentCreate` and `SponsoredContentPatch` rejects with a 422; frontend pre-checks and toasts before submit. Regression test `test_rejects_end_before_start_on_create` + `test_accepts_end_after_start`.

**Final test tally after round 5**: **61 backend + 16 mobile = 77 tests, all green.**
- [ ] `ENABLED_KINDS='employer,house'` set in production env

**Phase 1 ship gate**: all M1–M8 boxes ticked.

---

### Phase 2 milestones (~5.5 engineering days + parallel non-software work)

#### M9 — Phase 2 schema migration (0.5 day · depends on Phase 1 shipped) ✅
- [x] Alembic revision `phase2_ads_columns_20260517`: adds `companies.ads_enabled BOOL NOT NULL` with two-step backfill — column added nullable, all existing rows `UPDATE`d to `false`, then column locked `NOT NULL` with `server_default 'true'` so future signups default to ads-on
- [x] Same revision: grandfather backfill (`UPDATE companies SET ads_enabled = false WHERE ads_enabled IS NULL`) — verified against dev DB: 1/1 existing rows now `ads_enabled=false`, column default for new inserts confirmed `true`
- [x] `private_users.is_ad_free BOOL NOT NULL DEFAULT false` added; all 4 existing rows backfilled to false
- [x] `private_users.ads_consent_at TIMESTAMPTZ NULL` added; all 4 existing rows are NULL (no consent yet)
- [x] `alembic upgrade head` clean; `alembic downgrade -1` reverses cleanly; re-upgraded for ongoing work
- [x] Phase 1 test suite (61 cases) still green after schema change — no regressions in `test_sponsored_*.py`

**Shipped**:
- `backend/alembic/versions/phase2_ads_columns_20260517.py` — additive migration with reversible downgrade (drops all 3 columns)
- `backend/core/model.py` — `PrivateUser.is_ad_free`, `PrivateUser.ads_consent_at`, and `Company.ads_enabled` declared on the ORM models. Note: model default is `server_default='true'` because the SQL-level default is what new rows inherit; the historical backfill happens once in the migration and is invisible to the ORM.

#### M10 — Backend ad routes + serve update (1.5 days · depends on M9) ✅
- [x] Platform-admin: `POST /admin/ads/upload-image` — mime/size/dimension validated, stored under `sponsored/ad/staging/{admin_user_id}`
- [x] Platform-admin: `POST /admin/ads/campaigns` — pins `kind='ad'` server-side; Pydantic + DB CHECK enforce funding/paid invariants; status starts 'draft'
- [x] Platform-admin: `GET /admin/ads/campaigns` with status + advertiser filters
- [x] Platform-admin: `GET /admin/ads/campaigns/{id}`
- [x] Platform-admin: `PATCH /admin/ads/campaigns/{id}` — creative change auto-snapshots a new `SponsoredContentVersion`, attribution stays locked to viewed version
- [x] Platform-admin: `GET /admin/ads/campaigns/{id}/versions` + `/stats?bucket=day|hour` + `/export.csv` (streaming)
- [x] Platform-admin: `DELETE /admin/ads/campaigns/{id}` (soft delete, idempotent, status flips to 'ended')
- [x] Platform-admin: `POST /admin/companies/{id}/ads-enabled` — AuditLog'd with before/after values
- [x] Serve eligibility — already wired in M3's `_passes_kind_eligibility`: an ad is dropped if `is_ad_free=true`, `ads_consent_at IS NULL`, or `Company.ads_enabled=false`. M10 changed the columns from `getattr`-with-fallback to real ORM attributes (M9 made them real).
- [x] Serve scoring — `paid_amount_cents / 1000` already in `_score()` from M3
- [x] Employee: `POST /api/v1/sponsored/consent {accepted, policy_version?}` — accept: sets `ads_consent_at=now`, `is_ad_free=false`. Decline: clears consent, `is_ad_free=true`. Invalidates this user's /serve cache so the new state is reflected immediately on the next fetch (instead of up to 60s later). AuditLog'd with `policy_version` for DPA Article 7 evidence.
- [x] Employee: `DELETE /api/v1/sponsored/consent` — withdrawal: clears `ads_consent_at`, sets `is_ad_free=true`, invalidates cache, AuditLog'd
- [x] Design fix (caught during M10): `create_sponsored_content` no longer calls `require_kind_enabled`. The `ENABLED_KINDS` kill switch gates serving only — admins must be able to draft an ad campaign before ops flips the env var. Mirrors how Meta/LinkedIn split authoring from serving.
- [x] 14 new pytest cases in `tests/test_sponsored_ads_m10.py`:
  - admin auth (non-admin gets 401/403 on /admin/ads/campaigns)
  - admin happy-path CRUD round trip (create → list → get → patch creates v2 → versions has 2 rows → stats endpoint → CSV stream → soft delete)
  - schema validation rejects ad without payment fields (422)
  - kind-locked routing (ad row 404s through /announcements/{id})
  - `/admin/companies/{id}/ads-enabled` flips flag + writes AuditLog with before/after; 404 for unknown company
  - consent accept / decline / withdraw branches set the DB columns correctly; 403 for users without `private_user`
  - **end-to-end serving**: consent + ads_enabled + paid ad → ad served; flip ads_enabled off → ad dropped; withdraw consent → ad dropped on next /serve (cache invalidation tested)
- [x] All 75 sponsored pytest cases green (61 Phase 1 + 14 new)

**Shipped**:
- `backend/api/v1/admin.py` — appended ad campaigns (upload-image / campaigns CRUD / versions / stats / export.csv) + per-company ads-enabled toggle. Reused existing `require_platform_admin` gate.
- `backend/api/v1/sponsored.py` — appended `/consent` POST + DELETE with cache invalidation on state change.
- `backend/db_models/crud/sponsored_content.py` — added `set_ads_consent`, `withdraw_ads_consent`, `set_company_ads_enabled` (all AuditLog'd). Removed the `require_kind_enabled` call from `create_sponsored_content` per the kill-switch-is-serving-only design.
- `backend/tests/test_sponsored_ads_m10.py` — 14 pytest cases, all green.

#### M11 — Web admin: Ads UI (1.5 days · depends on M10) ✅
- [x] `web/ivor-web/services/ads.ts` — typed wrappers for the 10 admin ad endpoints + `setCompanyAdsEnabled` toggle; reuses `Announcement`/`AnnouncementVersion`/`AnnouncementStats` types from `services/announcements.ts`
- [x] `(platform)/admin/ads/page.tsx` — list with status filter chips, advertiser-id text filter, bulk Pause/End action bar (sticky when selection > 0), per-row End button, formatted paid amount column
- [x] `(platform)/admin/ads/new/page.tsx` — wraps the new shared `AdCampaignForm` (mode='create')
- [x] `AdvertiserPicker` component — autocomplete combobox backed by `getAdminCompanies`; client-side filter by name/BRN/ID; locks the field in edit mode (advertiser change after creation would orphan billing)
- [x] Cross-company targeting UI: company_ids allow-list, `exclude_company_ids` block-list (with "competitor conflict" hint), country_codes (ISO 3166-1 alpha-2, auto-uppercased), roles — all CSV inputs under an Advanced disclosure
- [x] Payment fields: amount in major units with 2-decimal precision, ISO 4217 currency dropdown (MUR/USD/EUR/ZAR/GBP/KES/NGN seeded), payment_notes free-text, base_priority override. Major-units → cents conversion uses `Math.round(major * 100)` to dodge float drift.
- [x] **Ad Content Policy checkbox** — release-blocker dependency. Mandatory on Create; pre-checked + hidden on Edit. Anchor links to `/admin/policies/ad-content` (placeholder route; policy doc is the non-code release blocker).
- [x] Live `SponsoredCardPreview kind='ad'` reused from M4 — gives the orange "Sponsored — From {advertiser}" pill so admins see what mobile will render
- [x] `(platform)/admin/ads/[id]/page.tsx` — edit form + Performance panel (SVG bar chart from M4) + Version history sidebar + Export CSV + Duplicate (creates a fresh draft with same advertiser+payment) + End. Amber soft-deleted banner mirrors the company-side detail page.
- [x] `ads_enabled` toggle row on `/admin/employers/{id}` — new standalone `AdsEnabledToggle` component renders below `CompanyDetails`, posts to `/admin/companies/{id}/ads-enabled` with confirm + toast. Backend `GET /admin/companies/{id}` extended to surface `ads_enabled` (M9 column) so the toggle paints with the correct initial state.
- [x] All routes wrapped in `<RoleGuard requiredRole={['platform_admin']} />`
- [x] Sidebar nav: new "Ad Campaigns" entry between Audit Logs and House Content, gated by `requiredRoles: ['platform_admin']`
- [x] `tsc --noEmit` clean on all new files (pre-existing errors in `services/api.tsx` and `PlatformUsersSection.tsx` are unrelated and predate M11)
- [x] Backend regression: all 75 sponsored pytest cases still green after the `/admin/companies/{id}` shape change

**Shipped**:
- `web/ivor-web/services/ads.ts` — 10 typed wrappers for the admin ad endpoints + the per-company toggle
- `web/ivor-web/src/app/(platform)/admin/ads/page.tsx` — list
- `web/ivor-web/src/app/(platform)/admin/ads/new/page.tsx` — create
- `web/ivor-web/src/app/(platform)/admin/ads/[id]/page.tsx` — detail / edit
- `web/ivor-web/src/app/(platform)/admin/ads/components/AdCampaignForm.tsx` — shared create+edit form (kind='ad'-specific fields: advertiser picker, payment block, cross-company targeting, Ad Content Policy gate)
- `web/ivor-web/src/app/(platform)/admin/ads/components/AdvertiserPicker.tsx` — autocomplete combobox backed by `getAdminCompanies`
- `web/ivor-web/src/app/(platform)/admin/employers/[id]/AdsEnabledToggle.tsx` — per-company master toggle row
- `web/ivor-web/src/app/(platform)/admin/employers/[id]/page.tsx` — mounts `AdsEnabledToggle` below `CompanyDetails`
- `web/ivor-web/src/app/(platform)/dashboard/components/Sidebar.tsx` — "Ad Campaigns" nav entry
- `backend/api/v1/admin.py` — `GET /admin/companies/{id}` now returns `ads_enabled` so the web toggle paints with the correct initial state

#### M12 — Mobile consent + settings opt-out (1 day · depends on M10) ✅
- [x] `mobile/components/AdsConsentModal.tsx` — one-time first-launch modal with Accept / Decline. Uses gluestack `Modal` over a 55% black backdrop; tapping outside / hardware back are no-ops so the user makes an explicit choice. `testID`s on both buttons for unit tests.
- [x] AsyncStorage flag keyed by `ADS_CONSENT_STORAGE_KEY = 'kontokaz:ads_consent_prompt:v1'`, value `{answered, accepted, policy_version, at}`. The exported `hasAnsweredAdsConsent()` compares stored `policy_version` against the current `ADS_CONSENT_POLICY_VERSION = '2026-05-17'` — bumping that constant on a new privacy policy revision automatically re-prompts every user once.
- [x] Modal calls `postAdsConsent(accepted, policyVersion)` on either branch; server-side persists `ads_consent_at` + `is_ad_free` and writes the AuditLog. On server failure the modal closes but the local flag is **not** set (so the user gets re-prompted next launch instead of silently flipping the wrong way).
- [x] `mobile/app/private_dashboard/settings.tsx` — new "Ad preferences" row added under Preferences (orange `campaign` icon, between Your Rights and the Support section)
- [x] `mobile/app/private_dashboard/ad_preferences.tsx` — full screen with a pill toggle. Flipping it routes through `postAdsConsent(true, …)` or `withdrawAdsConsent()` depending on direction, syncs the AsyncStorage flag, and surfaces the new state. Amber banner explains the employer-paid ad-free perk so users who never see ads understand why.
- [x] Withdrawal hits `DELETE /api/v1/sponsored/consent` — DPA Article 7-compliant withdrawal mechanism (server clears `ads_consent_at` + sets `is_ad_free=true` + invalidates the 60s `/serve` cache for this user)
- [x] Stack screen registered in `_layout.tsx` with `href: null` so it stays out of the tab bar (only reachable from Settings)
- [x] i18n: 13 new `sponsored.*` keys (5 modal + 8 ad-preferences screen) added to the schema and **all 5 locales** (en/fr/mg/ar/es). EN/FR/MG/ES carry native translations; AR uses the EN fallback strings (RTL-ready, native AR copy is a separate copy-review pass).
- [x] Mounted `<AdsConsentModal />` at the top of `private_dashboard/home.tsx` (after the ScrollView, inside SafeAreaView) so it overlays the home content on the first authenticated mount.
- [x] **7 new unit tests** in `tests/__tests__/AdsConsentModal.test.tsx`:
  - first render with no prior answer → modal visible
  - matching `policy_version` on disk → modal hidden
  - older `policy_version` on disk → modal visible (re-consent loop verified at both the helper and the component level)
  - accept → POSTs `{accepted: true, policy_version}`, persists, hides, fires `onResolved(true)`
  - decline → POSTs `{accepted: false, …}`, persists
  - server throw → modal closes but storage is **not** written (re-prompt next launch)
  - `forceShow=true` bypasses the stored-answer check (used by future settings flows)
- [x] **24 mobile tests green** total (10 SponsoredCard + 6 useSponsoredSlot + 7 AdsConsentModal + 1 ThemedText). `tsc --noEmit` clean on every new M12 file.

**Shipped**:
- `mobile/components/AdsConsentModal.tsx` — first-launch consent modal with persistent answer + per-policy re-prompt
- `mobile/app/private_dashboard/ad_preferences.tsx` — Settings → Ad preferences screen with pill toggle wired to consent POST/DELETE
- `mobile/app/private_dashboard/_layout.tsx` — registered the new screen with `href: null`
- `mobile/app/private_dashboard/settings.tsx` — added "Ad preferences" row in Preferences section
- `mobile/app/private_dashboard/home.tsx` — mounted `<AdsConsentModal />` so it fires on first authenticated home render
- `mobile/api/sponsored.ts` — added `postAdsConsent(accepted, policyVersion)` + `withdrawAdsConsent()` typed wrappers
- `mobile/types/ITranslationSchema.d.ts` — 13 new `sponsored.*` keys
- `mobile/app/locales/{en,fr,mg,ar,es}.ts` — all 5 locales carry the new keys (EN/FR/MG/ES native; AR English fallback)
- `mobile/tests/__tests__/AdsConsentModal.test.tsx` — 7 tests, all green

#### M13 — Phase 2 verification + release blockers (1 day code + parallel human work) ✅ (code-side)

**Code-side — all green:**
- [x] **77 backend pytest cases green** across `test_sponsored_constraints.py` (11), `test_sponsored_crud.py` (17), `test_sponsored_serve.py` (24), `test_sponsored_routes.py` (9), `test_sponsored_ads_m10.py` (16). The M10 file grew by 2 cases in M13 for the new GET endpoint.
- [x] **24 mobile jest cases green** across `SponsoredCard.test.tsx` (10 — covers all three kinds including `kind='ad'` with the orange SPONSORED pill, image OK/fail, dark mode, CTA + dismiss callbacks, onView idempotency, a11y), `useSponsoredSlot.test.ts` (6), `AdsConsentModal.test.tsx` (7), plus the unrelated `ThemedText` snapshot (1).
- [x] **Total: 101 sponsored-related tests green** (77 backend + 24 mobile). Persistent on CI.
- [x] Phase 1 verification still passes — the 61 original tests (constraints, CRUD, serve, routes) run alongside M10/M13 additions with zero regressions across multiple test runs.
- [x] Mobile snapshot for `kind='ad'` covered in `SponsoredCard.test.tsx` — verified label `Sponsored — From {advertiser}` + orange SPONSORED pill render correctly. Modal tested separately via `AdsConsentModal.test.tsx` (no snapshot needed; tests assert behaviour not visual diff).
- [x] **M13 follow-up fix**: added `GET /api/v1/sponsored/consent` so the mobile Settings → Ad preferences screen reads authoritative state from the server (closing the M12 gap where the toggle's initial position came from AsyncStorage only — wouldn't survive device-switching or cross-surface withdrawal). Mobile `ad_preferences.tsx` now does server-first, AsyncStorage fallback on network failure. Two new pytest cases verify the GET endpoint round-trips correctly across accept/withdraw and 403s for non-employee users.
- [x] Backend route audit: **21 sponsored-related routes** registered on the app — Phase 1 + Phase 2 surface complete:
  - Employee: `/sponsored/{serve,views,clicks,dismissals,consent}` (GET + POST + DELETE on consent)
  - Company admin: `/announcements` + `/announcements/{id}/{versions,stats,export.csv}` + upload-image (8 routes)
  - Platform admin: `/admin/ads/{house,upload-image,campaigns}` + `/admin/ads/campaigns/{id}/{versions,stats,export.csv}` + `/admin/sponsored` moderation + `/admin/companies/{id}/ads-enabled` (10 routes)
- [x] `tsc --noEmit` clean on all M12 + M13 mobile files; web `tsc --noEmit` clean on all M11 files (pre-existing repo errors unrelated)

**Release blockers — owners outside engineering (status unchanged from M9 estimate; tracked here so the ship gate is explicit):**
- [ ] Privacy policy update merged + published (covers profiling, retention, opt-out) — **legal copy owner**
- [ ] Ad Content Policy doc written and linked from admin form (no loan/gambling/medical-claim ads) — **product + legal**. The web form already links to `/admin/policies/ad-content` (placeholder route); the doc itself is the blocker.
- [ ] First advertiser contract template approved by legal — **sales + legal**
- [ ] B2B ad-free perk pricing approved — **pricing/sales**
- [ ] New-customer ToS clause re: ads-default-on merged — **legal + sales** (`Company.ads_enabled` server_default already flipped to `true` for new signups per M9; the ToS clause is the legal cover for that default)
- [ ] `ENABLED_KINDS='employer,ad,house'` set in production env — **ops**. Backend create endpoints already allow `kind='ad'` drafts before this flips (M10 design fix); flipping the env var is the single switch that takes ads live on `/serve`.

**Phase 2 code ship-gate**: ✅ all engineering boxes (M9–M13) ticked. Software is shippable today. Release timing waits on the 6 non-code blockers above.

**Final phase-2 test tally**: **77 backend + 24 mobile = 101 sponsored-related tests, all green.** Combined Phase 1 + Phase 2 surface: 21 backend routes, 8 web pages/sections, 1 mobile component + 1 modal + 1 settings screen, 5 locales × 18 i18n keys.

### Parallelization opportunities

- M6 (mobile component) can start day 1, before any backend exists — develop against mocked API responses.
- M4 + M5 (web UIs) can develop in parallel with M3 (serve algorithm) since they call different routes (M2 admin routes vs M3 employee routes).
- Phase 2 release-blocker docs (privacy policy, content policy, contracts, pricing, ToS) can be drafted during Phase 1 implementation by their respective owners.

## Pre-launch dependencies (non-software, OWNERS TBD)

These are not code tasks but they block phases:

| Item | Blocks | Owner |
|---|---|---|
| Targeting source-of-truth verification | Phase 1 kickoff | Engineering (hour 1) |
| SponsoredCard visual mockup | Phase 1 kickoff | Design |
| Click-redirect URL allowlist policy | Phase 1 launch | Eng + security |
| Privacy policy update | Phase 2 launch | Legal copy owner |
| Ad Content Policy doc (no loan/gambling/medical-claim) | Phase 2 launch | Product + legal |
| Advertiser onboarding process (contracts, billing, content review SLA) | Phase 2 launch | Sales |
| B2B ad-free perk pricing | Phase 2 launch | Pricing/sales |
| New-customer ToS clause re: ads default-on | Phase 2 launch | Legal + sales |

## Open product questions (resolve before / during Phase 1)

- **Success metrics + kill criteria.** What CTR / dismiss-rate / revenue threshold defines success? At what threshold do we pull the plug? Recommend: dismiss-rate > 30% triggers placement A/B test; > 50% triggers pause.
- **Staged rollout.** Internal dogfood → 5% of employees → 25% → 100%? Mechanism: feature-flag on `PrivateUser` or random hash of user_id with a percentage gate in /serve.
- **Web app parity.** Employees also view payslips on `web/ivor-web/`. Should sponsored content show there too? Default in this plan: **mobile only**. Web parity is a Phase 1.5 add if needed.
- **Rollback plan.** Kill switches handle immediate disable. Data cleanup if winding down: keep rows for analytics + audit, just disable kinds via env.

## Risks and trade-offs

### High-impact
- **Apple IAP rule (Phase 2 only)** — mitigated by B2B-only ad-removal (no consumer transaction).
- **Trust erosion in a financial/work tool** — mitigated by: separate management UIs preserving the user-facing concept split; "From {company}" vs "Sponsored — From {advertiser}" labels; grandfathered existing customers; home-only placement; hard-banned ad categories.
- **MU DPA / MG 2014-038** — mitigated for ads only (consent modal + withdrawable opt-out + audit-logged consent + policy update); not applicable to employer announcements (lawful basis: employment).
- **Sponsored notifications muddy alerts** — excluded from both phases by design.

### Medium
- **Conditional schema fields** (`paid_amount_cents` nullable, meaningful only for `kind='ad'`) — mitigated by DB CHECK constraints + per-kind API validators.
- **Compliance-audit blast radius** — a regulator subpoenaing ad inventory hits the shared table. Mitigated by exposing kind-filtered views in all admin routes (`WHERE kind='ad'` etc.). If a stricter physical separation is ever needed, can split tables later.
- **Single point of failure for /serve** — mitigated by per-kind kill switch (`ENABLED_KINDS`) so an ad bug doesn't break employer comms.
- **Click redirect security** — mitigated by https-only + scheme blocklist + optional host allowlist (policy decision before launch).
- **Image hosting** — own S3 only; no external URLs.
- **Impression table growth** — 90-day retention with rollup.
- **Advertiser conflict-of-interest** — `exclude_company_ids` in ad targeting.

### Low
- Multilingual creative — single-language per row in Phase 1+2. JSONB extension later if needed.
- Home-screen latency — fetch in parallel, never block render.
- VAT/tax on advertiser billing — accountant question.

## Testing

### Unit (`/serve` algorithm) — the highest-risk code in the system
- ENABLED_KINDS filtering (kind='ad' rows skipped when not in env var).
- Per-kind eligibility: employer ↔ own company match; ad → consent + ads_enabled + is_ad_free all required; house → broad.
- Targeting: department/job (employer); company allow + block + country + industry + role (ad).
- Per-item 24h cap.
- Variant_group cap collapsing.
- Global daily cap.
- Ranking: paid_amount_cents weight; recency boost; frequency penalty.
- Creative versioning preserves attribution.
- Soft delete / status / date-window exclusions.
- Master kill switch + per-kind kill switch.

### Integration
- Auth gating: Company A admin cannot read Company B's announcements (403). Company admin cannot hit `/admin/ads/*` (403). Platform admin cannot create kind='employer' via `/admin/ads/*` (rejected by per-kind validator).
- Idempotency on `/views` (duplicate POST with same view_token returns 200 without inserting a new row).
- Idempotency on `/clicks` (duplicate POST with same click_token returns 302 without inserting a new click row).
- **Version-locked click attribution**: serve v1, edit to v2, then POST /clicks with v1's `version_id` → click is attributed to v1, the 302 target is v1's `cta_url`, not v2's.
- Consent round-trip (Phase 2).

### Mobile
- SponsoredCard snapshot per `kind` (light/dark, image-fail).
- Slot orchestrator dismiss state.
- AdsConsentModal flow (Phase 2).

## Verification

### Phase 1
1. Backend: Company A admin uploads image + creates announcement targeting own employees. Company B admin gets 403 on Company A's announcement. Employee from Company A: /serve returns the announcement. Repeat with same view_token → idempotent. Edit title → version 2 snapshotted; v1's views still reference v1. Status='paused' / past end_at / soft-deleted → not served. AuditLog written.
2. Web: Announcements section shows own-company only with live mobile preview matching the rendered card. Edit creates version. CSV export works.
3. Mobile: home renders `SponsoredCard kind='employer'` with "From Company A" label between PaySummary and EarningsVsExpenses. Dismiss persists 24h. CTA tap → server redirect → click logged. Image-fail path renders cleanly. VoiceOver reads correctly.
4. With both an active employer announcement and an active house: employer wins (higher base_priority). Set status='paused' on employer → house serves.
5. Set `ENABLED_KINDS='house'` → only house serves. Set `SPONSORED_ENABLED=false` → nothing serves.

### Phase 2 (in addition to Phase 1 still passing)
1. Backend: platform admin creates kind='ad' campaign. Company admin gets 403. Employee with `ads_consent_at=null` → /serve skips ad candidates, may still return employer/house. Employee accepts consent → ads now eligible. Employee with `is_ad_free=true` → no ads. Company with `ads_enabled=false` → that company's employees see no ads (still see employer/house). Two active ads → weighted by paid_amount_cents.
2. Web: admin /ads section works; per-company ads_enabled toggle works on /admin/employers/{id}; version history + CSV export work.
3. Mobile: AdsConsentModal appears on first launch post-Phase-2. Declining → no ads (employer/house still show). Accepting → ads eligible. Settings → "Ad preferences" → toggle = consent withdrawal.
4. With both active employer and active ad: ranking respects `base_priority + paid_amount_cents/1000`. Employer (base 100) generally beats ad (base 50 + small paid signal) unless ad has large paid_amount.

## Critical files

- `backend/api/v1/admin.py:56-84` — `require_platform_admin()` (reused for ads + house + per-company toggle).
- `backend/core/model.py:430-442` — `Notification` (shape reference).
- `backend/core/model.py:539-567` — `Loan`/`Repayment` (B2B-perk billing template if it gets formalized).
- `backend/core/model.py:118-150` (`Company` — has `country_code`, no `industry`), `backend/core/model.py:60-114` (`PrivateUser` — has `company_id: Integer FK`, `department_id`, `role: String(20)`), `backend/core/model.py:243-292` (`Job` — has `job_title`), `backend/core/model.py:230-241` (`Department`). All targeting fields are verified to exist.
- `backend/core/model.py:184-193` (`AuditLog` — columns: `actor_user_id`, `action`, `target_type`, `target_id`, `meta JSONB`, `created_at`). Example write pattern in `backend/core/profile_lock.py`.
- `backend/services/storage_service.py` — `S3Storage` class with `upload_file()` (async, for FastAPI `UploadFile`) and `upload_bytes()`. Returns `https://{bucket}.s3.amazonaws.com/{key}`.
- `web/ivor-web/src/app/(platform)/components/RoleGuard.tsx` — props: `requiredRole`, `minCompanyRole`, `fallbackPath`. Checks `user.isPlatformAdmin`, `user.hasRole(...)`, `user.isCompanyAdmin`.
- `backend/main.py` — register `announcements.py`, `sponsored.py`, and admin extensions.
- `backend/.env` — S3 credentials present; add `SPONSORED_ENABLED`, `ENABLED_KINDS`, `CLICK_HOST_ALLOWLIST`.
- `web/ivor-web/src/app/(platform)/admin/employers/page.tsx` — closest existing admin list+edit pattern.
- `mobile/app/private_dashboard/home.tsx` (~line 1620) — slot insertion point.
- `mobile/app/private_dashboard/settings.tsx` — Phase 2 Ad preferences row.
- `mobile/services/apiClient.tsx` — central axios instance (mandatory per CLAUDE.md).
