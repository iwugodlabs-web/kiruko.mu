# Kiruko — Go-Live Plan

**Target go-live:** 29 June 2026
**Last updated:** 12 June 2026
**Scope:** Web (`app.kiruko.mu` dashboard + `kiruko.mu` marketing) **and** the mobile app live for pilot users by 29 June. Kiosk pilot optional.
**Legal entity:** Zilwa Eklere Ltd (parent) · Product: Kiruko

---

## The one honest constraint
Web is fully in our control and **will** be ready. The app's **public** App Store / Google Play listing depends on Apple/Google timelines (D-U-N-S → org verification → review) that can exceed 17 days. So we decouple:

- App goes live to **pilot users on 29 June via TestFlight (iOS) + Play internal/closed testing** (or direct APK).
- **Public store listings are a fast-follow into July**, running in parallel — not blocking the 29th.

**Legend:** 🟢 = founder action · 🔵 = Claude / in-repo

---

## Track A — Web (in our control)
- [ ] 🟢 DO web env: `BACKEND_URL=https://api.kiruko.mu`, `NEXT_PUBLIC_SITE_URL=https://app.kiruko.mu`, `JWT_SECRET` (byte-for-byte match with backend) → redeploy
- [ ] 🟢 DO backend env: `CORS_ORIGINS=https://app.kiruko.mu,https://kiruko.mu,http://localhost:3000`
- [ ] 🟢 Test full chain on `app.kiruko.mu`: signup → verify email → login
- [ ] 🔵 Marketing: flip store badges "coming soon" → live links once apps are available

## Track B — Production config (breaks launch if skipped)
- [ ] 🟢 Transactional email in prod (SMTP / SendGrid / Brevo) — else verification emails never send → no one can finish signup
- [ ] 🟢 File storage → DigitalOcean Spaces / S3 (App Platform disk is ephemeral; uploads vanish on every redeploy)
- [ ] 🟢 Rotate secrets: `JWT_SECRET`, `POSTGRES_PASSWORD`, `SUPER_USER_PASSWORD`
- [ ] 🟢 (later) Purge `backend/.env` from git history
- [ ] 🟢 OTP login: configure WhatsApp/SMS provider **or** hide the OTP path for launch (email/password works)

## Track C — Store / legal blockers
- [ ] 🟢 **D-U-N-S** for Zilwa Eklere Ltd — long pole, start first (steps below)
- [x] 🔵 Privacy Policy page (`marketing/privacy.html`) — drafted; pending 🟢 legal review + deploy
- [x] 🔵 Terms of Service page (`marketing/terms.html`) — drafted; pending 🟢 legal review + deploy
- [x] 🔵 Account deletion — backend `DELETE /user/me` + mobile UI (both settings, en/fr/mg) + **3 passing tests** (suite collects 499). Decisions: financial tables retained de-identified (loans are payroll-linked); two-step confirm (RN `Alert.prompt` is iOS-only). Pending: web deletion URL; live prod verification after backend redeploys.
- [ ] 🟢 Apple Developer Program enrollment (~$99/yr) — needs D-U-N-S
- [ ] 🟢 Google Play Console enrollment (~$25) — needs D-U-N-S (org verification)
- [ ] 🟢 Data Safety form (Play) + Privacy nutrition labels (Apple)

## Track D — App build & submit
- [ ] 🔵 Point `mobile/services/apiClient.tsx` baseURL → `https://api.kiruko.mu`
- [ ] 🔵 EAS production build config (iOS + Android), bundle id `com.iwugodlabs.kiruko`
- [ ] 🔵 EAS builds → upload to TestFlight + Play internal testing
- [ ] 🟢 Store listings: icon, screenshots, descriptions, content rating
- [ ] 🟢 Onboard pilot users to TestFlight / internal testing
- [ ] 🟢 Submit for public review (→ July)

## Track E — Kiosk (optional)
- [ ] 🔵/🟢 Build Android APK; install on kiosk tablets (no store needed)

---

## Timeline
- **12–13 Jun:** D-U-N-S started · web env + login test · prod email/storage set · secrets rotated · (Claude) start Privacy/Terms + account-deletion
- **by 18 Jun:** web works end-to-end · Privacy/Terms live · account-deletion shipped · mobile → `api.kiruko.mu` · EAS build config
- **by 25 Jun:** store enrollment done · EAS builds on TestFlight + Play internal · listings drafted · submitted for review
- **26–29 Jun:** final QA · 🚀 web public + app to pilot users (+ kiosk optional)
- **early–mid Jul:** public store listings approved (fast-follow)

---

## D-U-N-S — how to start (do first)
**Pre-req:** Zilwa Eklere Ltd must be a *registered* entity (BRN + registered address). If registration is still pending, that's the real gate, not the D-U-N-S.

1. Go to **https://developer.apple.com/enroll/duns-lookup/** (free; the number also works for Google Play).
2. Search **Zilwa Eklere Ltd** + country **Mauritius**. If it already exists → note the number, done.
3. If not found → request one on the same page. Have ready, **exactly as registered**:
   - Legal name `Zilwa Eklere Ltd`, BRN, registered office address
   - A reachable company phone, website `https://kiruko.mu`
   - Contact: your name + title + `hello@kiruko.mu`
4. Verification: D&B may email/call. ~5 business days via Apple's tool (up to 30 direct). Don't pay for expedited unless time-pressed.
5. Use the **exact same legal name + address** in Apple + Google enrollment later — any mismatch triggers re-verification delays.

---

## Apple Developer Program — enroll (after D-U-N-S)
**D-U-N-S ≠ enrollment.** The D-U-N-S is just the company ID you bring *to* the enrollment; you still have to enroll and pay separately. Same number unblocks both Apple (here) and the Google Play org verification.

1. Go to **https://developer.apple.com/programs/enroll/** and sign in with a **company-owned Apple ID** (not a personal account); enable two-factor auth on it.
2. Entity type: choose **Organization** (Individual would publish under a personal name, not Zilwa Eklere Ltd).
3. Enter legal entity details + **D-U-N-S** — must match D-U-N-S record *exactly* (legal name, address, phone).
4. Apple verifies the entity and may **phone the number on the D-U-N-S record** to confirm you can bind the org. Pay **$99/yr**. Account created in a few days (longer if D-U-N-S needs correcting).
5. In **App Store Connect** (`appstoreconnect.apple.com`): sign the **Agreements, Tax & Banking** (the free-apps agreement is required even for free apps), add **Users and Access** team members, then create the app record (bundle id `com.iwugodlabs.kiruko`).
