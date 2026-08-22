# WhatsApp OTP Login — Testing Guide

End-to-end test plan for the phone-or-email login + WhatsApp OTP flow shipped in tasks #59–#64.

Two phases:

- **[Phase 1](#phase-1--dev-test-with-console-provider-5-min-no-meta)** — works today, no Meta setup. Codes go to backend stdout.
- **[Phase 2](#phase-2--real-whatsapp-delivery-meta-setup-required)** — real WhatsApp delivery. Needs Meta business verification + an approved template (~24h–several days).

Also covered:

- **[Phase 2.5](#phase-25--twilio-sms-fallback-skip-unless-meta-is-blocked)** — Twilio fallback if Meta drags
- **[Quick curl health-check](#quick-health-check-command)** — endpoint smoke without any UI

---

## Phase 1 — Dev test with console provider (5 min, no Meta)

The default `OTP_PROVIDER=console` logs codes to backend stdout instead of sending them anywhere. Perfect for end-to-end testing the full flow before any Meta setup.

### Setup (one-time)

```bash
# 1. Apply the new migrations (creates trusted_devices + reuses verification_tokens)
cd backend && alembic upgrade head

# 2. Ensure a test user has a phone number set
psql $DATABASE_URL -c "SELECT user_id, email, phone FROM users WHERE phone IS NOT NULL LIMIT 3;"

# If none, set one on your own test user:
psql $DATABASE_URL -c "UPDATE users SET phone='+23057123456' WHERE email='you@test.com';"

# 3. Start backend so you can watch stdout for the code
cd backend && source .venv/bin/activate
uvicorn main:app --reload
```

### Test the flow

**Mobile** (after `npm install` to get netinfo + expo-camera):

```bash
cd mobile && npm install && npm start
```

1. Open app → login screen → tap **Phone** tab
2. Type `+23057123456` (or whatever phone you set)
3. Tap **"Get code on WhatsApp"** (goes through the console provider — no actual WhatsApp)
4. **Watch the backend terminal** — grep for `[OTP_DEV]`:
   ```
   WARNING:services.otp_providers.console:[OTP_DEV] would send code=482931 to phone=+23057123456 (locale=default)
   ```
5. Type that code into the mobile OTP screen → logged in

**Web:**

```bash
cd web/ivor-web && npm run dev
```

1. Open `localhost:3000` → tap **Phone** tab
2. Type the phone, tap **"Get code on WhatsApp"**
3. Same backend stdout trick to grab the code
4. Inline 6-digit input on the page → logged in

### Negative paths (still console)

| Test | How | Expected |
|---|---|---|
| Wrong code | Type 6 random digits | "Invalid code" |
| Expired code | Wait 11 minutes, then submit | "That code expired" |
| Rate limit (per phone) | Request 4 codes in a row | 429 "Too many code requests" |
| Unknown phone | Type `+23099999999` | Generic 200 success (anti-enumeration); **no** `[OTP_DEV]` line in logs |
| Device binding (TOFU) | Login OK → delete row from `trusted_devices` for a passwordless user → log in from a NEW browser → request another code → verify | 403 "new device requires approval" |

---

## Phase 2 — Real WhatsApp delivery (Meta setup required)

### Meta account setup (do this ONCE, can take days)

1. Go to **business.facebook.com** → create or use existing Meta Business account
2. **Verify your business** (Business Settings → Business Info → Verify). This is the slowest step — 24h to several days. Required for WhatsApp Business API.
3. In Business Settings → **WhatsApp Accounts** → Add → follow the wizard. You'll get:
   - **WhatsApp Business Account ID** (waba_id)
   - **Phone Number ID** (the numeric ID Meta gives you, NOT the actual phone)
4. **System User token** (Business Settings → System Users → Add → name it `kontokaz-otp` → Generate New Token):
   - Select your WA app
   - Scopes: `whatsapp_business_messaging` + `whatsapp_business_management`
   - Expiration: **Never** (permanent system token)
   - Save the token immediately — Meta only shows it once
5. **Submit an OTP template** (WhatsApp Manager → Message Templates → Create):
   ```
   Name:      kontokaz_login_otp
   Category:  AUTHENTICATION
   Language:  English (en) — add French (fr) separately later
   Header:    (none)
   Body:      Your Kontokaz code is {{1}}. Don't share it.
   Footer:    Code expires in 10 minutes.
   Button:    Copy Code (URL type, value: {{1}})
   ```
   Submit → Meta reviews → usually approved in <24h for AUTH templates.

### Configure backend env

```bash
# Add to backend/.env (or your deployment env vars)
OTP_PROVIDER=whatsapp_meta
META_WA_PHONE_NUMBER_ID=123456789012345
META_WA_TOKEN=EAAxxx...your-permanent-system-user-token
META_WA_TEMPLATE_NAME=kontokaz_login_otp
META_WA_API_VERSION=v21.0
```

Restart the backend. No errors at startup means the env is parsed; the actual Meta call happens on first request.

### First real test

1. **Use YOUR OWN WhatsApp number first.** Set it on a test user:
   ```sql
   UPDATE users SET phone='+23057XXXXXXX' WHERE user_id=1;
   ```
2. Open the login page → Phone tab → type your number → "Get code on WhatsApp"
3. Within 5–15 seconds, **WhatsApp delivers a message** from Meta's number with the code
4. Type into the OTP screen → logged in

### What to watch for (real-WhatsApp failure modes)

Watch backend logs while testing:

| Log line | Meaning | Fix |
|---|---|---|
| `WhatsApp send rejected: 401` | Bad token | Regenerate system user token |
| `WhatsApp send rejected: 400 ... template` | Template not approved, wrong name, or wrong locale | Check Meta WA Manager; template must show "Approved" status |
| `WhatsApp send rejected: 400 ... (#131030)` | Recipient phone not in your test allowlist (only relevant before WA is verified for production messaging) | Add recipient to test numbers in Meta dashboard, OR finish Meta business verification |
| `WhatsApp upstream 5xx` | Meta side, transient | Wait + retry; check status.fb.com |
| `delivery_failed_not_configured` (502 to client) | Env var missing | Check `META_WA_*` env vars are set + backend restarted |

---

## Phase 2.5 — Twilio SMS fallback (skip unless Meta is blocked)

If Meta approval drags and you need OTP login live ASAP, flip to SMS:

```bash
OTP_PROVIDER=twilio_sms
TWILIO_ACCOUNT_SID=ACxxxxxxxxxxxxxxxx
TWILIO_AUTH_TOKEN=...
TWILIO_FROM_NUMBER=+1234567890   # your Twilio-provisioned sender
```

No template approval needed — Twilio sends plain text immediately. Cost: ~Rs 1.50–2.25 per SMS in MU. **Don't run it as the default in production** unless WhatsApp is genuinely blocked — the cost adds up fast at scale.

---

## Quick health-check command

You can call the endpoints directly without any UI:

```bash
# Request a code
curl -X POST http://localhost:8000/api/v1/auth/otp/request \
  -H "Content-Type: application/json" \
  -d '{"phone":"+23057123456"}'
# → {"status":"ok","expires_in_seconds":600,"provider":"console"}

# Verify (after grabbing code from logs / WhatsApp)
curl -X POST http://localhost:8000/api/v1/auth/otp/verify \
  -H "Content-Type: application/json" \
  -H "X-Device-Id: test-curl-1" \
  -H "X-Device-Name: curl test" \
  -d '{"phone":"+23057123456","code":"482931"}'
# → full /login-style response with access_token + refresh_token + data
```

The `X-Device-Id` + `X-Device-Name` headers are what the new TOFU device-binding policy reads. Omit them and the backend "degrades open" (`skipped` outcome) — useful for older curl scripts but real clients should always send them.

---

## Related files

- `backend/api/v1/auth_otp.py` — `/auth/otp/request` + `/auth/otp/verify` + device list/revoke endpoints
- `backend/services/otp_providers/` — pluggable providers (`console`, `whatsapp_meta`, `twilio_sms`)
- `backend/services/trusted_device_service.py` — TOFU policy for device binding
- `backend/core/phone_utils.py` — MU-aware E.164 normalization + lookup variants
- `backend/alembic/versions/trusted_devices_20260531.py` — schema
- `mobile/app/login/index.tsx` + `mobile/app/login/verify-otp-login.tsx` — mobile UI
- `web/ivor-web/src/app/page.tsx` — web UI (inline OTP step)

## Recommended path

**Start with Phase 1 today** to confirm the wiring works end-to-end. Submit your Meta template in parallel so Phase 2 unblocks ~24h later. Keep `OTP_PROVIDER=console` in dev/CI forever — never set it in production.
