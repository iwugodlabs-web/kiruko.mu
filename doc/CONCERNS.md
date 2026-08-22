# Concerns — system of record for workplace grievances

This is the canonical reference for the Concerns subsystem (formerly
"Your Rights"). Read this first if you are:

- Onboarding to engineering on this feature.
- A Kiruko Compliance lawyer who wants to know how the system enforces
  the anonymity / impartiality guarantees we sell.
- A customer's legal team reviewing the platform for fitness as a
  whistleblower channel.

For day-to-day operations see the **companion docs**:
- `backend/CONCERNS_INCIDENTS.md` — on-call runbook for anonymity / abuse incidents.
- `backend/CONCERNS_KONTOKAZ_TRAINING.md` — 45-min lawyer training outline.
- `backend/CHANGELOG_CONCERNS_V2.md` — customer-facing release notes.
- `backend/CONCERNS_CUSTOMER_ONBOARDING.md` — practical guide for new customers.
- `/Users/iwugod/.claude/plans/keen-hugging-wadler.md` — the 16-week build plan + milestone status board.

---

## 1. What it is

A workplace-grievance + whistleblower platform built into Kiruko. An
employee files a "concern" through the mobile app; it routes to one of two
audiences:

- **Internal channel** → handled by the employee's own company HR / Owner
  via the web dashboard at `Dashboard → Leave → Concerns`.
- **External channel** → handled by **Kiruko Compliance** (an in-house
  lawyer team) via `/admin/compliance`. Acts as an impartial third party
  for cases where the employer cannot fairly self-handle (conflict of
  interest, severe misconduct, etc.).

The system is the **legal record**. Closed cases are append-only; the
audit log is partitioned and retained for 7 years; identities of anonymous
reporters are masked server-side from employers.

## 2. High-level architecture

```
┌─────────────────────┐        ┌──────────────────────────────────┐
│  Mobile (Expo RN)   │        │  Web (Next.js)                   │
│                     │        │                                  │
│  your_right.tsx     │        │  /dashboard/leave → Concerns     │
│  your_right_pin     │        │  /admin/compliance               │
│  concern_thread     │        │  /concerns/track  ← public PIN   │
│  your_right_history │        │                                  │
└──────────┬──────────┘        └─────────────────┬────────────────┘
           │                                     │
           │       FastAPI backend               │
           │       /api/v1                       │
           └─────────┬───────────────────────────┘
                     │
        ┌────────────┴──────────┬──────────────────┐
        │  POST /user-right     │ /portal/concerns │ /disputes/...
        │  (filing + PIN issue) │ (reporter portal)│ (handler-side)
        └────────────┬──────────┴──────────────────┘
                     │
        ┌────────────┴──────────────────────┐
        │  PostgreSQL                       │
        │  • user_rights (the case)         │
        │  • concern_messages (thread)      │
        │  • concern_audit_log  partitioned │
        │  • concern_retaliation_responses  │
        └────────────┬──────────────────────┘
                     │
        ┌────────────┴──────────────┐
        │  Cron scripts (M6):       │
        │  audit_partition_roll     │
        │  sla_employer             │
        │  acknowledge_reminder     │
        │  retaliation_survey       │
        │  retention_purge          │
        └───────────────────────────┘

        ClamAV daemon (optional, M7)
        docker-compose --profile scan
```

## 3. Data model

All concerns DDL lives in `backend/alembic/versions/concern_v2_*.py`.
Migration 1.A creates the new tables; 1.B adds 11 nullable columns to
`user_rights`; 1.C widens the status enum + backfills.

### `user_rights` — the case
Source: `backend/core/model.py:UserRight`.

| Column | Purpose |
|---|---|
| `right_id` (PK) | Case number shown to handlers. |
| `private_user_id` (FK) | Reporter — even on anonymous filings (masked at API layer). |
| `title`, `category`, `issue_description`, `expected_outcome`, `occurrence_description`, `urgency_level` | Substance fields, identical for anonymous and named cases. |
| `status` | One of the 8 workflow states. CHECK constraint enforces enum. |
| `channel` | `internal` or `external`. |
| `is_anonymous` | When true, server-side mask kicks in on employer-facing reads. |
| `attachment_url`, `attachment_scanned_at`, `attachment_scan_result` | M7 hygiene. |
| `case_pin_hash` | bcrypt hash; plaintext PIN never persisted (M2 reporter portal). |
| `named_parties` | JSON list of `{user_id, label}`; drives COI auto-escalation (M4). |
| `escalated_to_external_at`, `escalated_reason` | Set when COI auto-escalation fires. |
| `acknowledged_at` | Stamped on first state transition out of `received`. EU 7-day directive target. |
| `assigned_to`, `internal_notes`, `resolution`, `closed_at`, `closed_by` | Admin workflow (M2/M4). |
| `retention_purge_at` | Computed `closed_at + 7y`; cron purges past this. |
| `retaliation_check_30d_at` / `_60d_at` / `_90d_at` | Stamped per fired survey. |
| `last_sla_notified_at` | SLA-digest idempotency. |

A DB trigger `user_rights_closed_immutable` (from earlier migration) rejects
UPDATEs to closed rows for substance fields. Operational stamps
(retaliation timestamps, audit-log writes) are allowed because they're not
in the trigger's reject-list.

### `concern_messages` — thread
Source: `backend/core/model.py:ConcernMessage`. One row per message (reporter
or handler). `author_user_id` is **always NULL** on reporter messages even
on the owner-gated mobile endpoint, to prevent identity leakage between
the anonymous portal path and the in-app named path.

### `concern_audit_log` — append-only forensic log
Source: `backend/core/model.py:ConcernAuditLog`.

`PARTITION BY RANGE (created_at)`, monthly partitions. 24 partitions seeded
at deploy time covering 2026-05 → 2028-04. Cron at
`backend/scripts/concern_audit_partition_roll.py` creates the next month
each 25th and detaches partitions past retention into a parallel
`concern_audit_log_archive_<YYYY>` schema (preserved, not deleted).

Index: `(right_id, created_at DESC)` on every partition for the
"show me everything that happened to this case" query.

Every endpoint that touches a concern writes to this log — including reads
(action `viewed`), portal lookup attempts (`portal_lookup`), COI filtering
(`coi_filtered`), and triage decisions (`triage_dismissed` / `triage_accepted`).

Action constants live in `backend/services/concern_audit.py`.

### `concern_retaliation_responses`
Source: `backend/core/model.py:ConcernRetaliationResponse`. Survey answers
captured by the 30/60/90-day cron. CHECK constraint enforces window values.

## 4. Anonymity guarantees

The anonymity model is **identity-only redaction**, not content
redaction:

| Field exposed to | Anonymous case |
|---|---|
| Reporter themselves (portal + mobile) | Full substance + handler replies. No employer identities. |
| Employer (HR / Owner) | "Anonymous" name, NULL `private_user_id`. Full substance + thread + admin actions. |
| Kiruko Compliance | Full identity, full substance, full thread. By design — they need it to follow up; they're bound by professional confidentiality. |
| Public reporter portal (PIN-authed) | Full substance + thread, NO handler user_ids exposed. |

**Where masking is enforced:**

1. `GET /user/disputes/company/{id}` — server replaces `employee_name` with
   `"Anonymous"` and sets `private_user_id = None` before returning when
   `is_anonymous=True`. Code: `backend/api/v1/user.py` around the
   `internal_out.append(...)` block.
2. `GET /portal/concerns/{case_id}` — never includes `author_user_id` for
   any message regardless of authorship. Code:
   `backend/api/v1/concerns_portal.py:get_case`.
3. Defense in depth on the **web UI**: `Complaints.tsx` branches on
   `is_anonymous === true` BEFORE rendering any identity field, even
   though the API has already masked.
4. The **notification copy** in `backend/CONCERNS_INCIDENTS.md` lists the
   rules for what may appear in subject lines / push bodies sent to the
   reporter to avoid identifying them on a shared device.

Anonymity is one-way: hidden from employer, not from Kiruko. This is
disclosed to the reporter at filing time via
`yourRightsForm.anonymousDisclosure` in every locale (M7).

## 5. Conflict-of-interest gating (M4)

When an employee files a concern, they can name up to 5 implicated
parties via `named_parties` on `POST /user-right`. If any named party is a
**company admin** for the reporter's company, the backend auto-routes the
case to Kiruko:

```
channel = 'external'
escalated_to_external_at = now()
escalated_reason = "Conflict-of-interest auto-escalation: named party
                    user_id(s)=[...] are admin(s) of company N."
```

The audit log fires an `escalated` event. Kiruko sees the case in the
**Triage** tab (`/admin/compliance`) where they accept (handle as a
normal external case) or dismiss-back-to-internal (named admin is removed,
channel flips back; ops if the naming was frivolous).

In parallel, **`GET /disputes/company/{id}` filters out cases naming the
calling admin**. A COI'd admin sees nothing — neither in the list nor in
aggregate counts. The filter event is itself audit-logged
(`action='coi_filtered'`) so even a redacted view is attributable.

`named_parties` is capped at 5 server-side (422 on >5) to prevent
weaponising the auto-escalation (a reporter who names every admin to
force-route trivial complaints to Kiruko lawyers).

## 6. State machine

Source: `backend/core/concern_states.py`. 28 unit tests in
`backend/tests/test_concern_states.py`.

```
received → triaged → investigating → action_taken → resolved → closed
                                                         ↘ appealed → investigating
            ↘ rejected → closed
                       ↘ appealed → investigating
```

Rules:
- `received → anything` triggers `acknowledged_at` stamp (EU 7-day acknowledgement).
- `appealed` is the only state a reporter can drive — via the portal
  `POST /portal/concerns/{case_id}/appeal`. Handlers cannot file appeals
  on a reporter's behalf.
- `closed` is terminal.
- Closed rows are append-only — only `internal_notes` may change. DB
  trigger + API-layer guard both enforce it.
- Skipping states returns HTTP 409 with a descriptive message
  ("Illegal transition received → resolved").

## 7. Reporter portal (M2)

Source: `backend/api/v1/concerns_portal.py`. Public router at
`/api/v1/portal/concerns/*` — no auth wall.

Reporter returns to a case via case_id + 8-char PIN (issued once at
submission, bcrypt-hashed in `case_pin_hash`, never recoverable). Successful
verification mints a short-lived (30 min) JWT scoped to that case_id
(audience=`concern_portal` — see `backend/core/security.py:VALID_AUDIENCES`).

Endpoints:

| Method | Path | Purpose |
|---|---|---|
| POST | `/lookup` | case_id + PIN + optional captcha → token |
| GET | `/{case_id}` | substance + thread (no admin fields) |
| POST | `/{case_id}/messages` | reporter posts a reply |
| POST | `/{case_id}/appeal` | reporter triggers resolved/rejected → appealed |

### Abuse mitigation

`backend/services/concern_portal_security.py` (in-memory state — Redis
swap is a TODO for multi-process production):

- 5 PIN attempts per case_id per 15 min; 1-hour lockout after 10 failures.
- 10 lookups per IP per 15 min.
- hCaptcha required after 3 failed IP attempts (`services/hcaptcha.py`,
  env-flagged `HCAPTCHA_SECRET`).
- Constant-time response: lookup ALWAYS returns 200 with uniform
  `{ok, captcha_required, token?}` body — unknown-case / wrong-PIN /
  rate-limited / locked are indistinguishable to the caller.
- Burst alerts via `logger.warning(..., extra={"alert": "..."})` on
  >100 lookups/5min or >5 lockouts/hour.

Every attempt writes a `portal_lookup` audit row with `success` flag.

## 8. Audit log + retention

- **Partitioned monthly** on `created_at`. New month created by the
  partition-roll cron (`backend/scripts/concern_audit_partition_roll.py`).
- **7-year retention** by default. Past-retention partitions are detached
  into `concern_audit_log_archive_<YYYY>` schemas (preserved, not dropped)
  so legal queries against old data still work but the live index stays
  small.
- **Viewer** at `/admin/compliance` → "Audit log" tab (M7). Filter by
  case / action / actor / date-range; CSV export for legal review.

Concerns themselves are retention-managed by the **retention-purge cron**
(`backend/scripts/concern_retention_purge.py`):
- Stamps `retention_purge_at = closed_at + 7y` on any closed concern
  missing it.
- Default mode is **DRY-RUN**. The `--enable-purge` flag is required to
  actually delete. **Production cron must omit `--enable-purge` until the
  first real 7-year expiry approaches** (years out from launch).
- Audit row is written BEFORE the delete (FK cascades on delete).

Per-company retention override is a follow-up: `companies.concern_retention_years`
column was scoped in the plan but not yet shipped. Today every customer is
on the 7-year default.

## 9. Cron job ownership

All scripts live at `backend/scripts/concern_*.py`. Suggested crontab:

```
# 25th of each month at 02:00 — roll forward + archive old partitions.
0 2 25 * * cd /app && python3 scripts/concern_audit_partition_roll.py

# Weekdays at 09:00 — SLA digest to company admins.
0 9 * * 1-5 cd /app && python3 scripts/concern_sla_employer.py

# Daily at 10:00 — nudge handlers when concerns aren't acknowledged.
0 10 * * * cd /app && python3 scripts/concern_acknowledge_reminder.py

# Daily at 11:00 — 30/60/90-day retaliation surveys.
0 11 * * * cd /app && python3 scripts/concern_retaliation_survey.py

# Daily at 02:00 — retention check. NOTE: no --enable-purge in prod
# until the first real expiry approaches.
0 2 * * * cd /app && python3 scripts/concern_retention_purge.py
```

Every script supports `--dry-run` (or, for retention-purge,
behaves dry-run by default unless `--enable-purge` is passed).

## 10. Notifications

Reuses `services/notification_service.NotificationService`. Push tokens
live on the User row (`expo_push_token`). Notification copy rules are in
`backend/CONCERNS_INCIDENTS.md` — designed so a reporter's identity is
never derivable from a push title / subject visible on a shared device.

## 11. Kill switch

Set `KONTOKAZ_CONCERNS_KILL=true` in the backend environment to freeze the
public reporter portal endpoints (they all return 503 with a uniform body).
Handler-side endpoints remain functional so in-flight cases can continue
being processed. See the incident runbook.

The broader `KONTOKAZ_CONCERNS_V2` env flag was scoped in the original
plan but never wired — the system shipped live. A regression requires a
code revert, not a flag toggle. Accepted trade-off; documented honestly in
the M5 plan section.

## 12. Roles and auth gates

Source: `backend/core/roles.py`.

| Helper | Where it gates |
|---|---|
| `is_company_admin_for(user, company_id, db)` | `GET /disputes/company/{id}`, `PATCH /disputes/{id}` for internal cases. |
| `is_compliance_officer(user, db)` | `compliance_officer` role check. |
| `is_compliance_or_platform_admin(user, db)` | `GET /disputes/compliance`, `PATCH /disputes/{id}` for external cases, `PATCH /disputes/{id}/triage`, `GET /concerns/audit-log`. |
| `is_company_admin_by_user_id(user_id, company_id, db)` | Used by the COI auto-escalation in `POST /user-right` to identify named-admin parties. |

Platform roles (`compliance_officer`, `platform_admin`) live in the
`user_platform_roles` join table; helper queries via `user_has_role_by_user_id`.

## 13. Code surfaces — where to find what

### Backend
- Routes: `backend/api/v1/user.py` (filing + handler-side disputes + audit log + triage), `backend/api/v1/concerns_portal.py` (public reporter portal).
- Models: `backend/core/model.py` (`UserRight`, `ConcernMessage`, `ConcernAuditLog`, `ConcernRetaliationResponse`).
- Services: `backend/services/concern_audit.py`, `concern_pin.py`, `concern_portal_security.py`, `hcaptcha.py`, `attachment_scanner.py`.
- State machine: `backend/core/concern_states.py`.
- Roles: `backend/core/roles.py`.
- Migrations: `backend/alembic/versions/concern_v2_*.py` (1.A / 1.B / 1.C).
- Crons: `backend/scripts/concern_*.py`.
- Tests: `backend/tests/test_concern_states.py`, `test_concern_pin.py`, `test_concern_portal_security.py`, `test_attachment_scanner.py`.

### Web (Next.js)
- Employer view: `web/ivor-web/src/app/(platform)/dashboard/components/Complaints.tsx`.
- Kiruko compliance: `web/ivor-web/src/app/(platform)/admin/compliance/components/ComplianceSection.tsx` (queue + triage + audit-log tabs).
- Public portal: `web/ivor-web/src/app/concerns/track/page.tsx`.
- Section host: `web/ivor-web/src/app/(platform)/dashboard/components/RequestsSection.tsx`.
- Service helpers: `web/ivor-web/src/services/api.tsx` (`fetchCompanyDisputes`, `patchDispute`, `fetchDisputeThread`, `postDisputeMessage`, `patchTriageAction`, `fetchConcernAuditLog`, `concernAuditLogCsvUrl`).

### Mobile (Expo)
- Filing form: `mobile/app/private_dashboard/your_right.tsx` (named_parties picker, anonymity disclosure, channel toggle).
- PIN handoff: `mobile/app/private_dashboard/your_right_pin.tsx`.
- Thread: `mobile/app/private_dashboard/concern_thread.tsx`.
- History: `mobile/app/private_dashboard/your_right_history.tsx`.
- Service helpers: `mobile/services/api.tsx` (`submitUserRightReport`, `getUserRightHistory`, `getOwnerThread`, `postOwnerMessage`).
- Locales: `mobile/app/locales/{en,fr,mg,ar,es}.ts` under `yourRightsForm.*`, `concernPin.*`, `concernThread.*`, `concernHistory.*`.

## 14. How to extend

### Add a new audit action
1. Add a constant to `services/concern_audit.py` (e.g.
   `ACTION_REOPENED = "reopened"`).
2. Call `concern_audit.log(db, right_id=..., actor_kind=..., action=ACTION_REOPENED, ...)` from the new code path.
3. The action will appear in the audit-log viewer immediately (the viewer
   filters on free-form strings).

### Add a new state-machine transition
1. Edit `ALLOWED_TRANSITIONS` in `core/concern_states.py`.
2. If the transition is actor-restricted, add an entry to
   `TRANSITION_ACTORS`.
3. Add unit tests in `test_concern_states.py` for both the legal and the
   illegal cases.

### Add a new locale for the mobile UI
1. Copy `mobile/app/locales/en.ts` to the new locale code.
2. Translate every key under `yourRightsForm.*`, `concernPin.*`,
   `concernThread.*`, `concernHistory.*`.
3. Register the locale in the i18n bootstrap (see existing locales).
4. Verify the disclosure copy under `yourRightsForm.anonymousDisclosure`
   is reviewed by counsel for that jurisdiction's professional-confidentiality
   wording.

### Add a new MIME type to the attachment allow-list
1. Add to `ALLOWED_MIMES` in `services/attachment_scanner.py`.
2. If the new type has a recognisable magic prefix, add it to
   `_MAGIC_SIGNATURES`.
3. If it shares ZIP magic with Office docs, add it to `_ZIP_BASED_MIMES`.
4. Add a unit test in `test_attachment_scanner.py`.

## 15. Known limitations

These are explicit non-goals as of M8:

- **Per-company retention override** (`companies.concern_retention_years`)
  scoped but not shipped.
- **Real `@hcaptcha/react-hcaptcha` widget** on the web portal — currently a
  placeholder accepts any non-empty string; backend accepts that when
  `HCAPTCHA_SECRET` is unset. Production needs both wired.
- **expo-print PDF export** of the case PIN — current mobile flow uses
  native `Share`. PDF export is a follow-up.
- **Real-time websocket message delivery** — current implementation polls
  at 30s in the foreground; push notifications are the primary signal.
- **Sentry SDK** is not initialised in the backend — `logger.warning`
  calls with `extra={"alert": "..."}` exist for portal abuse; ops must
  pipe these to Sentry/Slack.
- **Assignee picker** in the drawer admin actions — `assigned_to` is a
  nullable column; a UI search component is a follow-up.
- **Per-company audit-log scoping** — the viewer currently shows all
  audit rows; for a multi-tenant compliance team this should filter on
  the calling user's allowed companies.

## 16. Test surface

```bash
cd backend && .venv/bin/python -m pytest tests/test_concern_states.py \
                                          tests/test_concern_pin.py \
                                          tests/test_concern_portal_security.py \
                                          tests/test_attachment_scanner.py -q
```

70 unit tests as of M7. No integration tests yet — the anonymity-leak
integration suite is the open item before the M4/M7 operational sign-off.

## 17. Version

This document was written at the close of M8. The Concerns subsystem is
considered the **system of record** for workplace grievances on this
platform as of that sign-off. Schema is forward-only from Migration 1.C;
operational rollback uses the `KONTOKAZ_CONCERNS_KILL` switch (portal
freeze, handlers keep working).

Next revision after the first production incident, the first retention
purge, or any material new feature.
