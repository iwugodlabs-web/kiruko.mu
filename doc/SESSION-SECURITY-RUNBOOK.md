# Session Security — Activation Runbook

How to turn on the two session-hardening features:

1. **Session device/IP binding** (stolen-token detection) — `SESSION_ANOMALY_MODE`
2. **Login brute-force lockout** (per-identifier) — always-on once deployed

Both are already built, tested, and merged into this branch. This doc is the
deliberate, reversible "turn it on" step — **nothing changes behavior until you
flip the env var**.

---

## What the feature does

### 1. Session binding + anomaly check (`SESSION_ANOMALY_MODE`)

At login (and on token refresh), the access token is stamped with two claims:

| Claim     | Source                                      | Meaning                              |
|-----------|---------------------------------------------|--------------------------------------|
| `sess_dev` | `X-Device-Id` header (mobile sends this on **every** request) | device identity |
| `sess_ip` | `X-Forwarded-For` first hop, else socket peer | source IP |

On every authenticated request, `get_current_user` (in both
`core/dependencies.py` and `auth/dependencies.py`) recomputes the current
device + IP and compares them to the token's claims.

| Mode | Claims minted? | Device mismatch | IP-only change |
|------|----------------|-----------------|----------------|
| `off` (default) | no | — (no check) | — (no check) |
| `audit` | yes | `AuditLog(action='session.anomaly')` + `logger.warning` — **request allowed** | audit only |
| `block` | yes | **HTTP 401** + audit | audit only (mobile IPs roam — never blocks) |

Device mismatch = the token is being used by a different device than the one
that logged in (the strongest stolen-token signal). IP-only changes are
audited but never blocked because mobile clients legitimately roam across
Wi-Fi/cellular.

**Web caveat:** web clients send no `X-Device-Id`, so their tokens carry only
`sess_ip` and never hit the device-mismatch block path.

### 2. Login brute-force lockout (per-identifier)

`services/login_security.py` tracks failed password attempts **per identifier**
(email/phone, case-normalized). This closes the gap left by the existing per-IP
slowapi limit (`10/minute` on `POST /user/login`) — a distributed attacker using
many IPs against one account.

- **10 failed attempts in 15 min → lockout for 15 min** (HTTP 429)
- A successful password login resets the counter
- Applies to `/user/login` (password path) only; OTP login is unaffected

This feature has **no env flag** — it is active as soon as this code is
deployed.

---

## Activation steps

### Step 0 — Deploy the code (behavior unchanged)

Default mode is `off`: no claims are minted, no checks run. Safe to ship
alongside anything else.

```bash
# verify the new tests pass
cd backend && .venv/bin/python -m pytest tests/test_login_security.py tests/test_session_security.py -q
```

### Step 1 — Observe (`SESSION_ANOMALY_MODE=audit`)

```bash
# backend/.env
SESSION_ANOMALY_MODE=audit
```

Redeploy/restart. Now every token is bound, and mismatches are recorded without
blocking anyone. Watch for a week (or your chosen soak period):

- **Audit trail** — look for rows where `action = 'session.anomaly'`:
  ```sql
  SELECT actor_user_id, meta->>'device_changed' AS dev, meta->>'ip_changed' AS ip,
         meta->>'expected_device' AS from_dev, meta->>'current_device' AS to_dev,
         meta->>'expected_ip' AS from_ip, meta->>'current_ip' AS to_ip, created_at
  FROM audit_logs
  WHERE action = 'session.anomaly'
  ORDER BY created_at DESC;
  ```
- **Logs** — structured warning `session.anomaly` (with `alert: session.anomaly`)
  and `login.account_lockout` (when the lockout fires).

If the volume of `ip_changed=true` rows is high, it's just mobile roaming
(noise, not a breach). `device_changed=true` rows are the signal that matters.

### Step 2 — Enforce (`SESSION_ANOMALY_MODE=block`)

```bash
# backend/.env
SESSION_ANOMALY_MODE=block
```

Redeploy/restart. Now a token replayed from a different device is rejected with
HTTP 401 and the client is forced to re-login. IP-only changes remain audit-only.

---

## Verification

Manual end-to-end check:

1. Log in from device A (mobile sends `X-Device-Id`).
2. Replay the returned `access_token` from a different device id
   (`curl -H "X-Device-Id: OTHER" -H "Authorization: Bearer <token>" ...`) →
   in `block` mode you get `401 "Session is no longer valid on this device..."`.
3. Same token, same device, different source IP → request succeeds, audit row
   written with `ip_changed=true`.

Automated coverage lives in `tests/test_login_security.py` and
`tests/test_session_security.py` (15 unit tests; pure logic, no DB needed).

---

## Rollback

- **Anomaly check:** set `SESSION_ANOMALY_MODE=off` (or unset) and restart.
  Behavior returns to exactly as before; already-issued tokens simply carry
  claims nobody checks.
- **Login lockout:** remove/revert the `services/login_security.py` wiring in
  `services/user_service.py` (no env kill-switch by design — it's low-risk and
  silent). If you ever need it disabled in a hot incident, that revert + redeploy
  is the path.

---

## Operational caveats

- **In-memory lockout state** (`services/login_security.py`) is correct for a
  single-process deployment but **does not survive restarts and does not
  coordinate across uvicorn workers**. When you horizontally scale, swap the
  backing store to Redis (function signatures are written for a drop-in swap) —
  same caveat as `services/concern_portal_security.py`.
- **Audit volume:** in `audit`/`block` mode, each mismatched request writes one
  `session.anomaly` row. Roaming mobile clients can generate a few rows a day
  per user; a stolen-and-replayed token generates one per request. Treat bursts
  as an alert, not individual rows.
- **Refreshed tokens** re-derive `sess_dev`/`sess_ip` from the refresh request,
  so a legitimate device refresh keeps its binding; a cross-device refresh
  upgrades the anomaly signal.

---

## Files touched

| File | Change |
|------|--------|
| `backend/core/session_security.py` | **new** — mode, IP/device extraction, binding claims, `check_session_anomaly` |
| `backend/services/login_security.py` | **new** — per-identifier failure window + lockout |
| `backend/services/user_service.py` | `login_user` signature + lockout wiring + binding claims |
| `backend/api/v1/user.py` | `/user/login` + `/refresh-token` pass device/IP, mint claims |
| `backend/core/dependencies.py` | `get_current_user` runs `check_session_anomaly` |
| `backend/auth/dependencies.py` | `get_current_user` runs `check_session_anomaly` |
| `backend/tests/test_login_security.py` | **new** — lockout unit tests |
| `backend/tests/test_session_security.py` | **new** — binding/anomaly unit tests |
