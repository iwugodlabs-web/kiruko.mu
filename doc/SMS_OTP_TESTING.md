# SMS OTP Login (Twilio) — Testing Guide

End-to-end test plan for the SMS OTP fallback shipped in tasks #59–#64.

The SMS path uses the same endpoints, same UI, same device-binding policy as the WhatsApp flow — only the delivery provider changes. See `WHATSAPP_OTP_TESTING.md` for the WhatsApp variant; this doc is the SMS-specific reference.

**Read this first:** SMS is the **fallback** provider. Default to WhatsApp in production — SMS in MU runs ~Rs 1.50–2.25 per message via Twilio, which compounds fast at scale (500 employees × 2 logins/day × Rs 2 ≈ Rs 60K/month). Only run `OTP_PROVIDER=twilio_sms` as default if:

- Meta WhatsApp template approval is genuinely blocking launch, OR
- A meaningful share of your users don't have WhatsApp installed (uncommon in MU but possible in older-worker segments)

Two phases:

- **[Phase 1](#phase-1--dev-test-with-console-provider-5-min-no-twilio)** — works today, no Twilio setup. Codes go to backend stdout.
- **[Phase 2](#phase-2--real-twilio-sms-delivery)** — real SMS delivery. Needs Twilio account + a sender number.

---

## Phase 1 — Dev test with console provider (5 min, no Twilio)

Identical to the Phase 1 dev flow in `WHATSAPP_OTP_TESTING.md` — the console provider is provider-agnostic. Listed here for self-contained reference.

### Setup (one-time)

```bash
# 1. Apply the migrations (creates trusted_devices + reuses verification_tokens)
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

Mobile or web → login screen → **Phone** tab → type phone → "Get code on WhatsApp" (the button label is WhatsApp-themed regardless of provider; SMS users still tap the same button — they just receive an SMS instead) → watch backend logs for:

```
WARNING:services.otp_providers.console:[OTP_DEV] would send code=482931 to phone=+23057123456 (locale=default)
```

→ paste into the OTP entry → logged in.

> If you want the button label to say "Get code by SMS" when SMS is active, that's a small UI change. Flag it if you want it.

---

## Phase 2 — Real Twilio SMS delivery

### Twilio account setup (do this ONCE — much faster than Meta)

Twilio has none of Meta's business-verification or template-approval gating. Typical setup is **10–30 minutes** end-to-end (vs. 24h+ for WhatsApp). Trade-off is cost per message, not approval friction.

1. Go to **twilio.com** → create account (or use existing). Trial accounts get $15 in free credit which is plenty for testing.
2. **Verify your own phone** in Twilio Console → Phone Numbers → Verified Caller IDs. **Trial accounts can only send to verified numbers** until you upgrade — add every test recipient here, or upgrade before testing widely.
3. **Get a sender number:**
   - Twilio Console → Phone Numbers → Buy a number → filter by SMS capability
   - Mauritius (+230) doesn't have inbound Twilio numbers — buy a **US or UK long code** (cheapest) or a **Twilio short code** (more expensive but better deliverability in MU). For most pilots: a US long code at $1/month is fine.
   - Alternative: **alphanumeric sender ID** ("KONTOKAZ") — supported in MU, no number needed, but requires per-country registration in Twilio Console → Messaging → Sender Pool → Alphanumeric Sender IDs. Recommended for production.
4. **Grab credentials** (Twilio Console → Account → API keys & tokens):
   - `Account SID` (starts with `AC...`)
   - `Auth Token` (click to reveal — rotate any time)
5. Confirm SMS works from Twilio Console → Messaging → Try It Out → Send an SMS to your verified number. If it arrives, the account is good.

### Configure backend env

```bash
# Add to backend/.env (or your deployment env vars)
OTP_PROVIDER=twilio_sms
TWILIO_ACCOUNT_SID=ACxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx
TWILIO_AUTH_TOKEN=...your-auth-token...
TWILIO_FROM_NUMBER=+14155551234   # the Twilio number you bought, OR "KONTOKAZ" for alpha sender
```

Restart the backend. No errors at startup means env is parsed; the actual Twilio call happens on first request.

### First real test

1. **Use YOUR OWN phone first.** Set it on a test user:
   ```sql
   UPDATE users SET phone='+23057XXXXXXX' WHERE user_id=1;
   ```
   Your number must also be in Twilio's Verified Caller IDs list **if your Twilio account is still on trial**.
2. Open the login page → Phone tab → type your number → "Get code on WhatsApp" (yes, the button)
3. Within 5–30 seconds, **SMS arrives** from your Twilio number / sender ID. Body looks like:
   > Your Kontokaz code is 482931. Don't share it.
   
   Body localizes by `preferred_locale` (en / fr / mg) — see `backend/services/otp_providers/twilio_sms.py`.
4. Type the code into the OTP screen → logged in
5. Twilio Console → Monitor → Logs → Messaging → confirm a row appears with status `delivered` (or `sent` → `delivered` within seconds)

### What to watch for (real-Twilio failure modes)

Watch backend logs while testing:

| Log line | Meaning | Fix |
|---|---|---|
| `Twilio rejected: 401` | Bad Auth Token | Regenerate Auth Token in Twilio Console (any saved env var goes stale) |
| `Twilio rejected: 400 ... (21211)` | Invalid `To` number — not E.164 format | Check `core/phone_utils.normalize_phone` output — should be `+23057XXXXXXXX` |
| `Twilio rejected: 400 ... (21408)` | Geo-permission disabled for Mauritius | Twilio Console → Messaging → Settings → Geo Permissions → enable Mauritius |
| `Twilio rejected: 400 ... (21610)` | Recipient is on Twilio's STOP list (replied STOP to a prior message) | Recipient sends `START` to your sender; or you whitelist via Twilio API |
| `Twilio rejected: 400 ... (21612)` | Sending to a number not verified (trial accounts) | Verify in Twilio Console, or upgrade out of trial |
| `Twilio upstream 5xx` | Twilio side, transient | Wait + retry; check status.twilio.com |
| `delivery_failed_not_configured` (502 to client) | Env var missing | Check `TWILIO_*` env vars are set + backend restarted |

### Cost monitoring (this is the SMS provider's main risk)

Set this up before turning SMS on widely. SMS abuse + accidental loops can drain credit overnight.

1. **Twilio billing alert** — Twilio Console → Billing → Usage Triggers → create one at e.g. $20 to email you when daily spend crosses that floor
2. **Per-phone rate limit** is already enforced by the backend (3 codes/hour/phone, see `api/v1/auth_otp.py:request_otp`). Don't loosen this without thinking about cost.
3. **Per-IP rate limit** (5/hour) catches bot scrapes that probe many different phone numbers. Already on.
4. **Watch the metric**: `backend/services/otp_providers/twilio_sms.py` logs `Twilio OTP sent to=...` on every successful send — pipe to a daily count.

Rough cost math worth re-checking on your account:

| Sender type | Cost/SMS in MU (approx) | 500 emp × 2 logins/day | Monthly |
|---|---|---|---|
| US long code | $0.05 (~Rs 2.25) | 1000 SMS/day | Rs 67,500/mo |
| Twilio short code | $0.075 (~Rs 3.40) | 1000 SMS/day | Rs 102,000/mo |
| Alpha sender (KONTOKAZ) | $0.04 (~Rs 1.80) | 1000 SMS/day | Rs 54,000/mo |
| WhatsApp (for comparison) | ~$0 first 1000/mo then ~$0.014 | 1000 SMS/day | ~Rs 9,500/mo |

WhatsApp is **~5–10× cheaper** at any meaningful scale. SMS is a stopgap.

---

## Quick health-check command

Same endpoint surface as WhatsApp — only the provider changes:

```bash
# Request a code (will go via Twilio if OTP_PROVIDER=twilio_sms)
curl -X POST http://localhost:8000/api/v1/auth/otp/request \
  -H "Content-Type: application/json" \
  -d '{"phone":"+23057123456"}'
# → {"status":"ok","expires_in_seconds":600,"provider":"twilio_sms"}

# Verify (after SMS arrives)
curl -X POST http://localhost:8000/api/v1/auth/otp/verify \
  -H "Content-Type: application/json" \
  -H "X-Device-Id: test-curl-1" \
  -H "X-Device-Name: curl test" \
  -d '{"phone":"+23057123456","code":"482931"}'
# → full /login-style response with access_token + refresh_token + data
```

`provider` field in the request response confirms which adapter actually ran — useful when toggling between WhatsApp and SMS during a hybrid rollout.

---

## Hybrid rollout (advanced — not built yet)

Today the backend picks one provider via `OTP_PROVIDER`. A future enhancement worth thinking about:

- Try WhatsApp first → on `rejected` (#131030 not-in-allowlist, or template error) → fall back to SMS automatically
- Per-user preference: store on `PrivateUser.preferred_otp_channel` ('whatsapp' | 'sms')

Neither is built. If pilot data shows a meaningful WhatsApp delivery-fail rate, this becomes a real ticket. The provider abstraction in `backend/services/otp_providers/` is designed to support this without a contract change.

---

## Related files

- `backend/services/otp_providers/twilio_sms.py` — Twilio adapter (single ~80-line file)
- `backend/services/otp_providers/__init__.py` — `get_provider()` factory (reads `OTP_PROVIDER` env)
- `backend/api/v1/auth_otp.py` — `/auth/otp/request` + `/auth/otp/verify` endpoints
- `backend/services/trusted_device_service.py` — TOFU device binding (same as WhatsApp flow)
- `backend/core/phone_utils.py` — MU-aware E.164 normalization
- `mobile/app/login/verify-otp-login.tsx` + `web/ivor-web/src/app/page.tsx` — UI (provider-agnostic)

## Recommended path

1. Get **Phase 1** (console) green today
2. Submit Meta WhatsApp template in parallel
3. If Meta hasn't approved within your launch window → flip to `OTP_PROVIDER=twilio_sms` as a temporary measure
4. Set the billing alert in Twilio **before** flipping the switch — easy to forget, hard to recover from
5. Once WhatsApp is approved, flip back: `OTP_PROVIDER=whatsapp_meta`. Keep `TWILIO_*` env vars set so you can swap back fast if Meta breaks.
