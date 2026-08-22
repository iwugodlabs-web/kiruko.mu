# Notifications — proper end-to-end fix (rev 4, verified)

Rev 4 folds in three verification spikes (backend internals, web consumers, mobile consumers). Every "no client change" claim is now **verified against the actual code**, and the column-drop migration has a **complete, bounded** reference list. Phases 0–2 are confirmed backend-only and API-shape-preserving for **both web and mobile**.

## Concern → resolution (all addressed)

| # | Concern | Proper fix | Phase | Confidence |
|---|---|---|---|---|
| 1 | Whistleblower exposure widening | Concern/compliance stays narrow (owner / existing routing); never fanned. | 2 | 100% |
| 2 | Sync Expo push blocks the request | Durable async push outbox + worker (mirrors `email_queue`). | 1 | 100% |
| 3 | N× duplicated rows (single-recipient model) | Normalize: event row + `notification_recipients` join, per-user read-state. | 1 | 100% |
| 4 | Notification fatigue / no preferences | Per-user per-category in-app/push prefs, enforced at delivery; web + mobile UI. | 3 | 95% |
| 5 | `leave → view_employee` proxy | Dedicated `view_leave`/`approve_leave`, seeded + backfilled. | 0 | 98% |
| 6 | Legacy+modern role union debt | Eliminated (concern_* untouched). | — | 100% |
| 7 | No tests | Coverage per phase. | all | 100% |

## Verification results (spikes done)

**Backend (safe to refactor):**
- **All 26 `create_notification` call sites ignore the return value** — changing what it returns breaks nothing.
- **Complete `Notification.user_id` / `is_read` reference set** (everything that must move before the columns drop): `api/v1/notification.py` lines 25, 48, 64, 70, 101, 102, 123, 147; `api/v1/company.py` 714–722, 727, 741, 745, 749; `services/time_log_service.py:449` (clock-out reminder dedup); `api/v1/user.py:735` (account-deletion delete); tests `test_account_deletion.py`, `test_missed_clockout_resolution.py`. Nothing else references them.
- **Endpoints to preserve:** `GET /notification` (returns `List[Notification]`), `GET /{company_id}/notifications` (`{total, unread, data[]}`), `PUT /notification/{id}/read`, `PUT /notification/read-all`, **`DELETE /notification/{id}`**, **`DELETE /notification`** (dismiss — used by mobile), `POST /user/register-push-token`.

**Web depends on:** `notification_id, type, is_read, title, message, created_at` (critical); `user_id, notification_type, meta, related_entity_id` declared-but-unused. Shapes: array for `/notification`; `{total, unread, data[]}` for company. → fully preservable.

**Mobile depends on:** same fields **plus `meta.timelog_id`** (company screen renders Confirm/Reject overtime buttons from it) and the two `DELETE` dismiss endpoints. Push payload uses `data.type` for routing (`data.notification_id`/`notification_type` sent, not yet read). Settings live in `private_dashboard/settings.tsx` (Preferences section) and `company_dashboard/settings.tsx`; a prefs screen mirrors `ad_preferences.tsx`. → fully preservable; `meta` stays on the event row so the overtime buttons keep working.

**Net:** preserve the field set (resolve `user_id`/`is_read` from the caller's recipient row) and keep all six endpoints → **zero web and zero mobile changes for Phases 0–2.**

Design invariant: recipient changes are **pure supersets** (owner always retained); read responses keep the **identical field set** per item.

---

## Phase 0 — Dedicated leave permission (98%)
- [ ] Add `"Leave": ["view_leave", "approve_leave"]` to `PERMISSION_GROUPS` → auto-flows into seeded Owner (all) + Company Admin (all-but-`delete_role`).
- [ ] Idempotent backfill (only-if-missing) adding both perms to existing companies' **system** Owner + Company Admin `CompanyRole.permissions`. (Additive config edit — not legal-rule data, so the append-only rule doesn't apply; safe even on customized roles.)
- [ ] Gate the leave-approval endpoint on `approve_leave`; map `leave_request` notification → `view_leave`.
- [ ] Tests: perms in seed; backfill idempotent; approval denied without `approve_leave`.

## Phase 1 — Normalized model + async push outbox (100%)
**1a. Normalize (#3)** — uses the verified reference list, so the column drop is exhaustive.
- [ ] `notification_recipients(id, notification_id FK ON DELETE CASCADE, user_id FK ON DELETE CASCADE, is_read, read_at, created_at)`, unique `(notification_id, user_id)`, index `(user_id, is_read)`.
- [ ] `notifications` becomes the event row (`notification_id, title, message, type, meta, created_at`, + nullable `company_id`); `user_id`/`is_read` retained until 1d.
- [ ] Data migration: one recipient row per existing notification (carry `user_id`/`is_read`).
- [ ] `create_notification(db, user_id, …)` keeps its signature → 1 event + 1 recipient (back-compat for all 26 sites, none read the return). Add `create_notification_fanout(db, user_ids, …)`.
- [ ] Rewrite the verified reference sites to the join, preserving response field sets (resolve `user_id`/`is_read` from the **caller's** recipient row):
  - `GET /notification` (notification.py:25) → caller's recipient rows ⨝ events; same `Notification` schema out.
  - `GET /{company_id}/notifications` (company.py:714–749) → caller's own recipient rows; same `{total, unread, data[]}` incl. `user_id`/`is_read`.
  - mark-one / mark-all / **dismiss-one / dismiss-all** (notification.py:48,64,70,101,102,123,147) → operate on the caller's `notification_recipients` rows. (Per-user read-state means the old "admin marks a linked user's read" at :64 collapses to "your own" — intended.)
  - `services/time_log_service.py:449` clock-out dedup → join on recipient `user_id`.
  - `api/v1/user.py:735` account deletion → recipient rows cascade via FK; orphan events swept by Phase 4 retention.
- [ ] Update the two tests that construct/query `Notification.user_id`.
- [ ] **1d.** After reads/writes use the join, drop `notifications.user_id` + `is_read` (second migration).

**1b. Async push outbox (#2)**
- [ ] `PushJob` + `push_jobs` table mirroring `email_jobs`; `services/push_queue.py` mirroring `email_queue` (`enqueue_push`, `process_due_jobs` w/ `FOR UPDATE SKIP LOCKED` + backoff, `start_worker`). Wire `start_worker()` beside email's in `main.py`.
- [ ] `create_notification*` enqueues push per recipient instead of inline `send_expo_push`. Request thread never calls Expo.

## Phase 2 — Fan-out the three non-sensitive types (100%, #1 narrow)
- [ ] `_members_with_permission(db, company_id, permission)` (owner always; modern `company_user_roles` × `CompanyRole.permissions`; fail-closed to `[owner]`).
- [ ] `notify_employer_overtime`→`view_overtime` (keep single employer email); `notify_employer_leave_request`→`view_leave`; `time_log_auto_closed`→`view_attendance` — all via `create_notification_fanout`.
- [ ] Untouched/narrow: `user_right_report`, `concern_aging`, `concern_unack`.
- [ ] Tests: owner always; permissioned manager gets in-app + queued push + bell badge; no-perm HR Manager gets nothing; whistleblower still owner-only; no duplicates.

## Phase 3 — Notification preferences (95%, the only client-facing phase)
- [ ] `notification_preferences(id, user_id, category, in_app bool=true, push bool=true)`; categories from the web `tabForType` map {leave, overtime, attendance, compliance, disputes, general}.
- [ ] Enforce at delivery: skip push if `push=false`, skip the recipient row if `in_app=false`; unset = both on.
- [ ] `GET/PUT /user/notification-preferences`.
- [ ] **Web:** a Settings panel. **Mobile:** `private_dashboard/notification_preferences.tsx` + `company_dashboard/notification_preferences.tsx`, modeled on `ad_preferences.tsx` (server source of truth + AsyncStorage fallback, `useFocusEffect` resync); add a row to each settings list's Preferences section.
- [ ] Tests: muted category suppresses push/in-app; default-on when unset.

## Phase 4 — Hygiene (95%)
- [ ] Retention job: delete read recipient rows + orphaned events older than ~90 days. Indexes per 1a.

---

## Quality (verified)
Phases **0–2** are now **~100%**: the return-value audit (26/26 ignore), the **complete** column-reference list, and the **verified** web + mobile field/endpoint contracts remove the guesswork — the refactor is backend-only with zero client change, and recipients are pure supersets. Residual = mechanical care on three additive/idempotent migrations (recipient backfill, column drop, perm backfill). **Phase 3** is **~95%** — now concretely specced against the real settings screens and the `ad_preferences` pattern; remaining risk is ordinary feature execution + i18n strings, and it's the only phase touching client code. **Phase 4** standard. Recommended order: **0 → 1 → 2** (delivers the fan-out properly on a clean model, no client work), then **3 → 4**.
