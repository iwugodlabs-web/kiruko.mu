# Concerns subsystem — incident-response runbook

Audience: on-call engineer + Kiruko Compliance lead.

This runbook covers anonymity-breach incidents, reporter-portal abuse
spikes, and the kill-switch procedure. For broader system context see
`backend/CONCERNS.md`; for the build history see
`~/.claude/plans/keen-hugging-wadler.md`.

If you are unsure whether something qualifies as an incident: **assume it
does, freeze the surface, then triage.** A false-positive freeze is a
2-hour inconvenience; a missed real breach damages Kiruko's positioning.

## Quick reference — three kill switches

| Env var | Effect | When to use |
|---|---|---|
| `KONTOKAZ_CONCERNS_KILL=true` | All `/portal/concerns/*` endpoints return 503. Handler-side endpoints keep working. | Reporter-portal abuse or anonymity breach via the public surface. |
| Deploy code revert | Rolls back UI changes. Schema stays forward-only. | Handler-side regression (drawer, audit viewer, etc.). |
| Disable cron entries | Stop SLA / retaliation / retention jobs. | Cron-only regressions; live serving unaffected. |

The `KONTOKAZ_CONCERNS_V2` env flag was scoped in the original plan but
never wired. Live rollback requires a code revert; documented in
`CONCERNS.md` §11.

---

## Triggers — what "an incident" looks like

1. **Anonymity breach**: an anonymous reporter's identity (name, email,
   employee_id, private_user_id) appears in any handler-side response, audit
   row, notification body, or log line. Even one occurrence is an incident.
2. **Portal abuse spike**: the warning `concern_portal: global lookup burst`
   or `concern_portal: global lockout burst` fires. Both are emitted from
   `services.concern_portal_security` with `extra={"alert": "..."}`.
3. **PIN brute-force success**: any `portal_lookup` audit row with
   `success=true` from an IP that recently triggered case lockouts.
4. **Mass case lookups**: ≥ 100 `portal_lookup` audit rows in 5 minutes,
   or ≥ 5 case lockouts in 1 hour (alerts above; backstop: query the audit
   log directly).
5. **Audit-log gaps**: a concern endpoint succeeds but no audit row appears
   within 60 seconds. Audit writes are best-effort; a sustained gap means
   the logger is broken.

---

## Step 1 — Freeze the surface (≤ 5 minutes)

Set `KONTOKAZ_CONCERNS_KILL=true` on the backend deployment and restart /
roll the backend pods. The kill-switch is checked at the top of every
`/portal/concerns/*` endpoint and returns `503 Service temporarily
unavailable` (uniform body, leaks no detail).

```bash
# Heroku-style
heroku config:set KONTOKAZ_CONCERNS_KILL=true -a kontokaz-backend
# k8s-style
kubectl set env deployment/backend KONTOKAZ_CONCERNS_KILL=true
kubectl rollout restart deployment/backend
```

**The kill switch only freezes the public reporter portal endpoints.** The
handler-side endpoints (`/disputes/...`) keep functioning so HR / Kiruko
can continue managing in-flight cases. If the breach is in the handler-side
surface, also set the broader feature flag off:

```bash
heroku config:set KONTOKAZ_CONCERNS_V2=false -a kontokaz-backend
```

Document the freeze time, the trigger, and who you paged in
`backend/incidents/<YYYY-MM-DD>-concerns-freeze.md` (create the directory if
it doesn't exist yet).

---

## Step 2 — Page Kiruko Compliance lead (≤ 15 minutes)

The compliance lead is the legal owner of any anonymity breach. Page via
the rota maintained outside this repo (currently in 1Password under
"Kiruko On-call"). Provide:

- Breach summary (one sentence)
- Time of detection
- Number of `right_id`s known to be affected
- Whether the surface is currently frozen
- Where the postmortem doc lives

---

## Step 3 — Forensics (≤ 1 hour)

The audit log is the source of truth. Query patterns:

```sql
-- All actions on a specific case
SELECT created_at, actor_kind, action, details, ip
FROM concern_audit_log
WHERE right_id = $1
ORDER BY created_at;

-- All portal lookups from one IP
SELECT created_at, right_id, action, details
FROM concern_audit_log
WHERE ip = $1 AND action IN ('portal_lookup', 'viewed', 'message_sent')
ORDER BY created_at DESC LIMIT 1000;

-- Cases where identity may have been visible to an unauthorised role
SELECT a.right_id, a.actor_user_id, a.actor_kind, ur.is_anonymous, ur.channel
FROM concern_audit_log a
JOIN user_rights ur ON ur.right_id = a.right_id
WHERE a.action = 'viewed'
  AND ur.is_anonymous = true
  AND a.actor_kind = 'employer'
  AND ur.channel = 'internal'
ORDER BY a.created_at DESC LIMIT 200;
```

The audit log is partitioned monthly (`concern_audit_log_YYYY_MM`); queries
that filter on `created_at` will use partition pruning.

---

## Step 4 — Reporter notification (≤ 24 hours)

Mauritius DPA breach-notification window is **72 hours**; we target 24
hours internally to leave room for legal review.

For each affected reporter:

- If the reporter is named (`is_anonymous=false`): notify via the contact
  channel they originally chose (push + email per
  `users.expo_push_token` / `users.email`).
- If the reporter is anonymous: post a notice to their case via the
  `concern_messages` table (author_kind=`system`). They will see it next
  time they log into the reporter portal. Do NOT push out-of-band — that
  could de-anonymise them.

Notification copy template (paste into a `concern_messages` insert or the
push notification body):

> A privacy issue may have affected a concern you filed with Kiruko. We
> are investigating and will follow up with details within 5 working days.
> If you have questions in the meantime, reply to this thread.

The follow-up message must be reviewed by Kiruko Compliance lead before
sending.

---

## Step 5 — Postmortem

Within 5 working days of the freeze:

1. Engineering writes the technical postmortem in
   `backend/incidents/<YYYY-MM-DD>-postmortem.md` covering:
   - Timeline (detection → freeze → notification → fix → unfreeze)
   - Root cause
   - Why existing tests / monitoring did not catch it
   - Code changes that landed
   - New tests / alerts added
2. Kiruko Compliance lead writes the legal postmortem in the same dir,
   covering: who was notified, when, what regulatory filings were made.
3. Both docs are reviewed in a no-blame postmortem meeting; action items
   are tracked in `MILESTONES.md` under a `Concerns: post-incident hardening`
   heading.

---

## Unfreeze procedure

Only after:
- Root cause is identified AND patched.
- A new automated test reproduces the breach pre-fix and passes post-fix.
- Kiruko Compliance lead has signed off in writing (Slack / email is fine).
- All affected reporters have been notified.

```bash
heroku config:unset KONTOKAZ_CONCERNS_KILL -a kontokaz-backend
heroku config:unset KONTOKAZ_CONCERNS_V2 -a kontokaz-backend  # if set above
```

Watch the audit log for 24 hours post-unfreeze. Re-freeze immediately if
the same pattern reappears.

---

## Tabletop exercise

This runbook MUST be exercised before M3 ships (per the M3 GO/NO-GO).
Simulate a "named admin appears in anonymous case response" breach in
staging:

1. File an anonymous concern from the mobile app against a staging tenant.
2. Have a colleague intentionally bypass the masking (e.g. by querying
   the legacy `/user/user-rights` endpoint directly from a logged-in admin
   session — that endpoint still exists for backwards compat).
3. Verify Sentry/Slack alert fires within 60 seconds of the bypass.
4. Walk through Steps 1-5 above with stopwatches; capture each handoff
   time in the postmortem template; identify the slowest step and
   automate it before M3.

---

## Open follow-ups (not yet wired)

- Sentry SDK is not yet initialised in this backend. The portal-security
  service uses `logger.warning(..., extra={"alert": "..."})` calls; ops
  needs to pipe these to Slack/Sentry. Do not ship M2 without this.
- The "audit-log gap" alert (Trigger #5) needs a passive watchdog that
  compares endpoint-call counts (from the access log) with audit-row
  counts. Spec'd for PR 4.
- The reporter-notification template above is English-only. M3 ships the
  five-locale version.
