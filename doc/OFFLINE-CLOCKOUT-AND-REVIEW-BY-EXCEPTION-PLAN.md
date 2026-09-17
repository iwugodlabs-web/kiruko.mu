# Offline Clock-Out Queue & Review-by-Exception — Implementation Plan

**Status:** Proposed
**Author:** Engineering
**Scope:** `mobile/` (employee app) + `backend/` (time-log + review APIs)
**Related:** M26 auto-close chain, M30 review dashboard, M31 kiosk offline queue, M6 idempotency middleware, Geofencing v3

---

## 1. Problem

Two linked weaknesses in the attendance flow:

1. **Blank auto-clock-outs.** Employee clock-out is a foreground PUT that `throw`s on network failure
   (`mobile/app/private_dashboard/clock-in.tsx:1414-1419`). Nothing is persisted, the session stays open,
   and the missed-clockout cron later auto-closes it with **no clock-out location and a synthetic end time**.
   A large share of these are *network* failures at end-of-shift, not employees forgetting.

2. **Un-triageable review pile.** Every session lands in one pending list on the Clock-in Review screen.
   As headcount grows this doesn't scale — admins re-examine hundreds of clean sessions to find the few
   that need judgment.

This plan fixes (1) with an **offline clock-out queue** and (2) with **review-by-exception**, reusing
existing in-repo machinery and adding the money-integrity guardrails a payroll system requires.

---

## 2. Existing assets we reuse (do not rebuild)

| Asset | Location | Reused for |
|---|---|---|
| Kiosk offline queue (Drizzle + sync worker) | `mobile/app/kiosk/services/{offlineQueue,syncWorker}.ts`, `mobile/db/schema.ts::kioskQueue` | Port to the employee punch queue |
| Idempotency middleware (Stripe-style, dedup on `Idempotency-Key`) | `backend/core/idempotency.py` | Safe clock-out retries |
| Bulk approve + audit | `backend/api/v1/time_log_review.py:428` | "Approve all clean" |
| Signal columns (`auto_closed`, `out_of_geofence`, `out_of_schedule`, `is_late`, `geofence_check_json`) | `backend/core/model.py::TimeLog` | Exception classification |
| Geofence enforcement + timestamp coercion | `backend/services/geofence_service.py`, `_coerce_fix_timestamp` | Enforce on the fix at sync time |
| Self-healing auto-close on self-poll | `backend/api/v1/job.py:1364` | Reconciliation ordering (see §3.4) |

---

## 3. Feature 1 — Offline clock-out queue

### 3.1 Endpoint decision — new POST action endpoint

Add **`POST /job/time-log/{id}/clock-out`** accepting `{ end_time, location, geo_check }`.

- **Why POST, not the existing PUT:** the idempotency middleware only caches `{POST, PATCH, DELETE}`
  (`core/idempotency.py:152`) — PUT retries are **not** deduped. A dedicated POST plugs straight into it.
- Keeps the supersede/reconciliation semantics (§3.4) out of the generic PUT `/job/time-log/{id}`, which
  stays as-is for break/admin field edits.
- `_assert_timelog_access(id, current_user, db)` for tenant scoping (mirrors the current PUT handler).

### 3.2 Mobile components

- **New Drizzle table `punch_queue`** — migration `mobile/drizzle/0002_punch_queue.sql`, schema in
  `mobile/db/schema.ts`. Mirrors `kioskQueue` but authed-employee shape:
  `id (uuid=idempotencyKey)`, `timelogId`, `endTime` (ISO), `latitude`, `longitude`, `accuracyM`,
  `geoCheckJson` (text), `idempotencyKey`, `attempts`, `lastError`, `createdAt`, `deadLettered`.
- **`mobile/app/private_dashboard/services/punchQueue.ts`** — near-verbatim port of
  `kiosk/services/offlineQueue.ts` (enqueue / listPending / markSynced / recordFailure / count).
- **`mobile/app/private_dashboard/services/syncWorker.ts`** — port of the kiosk worker. Reuse its
  network-class-vs-4xx dead-letter logic verbatim (`syncWorker.ts:80-94`): status `0`/`5xx` → "still
  down", bail without burning an attempt; `4xx` → real rejection, count toward `MAX_SYNC_ATTEMPTS`.
  Calls go through the authed `apiClient` instance (token), not the kiosk PIN path.
- **Register the worker** in `mobile/app/private_dashboard/_layout.tsx` (so it only runs in the authed
  subtree), draining on NetInfo `online` and AppState `active`.
- **Clock-out call site** (`clock-in.tsx:1405-1432`): on **network-class** failure, `punchQueue.enqueue()`
  with a fresh idempotency key, then run the optimistic local-clockout path. On **4xx**, keep the current
  error path (do not optimistically clear state — see §3.5).
- **Payload pinning invariant:** the queue row stores the *exact* request body (end time + location +
  geo-check) at enqueue time, and retries replay those stored bytes verbatim — never re-capture location
  or re-derive `end_time` on retry. The idempotency middleware returns **409** on a reused key with a
  different body (`core/idempotency.py:195-205`); pinning the payload is what keeps replays hash-stable.
- **Pending-sync banner** via the worker's `onChange` (kiosk already has this pattern).

### 3.3 Backend reconciliation — the point of the queue

`update_time_log` clock-out CRUD, when the target session is currently `auto_closed=True` **and eligible**
(see §3.4): overwrite `end_time` with the employee's real time, recompute `hours_worked` (**subtracting
break durations**, not just `end − start`), set `auto_closed=False`, attach the `clock_out` sub-key to
`location`, and re-run `enforce_punch` on the stored fix (`_coerce_fix_timestamp` already tolerates the
stringified `fix_timestamp` from a queued payload — commit `05092f0`). Write an `AuditLog`
(`time_log.clock_out_superseded_auto_close`).

**Human-touch guard:** only supersede when the session was closed *by the cron*, not by a human. A row
that is `auto_closed=True` may already have been hand-corrected by an admin via the PUT path. Gate the
overwrite on "no admin edit has occurred" — `admin_approved`/`admin_rejected` are false **and** `end_time`
still equals the cron's synthetic value (or an explicit `admin_edited` marker is absent). If a human has
touched it, defer to `TimeLogDispute` (§3.4) rather than overwrite their edit.

### 3.4 ⭐ Integrity guard #1 — never rewrite paid/approved data

**A late clock-out MUST NOT silently mutate money that's already been paid or approved.**

When a queued clock-out arrives for a session that is **`admin_approved`**, **`admin_rejected`**, or whose
`start_time` falls inside a **finalized payroll period**:

**Concrete predicate (no hand-waving):** a session is in a finalized period iff there exists a
`PayrollRun` for the same company with `status = 'finalized'` whose `period_start`/`period_end` window
contains the session's `start_time`. This is the exact check `patch_time_log` already enforces
(`time_log_review.py`); reuse it as one shared helper (`_session_in_finalized_period(db, company_id, start_time)`)
so the supersede path and the payroll engine agree on the definition. Note `PrivateUser.is_locked`
(`model.py:119`) is a *profile* lock, not a payroll lock — do not use it here.

- Do **not** mutate `end_time` / `hours_worked` on the original row.
- Instead create a **`TimeLogDispute`** (or period-scoped adjustment) carrying the real clock-out time +
  location, routed to admin review, so the correction lands in the *next* period rather than rewriting a
  closed one.
- Audit: `time_log.clock_out_adjustment_deferred`.

Ordering vs the self-heal path (`job.py:1364`) and the cron: reconciliation keys on `timelog_id`, so a
queued clock-out for session A is independent of a later online session B. The eligibility check above is
the single gate that decides mutate-in-place vs defer-to-dispute.

### 3.5 ⭐ Integrity guard #2 — trustworthy offline timestamps

The queued `end_time` is the **device wall clock** while offline — wrong clocks and deliberate manipulation
are real payroll-fraud vectors on a personal phone. Server-side, on clock-out:

- **Clamp** `end_time` to `[start_time, sync_arrival_time]`. Never accept an end in the future or before start.
  Apply the clamp **only beyond the skew threshold**, not as a blanket trim — a device clock 2–3 min ahead
  is common, and hard-clamping to `sync_arrival_time` would silently shorten legitimate clock-outs. For
  small drift, set the `time_skew` flag (§4.2) instead of mutating the value.
- **Skew flag:** if `|end_time − server_now_at_sync|` or `|end_time − fix_timestamp|` exceeds a threshold
  (e.g. > 15 min beyond expected sync latency), set a `time_skew` review reason (§4.2) — the session
  surfaces for admin review instead of flowing through clean.
- **Cross-check** against the GPS `fix_timestamp` (GPS time is hard to spoof) when present.

### 3.6 ⭐ Integrity guard #3 — no silently-lost punches

Optimistic UI must never lie. When a queued clock-out **dead-letters** (e.g. token expired during a long
offline stretch) or **4xx-fails**:

- Reconcile local state: revert the optimistic "clocked out" back to "needs attention," don't leave the
  employee believing they're clocked out while the server has an open session the cron will auto-close.
- Employee-visible affordance: "This clock-out didn't sync — resubmit / contact your admin."
- Emit a dead-letter metric (§6).

### 3.7 Phasing

- **P1:** clock-out queue + POST endpoint + reconciliation + guards #1–#3. *(the 90% case)*
- **P2:** queue clock-*in* too (client-generated temp id, PIN-less offline session create) + dead-letter
  management UI.

---

## 4. Feature 2 — Review-by-exception

### 4.1 Decision — filter-only first, auto-approve as a separate opt-in step

Ship the exception **view** before any auto-approval. The filter delivers most of the admin relief at
~0% payroll risk (purely presentational); auto-approve is a payroll mutation that needs the classifier
validated in production first.

### 4.2 Exception classification (server-authoritative)

`_classify_exceptions(tl) -> list[str]`. A session **needs review** if any of:

- `auto_closed`
- `out_of_geofence`
- `out_of_schedule`
- `is_late`
- `is_overtime and not overtime_confirmed_by_employer`
- mock-location present in `geofence_check_json`
- low-accuracy fix (accuracy over threshold)
- pending `TimeLogDispute`
- missing `clock_out` location
- **`time_skew`** (from §3.5)

Everything else is **clean**.

**Single source of truth:** classification is computed once and persisted (`needs_review: bool` +
`exception_reasons: text[]` columns on `TimeLog`, recomputed on any write that changes a signal) — do
**not** run one classifier at read-time and a different one at auto-approve-time, or the two paths drift.

**Write-path inventory (exhaustive — every one recomputes):** (a) the cron auto-close, (b) dispute
creation, (c) clock-out supersede (§3.3), (d) the PUT end-break/admin-edit path, (e) `enforce_punch`
results, (f) the offline-queue reconciliation. Any new write path that touches a signal column must be
added to this list.

**Backfill (required, part of P1):** existing rows will have `needs_review = NULL` after the migration, so
the default "Needs review" view would be empty/ambiguous on day one. The classification of historical rows
is folded into the schema migration itself (a self-contained SQL mirror of the classifier in
`services/time_log_backfill.py`) so `alembic upgrade head` does it atomically — no separate script step in
production. The SQL pass is frozen and one-time; the Python classifier remains the source of truth for
ongoing writes.

Add `needs_review` + `exception_reasons` to `TimeLogReviewItem` (`time_log_review.py:72`) and a
`needs_review: Optional[bool]` query param to `list_time_logs`.

### 4.3 ⭐ Integrity guard #4 — clean is not a free pass

Exception review optimizes for the flags we already have; a sophisticated buddy-punch (valid selfie,
in-geofence, on-time) looks clean and would get *less* scrutiny than today. Mitigations:

- **Random-sample audit:** surface a small % of "clean" sessions into the review queue anyway (per
  company, configurable). Clean is never a guaranteed skip. **Determinism:** seed the selection on
  `timelog_id` (or a `(company_id, timelog_id)` hash) so a given session is stably in/out of the sample —
  re-randomizing on every recompute would churn the queue and make sampling unauditable. Store the sample
  percentage on `Company` (a platform-wide default is a fallback, not the primary config).
- **Late signals pull back:** filing a dispute (or a superseding clock-out per §3.4) re-flags a session
  even if it was previously clean/approved.

### 4.4 ⭐ Integrity guard #5 — flag rates must stay sane (analytics loop is required)

Review-by-exception only helps if flags are *rare*. A mis-tuned geofence or wrong `work_end_time` flags
*everyone*, and the exception pile is as useless as today's. Therefore the analytics loop is **required,
not optional**:

- Feed auto-close / late / out-of-geofence events into PostHog, aggregated **per job / per company**.
- Surface a "flag rate" signal so a whole shift that always auto-closes reads as a *schedule/config* bug
  to fix, not N individual review items.

### 4.5 Auto-approve (P2, opt-in)

- New `Company.auto_approve_clean_clockins` (Boolean, `server_default 'false'`), beside
  `require_approved_clockins_for_payroll` (`model.py:280`).
- On clock-out finalize, if the company opted in **and** `exception_reasons` is empty **and** not selected
  by the random-sample audit → set `admin_approved=True` with a system marker (`admin_approved_by_user_id`
  NULL, audit `time_log.auto_approved`).
- Respect `require_approved_clockins_for_payroll`: a company that mandates manual approval doesn't get
  silent auto-approval unless it explicitly enables both.
- One-click **"approve all clean this month"** reuses the bulk `approve_time_logs` endpoint filtered to
  clean ids (go-forward + backfill).

### 4.6 Frontend (Clock-in Review)

- Default view → **"Needs review"** (exceptions only). Segmented control:
  `Needs review (n) · Auto-approved (n) · All`.
- Render `exception_reasons` as chips (matches existing `AUTO-CLOSED` / `Late` chips).
- Collapse clean/auto-approved into a single expandable count row.

### 4.7 Phasing

- **P1:** classification + persisted columns + `needs_review` filter + frontend default-to-exceptions +
  random-sample audit (§4.3) + analytics loop (§4.4). *No auto-approval.*
- **P2:** `auto_approve_clean_clockins` flag + auto-approve-on-finalize + "approve all clean" button.

---

## 5. Testing (required — this is payroll)

- **Reconciliation:** queued clock-out supersedes an `auto_closed` session; **does NOT** mutate an
  `admin_approved` / finalized-period session (asserts dispute created instead). Extend
  `backend/tests/integration/test_payroll_scenarios.py`.
- **Timestamp clamp/skew:** future `end_time` clamped; large skew sets `time_skew` reason.
- **Idempotency:** replayed clock-out returns the original TimeLog, no duplicate.
- **Dead-letter:** 4xx exhausts attempts → dead-lettered; local optimistic state reverts.
- **Classifier:** each signal yields the right `exception_reasons`; clean stays clean; random-sample can
  still pull a clean row in.
- **Mobile:** `punchQueue` enqueue/drain/dead-letter, mirroring existing kiosk queue tests.

---

## 6. Observability & rollout

- **Metrics (PostHog):** sync-success rate, dead-letter rate, supersede rate, deferred-adjustment rate,
  per-job flag rate. Without these the queue can silently eat punches.
- **Feature-flag** the offline queue for staged rollout; auto-approve is already opt-in per company.
- **Idempotency key growth:** confirm/attach a purge for `idempotency_keys` (one row per punch).

---

## 7. Known pre-existing issue to flag (fix in lockstep, not "out of scope")

`create_daily_time_log` (`backend/api/v1/job.py:1004`) has **no `get_current_user` dependency** — the
clock-in POST is unauthenticated. Not caused by this plan, but it is a live authz hole that P2 (offline
clock-*in*) targets directly. Add `get_current_user` + tenant scoping in the same PR as the POST clock-out
endpoint (§3.1) — they touch the same surface.

---

## 8. Build order (value-for-effort)

1. **Review-by-exception P1** — biggest admin win, additive, lowest risk. Start here.
2. **Offline clock-out queue P1** — POST endpoint + reconciliation + guards #1–#3.
3. **Both P2s** — auto-approve opt-in; queued clock-in.

---

## 9. Self-assessment

Rated **9.5/10** after hardening the review: the finalized-period predicate is now concrete (§3.4), the
human-touch guard prevents overwriting admin edits (§3.3), `needs_review` has an exhaustive write-path
inventory + backfill (§4.2), random-sample audit is deterministic (§4.3), and `create_daily_time_log` is
moved into scope (§7). Remaining work is execution-time validation: privacy/consent framing for location
capture, and proving the supersede path against a real payroll-finalize run before enabling auto-approve.
