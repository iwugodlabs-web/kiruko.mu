# Concerns v2 — release notes

**Status:** rolling out to all Kiruko customers · _Audience:_ HR / Owner roles + employees · _Internal_

The "Raise a Concern" feature (formerly "Your Rights") is now a complete
workplace-grievance + whistleblower platform. This document is the
customer-facing summary; engineering details live in
`/Users/iwugod/.claude/plans/keen-hugging-wadler.md`.

---

## What's new

### For employees (mobile app)
- **One-time PIN at submission.** Every concern now issues a case ID + PIN.
  Save it before leaving the screen — it lets you return to the case from
  any device (including the web) via the public reporter portal at
  `/concerns/track`.
- **In-app message thread.** A new "View thread" button on every concern in
  your history opens a chat with your handler. Replies show up via push and
  appear without a refresh while you're on the screen.
- **Clear routing labels.** Each concern in history now shows whether it
  went to your employer ("Sent to your employer") or to Kiruko's
  independent compliance team ("Sent to Kiruko Compliance"). An
  "Auto-escalated to Kiruko" badge appears when the system reroutes a
  report due to conflict of interest.
- **Anonymity is enforced server-side.** When you file anonymously, your
  name, email, and employee ID are stripped from every employer-facing
  surface — even if someone bypasses the UI. Kiruko lawyers still see
  your identity (they need it to follow up); your employer does not.

### For company HR / Owners (web dashboard)
- **The "Concerns" tab is now available to you** without a platform admin.
  Find it at Dashboard → Leave → Concerns.
- **Richer case view.** New drawer-style detail panel with full substance
  (description, expected outcome, occurrence details, attachment) for every
  concern, plus an editable status workflow with eight states
  (received → triaged → investigating → action_taken → resolved → closed,
  with appeal and rejection paths).
- **Append-only internal notes.** Every note you add is timestamped + tied
  to your account. Notes on a closed case stay editable; status and
  resolution lock.
- **Reporter messaging.** Reply directly to the employee through the case
  drawer. If they filed anonymously, your reply appears in their portal
  thread without ever revealing their identity to you.
- **Conflict-of-interest gating.** When an employee files a concern that
  names you (or any company admin) as a party, the case is automatically
  rerouted to Kiruko Compliance. You will never see complaints filed
  against you, and the employee is not relying on you to handle them.

### For Kiruko Compliance (internal)
- **The compliance dashboard is now actionable.** The "External reports are
  read-only here" banner is gone — Kiruko can drive cases through the
  full state machine, post replies, write resolutions, and close cases
  inside the system. Every action is audit-logged.
- **New Triage queue** (`/admin/compliance` → "Triage" tab) for cases
  auto-escalated from employers due to conflict of interest. Dismiss-back-
  to-employer (with reason) or accept-into-queue from the drawer.

---

## What stayed the same

- Mobile filing flow is unchanged from the employee's point of view —
  same form, same steps, same locales. Anonymity and external-routing
  toggles work exactly as before.
- Existing concerns filed before this release continue to work; their
  legacy statuses (`pending`, `in_progress`, `resolved`, `rejected`) were
  migrated to the new workflow during the schema upgrade.
- Email / push notifications fire on the same events as before, plus a
  new event when the reporter posts a portal message.

---

## What's coming next

Items already designed and on the roadmap for the next few weeks:

- **SLA digests.** Daily 09:00 email to company admins listing concerns
  past 5 working days without acknowledgement.
- **30 / 60 / 90-day retaliation check-ins.** Anonymous survey to reporters
  after a case is resolved.
- **7-year retention with auto-purge.** Resolved/rejected cases automatically
  archive then purge after 7 years (default; configurable per company).
- **Attachment scanning.** ClamAV + MIME allow-list on every upload.
- **Audit-log viewer** in the compliance dashboard with CSV export for legal
  defensibility.

These ship as part of milestones M6 and M7 of the broader plan and do not
require any action from you.

---

## Action items for your team

1. **No code change required on your side** if you're a company HR / Owner —
   the new "Concerns" tab appears automatically next time you sign in.
2. **Tell your employees** that:
   - Their old concern history is intact; nothing is lost.
   - They will now receive a one-time PIN when filing a new concern — they
     should save it.
   - They can chat with their handler inside the app.
3. **If you currently handle complaints out-of-band** (email / phone /
   spreadsheets), please switch to the in-app workflow. Out-of-band edits
   are not auditable and do not contribute to the legal-defence record.

---

## Where to get help

- **Customer support:** standard Kiruko support channels.
- **Anonymity / privacy incidents:** see `backend/CONCERNS_INCIDENTS.md` for
  the on-call runbook. Customer-facing escalation goes through Kiruko
  Compliance directly.
- **Feedback on this release:** reply to your Kiruko customer-success
  contact. We're tracking sustained support-ticket volume vs. the legacy
  baseline as a release-health signal.

---

_Document version 1.0 — published with the M5 rollout._
