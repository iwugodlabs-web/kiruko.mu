# Ivor — Senior Engineering Audit

**Date:** 2026-04-03
**Scope:** Backend, Mobile, Web, Architecture, Product, Regulatory
**Status:** Work in progress — check off items as completed

---

## How to use this file

Each item has a priority, effort estimate, and a checkbox. When something is done, tick the box and add the date. Items are grouped by severity, not by sprint — tackle them alongside feature work.

---

## 🔴 CRITICAL — Fix Before Any Real Users

- [ ] **Rotate hardcoded secrets in `docker-compose.yml`**
  `JWT_SECRET`, `SMTP_USER`, `SMTP_PASS` are committed in plain text. Anyone with repo access can forge JWT tokens and impersonate any user including super admins.
  **Fix:** Move to `.env` (in `.gitignore`) or a secrets manager (AWS Secrets Manager, DigitalOcean Secrets, HashiCorp Vault). Rotate all three values immediately.
  **Files:** `backend/docker-compose.yml`, `web/ivor-web/.env.local`
  **Effort:** 2h

- [ ] **Add rate limiting to all auth endpoints**
  Login, OTP, and password reset endpoints have zero rate limiting. A 6-digit OTP has 1M combinations — brute-forceable in minutes. User inboxes can be flooded with reset emails.
  **Fix:** Add `slowapi` to `requirements.txt`. Protect `/api/v1/user/login`, `/api/v1/password/forgot-password`, `/api/v1/password/verify-otp` with `@limiter.limit("5/minute")`.
  **Files:** `backend/main.py`, `backend/api/v1/password_reset.py`, `backend/api/v1/user.py`
  **Effort:** 4h

- [ ] **Enforce HTTPS in production**
  The production deployment speaks plain HTTP. JWT tokens and HttpOnly cookies are exposed over the wire.
  **Fix:** Put Nginx in front of FastAPI with Let's Encrypt certificate. Add HSTS header. Redirect HTTP → HTTPS.
  **Files:** `backend/docker-compose.yml` (add nginx service), new `nginx/nginx.conf`
  **Effort:** 4h

- [ ] **Lock down CORS configuration**
  `allow_methods=["*"]` and `allow_headers=["*"]` is too permissive. Hardcoded `192.168.x.x` dev IPs will break when machines change.
  **Fix:**
  ```python
  allow_origins=os.getenv("CORS_ORIGINS", "").split(",")
  allow_methods=["GET", "POST", "PUT", "DELETE", "OPTIONS"]
  allow_headers=["Content-Type", "Authorization"]
  ```
  **Files:** `backend/main.py` lines 40–56
  **Effort:** 1h

---

## 🟠 HIGH — Fix Before Scale

- [ ] **Add database indexes to all foreign key columns**
  `Job.company_id`, `TimeLog.job_id`, `TimeLog.private_user_id`, `PrivateUser.company_id` have no indexes. Every company-scoped query does a full table scan. At 500 employees: slow. At 5,000: unusable.
  **Fix:** New Alembic migration:
  ```sql
  CREATE INDEX idx_job_company ON jobs(company_id);
  CREATE INDEX idx_timelog_job ON time_logs(job_id);
  CREATE INDEX idx_timelog_user ON time_logs(private_user_id);
  CREATE INDEX idx_private_user_company ON private_users(company_id);
  CREATE INDEX idx_transfer_user ON transfers(private_user_id);
  CREATE INDEX idx_purchase_user ON purchases(private_user_id);
  CREATE INDEX idx_leave_user ON leaves(private_user_id);
  CREATE INDEX idx_leave_company ON leaves(company_id);
  ```
  **Files:** New `backend/alembic/versions/YYYYMMDD_add_fk_indexes.py`
  **Effort:** 4h

- [ ] **Implement soft deletes on critical tables**
  Deleting a `PrivateUser` cascades to: jobs, time logs, leaves, transfers, loans, documents, complaints — all permanently gone. A labor tribunal subpoena two years from now has nothing to give them.
  **Fix:** Add `deleted_at = Column(DateTime(timezone=True), nullable=True)` and `deleted_by = Column(Integer, ForeignKey("users.user_id"), nullable=True)` to: `PrivateUser`, `Job`, `TimeLog`, `Leave`, `UserRight`, `DocumentVault`, `Salary`. Filter all queries with `WHERE deleted_at IS NULL`.
  **Files:** `backend/core/model.py`, all CRUD files, new Alembic migration
  **Effort:** 1 week

- [ ] **Fix timezone-naive DateTime columns throughout**
  Most `created_at` / `updated_at` columns use `DateTime` without `timezone=True`. A clock-in in Madagascar (UTC+3) on a UTC server records the wrong time. Overtime calculation will be wrong.
  **Fix:** Replace all `Column(DateTime, ...)` with `Column(DateTime(timezone=True), server_default=func.now(), nullable=False)`.
  **Files:** `backend/core/model.py` — every model's `created_at`, `updated_at`, `start_time`, `end_time`
  **Effort:** 4h + Alembic migration

- [ ] **Add background job queue**
  Email sending, OCR receipt processing, bulk exports, push notifications, compliance score recalculation — all currently block the HTTP request thread. A payroll export for 200 employees will time out.
  **Fix:** Add **ARQ** (lightweight, FastAPI-native) or **Celery + Redis**.
  Offload: email sending (`send_via_smtp`), OCR (`scan_receipt.py`), bulk CSV exports, Expo push notifications.
  **Files:** New `backend/workers/`, `backend/tasks/email.py`, `backend/tasks/exports.py`
  **Dependencies:** Add `arq` or `celery[redis]` + `redis` to `requirements.txt`
  **Effort:** 1 week

- [ ] **Move request logging out of the database**
  `main.py` writes every HTTP request to the `RequestLog` DB table. At 10,000 daily active users = 10M+ rows/month. PostgreSQL backup size triples. Queries slow down.
  **Fix:** Log to stdout in JSON format → hosting provider's log aggregation (DigitalOcean, Datadog, Papertrail). Keep `AuditLog` for business events only (salary changes, leave approvals, deletions).
  **Files:** `backend/main.py` lines 60–186
  **Effort:** 4h

- [ ] **Validate file uploads (type, size, filename)**
  File upload endpoints don't validate MIME type, file size, or sanitize filenames. An attacker can upload a 1GB file or a file with `../` path traversal in the name.
  **Fix:**
  ```python
  ALLOWED_MIME_TYPES = {"application/pdf", "image/jpeg", "image/png"}
  MAX_FILE_SIZE = 10 * 1024 * 1024  # 10MB
  if file.content_type not in ALLOWED_MIME_TYPES:
      raise HTTPException(400, "Invalid file type")
  ```
  **Files:** `backend/api/v1/user.py` (vault upload), `backend/api/v1/scan_receipt.py`
  **Effort:** 3h

- [ ] **Resolve Alembic merge heads**
  38 migrations with multiple merge heads means `alembic upgrade head` on a fresh database may fail. This is a production deployment risk every time you deploy.
  **Fix:** Run `alembic merge heads -m "merge_heads"` and validate on a fresh DB.
  **Files:** `backend/alembic/versions/`
  **Effort:** 2h

---

## 🟡 ARCHITECTURE

- [ ] **Add consistent audit trail for business events**
  Who changed a salary? Who approved overtime? Who deleted a time log? The `AuditLog` table exists but is not consistently written to. Key events are happening with no record of who did what.
  **Fix:** Create a `create_audit_entry(db, action, entity_type, entity_id, user_id, before_value, after_value)` helper. Call it on: salary create/update, leave approve/reject, OT approve/reject, user enable/disable, document delete, role change.
  **Files:** New `backend/services/audit_service.py`, called from relevant route handlers
  **Effort:** 1 week

- [ ] **Add Redis caching for reference data**
  Sector data (minimum wages by country, labour law thresholds, public holidays) never changes but is queried on every request that needs it. Company headcount stats are queried on every sidebar load.
  **Fix:** Add Redis. Cache `/api/v1/sector` with 1h TTL. Cache `/company/{id}/stats` with 60s TTL.
  **Files:** New `backend/core/cache.py`, called from `backend/api/v1/sector.py`, `backend/api/v1/company.py`
  **Dependencies:** Add `redis`, `hiredis` to `requirements.txt`
  **Effort:** 1 week

- [ ] **Add WebSockets for live attendance dashboard**
  The web dashboard polls `/dashboard/stats` on a 60s timer to see live clock-ins. At 100 companies each polling every 60s = 100 requests/minute of wasted load. FastAPI supports WebSockets natively.
  **Fix:** Add `ws://api/v1/company/{id}/live` WebSocket endpoint that pushes clock-in/out events as they happen. Web dashboard subscribes once per session.
  **Files:** New `backend/api/v1/ws.py`, `web/ivor-web/src/hooks/useLiveAttendance.ts`
  **Effort:** 1 week

- [ ] **Add webhook/integration system**
  No way for payroll processors, accounting tools (QuickBooks, Xero), or government reporting systems to subscribe to Ivor events. This is an enterprise sales blocker.
  **Fix:**
  ```
  POST /company/{id}/webhooks        ← register endpoint URL
  GET  /company/{id}/webhooks        ← list registered webhooks
  DELETE /company/{id}/webhooks/{id} ← remove webhook
  Events: employee.clocked_in | leave.approved | overtime.confirmed | payroll.locked
  ```
  On each event: POST payload to registered URLs, store delivery receipt, retry 3× on failure.
  **Files:** New `backend/api/v1/webhooks.py`, new `backend/tasks/webhook_delivery.py`
  **Effort:** 2 weeks

- [ ] **Fix N+1 query problem in list endpoints**
  Dashboard stats endpoints likely loop over companies/employees and trigger a separate SQL query per record. Use SQLAlchemy `joinedload()` / `selectinload()` on every relationship accessed in a loop.
  **Fix:** Audit all `db.query(X).all()` calls that access related objects in a loop. Add `.options(joinedload(X.related))`.
  **Files:** `backend/api/v1/dashboard.py`, `backend/api/v1/company.py`, CRUD files
  **Effort:** 3 days

- [ ] **Add pagination to all list endpoints**
  Endpoints returning all users, all time logs, all leave requests have no `limit/offset`. At 10,000 records a response is 10MB+ and the app hangs.
  **Fix:** Add `skip: int = 0, limit: int = 50` to every list endpoint. Return `{"data": [...], "total": N, "skip": skip, "limit": limit}`.
  **Files:** `backend/api/v1/user.py`, `backend/api/v1/job.py`, `backend/api/v1/company.py`
  **Effort:** 3 days

- [ ] **Add a proper health check endpoint**
  No `/health` endpoint for container orchestration (Kubernetes, Docker Swarm, DigitalOcean App Platform). Deployments can't verify the service is up.
  **Fix:**
  ```python
  @app.get("/health")
  async def health(db: Session = Depends(get_db)):
      db.execute("SELECT 1")
      return {"status": "ok", "db": "connected"}
  ```
  **Files:** `backend/main.py`
  **Effort:** 30min

- [ ] **Pin all dependency versions**
  `requirements.txt` has unpinned versions. A `pip install` six months from now may install a breaking version of FastAPI, SQLAlchemy, or Pydantic and silently break the app.
  **Fix:** Run `pip freeze > requirements.txt` in a clean venv. Use `pip-tools` to manage: `pip-compile requirements.in`.
  **Files:** `backend/requirements.txt`
  **Effort:** 2h

- [ ] **Add structured (JSON) logging**
  Using `print()` and `logger.info()` inconsistently with no structured format. Impossible to search, alert on, or ship to a log aggregator.
  **Fix:**
  ```python
  from pythonjsonlogger import jsonlogger
  handler = logging.StreamHandler()
  handler.setFormatter(jsonlogger.JsonFormatter())
  ```
  Add context fields to every log: `user_id`, `company_id`, `request_id`, `duration_ms`.
  **Files:** `backend/core/logging.py` (new), imported in `main.py`
  **Effort:** 4h

---

## 🟡 PRODUCT GAPS

- [ ] **Add a subscription / billing layer**
  Ivor is a SaaS platform with no billing, no seat limits, no pricing tiers, and no trial enforcement. Before acquiring company #2, wire Stripe (international) or PayDunya (Mauritius/Madagascar) to the backend.
  **Suggested model:** Per-seat per-month (MUR 300/employee/month). Free tier: up to 5 employees. Pro: unlimited + compliance module. Enterprise: custom + SLA.
  **Files:** New `backend/api/v1/billing.py`, new `Subscription` company-level model (separate from the personal finance `Subscription`)
  **Effort:** 2 weeks

- [ ] **Add feature flags per company**
  When the Compliance module has a bug you can't disable it for one company without a deployment. Feature flags let you roll out features gradually and create premium tiers.
  **Fix:** Simple DB table:
  ```python
  class CompanyFeatureFlag(Base):
      company_id, feature_name, enabled, updated_at
  ```
  Check via `has_feature(company_id, "compliance_module")` in route handlers.
  **Files:** `backend/core/model.py`, new `backend/services/feature_flags.py`
  **Effort:** 3 days

- [ ] **Implement multi-language (i18n)**
  The mobile app has a `LanguageProvider` but no actual translations. Workers speak Tagalog, Bahasa Indonesia, Hindi, Nepali, French (Madagascar), Creole (Mauritius). A worker who can't read the rights reporting form in their language can't use the core differentiating feature.
  **Fix:** Add `i18next` + `expo-localization` on mobile. Add `next-intl` on web. Start with French (covers Madagascar) and English. Add Creole and Hindi next.
  **Files:** `mobile/services/i18n.ts` (new), all screen files, `web/ivor-web/src/i18n/` (new)
  **Effort:** 2 weeks for French/English

- [ ] **Add company first-run onboarding wizard (web)**
  When a company signs up, they land on a blank dashboard with no guidance. There's no guided flow to: set up departments → invite employees → configure salary → publish first schedule.
  **Fix:** 5-step wizard shown on first login (`onboarding_complete` flag on Company model). Skip anytime.
  **Files:** `web/ivor-web/src/app/(platform)/dashboard/onboarding/page.tsx`
  **Effort:** 1 week

- [ ] **Refresh Expo push tokens on every app foreground**
  Expo push tokens expire and get recycled to other devices. The app saves the token on login but never refreshes it. When a token goes stale, push notifications silently fail.
  **Fix:** On every `AppState` change to `active`, call `Notifications.getExpoPushTokenAsync()` and PATCH to `/api/v1/user/me/push-token`. On Expo API `DeviceNotRegistered` error, null the token in the DB.
  **Files:** `mobile/app/_layout.tsx` or `mobile/services/notifications.ts`
  **Effort:** 4h

- [ ] **Add offline clock-in support (mobile)**
  A construction worker in rural Madagascar has no signal at 7am. They can't clock in. The action should queue locally (GPS + timestamp captured on device) and sync when connectivity returns.
  **Fix:** Use `@react-native-async-storage/async-storage` as a local queue. On app foreground + connectivity: drain queue → POST each pending clock-in → show sync status badge.
  **Files:** New `mobile/services/offlineQueue.ts`, `mobile/app/private_dashboard/clock-in.tsx`
  **Effort:** 1 week

- [ ] **Add worker identity verification for permits**
  Users can type any passport or permit number with no verification. Two options: (a) integrate with Mauritius Passport & Immigration Office API if available, or (b) require document upload + company admin sign-off before a permit is marked "Confirmed." Option (b) is partially built in the verification workflow — complete it to cover permit renewal.
  **Files:** `backend/api/v1/verification.py`, `mobile/app/private_dashboard/profile.tsx`
  **Effort:** 1 week (option b)

---

## 🟡 MOBILE CI/CD

- [ ] **Set up EAS Build + automated releases**
  Every release requires someone to run `eas build` manually. No automated build on merge to main. No TestFlight/internal track distribution.
  **Fix:** GitHub Actions workflow:
  ```yaml
  on: push to main
  → eas build --platform all --non-interactive
  → eas submit (iOS → TestFlight, Android → internal track)
  ```
  **Files:** New `.github/workflows/mobile-release.yml`
  **Effort:** 4h

- [ ] **Add mobile crash reporting**
  No Sentry, Bugsnag, or Crashlytics integration. When the app crashes on a user's device, you have no visibility.
  **Fix:** Add `@sentry/react-native`. Initialize in `_layout.tsx`. Capture unhandled errors + native crashes.
  **Files:** `mobile/app/_layout.tsx`, new `mobile/services/errorReporting.ts`
  **Effort:** 4h

---

## 🔵 REGULATORY & LEGAL

- [ ] **Decide on data residency strategy**
  Mauritius has the Data Protection Act 2017. Madagascar has Loi n° 2014-038. Both restrict transferring personal data (passport numbers, biometrics, salary) outside the country. If your PostgreSQL is on a server in Amsterdam or `us-east-1`, you may be non-compliant for every company you sign.
  **Options:**
  - Host on AWS `af-south-1` (Cape Town — may qualify)
  - Host on a Mauritius-based VPS (Rogers Capital Cloud, SBM Cloud)
  - Get explicit data transfer agreements signed by every company
  **Effort:** Architecture decision + legal review (not a code task)

- [ ] **Implement right to erasure (DPA compliance)**
  Under Mauritius DPA, workers can request deletion of their personal data. Deleting a `PrivateUser` cascades everything — but there's no formal workflow, no record it was done, and no way to delete PII while keeping anonymized records for business reporting.
  **Fix:**
  ```
  POST /api/v1/user/me/erasure-request   ← worker submits request
  GET  /api/v1/admin/erasure-requests    ← admin reviews
  POST /api/v1/admin/erasure/{id}/execute ← nulls PII fields, logs action
  ```
  PII to null: `first_name`, `last_name`, `pass_port_number`, `phone`, `date_of_birth`. Keep anonymized record for payroll/compliance audit.
  **Files:** New `backend/api/v1/erasure.py`, `backend/services/erasure_service.py`
  **Effort:** 1 week

- [ ] **Add Terms of Service and DPA acceptance tracking**
  No record of when a company accepted the Terms of Service or Data Processing Agreement. This is required before storing employee personal data on behalf of a company under both Mauritius and Madagascar law.
  **Fix:** Add `tos_accepted_at`, `tos_version`, `dpa_accepted_at` to the `Company` model. Show acceptance screen on first company login.
  **Files:** `backend/core/model.py`, `web/ivor-web/src/app/(platform)/dashboard/onboarding/`
  **Effort:** 3 days

- [ ] **Document RTO/RPO and set up automated backups**
  No documented backup strategy. No recovery time objective. If the PostgreSQL server fails, how long until data is restored? An HR director evaluating Ivor for 200 employees will ask this.
  **Fix:**
  - Enable DigitalOcean Managed Database daily backups (or `pg_dump` cron job to S3)
  - Test restoration monthly
  - Document: RPO = 24h, RTO = 4h (or whatever is achievable)
  **Effort:** 4h to set up, ongoing to maintain

---

## ✅ Completed Items

<!-- Move items here when done, with completion date -->

---

## Summary Priority Matrix

| # | Item | Effort | Why Now |
|---|---|---|---|
| 1 | Rotate secrets | 2h | Catastrophic if breached |
| 2 | Rate limiting on auth | 4h | Brute force prevention |
| 3 | HTTPS + Nginx | 4h | Tokens exposed over wire |
| 4 | CORS lockdown | 1h | Open to any origin |
| 5 | DB indexes on FKs | 4h | 10× query performance |
| 6 | Fix DateTime(timezone=True) | 4h | Wrong time records |
| 7 | Resolve Alembic merge heads | 2h | Deployment blocker |
| 8 | Health check endpoint | 30min | Required for deployment |
| 9 | Pin dependency versions | 2h | Prevents silent breakage |
| 10 | File upload validation | 3h | Security + storage cost |
| 11 | Pagination on list endpoints | 3d | API unusable at scale |
| 12 | Soft deletes | 1w | Legal/compliance requirement |
| 13 | Background job queue | 1w | Bulk ops will time out |
| 14 | Move request logging to stdout | 4h | DB bloat |
| 15 | Consistent audit trail | 1w | Required for dispute resolution |
| 16 | Redis caching | 1w | Reference data hammering DB |
| 17 | Structured JSON logging | 4h | Production observability |
| 18 | Feature flags | 3d | Safe rollouts + premium tiers |
| 19 | Billing / Stripe | 2w | Monetization |
| 20 | i18n French + English | 2w | Core to mission |
| 21 | Expo push token refresh | 4h | Silent notification failures |
| 22 | Offline clock-in | 1w | Field worker usability |
| 23 | EAS Build CI/CD | 4h | Manual releases are risky |
| 24 | Mobile crash reporting | 4h | Zero production visibility |
| 25 | Data residency decision | — | Legal requirement |
| 26 | Right to erasure endpoint | 1w | DPA compliance |
| 27 | ToS/DPA acceptance tracking | 3d | Required before storing PII |
| 28 | Automated DB backups + RTO doc | 4h | Disaster recovery |
| 29 | WebSockets for live dashboard | 1w | Replaces polling |
| 30 | Webhook/integration system | 2w | Enterprise sales blocker |
| 31 | N+1 query fixes | 3d | Dashboard performance |
| 32 | Worker permit verification | 1w | Product integrity |
| 33 | Company onboarding wizard | 1w | First-run experience |
