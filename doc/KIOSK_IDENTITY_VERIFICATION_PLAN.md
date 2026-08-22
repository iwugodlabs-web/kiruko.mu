# Kiosk Identity Verification — Fingerprint + Badge Plan

## Context

The kiosk currently verifies identity two ways:

1. **Lookup** — employee types email/phone → picks themselves from a list.
2. **PIN** — 4-digit `kiosk_pin_hash` on `PrivateUser` (bcrypt, mirror of the
   `kiosk_clockin_20260530` migration), plus a selfie at clock-in as a
   buddy-punch deterrent (no biometric hardware).

Request: add **fingerprint** to the kiosk, on tablets. This doc separates the
request into two problems with very different costs and spells out the plan
for each. Decisions below were confirmed with the requester:

- **Employee identity path → Badge / RFID / NFC** (not per-employee fingerprint).
- **Tablets → mixed / undecided** (design must degrade gracefully across
  iPadOS and Android).

---

## 1. The load-bearing insight

"Fingerprint on a shared kiosk" is two different problems:

| | Admin unlock | Employee clock-in |
|---|---|---|
| Whose biometric? | Tablet owner (enrolled in OS) | Each employee |
| Mechanism | OS Touch ID / Face ID / Android fingerprint | External reader + template DB |
| iPad | Native | No external fingerprint readers on iPadOS |
| Android | Native | USB/OTG scanner + vendor SDK |
| Effort | ~half day | ~6 weeks + hardware + legal |

The tablet's built-in fingerprint is bound to whoever enrolled it in the OS
settings — the **admin**, never the employees. It cannot identify *which*
employee is standing there. So device biometrics are usable only for the
admin gate; employee identity needs a different mechanism.

**Why badge/RFID/NFC instead of per-employee fingerprint:** a workforce kiosk
authenticates "which employee", which is a 1:N lookup. Badges do this with a
cheap, offline-friendly card; fingerprint needs a template store + enrollment
+ vendor SDK + a dedicated reader per kiosk. Badges are also faster in a
queuing crowd and carry no biometric-data retention obligations (Mauritius
DPA 2017 / Madagascar Loi 2014-038 treat biometric templates as sensitive).

---

## 2. Phase A — Admin finger unlock (portable, ship now)

Device biometric (Touch ID / Face ID / Android fingerprint) unlocks the admin
gate — the long-press-gear surface that currently requires the admin PIN.

- **No backend change, no hardware.** `expo-local-authentication` is already
  a dependency (`mobile/package.json`), the plugin is configured in
  `mobile/app.json`, and `USE_BIOMETRIC` is granted on Android.
- **Status: implemented.** `mobile/app/kiosk/services/biometrics.ts` wraps
  `hasHardwareAsync` / `isEnrolledAsync` / `authenticateAsync`; `clock-in.tsx`
  probes availability on mount and offers a "Face ID / Fingerprint" button
  alongside the PIN pad in the admin overlay. A successful biometric check
  calls the same `openAdminMenu()` the PIN path uses.

Remaining Phase A polish (optional):

- [ ] Persist an "unlock with biometric by default" pref so the admin doesn't
      tap the button each time (auto-prompt on gate open).
- [ ] i18n strings for the biometric button label (currently hardcoded
      "Face ID" / "Fingerprint").

---

## 3. Phase B — Employee badge / RFID / NFC

### 3.1 Tablet reality (drives the design)

| Reader | iPad | Android | Notes |
|---|---|---|---|
| Built-in NFC tap | ❌ No NFC hardware | ✅ | Android reads tag UID *and* NDEF |
| Camera QR/barcode | ✅ | ✅ | `expo-camera` has native barcode scanning |
| USB/Bluetooth barcode scanner | ⚠️ Lightning/USB-C + BT | ✅ OTG | Extra hardware, one per kiosk |
| USB fingerprint scanner | ❌ | ✅ | Rejected for Phase B |

**Consequence for "mixed/undecided" tablets:** the only portable, zero-extra-
hardware badge reader is the **camera** — print a QR/barcode on the badge and
scan it with the kiosk's existing front camera (`KioskCameraMount` is already
mounted on the PIN screen). NFC tap is a valuable **Android-only enhancement**,
not the baseline.

Recommended v1: **camera-scanned QR/barcode on the badge.** Reuses the camera,
works on every tablet, no new hardware, and the code is printed so there is
nothing secret to protect in the DB.

### 3.2 Identity model

Badge = "something you have" that identifies *who*. It replaces the
email/phone lookup, not the PIN:

- **`badge_code`** — a short opaque string printed as a QR/barcode (and, on
  Android, derivable from an NDEF record or tag UID). Stored on `PrivateUser`.
  NULL = no badge assigned. Plaintext is fine: the code is physically printed
  on the card; it is not a secret (a lost badge is revoked, not "cracked").
- **PIN stays optional per company.** Badge alone is the fast path; a
  company setting later lets higher-security sites keep PIN-on-top. v1 ships
  **badge-only** (photo capture still fires), because a badge + PIN combo
  kills the throughput benefit that motivated badges in the first place.
- **Clock-out** still works: `has_active_session` already drives the in/out
  branch in the existing flow.

### 3.3 Backend

Migration `kiosk_badge_identity_YYYYMMDD.py`:

1. `private_users.badge_code` — `String(64)`, nullable.
2. Partial unique index `(company_id, badge_code) WHERE badge_code IS NOT NULL`
   so a code is unique *within* a company but two companies can reuse codes.
3. `private_users.badge_assigned_at` / `badge_assigned_by_user_id` (optional,
   for audit support in the UI).

Model — extend `PrivateUser` (`backend/core/model.py:88`):

- `badge_code = Column(String(64), nullable=True)`.
- (optional) `badge_assigned_at`, `badge_assigned_by_user_id` mirrors.

Service — `backend/services/kiosk_service.py`:

- `set_badge(db, private_user_id, badge_code, actor_user_id)` — normalize
  (trim/uppercase), enforce company-uniqueness, audit `kiosk_badge_assigned`.
- `clear_badge(db, private_user_id)` — audit `kiosk_badge_cleared`.
- `resolve_badge(db, company_id, badge_code) -> PrivateUser | None` — scoped
  by `company_id` (cross-tenant isolation, same rule as `find_employees`).
- `create_badge_timelog(db, device, private_user, location, idempotency_key)`
  — reuse the existing `create_kiosk_time_log` internals; the only delta is
  `auth_method='badge'` in the audit `meta`.

Routes — `backend/api/v1/kiosk.py`:

- **Admin:** `POST /admin/private-users/{id}/kiosk-badge` `{badge_code}` and
  `DELETE /admin/private-users/{id}/kiosk-badge` — mirror the existing
  `kiosk-pin` endpoints (`api/v1/kiosk.py`, admin router).
- **Kiosk:** `POST /kiosk/badge-lookup` `{badge_code}` → a single
  `KioskLookupCandidate` (same shape as `employee-lookup`, including
  `has_active_session`) or `404 badge_not_found`. Then the existing
  `/kiosk/clock-in` / `/kiosk/clock-out` handle the punch. **Decision needed:**
  either (a) extend the clock-in payload with `auth_method` + optional
  `badge_code` (PIN becomes optional) or (b) keep clock-in PIN-only and add
  `POST /kiosk/badge-clock-in` as a thin sibling. Recommend (a) with
  `auth_method: 'pin' | 'badge'` to avoid duplicating the idempotency/error
  matrix.

Tests — `backend/tests/test_kiosk_badge.py`:

- badge set/clear + uniqueness within company, cross-company isolation,
  resolve-by-badge, badge clock-in creates `created_source='kiosk'` with
  `auth_method='badge'` in audit, idempotency dedup on badge replay.

### 3.4 Kiosk client (mobile)

Hardware abstraction — `mobile/app/kiosk/services/badgeReader.ts`:

- A single `scanBadge(): Promise<string | null>` behind a small interface.
- **Camera impl (both platforms):** `expo-camera`'s `onBarCodeScanned`
  (`barCodeScannerEnabled`) reads QR/barcode. Reuses the existing camera mount
  pattern; no new native dep.
- **NFC impl (Android only):** `react-native-nfc-manager` reads NDEF/tag UID.
  Gated behind a capability check so iPad (and Android without NFC) fall back
  to the camera path. **New native dep — add only when an Android pilot asks
  for tap.**

State machine — `mobile/app/kiosk/clock-in.tsx`:

- `idle` gains a "Tap badge" action → `scanningBadge` → `submitting` (or
  `enteringPin` when the company policy requires PIN-on-top) → `success`.
- On scan: `POST /kiosk/badge-lookup` → `submitting` via the existing
  `clockInWithOfflineFallback` / `clockOutWithOfflineFallback` with
  `auth_method: 'badge'`. `404` → `error` ("Badge not recognised — see your
  admin"). Offline queue (M31) already covers replay via Idempotency-Key.

### 3.5 Enrollment

- Admin assigns a badge in the web employee detail (next to the existing
  PIN-set panel — `web/ivor-web` admin, M28 pattern).
- The code is printed on the badge (or an NDEF tag written) at issuance.
- No employee self-serve in v1 — matches the existing PIN reset posture (the
  target market is low-tech; admin-driven is the realistic flow).

---

## 4. Milestones

| ID | Scope | Effort | Depends | Notes |
|---|---|---|---|---|
| M35 | Admin finger unlock (Phase A) | S | — | **Done** (biometrics.ts + gate wiring) |
| M36 | Badge identity — backend (schema, service, routes, tests) | M | M26 | `badge_code` + `resolve_badge` + `/kiosk/badge-lookup` |
| M37 | Badge camera scan (kiosk client) | S–M | M36 | `badgeReader.ts` camera impl + state machine |
| M38 | Admin badge assignment UI (web) | S | M36 | Employee-detail panel next to PIN-set |
| M39 | NFC tap (Android-only) | M | M37 | Gated on Android pilot demand |

## 5. Risks & decisions

1. **iPad has no NFC.** Baseline is camera QR/barcode; NFC tap is an
   Android-only add-on. If the fleet goes iPad-only, drop M39 entirely.
2. **Badge loss / buddy-punch.** A badge is "something you have" — a friend
   can tap it. Mitigation = existing photo capture + `out_of_schedule`
   flagging + admin review. Company-level "require PIN on top of badge"
   policy is the escalation lever, deferred past v1.
3. **Badge-code secrecy.** Codes are printed on the card and not treated as
   secrets; revocation (clear the code) is the security control, not secrecy.
4. **Privacy.** No biometric templates are collected anywhere in this plan
   (admin unlock is an on-device OS check — see `doc/STORE-SUBMISSION-KIT.md`
   §2 "Face ID / biometrics: not collected"). No DPA-listed sensitive-data
   surface is added.
5. **Uniqueness scope.** Badge codes are unique *per company*, not global —
   matches the existing `employee_code` convention.

## 6. Out of scope

- Per-employee fingerprint (USB scanner + template DB) — rejected in favour of
  badges; revisit only if a customer specifically requires fingerprint.
- Face-match via camera — privacy/legal review + false-match risk; not needed
  given the badge path.
- PIN-on-top-of-badge company policy — escalation lever, not v1.
