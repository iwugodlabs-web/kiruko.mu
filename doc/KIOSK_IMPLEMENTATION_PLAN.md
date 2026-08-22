# Kiosk Device Clock-In — Implementation Plan

## Context

Some companies on Kontokaz can't get widespread employee-app adoption, so their workforce can't clock in. The fix is a wall-mounted tablet at the company entrance that lets an employee look themselves up by email/phone, confirm with a 4-digit PIN, and create a `TimeLog` server-side. Clock-out stays on mobile for v1 (Decision #2 in `KIOSK_SYSTEM_BRIEF.md`). Kiosk-created logs flow through the existing `admin_approved` review UI so payroll governance is preserved.

Companion design doc: `/Users/iwugod/www/ivor-mobile/KIOSK_SYSTEM_BRIEF.md` — sections 6, 9, and 12 (security, decisions, risks) remain canonical. This plan supersedes the brief's "files to create/modify" list (section 16), the proposed `fast_track_approval` column (section 4a), and the proposed standalone admin approval page (section 4b) — see "Deviations from brief" below.

## Deviations from brief (driven by codebase findings)

> **Post-build deviation (2026-06-02): kiosk client ships as a native mobile (Expo) app, not web.**
> The plan originally specced the tablet-facing kiosk client as a Next.js route under `web/ivor-web/src/app/kiosk/` (see "Web frontend → Embedded kiosk client" below). During the pilot build the client was re-implemented as a native Expo client at `mobile/app/kiosk/` (PIN pad, silent camera capture, SQLite-backed offline queue + sync worker). The web kiosk runtime was **removed** — native gives true kiosk-mode lockdown, native camera, and a sturdier SQLite offline queue than the planned web IndexedDB approach. **The "Web frontend → Embedded kiosk client" and "Verification → End-to-end" sections below are superseded for the runtime client.** Unchanged and still on web: the platform-admin device-management UI (`/admin/kiosks`, `kioskAdminApi.ts`), the PIN-set panel, and the `/dashboard/time-logs` source filter — admins manage devices from a desktop, employees clock in on the tablet.

1. **No new `fast_track_approval` column.** `TimeLog` already has the full approval workflow (`admin_approved`, `admin_approved_at`, `admin_approved_by_user_id`, `admin_rejected*` — `backend/core/model.py:418–461`). Kiosk logs are recognized by `created_source='kiosk'` and routed through the existing flow.
2. **No new `/admin/kiosks/approvals` page.** The existing `/dashboard/time-logs/page.tsx` already does bulk approve/reject. We add a `source` filter and a "Kiosk pending: N — Approve all" banner.
3. **Auth: opaque `X-Kiosk-Token`, not a JWT audience.** Stored bcrypt-hashed in `KioskDevice`; revocable by DB update; independent of the user JWT system (`VALID_AUDIENCES = ("web","mobile","concern_portal")` in `backend/core/security.py:31–96` stays untouched).
4. **No photo confirmation.** `PrivateUser` has no `photo_url`. Identity = name + initials avatar + **mandatory PIN** (stored as `kiosk_pin_hash` on `PrivateUser`, hashed like the existing `UserRight.case_pin_hash` pattern at `backend/core/model.py:751`).
5. **Real-time only, but with `Idempotency-Key` baked into `/kiosk/clock-in` from day one** — frontend can layer an IndexedDB queue in v2 with zero backend changes.
6. **Audit logging convention.** `audit_logs` only has `actor_user_id` (no `actor_kind`) and is mutation-protected by DB triggers. The migration creates a **synthetic "Kiosk System" `User` row** (`user_type='system'`, `email='kiosk-system@kontokaz.internal'`, `user_enabled=False` so it can't log in); its `user_id` is used as `actor_user_id` for all kiosk-originated audit rows. This avoids `NULL` `actor_user_id` (which existing audit consumers may not handle) while still letting `meta` carry the real device/employee context. `action` strings use a `kiosk_` prefix (e.g., `kiosk_clock_in`, `kiosk_device_registered`, `kiosk_token_rotated`).

## Milestone breakdown

Slots into the project's existing M-numbered system (`MILESTONES.md` ends at M25). Each milestone follows the established format: Summary · Why now · Effort (S ≤ 1 day · M 2–4 days · L 1–2 weeks) · Depends on · Unblocks · Deliverables · Files · Done when. **The detailed implementation guidance lower in this document is the reference; the milestone rows are the slicing.**

### Phase 8 — Kiosk MVP (v1)

#### M26 — Kiosk backend core
- **Summary**: Schema (KioskDevice + idempotency + source flag + PIN hash + max-shift columns + synthetic system user), `KioskService`, `get_kiosk_context` dependency, `/kiosk/*` and `/admin/kiosks/*` routes, audit + tenant-context integration.
- **Why now**: Unblocks all kiosk UI work. The backend has zero dependency on M25's CI gate landing, but M5a (tenant guard) is a hard prerequisite — kiosk routes must call `with_tenant(company_id)` to be RLS-safe.
- **Effort**: L
- **Depends on**: M5a (tenant guard). M5b nice-to-have but not blocking — kiosk tables aren't in the top-10 sensitive list and can be added to RLS later.
- **Unblocks**: M27, M28, M29, M30
- **Deliverables**:
  - [ ] Migration `kiosk_clockin_20260529.py` (all six changes listed in "Migration" section above)
  - [ ] `services/kiosk_service.py` with `register_device`, `validate_kiosk_token` (device-id-prefixed format), `rotate_token`, `find_employees`, `verify_pin`, `create_kiosk_timelog`
  - [ ] `core/dependencies.py` — add `get_kiosk_context`
  - [ ] `db_models/crud/job.py` — extend `create_time_log` with `created_source` (default `'mobile'`, zero-impact); add `create_kiosk_time_log` sibling with idempotency-key lookup
  - [ ] `api/v1/kiosk.py` (new) + register in `api/v1/__init__.py`
  - [ ] Per-device rate limit (100 req/min) — in-memory is acceptable for v1
  - [ ] `tests/test_kiosk_*.py` covering all cases listed in the "Tests" section above
- **Files**: see "Backend" section above; all paths listed there.
- **Done when**: `pytest backend/tests/test_kiosk_*.py` green; existing `test_time_log_*.py` still green (proves the CRUD signature change is non-breaking).

#### M27 — Profile-driven missed-clockout extension
- **Summary**: Extend `TimeLogService.check_for_missed_clockouts` to use the `Job → PrivateUser → Company → 12h` fallback chain instead of a hard threshold. Mark closures with `auto_closed=True`, notify the admin. Confirm the cron is scheduled; add it if missing.
- **Why now**: Decouples the v1 ghost-session risk from a flat "12h" policy. Without it, kiosks at companies with non-standard shift lengths (security, healthcare, factory night-watch) silently mis-close sessions.
- **Effort**: S
- **Depends on**: M26 (the schema columns ship together)
- **Unblocks**: M30 (admin UI to set the values)
- **Deliverables**:
  - [ ] Extend `TimeLogService.check_for_missed_clockouts` resolution logic
  - [ ] Wire the cron into existing scheduler (APScheduler or whatever runs `email_jobs_queue` cleanup)
  - [ ] Notification on auto-close (`NotificationService.create_notification`, type `'time_log_auto_closed'`)
  - [ ] `tests/test_missed_clockout_resolution.py` covering each fallback level
- **Files**: `backend/services/time_log_service.py`, scheduler config, new test
- **Done when**: employees with each fallback level get closed at the right threshold; admin receives a notification per auto-close.

#### M28 — Admin device management UI
- **Summary**: `/admin/kiosks/` device list + `register/page.tsx` form + one-time token display. Includes a "Max shift hours" field on the company settings + employee detail + job detail pages so admins can set the values M27 reads.
- **Why now**: Platform admins can't onboard a pilot kiosk without this. M27's policy values are also invisible until exposed.
- **Effort**: M
- **Depends on**: M8 (API wrappers), M26, M27
- **Unblocks**: M29 (kiosk client onboarding needs a real token), M30
- **Deliverables**:
  - [ ] `web/ivor-web/src/app/(platform)/admin/kiosks/page.tsx` (list, rotate, deactivate)
  - [ ] `web/ivor-web/src/app/(platform)/admin/kiosks/register/page.tsx` (form + token display)
  - [ ] `web/ivor-web/src/services/kioskAdminApi.ts` mirroring `timeLogReview` (`payroll-api.ts:737–821`)
  - [ ] Max-shift-hours inputs added to existing company/employee/job edit screens (small additive change)
  - [ ] PIN-set screen (or modal) under employee detail — admin sets PIN for kiosk-only employees
- **Files**: as above; reuses `src/components/Modal.tsx` and `RoleGuard`
- **Done when**: register a device → copy token → see it in the list with `last_seen_at = null`; rotate-token works; deactivate works; setting an employee PIN persists to `kiosk_pin_hash`.

#### M29 — Embedded kiosk client (clock-in only)
- **Summary**: `src/app/kiosk/` route, outside `(platform)` group, carved out of middleware. State machine `idle → searching → showingCandidates → enteringPin → submitting → success`. Real-time API only — no offline queue. `Idempotency-Key` set per attempt and reused across retries of the same attempt.
- **Why now**: This is the user-visible deliverable. Without it the rest of v1 is invisible.
- **Effort**: M
- **Depends on**: M26 (endpoints), M28 (admin issues tokens)
- **Unblocks**: pilot; M30 (real kiosk traffic to filter)
- **Deliverables**:
  - [ ] `src/app/kiosk/layout.tsx` (no auth wrappers, full-screen)
  - [ ] `src/app/kiosk/page.tsx` (onboarding: paste token → localStorage)
  - [ ] `src/app/kiosk/clock-in/page.tsx` + components (`KioskLookup`, `KioskCandidatePicker`, `KioskPinPad`, `KioskSuccess`, `KioskError`)
  - [ ] `src/services/kioskApi.ts` (dedicated axios instance with `X-Kiosk-Token` + `Idempotency-Key`)
  - [ ] Middleware carve-out for `/kiosk`
  - [ ] i18n keys added to `messages/{en,fr,mg}.json` under `kiosk` namespace
  - [ ] Locale switcher in the kiosk header
  - [ ] PIN retry lockout (5 wrong → 60s lock, local state)
- **Files**: see "Web frontend" section above
- **Done when**: end-to-end flow works on a tablet against the staging backend; tampered token → 403; expired token → 403; replay same Idempotency-Key → same timelog_id.

#### M30 — Source filter + bulk approve on `/dashboard/time-logs`
- **Summary**: Add a `source` filter chip row (all / mobile / web / kiosk) and a yellow "N kiosk entries pending — Approve all" banner that invokes the existing `timeLogReview.approve` with visible kiosk IDs. Backend list endpoint gets an optional `source` query param.
- **Why now**: Company admins need a way to triage kiosk-originated logs without dragging through every employee's manual entries. Without this, the fast-track approval pattern that the brief specified isn't actually faster.
- **Effort**: S
- **Depends on**: M26 (created_source exists), M29 (real data to filter)
- **Unblocks**: nothing functionally; this completes v1
- **Deliverables**:
  - [ ] Add `source` query param to time-log review list endpoint (backend)
  - [ ] Extend `timeLogReview.list` in `payroll-api.ts:737–821` to forward it
  - [ ] Add chip row + banner to `src/app/(platform)/dashboard/time-logs/page.tsx`
  - [ ] String additions to `messages/*.json`
- **Files**: `backend/api/v1/time_log_review.py` (existing), `web/ivor-web/src/services/payroll-api.ts`, `web/ivor-web/src/app/(platform)/dashboard/time-logs/page.tsx`, message files
- **Done when**: filter by `source=kiosk`, see banner, click "Approve all" → all visible kiosk-pending entries flip to `admin_approved=true`; verified in DB.

### Phase 9 — Kiosk v2

#### M31 — Kiosk offline queue
- **Summary**: IndexedDB queue for clock-in events when the kiosk loses network. Background sync worker drains the queue when connectivity returns. **Backend is unchanged** — the Idempotency-Key contract from M26 already handles dedup on replay.
- **Why now**: Pilot/beta data will show the actual offline rate. If it's >0.5% of attempts, this becomes the most cost-effective UX investment. If it's effectively zero (good WiFi everywhere), this milestone gets parked indefinitely.
- **Effort**: M
- **Depends on**: M29
- **Unblocks**: nothing
- **Deliverables**:
  - [ ] IndexedDB wrapper (vendor or thin custom; no existing pattern in codebase)
  - [ ] Queue with `{id, payload, attempts, last_error, created_at, synced_at}` shape
  - [ ] Background sync via `navigator.onLine` + visibility events; exponential backoff on retries
  - [ ] Yellow banner in the kiosk UI: "N entries queued — will sync when online"
  - [ ] Per-attempt Idempotency-Key persisted with the queue row so retries are deterministic
- **Files**: `src/app/kiosk/services/offlineQueue.ts` (new), extension of `kioskApi.ts`
- **Done when**: kill network mid-flow → success screen still shows ("queued"); restore network → entries drain and admin sees them in `/dashboard/time-logs`; killing the tablet between queue + sync still produces no duplicates.

#### M32 — Kiosk clock-out
- **Summary**: Mirror of clock-in for the close path. Same lookup → PIN → submit, but the active `TimeLog` gets `end_time` set. Same idempotency contract.
- **Why now**: Once the pilot company has a few weeks of data, the missed-clockout rate is measurable. If even with M27's auto-close it's painful for employees (lost hours), kiosk clock-out closes the gap. If auto-close handles it cleanly, this milestone may not be needed.
- **Effort**: S–M
- **Depends on**: M26, M29
- **Unblocks**: nothing
- **Deliverables**:
  - [ ] `POST /kiosk/clock-out` endpoint + service method
  - [ ] Kiosk UI screen variant for clock-out
  - [ ] Mode-switcher on the kiosk landing screen (or auto-detect based on whether the employee has an active session)
- **Files**: same as M26/M29 + extensions
- **Done when**: employee with active kiosk session can close it via kiosk; `end_time` and `hours_worked` populate; `auto_closed=false`.

#### M33 — Multi-job + employee-paid additional job profiles
- **Summary**: Employees may hold >1 active job profile. The first is free (existing behavior); each additional profile triggers an employee-billed subscription. Kiosk shows a job picker between PIN and success when the employee has >1 active paid profile.
- **Why now**: Real workforce reality — gig workers and second-jobbers exist. Charging the employee (not the company) for additional profiles is a new revenue stream and aligns incentives (the employee, not the employer, chose to take on the additional gig).
- **Effort**: L — **this milestone needs its own design pass before execution.** What's below is the shape; the open decisions block execution.
- **Depends on**: M26, M29
- **Unblocks**: future gig/freelance positioning
- **Open decisions (must resolve before this milestone is greenlit)**:
  1. **Payment provider** — Mauritius-local (MCB Juice, My.t Money, MauBank) vs international (Stripe, Adyen). Likely both eventually; pick the first based on which the pilot beta employees actually have.
  2. **Pricing model** — flat monthly per additional profile (e.g., Rs 200/month) vs per-shift (Rs 20/shift logged) vs first-N-free freemium. Recommend: **flat monthly, second profile free for first 30 days as trial**.
  3. **Who collects** — Kontokaz invoices the employee directly (new B2C billing infra: KYC-light, VAT registration in Mauritius, refund flows) vs the company collects and remits (just a feature flag, but creates an awkward employer-employee money flow). Strong recommendation: **Kontokaz collects directly**.
  4. **VAT treatment** — Mauritius VAT (15%) on the subscription. Need a tax-line on the invoice. Confirm whether B2C employee subscriptions cross the VAT threshold for Kontokaz; consult accountant.
  5. **Suspension semantics** — payment fails → 7-day grace → profile becomes read-only on kiosk (employee can't clock in to that job) but stays in the database for back-payment. Confirm with labor counsel that this is legally permissible — withholding work-tracking infrastructure over a personal subscription debt is touchy in MU labor law.
  6. **Currency** — MUR only at launch (Mauritius pilot); USD/EUR for diaspora later.
- **Deliverables** (shape only; full spec needed):
  - [ ] New tables: `job_profile_subscriptions` (employee, job, plan, status, current_period_end, payment_method_id), `subscription_invoices`, `subscription_payments`
  - [ ] Payment-provider integration (sandbox first; pick provider via open decision 1)
  - [ ] Subscription state machine: `trialing → active → past_due → grace → suspended → cancelled`
  - [ ] Kiosk `POST /kiosk/clock-in` becomes job-aware: if employee has >1 active paid profile, response from `/kiosk/employee-lookup` includes the eligible jobs, and the clock-in request body's `job_id` becomes required
  - [ ] Kiosk UI: `KioskJobPicker` component between PIN and success
  - [ ] Web UI: employee self-service screen to add/remove/pay for additional profiles (this might force the existence of an employee-facing web login, which the platform doesn't have today — flag as a sub-dependency)
  - [ ] Admin UI: read-only view of an employee's subscriptions for support
  - [ ] Mobile UI: same as web for subscription management (if mobile is the only channel employees have)
- **Files**: many; needs its own milestone document
- **Done when**: an employee with two active job profiles, one paid and active, the other in grace period, can clock in to the first at a kiosk; the second isn't offered until payment resumes.

#### M34 — Task-aware kiosk clock-in (optional, gated on task-based earnings decision)
- **Summary**: If the hybrid task-based earnings model (`TASK_BASED_EARNINGS_MODEL_SUMMARY.md`) ships, the kiosk clock-in flow gains a task selector after the job picker (or after PIN if single-job). Employer-attached allowances flow through to the resulting `TimeLog`.
- **Why now**: Strictly gated on the task-based model decision. Kiosk's payload accepts these fields as `None` from v1 so this milestone is purely additive when greenlit.
- **Effort**: M
- **Depends on**: M26, M29, and the task-based earnings decision being yes-with-hybrid-shape
- **Unblocks**: nothing
- **Deliverables**: see the task-based earnings doc when it's revised. Skeleton: task entity, employer-side task-creation UI, allowance catalog reuse from `one_off_allowances_service.py`, kiosk task picker, payroll integration.
- **Done when**: task-based model is live and kiosk clock-ins carry `task_id` plus the employer-defined allowance.

---

## Out of scope for v1

- **Moved to v2** (see Milestone breakdown above): offline queue (M31), kiosk clock-out (M32), multi-job picker with employee billing (M33), task-aware clock-in (M34).
- **Out of all kiosk milestones** (handle separately): fixing the pre-existing lack of auth on `POST /job/create-time-log` (`backend/api/v1/job.py:538–553`); photo verification; geofence-enforced device registration. See "Decisions deliberately deferred past v2" in the risks section for rationale.

---

## Backend

### Migration — `backend/alembic/versions/kiosk_clockin_20260529.py`
Match the existing `<feature>_<YYYYMMDD>.py` convention (see `timelog_admin_approval_20260430.py`). Six changes in one migration:

1. `time_logs.created_source` — `String(16)`, non-nullable, server_default `'mobile'` so existing rows backfill, then drop the default for new inserts. Add a partial index `(company_id, admin_approved) WHERE created_source = 'kiosk'` to make the kiosk-pending filter cheap.
2. `private_users.kiosk_pin_hash` — `String(255)`, nullable. No backfill; null = "PIN not set, kiosk login disabled".
3. New table `kiosk_devices`:
   - `device_id` UUID PK, `company_id` FK → `companies`, `device_name` `String(120)`, `location` JSONB, `api_token_hash` `String(255)` non-null, `token_expires_at` timezone-aware DateTime, `is_active` Boolean default true, `last_seen_at` timezone-aware DateTime nullable, `last_seen_ip` `String(45)` nullable (for stolen-tablet detection), `created_at`/`updated_at` (`server_default=func.now()`), `created_by_user_id` FK → `users`.
   - Indexes: `(company_id, is_active)`, unique on `(company_id, device_name)`.
4. New table `kiosk_idempotency`:
   - `device_id` UUID FK → `kiosk_devices`, `idempotency_key` `String(64)`, `timelog_id` Integer FK → `time_logs`, `created_at` timezone-aware DateTime default `now()`.
   - Composite PK `(device_id, idempotency_key)`. Index on `created_at` for cleanup.
   - Add a `pg_cron` job (or piggyback on the existing cleanup pattern from `email_jobs_queue_20260520.py`) to delete rows older than 7 days nightly. Grep for `pg_cron` in existing migrations before assuming; fall back to a small APScheduler job if the project doesn't use `pg_cron`.
5. Insert the synthetic **"Kiosk System" `User` row** used as `actor_user_id` for kiosk audit log entries — see Deviation #6. Fields: `user_type='system'`, `email='kiosk-system@kontokaz.internal'`, `user_enabled=False`, deterministic UUID so downgrade is safe. Record its `user_id` in a small `system_users` lookup row (or rely on email lookup at runtime — pick whichever already has precedent in the codebase; if neither, add a thin module constant `KIOSK_SYSTEM_USER_EMAIL` and resolve on app start).
6. **Configurable max-shift-hours fallback chain** (drives auto-close of forgotten clock-outs — see Risk §8):
   - `companies.default_max_shift_hours` — `Numeric(4,2)`, nullable.
   - `private_users.max_shift_hours` — `Numeric(4,2)`, nullable, employee-specific override (e.g., security guards on 12h shifts).
   - `jobs.max_shift_hours` — `Numeric(4,2)`, nullable, per-job override (a delivery driver job might be 6h, a night-watch job 14h).
   - `time_logs.auto_closed` — Boolean default false, set true when `check_for_missed_clockouts` closes a session via the resolved cap.
   - Resolution order at close time: `Job.max_shift_hours` → `PrivateUser.max_shift_hours` → `Company.default_max_shift_hours` → system constant (12h). Surface in the admin UI as part of M28.

### Models — `backend/core/model.py`
- Add `KioskDevice` ORM class matching the migration; mirror the column/relationship style of `Company` (lines 124–179) and `AuditLog` (lines 212–222). Add a `kiosk_devices` relationship on `Company`.
- Extend `TimeLog` (lines 418–461) with `created_source = Column(String(16), nullable=False, server_default='mobile')`.
- Extend `PrivateUser` (lines 60–120) with `kiosk_pin_hash = Column(String(255), nullable=True)`.

### Service — `backend/services/kiosk_service.py` (new)
Follow the static-method-on-class pattern of `services/time_log_service.py` and `services/notification_service.py`. Methods:

- `register_device(db, company_id, device_name, location, created_by_user_id) -> (KioskDevice, raw_token)` — creates the device row first to get its `device_id` (UUID), then generates `secret = secrets.token_urlsafe(32)`, stores `api_token_hash = bcrypt.hashpw(secret)`, sets `token_expires_at = now() + 30d`, writes `audit_logs` row with `action='kiosk_device_registered'`. Raw token returned **once** as the composite string `f"{device_id}.{secret}"`, never persisted in plaintext.
- `validate_kiosk_token(db, raw_token, request_ip=None) -> KioskDevice | None` — splits `raw_token` on the first `.` into `(device_id, secret)`. Looks up the single `KioskDevice` row by `device_id` (PK lookup, O(1) indexed). Rejects if missing, `is_active=False`, or `token_expires_at <= now()`. Bcrypt-compares `secret` against `api_token_hash` exactly once. This eliminates the O(active devices) bcrypt loop that a naive "compare to all hashes" implementation would force. On hit, updates `last_seen_at` and `last_seen_ip` (best-effort; failure must not break the request path).
- `rotate_token(db, device_id, actor_user_id) -> raw_token` — new token, new 30d expiry, audit row `kiosk_token_rotated`.
- `find_employees(db, company_id, query) -> list[PrivateUser]` — case-insensitive match on `email` (via `User.email`) OR `phone`; **always filtered by `company_id == device.company_id`** (cross-tenant isolation; brief §6); cap result at 5.
- `verify_pin(db, private_user_id, pin) -> bool` — bcrypt compare against `kiosk_pin_hash`. Constant-time on miss.
- `create_kiosk_timelog(db, device, private_user, location, idempotency_key) -> TimeLog` — see CRUD changes below.

### CRUD — `backend/db_models/crud/job.py`
- Extend the `CreateTimeLog` schema (`backend/schema/job_schema.py`) and the `create_time_log` function (`backend/db_models/crud/job.py:159–236`) with an optional `created_source: str = 'mobile'`. Default keeps every existing caller behaviorally identical.
- Add a sibling helper `create_kiosk_time_log(db, device, private_user, location, idempotency_key)` that:
  - Resolves the employee's active `job_id` (single active job assumption — error out cleanly if zero or multiple, surfacing `409` so the kiosk shows a sensible message).
  - Looks up an `idempotency_keys` row scoped to `(device_id, key)`; if present, returns the prior TimeLog instead of creating a duplicate. (Add a lightweight `kiosk_idempotency` table in the same migration: `device_id`, `idempotency_key`, `timelog_id`, `created_at`, unique on `(device_id, idempotency_key)`, TTL-cleaned by an existing housekeeping job or a 7-day expiry index.)
  - Calls the existing `create_time_log` flow with `created_source='kiosk'` so `TimeLogService.cleanup_active_time_logs` still runs and the "already clocked in" guard still fires.
  - Writes `audit_logs` `action='kiosk_clock_in'`, `target_type='TimeLog'`, `target_id=str(timelog_id)`, `meta={device_id, employee_id, source:'kiosk'}`.
  - Optionally fires `NotificationService.create_notification` for the company admin (mirroring `notify_employer_overtime` at `services/notification_service.py:83–150`) — type `'kiosk_clock_in'`.

### Dependency — `backend/core/dependencies.py`
Add `get_kiosk_context(request: Request, db: Session = Depends(config.get_db)) -> KioskContext`:
- Reads `X-Kiosk-Token` header → `KioskService.validate_kiosk_token` → returns a frozen dataclass `KioskContext(device_id, company_id, device)`.
- Calls `with_tenant(company_id)` (from `backend/core/tenant_context.py`) so all DB queries inside the request honor Postgres RLS, matching the pattern used by `require_company_scope` (lines 101–150).
- Raises `HTTPException(401)` on missing token, `403` on invalid/expired/inactive.

### Routes — `backend/api/v1/kiosk.py` (new) + register in `backend/api/v1/__init__.py`
Two routers in one file (different prefixes, different deps):

**Admin (caller is a platform admin / company admin via existing `require_company_scope`):**
- `POST /admin/kiosks/register` → returns `{device_id, api_token, expires_at}` (token shown once).
- `GET /admin/kiosks` (filtered by company scope) → list.
- `POST /admin/kiosks/{device_id}/rotate-token`
- `POST /admin/kiosks/{device_id}/deactivate`
- `POST /admin/private-users/{private_user_id}/kiosk-pin` `{pin}` → set or reset an employee's PIN. Hashes via bcrypt into `kiosk_pin_hash`. Audit row `action='kiosk_pin_set'`. **This is the v1 PIN reset path** (no employee self-serve reset) — the target market is precisely the segment without reliable mobile/email access, so an admin-driven reset is the realistic flow. See "Risks & decisions taken" §2.

**Kiosk (caller is the tablet, via `get_kiosk_context`):**
- `POST /kiosk/employee-lookup` `{query}` → `[{private_user_id, display_name, has_pin}]` (omit raw email/phone in response to limit info-leak from a stolen tablet).
- `POST /kiosk/clock-in` `{private_user_id, pin, location}` + `Idempotency-Key` header → `{status, timelog_id, message, clocked_in_at}`.
- `GET /kiosk/heartbeat` → updates `last_seen_at`; lets the admin UI show a fresh "online" indicator.

Add per-device rate limiting (100 req/min) — if there's no existing rate-limiter middleware, ship a simple in-memory limiter scoped to `device_id` and revisit when usage grows.

### Tests — `backend/tests/`
Mirror the structure of existing time-log tests. Cover:
- `test_kiosk_token_register_and_validate` (happy + expired + inactive + wrong token)
- `test_kiosk_employee_lookup_isolates_by_company` (device A can't see company B employees)
- `test_kiosk_pin_required` and `test_kiosk_pin_wrong`
- `test_kiosk_clock_in_creates_timelog_with_source_kiosk`
- `test_kiosk_idempotency_returns_existing_timelog`
- `test_kiosk_clock_in_blocked_when_employee_has_active_session` (existing 400 still fires)
- `test_kiosk_audit_log_written`

---

## Web frontend (`web/ivor-web`)

### Embedded kiosk client — `src/app/kiosk/`
> ⚠️ **SUPERSEDED (2026-06-02).** This web kiosk runtime was built then removed; the client now ships as a native Expo app at `mobile/app/kiosk/`. See the post-build deviation note at the top of this doc. The section below is retained for historical context only.

Sits **outside** the `(platform)` group so the `/admin`+`/dashboard` `useEffect` redirect (`src/app/(platform)/layout.tsx:21`) doesn't touch it. Add `/kiosk` to the public-route carve-out in `src/middleware.ts` (lines 31–39, same list as `/accept-invite`).

- `src/app/kiosk/layout.tsx` — minimal layout: no sidebar, no `AuthProvider`-driven redirects, locked to full-screen, dark/light themed for tablets.
- `src/app/kiosk/page.tsx` — onboarding screen. Paste API token (no QR for v1 — QR can come later when we add `qrcode.react`). Store token in `localStorage` under a single namespaced key; encrypt-at-rest is unnecessary because possession of the tablet already implies access.
- `src/app/kiosk/clock-in/page.tsx` — main flow.

**State machine** (all in one component, `useState`-driven, matching the codebase's no-Redux convention):
`idle → searching → showingCandidates → enteringPin → submitting → success → idle` with an `error` branch from any state.

**Components in `src/app/kiosk/components/`:**
- `KioskLookup.tsx` — large email/phone input (≥18px font), search button, calls `kioskApi.lookup`.
- `KioskCandidatePicker.tsx` — list of `{display_name, initials avatar}` (Tailwind colored initial tile; no photo).
- `KioskPinPad.tsx` — 4-digit numeric pad, masks input, retry counter (lock for 60s after 5 wrong entries — local state).
- `KioskSuccess.tsx` — green check, "Clocked in at HH:MM", auto-returns to lookup after 5s.
- `KioskError.tsx` — error variants: not_found / pin_invalid / network / already_clocked_in / no_active_job.

**API client — `src/services/kioskApi.ts` (new)**
Don't reuse the shared `apiClient.tsx` axios instance — it auto-attaches user auth and runs token refresh, neither of which applies here. Build a small dedicated client that:
- Sets `baseURL: '/api/v1'`.
- Attaches `X-Kiosk-Token` from `localStorage` on every request.
- Generates `Idempotency-Key: crypto.randomUUID()` per clock-in attempt and **reuses the same key on retry** (store per-attempt in component state; only roll a new one when the user starts a brand new clock-in).
- Returns `T | { error, status }` to match `payroll-api.ts:74–89`.

**i18n** — add a `kiosk` namespace to `messages/en.json`, `fr.json`, `mg.json` (the `next-intl` setup at `src/i18n/config.ts` already supports these three locales). Tablets pick locale via the existing `NEXT_LOCALE` cookie; a locale switcher in the corner of the kiosk screen is fine.

### Admin device-management UI — `src/app/(platform)/admin/kiosks/`
Wrap in `<RoleGuard>` (defaults to `platform_admin` only — `src/app/(platform)/components/RoleGuard.tsx`).
- `page.tsx` — table of devices (company, name, location, `last_seen_at`, status). Actions: rotate-token, deactivate. Reuse the `Modal` + `ConfirmModal` from `src/components/Modal.tsx` for destructive actions, the same `lucide-react` icon set already used in `time-logs/page.tsx`, and the toast-on-error pattern from `time-logs/page.tsx:199–221`.
- `register/page.tsx` — registration form (native HTML, no form lib — matches `accept-invite/page.tsx:1–239`). On success, show the one-time `api_token` in a copy-to-clipboard panel with a clear "this will not be shown again" warning.
- New API service file `src/services/kioskAdminApi.ts` mirroring `timeLogReview` (`payroll-api.ts:737–821`): `list`, `register`, `rotateToken`, `deactivate`.

### Extend `/dashboard/time-logs` — `src/app/(platform)/dashboard/time-logs/page.tsx`
- Add a `source` filter chip row (`all` | `mobile` | `web` | `kiosk`) alongside the existing status chips.
- When `source='kiosk'` is selected and there are pending kiosk entries, show a yellow banner: *"N kiosk entries pending — Approve all"* invoking the existing `timeLogReview.approve(companyId, ids)` with the visible kiosk IDs. The bulk-approve plumbing already exists; this is purely additive.
- Extend `timeLogReview.list` in `src/services/payroll-api.ts` to forward an optional `source` query param; the backend's existing list endpoint takes a new optional filter.

---

## Verification

**Backend (alembic + pytest):**
1. `cd backend && alembic upgrade head` — migration applies cleanly; `time_logs.created_source` exists with `'mobile'` server_default; existing rows backfilled.
2. `pytest backend/tests/test_kiosk_*.py -v` — all unit + isolation + idempotency tests green.
3. Spot-check that the existing `pytest backend/tests/test_time_log_*.py` suite still passes — guards against the CRUD signature change being silently breaking.

**End-to-end (local stack via `docker-compose up`):**
1. Log in to `/admin` as a platform admin → `/admin/kiosks/register` → register a device for a test company → copy the one-time token.
2. Open `/kiosk` in a second browser → paste token → confirm onboarding.
3. As the test employee, set a PIN (separate ticket — for now seed `kiosk_pin_hash` directly in a fixture or psql).
4. Look up by email → pick from candidate list → enter PIN → expect green "Clocked in at HH:MM".
5. Verify in DB: `SELECT timelog_id, created_source, admin_approved FROM time_logs ORDER BY timelog_id DESC LIMIT 1;` → `kiosk`, `false`.
6. Verify audit: `SELECT action, target_type, meta FROM audit_logs WHERE action='kiosk_clock_in' ORDER BY id DESC LIMIT 1;`.
7. Replay the same `Idempotency-Key` → same `timelog_id` returned, no duplicate row.
8. Log into `/dashboard/time-logs` as a company admin → filter by `source=kiosk` → see the pending entry and the "Approve all" banner → bulk approve → re-query DB shows `admin_approved=true`.
9. Cross-tenant check: register a device for company A, look up an employee known to belong to company B → empty result.

**Manual security checks:**
- Tamper with `X-Kiosk-Token` (flip a byte) → 403, no information leak.
- Wait until `token_expires_at`, force the clock (or seed an expired token) → 403; rotate-token in admin UI restores access.
- Try clock-in without `Idempotency-Key` → 400 with clear message.
- Send 200 req/min from one device → 429 from rate limiter.

## Rollout (mirrors brief §11)

Pilot with one trusted company for two weeks (employees can still use mobile in parallel) → closed beta of 5–10 companies → GA. **Pilot company must be vetted for WiFi quality** at the kiosk location — Decision #3 below makes this load-bearing. Day-one monitoring: `kiosk_devices.last_seen_at`, kiosk-source `TimeLog` creation rate, 4xx/5xx rates on `/kiosk/*`, distinct `last_seen_ip` per device per day (stolen-tablet signal), and lookup attempts that return zero results (probing signal).

---

## Risks & decisions taken

These are the trade-offs I weighed while drafting. Each is either resolved in the plan above or explicitly accepted as residual risk for the pilot to validate. **Do not silently drop any of these during execution — if one needs to change, raise it.**

### Resolved in the plan

1. **Multi-job employees & "which job to clock into?"** — *v1: assume single + 409. v2: paid multi-job picker (see M33).*
   In v1, `create_kiosk_time_log` resolves `job_id` by picking the employee's single active job; if zero or >1 active, the endpoint returns `409` with a clear message and no `TimeLog` is created. **Pilot company must be confirmed single-active-job per employee before onboarding.** In v2 (M33), employees who hold >1 active job profile pay a per-additional-profile subscription, and the kiosk shows a job picker between PIN and success. The v1 endpoint payload is designed to accept an optional `job_id` from day one so v2 is a non-breaking addition.

2. **PIN reset becomes the #1 support ticket.** — *Resolved by admin endpoint.*
   `POST /admin/private-users/{private_user_id}/kiosk-pin` is in v1 scope. The target market (low mobile adoption) can't realistically use an email/SMS self-reset flow, so v1 ships admin-driven reset only. Company admins must be trained on this as part of pilot onboarding. Watch reset-rate metric — if >5% of employees/month, employee self-serve becomes a v1.1 must-have.

3. **`validate_kiosk_token` was O(active devices) bcrypt comparisons per request.** — *Resolved by token format change.*
   Token format is `{device_uuid}.{secret}` so device lookup is an indexed O(1) PK query and bcrypt runs exactly once per request. This is the right call regardless of scale; the naive "compare against all active hashes" version would have melted CPU at ~1000 devices.

4. **`audit_logs.actor_user_id` is non-nullable in practice (existing consumers may not handle `NULL`).** — *Resolved by synthetic system user.*
   Migration creates a `User` row representing the kiosk system; its `user_id` is the actor for all kiosk audit entries. Real device/employee context still lives in `meta`.

5. **Idempotency table growth unbounded.** — *Resolved by 7-day TTL cleanup.*
   `kiosk_idempotency` rows are deleted nightly via `pg_cron` (or APScheduler fallback). 7 days is comfortably longer than any plausible "retry after network restore" window.

6. **Tablet physical security / stolen device.** — *Resolved by detection + manual revocation.*
   30-day token TTL is the floor. Day-one monitoring tracks `last_seen_ip` changes per device, lookup-zero-result rates (probing), and abnormal clock-in volume. Admin can hit `POST /admin/kiosks/{device_id}/deactivate` for immediate revocation. No auto-lockout in v1 — too easy to false-positive during a legit office move.

### Accepted residual risk (pilot will validate)

7. **Real-time-only against a target market that may have flaky WiFi.** — *Accepted; Idempotency-Key baked in so v2 is frontend-only.*
   The companies most likely to want kiosks (low mobile adoption) correlate with the companies most likely to have spotty connectivity. Decision #3 says we ship real-time-only anyway. **The pilot company must be selected for WiFi reliability at the kiosk location** — if the pilot dies on connectivity, the lesson is "add minimal `localStorage` queue before beta," not "go back to drawing board." Backend already accepts `Idempotency-Key` from day one, so v2 offline-queue is a pure frontend addition.

8. **Clock-in-only creates "ghost session" if employee forgets to clock out.** — *Resolved via profile/setup-driven auto-close.*
   The auto-close threshold is **not** a hard-coded 12h blanket. It resolves per-shift via the fallback chain `Job.max_shift_hours → PrivateUser.max_shift_hours → Company.default_max_shift_hours → 12h` (see Migration step 6). Existing `TimeLogService.check_for_missed_clockouts` (`backend/services/time_log_service.py:18–82`) is the hook — extend it to consult this chain instead of using a hard threshold. Closed sessions set `auto_closed=True` on the `TimeLog` and notify the company admin for review (employee can still dispute via the existing time-log review flow). **Confirm during execution** that the cron is actually scheduled; add it if not. Pilot company must accept the auto-close policy in writing, but now the policy is configurable per-job rather than one-size-fits-all.

9. **Cross-company isolation may leak across `PrivateUser.company_id` reassignment.** — *Accepted; mitigated by current-row filter.*
   `find_employees` filters by `device.company_id == private_user.company_id` at lookup time, so a reassigned employee disappears from their old company's kiosk immediately. Historical reassignments aren't exposed because audit logs are immutable and never replayed through this code path. No additional guard needed for v1.

10. **`POST /job/create-time-log` has no auth — pre-existing gap, becomes more interesting once "kiosk" is publicly associated with the codebase.** — *Out of scope but flagged.*
    Not the kiosk effort's job to fix, but should be raised as a separate ticket in the same sprint cycle. Mentioning the kiosk product publicly without addressing this widens the attack surface against a known weak endpoint.

### Decisions NOT taken in v1 (planned for v2 — see roadmap below)

- **Offline queue + kiosk clock-out** → M31, M32. Backend already accepts `Idempotency-Key`, so M31 is pure frontend.
- **Multi-job picker (paid)** → M33. Employees with >1 active job profile pay per additional profile; kiosk shows a job picker post-PIN.
- **Task-aware clock-in + employer-attached allowances** → M34, gated on the separate task-based earnings model decision (`TASK_BASED_EARNINGS_MODEL_SUMMARY.md`). v1 endpoint payload accepts optional `task_id` + `allowances[]` as `None` so M34 is non-breaking.

### Decisions deliberately deferred past v2 (no milestone yet)

- **Photo verification** — `PrivateUser.photo_url` doesn't exist; adding it requires storage, upload UI, and moderation. PIN provides verification; revisit only if pilot/beta shows identity-spoofing incidents.
- **QR-code device onboarding** — Paste-token is fine. `qrcode.react` adds bundle weight for a one-time convenience.
- **Geofence-enforced device registration** — Brief §14 Q6. Revisit if pilot shows device locations drift between registration and first clock-in.
