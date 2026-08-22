# Concerns — customer onboarding guide

For new customers turning on the Concerns subsystem and rolling it out
internally. Distinct from `CHANGELOG_CONCERNS_V2.md` (the announcement) —
this is the **practical playbook** for HR / Owner roles.

If you are filing a concern as an employee, you don't need this doc.
Open the app, tap "Raise a Concern" in Settings, follow the prompts.

---

## Day 0 — Enabling the feature

There is no toggle. The Concerns tab appears automatically the next time
your company admins sign in to the web dashboard. Nothing breaks for
your employees if you don't actively roll it out — the mobile flow is
also live for them already.

What you should still do on day 0:

1. **Audit your company admin list** (`Dashboard → Settings → Company
   Users`). Anyone with `Admin`, `Owner`, or `Manager` role is treated as
   a company admin for the conflict-of-interest gate. Make sure that
   list reflects the people you actually want handling grievances. If
   an admin is named in a concern, they will be locked out of that case
   automatically (the case auto-routes to Kiruko Compliance).
2. **Identify a primary concerns handler.** It does not have to be one
   person — any company admin can handle any case — but practice has
   shown that designating a primary handler reduces "diffusion of
   responsibility" delays.
3. **Decide your internal escalation policy** (see Day 7 below). Don't
   draft this for the first time when a case lands.

## Day 1-7 — Train your team

We provide three things to support training:

- **`CHANGELOG_CONCERNS_V2.md`** — short customer-facing announcement.
  Forward it internally; it's written for HR / Owner audience.
- **In-app history view** — employees can already see a "View thread"
  button on every concern they've filed; no training needed.
- **A 5-min walkthrough video** from Kiruko (link distributed via
  customer-success contact). Show it in your next all-hands or share
  with HR.

What employees need to know:

1. **How to file** — same flow as before; tab from Settings.
2. **The PIN.** New: every concern they file produces a one-time PIN
   shown on a dedicated screen. Tell them to save it — it lets them
   return to the case from any device via `/concerns/track` on the web.
3. **Anonymity** — they can file anonymously to you (you'll see
   "Anonymous" + a shield icon), but **Kiruko still sees their name**.
   The in-app disclosure under the anonymity checkbox spells this out;
   reinforce it in training so they make informed choices.
4. **Conflict of interest** — they can name people involved in the
   report. If they name a company admin, the case is automatically
   routed to Kiruko instead of you. Don't fight this — it's by design
   and is the system's biggest legal-defence feature.

## Week 1+ — Workflow basics

When a concern lands you'll receive a push notification + in-app
notification. Open `Dashboard → Leave → Concerns`. The case appears in
the table.

### The drawer
Click any row to open the slide-out drawer. You see:

- **Filed by** — employee name + avatar, or shield + "Identity protected"
  if anonymous.
- **Substance** — title, category, urgency, full description, expected
  outcome, occurrence details, attachment.
- **Timeline** — when it was filed, last updated, days open, acknowledged.
- **Admin actions** — status dropdown (8 states), append-only internal
  notes, resolution textarea, Save button.
- **Conversation** — message thread visible to the employee (anonymously
  if they filed without identity).

### The 8-state workflow

```
received → triaged → investigating → action_taken → resolved → closed
```

Plus `rejected` (you decide there's nothing to investigate, e.g.
duplicate, frivolous, out of scope) and `appealed` (the employee can
move a `resolved` or `rejected` case back into your queue if they
disagree — only THEY can; you cannot appeal on their behalf).

Recommended cadence:

- **received → triaged within 5 working days.** EU directive expects
  acknowledgement within 7 working days; we nag you at day 5. The
  `acknowledged_at` timestamp fires automatically on your first
  transition out of `received`.
- **triaged → investigating** within another 5 working days if you've
  decided to take action; **triaged → rejected** if you've decided not
  to (with a written reason — visible to the reporter).
- **investigating → action_taken** when you've done what you're going to
  do (talked to people, changed the policy, etc.).
- **action_taken → resolved** when you've documented the resolution.
- **resolved → closed** when you're ready to lock the case as a legal
  record. After this, only `internal_notes` can be appended; status and
  resolution are immutable.

Skipping states returns an error. We block this on purpose — every
transition is part of the legal record and skipping creates audit holes.

### Internal notes
Are timestamped + tied to your account. Each new entry is appended;
nothing is overwritten. Use them for case-management commentary the
reporter shouldn't see (e.g. "spoke with manager X off the record on
2026-06-12; they admit the issue but won't put it in writing").

### Resolution
Is visible to the reporter via the portal thread. Write it in plain
language. Avoid naming individual employees you've spoken to —
reference roles instead ("the line manager" rather than "Jane Doe").

### Conversation
Type and Send. The reporter gets a push and sees your reply attributed
to "Your employer" in their portal thread — they never see your
individual identity.

## What to do when ...

### ...an anonymous case lands and you can't ask follow-up questions
Use the conversation thread. You don't need their name to ask "what
date?" or "who else was present?". A determined investigator can run a
substantial inquiry without ever attempting to identify the reporter.

### ...you suspect the reporter is making it up
Resolve as `rejected` with a written reason. Don't engage in a
fact-finding mission to identify them — that's outside scope and the
DPA. If the volume of frivolous filings becomes a real problem, raise
it with Kiruko customer success; they may be able to add per-company
filing rate limits in a follow-up.

### ...a complaint names you personally
You will not see it. The case auto-routes to Kiruko Compliance. They
will reach out via the contact channel you registered if they need
information from you. This is a feature, not a bug — your inability to
self-handle is what makes the system credible.

### ...the reporter goes silent after you reply
Wait. Push notifications are best-effort and they may simply not be
checking. The 30/60/90-day retaliation surveys will fire automatically.
You can resolve and close the case without further contact if you've
done what you can; the legal record stands.

### ...you make a mistake and need to "un-close" a case
You can't. Closed is terminal. Two options: (a) wait for the reporter
to file an appeal, which reopens the case to `investigating`; (b) file
a new concern internally that references the closed case in
`internal_notes`. Closed rows are legal records — we don't let anyone
mutate them.

### ...the employee asks for their case to be deleted ("right to be forgotten")
Mauritius DPA Art. 39 right to erasure is real but **the legal-record
exception applies here.** Kiruko Compliance handles erasure requests
case-by-case; route to your customer-success contact and they'll
escalate. Do NOT delete records from the database directly — there is
no DELETE endpoint exposed to your role for exactly this reason.

### ...an anonymity breach is discovered
Stop. Don't try to fix it yourself. Page Kiruko Compliance via your
customer-success contact. The incident runbook
(`backend/CONCERNS_INCIDENTS.md`) covers the next steps: freeze the
portal, identify affected reporters, notify within 24h.

## Reading the audit log

You don't have access to it. Kiruko Compliance does, and they will
share excerpts with your legal team on request. The audit log records
**every** action on **every** case — including reads. If your inside
counsel asks "did anyone view this case before action X happened?",
Kiruko can answer.

## Retention

By default a closed concern is retained 7 years after closure, then
auto-archived. The cron job is in `--dry-run` mode at launch and will
not begin actually deleting until the first 7-year expiry approaches
(years out from your go-live). When auto-delete activates, every
deletion writes a separate audit row and a retention-audit file is
appended.

If your jurisdiction or contract requires a different retention window,
flag it during onboarding — there's a per-company override in design
but not yet shipped.

## When to contact Kiruko directly (not through us)

You can't, by design. Kiruko Compliance is a third party deliberately
held at arm's length. Communication with them about any specific case
happens **inside the system** via the conversation thread on that case.
This is what makes Kiruko independent.

Exception: anonymity incidents (see above).

## Day 30 — Health check

After your first month:

- **Look at your "Concerns" tab.** Are cases moving through the workflow?
  If everything is stuck in `received` your team needs to actually triage.
- **Look at your support tickets.** Are employees confused about the PIN?
  About anonymity? About where their reports go? Tell us — we can refine
  the in-app copy.
- **Open the audit log via Kiruko** if you're curious. Even a quick
  glance can tell you whether the system is being used at all.

---

_Document version 1.0 — published at M8 handoff. Next revision after the
first wave of customers' day-30 feedback._
