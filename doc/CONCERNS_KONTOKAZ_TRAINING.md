# Kiruko Compliance — Concerns v2 training outline

**Audience:** Kiruko in-house lawyers handling external workplace concerns.
**Format:** ~45 min live session + recorded walkthrough + this document as
reference. Run with the dashboard open at `/admin/compliance`.

This is the rolled-up cheat sheet — not a complete legal playbook. For the
broader plan + architecture, see
`/Users/iwugod/.claude/plans/keen-hugging-wadler.md`.

---

## 1. What changed (5 min)

Before Concerns v2 the compliance dashboard was **read-only** — you could
see external concerns and the SLA queue, but resolving them required
out-of-band action (email / phone). Audit trails were thin.

Now:
- You can **drive cases through the full workflow** inside the dashboard.
- You can **reply to reporters** (named or anonymous) via the thread.
- A new **Triage queue** holds cases auto-escalated from employers due to
  conflict-of-interest — your team accepts or dismisses each one.
- Every action is **audit-logged with timestamp + your user_id + IP**.
  Treat it the same way you treat your case files.

---

## 2. The workflow (10 min)

States and legal transitions:

```
received → triaged → investigating → action_taken → resolved → closed
                                                          ↘ appealed → investigating
            ↘ rejected → closed
                       ↘ appealed → investigating
```

Rules:
- A reporter is the only actor who can drive `resolved → appealed` or
  `rejected → appealed`. You'll see appeals come back into your queue.
- `closed` is terminal — you cannot transition out.
- Once a case is closed (`closed_at` populated), the resolution and status
  are locked. You can still append internal notes; that's how
  post-resolution context is captured.
- Skipping states is rejected with HTTP 409. There is no `received → closed`
  shortcut, by design.

Each transition fires a notification to the reporter and writes a row in
`concern_audit_log`. Be precise about your status changes; they are part of
the legal record.

---

## 3. Walking through a real case (15 min)

Open `/admin/compliance` with a staging tenant in front of you.

### a. Active queue
- Default filter is `channel=external`. The table lists every external
  concern (including auto-escalated ones).
- Click a row to open the drawer.
- Substance section is always populated. Identity (employee name +
  company) is visible to you regardless of `is_anonymous` — that is the
  whole point of the external channel. Use the same discretion you'd use
  in a clinical record: never include identifying information in a
  resolution you'd be comfortable showing the employer.

### b. Admin actions
- **Status:** pick the next legal state from the dropdown. If you select a
  state that's not legal from the current state, the save will return 409.
- **Resolution:** what was done. Visible to the reporter via the portal.
  Plain language, no jargon. Avoid naming the employer's admins.
- **Internal notes:** append-only legal-record commentary. Every entry is
  prefixed with the current timestamp and your account. Notes are never
  shown to the reporter.
- **Save changes** runs a single PATCH. A toast confirms; the drawer
  reflects the new state.

### c. Replying to the reporter
- Thread component sits below the admin actions.
- Type a reply in the composer + Send.
- Reporter receives a push notification. If they filed anonymously they
  see your reply attributed to "Kiruko Compliance" in their portal
  thread — they cannot derive your identity from it.
- **Important:** never copy an employer-side internal note into the
  reporter thread. The compose box is a clean separation.

### d. Closing the case
1. Move status through the legal path (`received → triaged → investigating
   → action_taken → resolved`).
2. Write the resolution.
3. Move status to `closed`. This locks status + resolution; `closed_at`
   and `closed_by` are stamped automatically with your account.
4. A 30-day retaliation survey will fire automatically; if the reporter
   reports retaliation, the case may be reopened via appeal.

---

## 4. The Triage queue (10 min)

When an employee files a concern that names a company admin (e.g. "my
manager"), the system auto-escalates it to Kiruko so the named admin
cannot see the case against themselves.

- Switch to the **"Triage" tab** in the dashboard.
- Each row is a fresh auto-escalation waiting for your call.
- Open the drawer; the **amber triage banner** at top shows the escalation
  reason (which user_ids triggered the routing).

### When to accept
The named party really is involved, the report is substantive, the
employer cannot fairly handle it. Click **Accept into queue** — the case
moves out of triage into your active queue, your team handles it
end-to-end. `acknowledged_at` is stamped; the triage window closes.

### When to dismiss
The naming was frivolous (e.g. employee named every admin to force-route a
payroll question to lawyers). Provide a **dismissal reason** (required) —
this becomes part of the audit log. Click **Dismiss to employer** —
`named_parties` is cleared, channel flips back to internal, employer's
admins now see the case in their Concerns tab. The reporter is notified of
the reroute.

### Edge cases
- If you're unsure: accept. You can dismiss-during-investigation by
  resolving as `rejected` with a written reason. The dismissal path is
  for clearly frivolous cases caught at the door.
- A dismissed case can re-enter triage if the reporter files a NEW concern
  naming an admin. Dismissal is per-case, not a permanent block.

---

## 5. Anonymity handling (5 min)

- **You see identities, employers don't.** Trust this; the masking is
  enforced server-side. You don't need to play the masking game yourself.
- **Don't echo identities into reporter-facing fields.** The "resolution"
  textarea is visible to the reporter via the portal. If you must
  reference a manager by name, do so in the internal-notes section
  instead.
- **Don't request identity from anonymous reporters via the thread.** It
  defeats the point of anonymity and may violate the Mauritius DPA.
  Ask the same factual questions you'd ask without identity (dates,
  locations, witness counts) and write your analysis around what you
  receive.
- The reporter portal has a PIN-based access path that does NOT require
  the reporter to log in. Do not assume a reporter is "logged in" — many
  arrive via the portal anonymously.

---

## 6. Incidents (5 min)

The full runbook is in `backend/CONCERNS_INCIDENTS.md`. The Kiruko
Compliance lead is the legal owner of any anonymity-breach incident; you
will be paged via the rota in 1Password.

**Tabletop exercise** is mandatory before the M3 launch sign-off. Walk
through Steps 1-5 of the runbook with stopwatches; the engineering team
will run the simulated breach.

---

## 7. Frequently-asked questions

> Can I un-close a case?

No, not via the dashboard. `closed` is terminal. The reporter can file an
appeal (`resolved → appealed` or `rejected → appealed`), which moves the
case back into `investigating`. If you need to act on a closed case
outside the appeal path, file a NEW linked case rather than mutating the
closed one — the closed row is a legal record.

> What if the reporter goes silent?

Status changes you drive are independent of reporter replies. You can
resolve and close a case without further contact. The 30/60/90-day
retaliation surveys will still fire.

> Can I export a case to PDF?

Not yet. The audit-log viewer in M7 will support CSV export. PDF export
is on the deferred list (after M7).

> Why does the compliance role bypass the conflict-of-interest gate?

Because Kiruko is the conflict-of-interest gate. The gate routes cases
AWAY from employers who would be self-judging; it routes them TO you
because you are the impartial third party.

---

_Document version 1.0 — supports the M5 rollout. Next revision after M7
ships (audit-log viewer + attachment hygiene)._
