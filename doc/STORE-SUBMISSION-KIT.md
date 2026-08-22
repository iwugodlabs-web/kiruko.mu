# Store Submission Kit — Kiruko

Pre-filled answers and copy for App Store Connect + Google Play Console. Derived
from the app's actual data practices (see `/privacy`). Review with legal before
final submission. **Bold = decision still needed from you.**

| Field | Value |
|---|---|
| App name | **Kiruko** |
| Bundle ID / package | `com.iwugodlabs.kiruko` |
| Version / build | `1.0.0` (EAS auto-increments build number) |
| Legal entity | Zilwa Eklere Ltd, Mauritius |
| Support email | hello@kiruko.mu |
| Support URL | **https://kiruko.mu** (or app.kiruko.mu) |
| Marketing URL | **https://kiruko.mu** |
| Privacy Policy URL | https://app.kiruko.mu/privacy |
| Terms URL | https://app.kiruko.mu/terms |
| Primary category | Business |
| Secondary category | Productivity |
| Age rating | 4+ (Apple) / Everyone (Play) |

---

## 1. Listing copy

### App name & taglines
- **App name** (Apple 30 / Play title 30): `Kiruko`
- **Subtitle** (Apple, 30 chars): `Payroll, attendance & leave`
- **Short description** (Play, 80 chars): `Payroll, clock-in, leave and documents for your team — simple and secure.`
- **Promotional text** (Apple, 170 chars): `Run payroll, track attendance, manage leave and share documents — all in one app built for small and growing teams.`

### Keywords (Apple, 100 chars, comma-separated, no spaces)
`payroll,attendance,time,clockin,leave,HR,employee,salary,workforce,roster,timesheet,staff`

### Full description (Apple + Play, ≤4000 chars)
```
Kiruko is a simple, secure workforce-management app for employers and
employees.

For employers:
• Run and review payroll, with salaries, loans and repayments in one place
• Track attendance with clock-in / clock-out, including optional location and
  photo verification to confirm presence
• Approve leave requests and manage time off
• Onboard employees, organise departments and roles
• Store and share employment documents
• Stay informed with role-aware notifications

For employees:
• Clock in and out, and view your attendance history
• Request leave and track approvals
• See your payslips and salary details
• Scan receipts and manage expenses
• Keep your documents in one secure vault
• Control your notification preferences and manage your account

Kiruko is built for small and growing teams. Your data is protected in transit,
sensitive on-device data is encrypted, and you can delete your account at any
time from Settings.

Operated by Zilwa Eklere Ltd, Mauritius. Questions? hello@kiruko.mu
```

### What's New (first release)
```
First release of Kiruko: payroll, attendance, leave, documents and expenses for
small and growing teams.
```

---

## 2. Apple — App Privacy ("nutrition labels")

Data **is** collected. Data is **not** used for tracking (no ATT). House ads are
contextual only — no third-party ad SDK, no cross-app tracking, so answer
**"No, we do not track."**

For each type below: **Linked to identity = Yes**, **Used for tracking = No**,
**Purpose = App Functionality** (unless noted).

| Apple data type | Collected | Notes |
|---|---|---|
| Contact Info → Name | Yes | Account |
| Contact Info → Email Address | Yes | Account, auth |
| Contact Info → Phone Number | Yes | Account, OTP auth |
| Financial Info → Other Financial Info | Yes | Salary, payroll, loans |
| Location → Coarse/Precise Location | Yes | Clock-in attendance verification only |
| User Content → Photos or Videos | Yes | Clock-in photo, receipt images |
| User Content → Other User Content | Yes | Uploaded documents |
| Identifiers → User ID | Yes | Account identifier |
| Identifiers → Device ID | Yes | Device-binding for secure sign-in |
| Sensitive Info | **Confirm** | Payroll/employment may qualify — disclose if asked |
| Diagnostics / Usage Data | Optional | Only if you add analytics later — currently No |

- **Face ID / biometrics:** on-device OS check only; **not collected** → do not list.
- **Push token:** operational; covered under Device ID / App Functionality.

---

## 3. Google Play — Data Safety form

- **Is data encrypted in transit?** Yes (HTTPS/TLS).
- **Can users request deletion?** Yes — in-app (Settings → Delete account) and via hello@kiruko.mu.
- **Data shared with third parties?** No third-party *sharing*. Data is processed by
  service providers acting on our behalf (cloud hosting/storage, Google Cloud
  Vision for receipt OCR, Expo push, email provider) — these are processors, not
  recipients you "share" with under Play's definition.

| Play category → type | Collected | Shared | Purpose |
|---|---|---|---|
| Personal info → Name | Yes | No | App functionality, Account management |
| Personal info → Email | Yes | No | App functionality, Account management |
| Personal info → Phone number | Yes | No | App functionality, Account management |
| Personal info → User IDs | Yes | No | App functionality |
| Financial info → Salary/payroll (Other) | Yes | No | App functionality |
| Location → Approximate/Precise | Yes | No | App functionality (attendance) |
| Photos and videos → Photos | Yes | No | App functionality |
| Files and docs | Yes | No | App functionality |
| App activity → notifications/audit | Yes | No | App functionality, Security |
| Device or other IDs | Yes | No | App functionality, Fraud prevention |

---

## 4. Encryption / export compliance

- `ITSAppUsesNonExemptEncryption = false` is already set in `app.json`.
- Rationale: the app uses HTTPS/TLS (exempt) and SQLCipher to encrypt its own
  local data — relies on the standard-encryption exemption. No custom/proprietary
  cryptography.
- Apple form: answer **"uses encryption" → exempt** (standard encryption). Confirm
  with legal if you export to restricted jurisdictions.

---

## 5. Age rating questionnaire

Answer **No** to all violence/sexual/drugs/gambling/profanity prompts → **4+**
(Apple) / **Everyone** (Play). It is a workplace tool with no objectionable
content and no user-generated public content.

---

## 6. Screenshots & graphics (assets to produce)

Apple (App Store Connect):
- [ ] iPhone 6.9"/6.7" (1290×2796) — **required**, 3–10 images
- [ ] **iPad 13" (2048×2732) — REQUIRED. Kiosk mode runs on iPad, so tablet
      support is intentional (`supportsTablet: true`); keep it. Capture the kiosk
      clock-in screen here.**
- [ ] App icon is taken from the build (no separate upload).

Google Play:
- [ ] Phone screenshots — min 2 (recommend 4–8), 1080×1920 or similar
- [ ] Feature graphic — **1024×500** (required)
- [ ] App icon — **512×512** PNG
- [ ] (Optional) 7" / 10" tablet screenshots

Suggested screens to capture: employer payroll list, employee clock-in,
attendance history, leave request, payslip, documents vault.

---

## 7. Review notes (paste into "App Review Information" / Play review)

```
Kiruko is a workforce-management app. Reviewer access:

Employer demo:  demo-employer@kirukodemo.com  /  DemoPass123!
Employee demo:  demo-worker@kirukodemo.com    /  DemoPass123!

Notes:
- Sign in with EMAIL + PASSWORD (the phone OTP option requires an SMS/WhatsApp
  provider that is not enabled for the review environment).
- Location is requested only at clock-in, to verify workplace presence.
- Camera is used to take a clock-in photo and to scan receipts.
- Account deletion: Settings → Delete account (also disables sign-in and
  anonymises personal data).
```

These accounts are created by `backend/scripts/seed_demo_payroll.py` (idempotent;
employer + employee + company + a month of approved clock-ins). To create them on
a given backend, run it with that backend's `DATABASE_URL`:

```
# prereqs (payroll + overtime rules), once per DB:
backend/.venv/bin/python backend/scripts/seed_all.py
# the demo company + reviewer logins:
backend/.venv/bin/python backend/scripts/seed_demo_payroll.py
# override the password if you like: DEMO_PASSWORD=... python ... seed_demo_payroll.py
```

**TODO:** run the above against the **production** DB (api.kiruko.mu) before
submitting — the accounts currently exist only on the local dev DB.

---

## 8. Pre-submission checklist

- [ ] Demo employer + employee accounts created, credentials in §7
- [ ] `app.kiruko.mu/privacy` and `/terms` deployed and reachable (public, no login)
- [ ] Decide support/marketing URL (kiruko.mu vs app.kiruko.mu)
- [ ] iPad screenshots (kiosk runs on iPad — capture the kiosk clock-in screen)
- [ ] Feature graphic (Play) + screenshots produced
- [ ] Backend live at `api.kiruko.mu`; preview build smoke-tested on a device
- [ ] Apple: Agreements, Tax & Banking signed (required even for free apps)
- [ ] Play: app content (Data Safety, content rating, target audience) completed
