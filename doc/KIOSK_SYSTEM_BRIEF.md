# Kiosk Device Clock-In System — Complete Brief for Implementation

## 1. PROBLEM STATEMENT

**Current Situation:**
- Employees need mobile app installed to clock in/out
- Some companies lack widespread app adoption
- Solution needed: Install kiosk device (tablet) at entrance for automatic clock-in

**Business Goal:**
- Enable companies without mobile app penetration to use the platform
- Reduce friction for employee onboarding (clock in without app)

---

## 2. SYSTEM REQUIREMENTS

### Functional Requirements
- **Device**: Tablet/Kiosk with touchscreen at company entrance
- **Employee ID Method**: Email or phone lookup
- **Data Sync**: Real-time (with option for offline fallback)
- **Device Setup**: Managed by Kontokaz or self-serve by companies
- **Approvals**: Fast-track workflow (maintain governance but speed up payroll)
- **Clock Operations**: Clock-in at kiosk; clock-out via mobile app (when available)

### Non-Functional Requirements
- Must not break existing time logging APIs
- Audit trail maintained for compliance
- Cross-company isolation enforced
- Scaleable to 100+ companies
- Handles WiFi failures gracefully

---

## 3. CURRENT ARCHITECTURE CONTEXT

### Time Logging Backend
**Model**: `TimeLog` (backend/core/model.py)
- Fields: `timelog_id`, `job_id`, `private_user_id`, `start_time`, `end_time`, `location` (JSONB GPS), `hours_worked`, `admin_approved` (Boolean)
- Approval Gate: Companies can require `admin_approved=true` before payroll processes
- Audit Trail: Every action logged in `AuditLog` table + Notification sent to employee
- Current Flow: Employee app → POST /job/create-time-log → Admin reviews → Approves/Rejects → Payroll processes

### Authentication
- JWT tokens audience-bound: `aud='mobile'`, `aud='web'`, etc.
- Platform headers: `X-Platform` (ios/android), `X-Client-Platform` (mobile/web)
- No existing device-level auth pattern

### User Model
- Two types: `private` (employee) and `company` (employer)
- Per-company roles: owner, admin, manager, member, viewer
- Private users assigned to company via `PrivateUser.company_id`

---

## 4. PROPOSED SOLUTION (MVP v1)

### 4a. Backend Architecture

#### New Models (backend/core/model.py)
```yaml
KioskDevice:
  device_id: UUID (primary key)
  company_id: FK
  device_name: String (e.g., "Main Entrance Kiosk")
  location: JSONB {latitude, longitude, address}
  api_token_hash: String (hashed)
  token_expires_at: DateTime (30-day TTL)
  is_active: Boolean
  last_sync: DateTime
  created_at, updated_at: DateTime
  created_by_admin_user_id: FK

TimeLog (extend):
  created_source: Enum ['mobile', 'web', 'kiosk']
  fast_track_approval: Boolean (for kiosk logs)
```

#### New Service (backend/services/kiosk_service.py)
- `register_device(company_id, name, location) → api_token` (expires 30 days)
- `validate_kiosk_token(token) → device_id, company_id, is_valid`
- `find_employee_by_email_or_phone(company_id, query) → [candidates with photos]`
- `create_kiosk_timelog(device_id, private_user_id, location) → TimeLog`
- `rotate_kiosk_token(device_id) → new_token` (new 30-day TTL)

#### New API Endpoints (backend/api/v1/kiosk.py)

**Admin Endpoints:**
```
POST /admin/kiosks/register
  Auth: Kontokaz admin token
  Body: { company_id, device_name, location }
  Response: { device_id, api_token (one-time), expires_at }

GET /admin/kiosks/{company_id}
  Response: [ {device_name, location, last_sync, is_active, status} ]

POST /admin/kiosks/{device_id}/rotate-token
  Response: { new_token, expires_at }
```

**Kiosk Endpoints:**
```
POST /kiosk/employee-lookup
  Auth: X-Kiosk-Token (in header)
  Body: { email_or_phone: string }
  Response: [ { private_user_id, name, photo_url, company_id } ]

POST /kiosk/clock-in
  Auth: X-Kiosk-Token
  Body: { private_user_id, location: {latitude, longitude} }
  Response: { status, timelog_id, message: "Clocked in at 08:00 AM" }

POST /kiosk/confirm-pin
  Auth: X-Kiosk-Token
  Body: { private_user_id, pin: string }
  Response: { verified: boolean }
```

#### Modified CRUD (backend/db_models/crud/job.py)
```python
def create_time_log(
    job_id: int,
    private_user_id: int,
    start_time: datetime,
    end_time: Optional[datetime],
    location: dict,
    created_source: str = 'mobile',  # NEW PARAM
    fast_track_approval: bool = False  # NEW PARAM
):
    # If source='kiosk':
    #   - Set created_source='kiosk'
    #   - Set fast_track_approval=True (pre-marked for admin bulk approval)
    #   - Skip app-specific location validation
    #   - Record in AuditLog with source='kiosk'
    # Create TimeLog and return
```

#### Token Auth Dependency (backend/core/dependencies.py)
```python
async def get_kiosk_context(request: Request):
    token = request.headers.get('X-Kiosk-Token')
    if not token:
        raise HTTPException(status_code=401, detail="Missing token")
    
    device_id, company_id = await validate_kiosk_token(token)
    if not device_id:
        raise HTTPException(status_code=403, detail="Invalid token")
    
    return KioskContext(device_id=device_id, company_id=company_id)
```

### 4b. Frontend Architecture

#### Admin Dashboard (web/ivor-web/src/app/(platform)/admin/kiosks/)
- **Device List**: Table showing all registered devices per company
  - Columns: device_name, location, last_sync, is_active, sync_status
  - Actions: View token (copy to clipboard), Rotate token, Deactivate, Delete
  
- **Device Registration**: Form to register new kiosk
  - Fields: Company (dropdown), Device Name, Location (map or coordinates)
  - Output: API token display (one-time, copy button), QR code with token embedded
  
- **Sync Status Monitor**: Real-time indicator of last_sync age
  - Alert if last_sync > 30 minutes ago

#### Kiosk Client UI (web/ivor-web/src/app/kiosk/)
**Embedded route, not separate SPA**

- **Setup Screen**: Scan QR code or paste API token
  - Validates token, stores securely (encrypted localStorage)
  
- **Main Clock-In Screen**: Large, accessible UI
  - Email/Phone input field (15pt+ font)
  - Search button or autocomplete
  
- **Candidate Selection**: If multiple matches
  - Show photo + name for each candidate
  - Employee taps to confirm identity
  
- **PIN Confirmation** (optional 2FA)
  - 4-digit keypad
  - Employee enters to verify
  
- **Clock-In Success**: Display confirmation
  - "✓ Clocked in at 08:15 AM"
  - Return to search screen
  
- **Error Handling**:
  - "Employee not found" → allow retry
  - "Network error" → queue event locally (see offline mode below)
  - "Invalid PIN" → show retry counter

**Sync Service** (IndexedDB for offline queue):
```typescript
// Real-time path:
POST /kiosk/clock-in → success → show confirmation

// Offline path (if network fails):
- Queue event in IndexedDB: {private_user_id, location, timestamp}
- Show yellow banner: "No signal. Will sync when online."
- When network returns → auto-sync queued events
- Mark as synced once successful
- Retry failed events up to 3x with exponential backoff
```

---

## 5. APPROVAL WORKFLOW (Fast-Track Model)

**Instead of**: Auto-approval (risky, no gate)

**Better**: Fast-track approval pattern
```
Kiosk logs created with fast_track_approval=True
↓
Admin Dashboard shows: "47 device entries ready to approve"
↓
Admin clicks: "Approve These 47"
↓
All marked as admin_approved=True + AuditLog entry
↓
Payroll includes them in next run
```

**Benefits:**
- ✅ Maintains human approval gate (compliance, wage-theft protection)
- ✅ Bulk operation (1 click for 100 logs)
- ✅ Audit trail preserved
- ✅ Admin still has option to drill-down and reject specific entries

---

## 6. SECURITY DESIGN

### Token Security
- **Generation**: 32-byte random token, hashed before storage (bcrypt/argon2)
- **TTL**: 30 days, auto-rotate on expiry
- **Distribution**: Shown once at creation, must copy immediately
- **Revocation**: Admin can manually rotate or auto-rotate on expiry
- **Rate Limiting**: All /kiosk/* endpoints limited to 100 req/min per device_id

### Employee Verification
1. Email/phone lookup
2. Show photo + name confirmation
3. Optional: 4-digit PIN (stores in PrivateUser.kiosk_pin or separate KioskPIN table)
4. **PIN Reset**: Employees reset via mobile app or Kontokaz admin

### Cross-Company Isolation
- Employee lookup filters by company_id = device's company
- Error if employee not assigned to device's company
- Cannot clock in employee from different company

### Audit Trail
```
AuditLog entry created:
{
  actor_kind: 'system',
  action: 'clock_in_device',
  resource: 'TimeLog',
  resource_id: timelog_id,
  company_id: company_id,
  device_id: device_id,
  metadata: {source: 'kiosk', employee_email: '...'}
}
```

---

## 7. DATA FLOW DIAGRAMS

### Happy Path (Real-Time)
```
Employee taps "Search"
↓
Enters email: "alice@company.com"
↓
POST /kiosk/employee-lookup
↓
Backend queries PrivateUser (filtered by company_id)
↓
Returns: [{ id: 42, name: "Alice Johnson", photo_url: "..." }]
↓
Kiosk displays photo + name
↓
Employee taps to confirm
↓
POST /kiosk/confirm-pin {private_user_id: 42, pin: "1234"}
↓
Backend validates PIN ✓
↓
POST /kiosk/clock-in {private_user_id: 42, location: {lat, lng}}
↓
Backend creates TimeLog:
  - private_user_id: 42
  - created_source: 'kiosk'
  - fast_track_approval: true
  - start_time: now()
  - end_time: null (active)
↓
Records AuditLog (source='kiosk')
↓
Response: {status: 'success', timelog_id: 1001}
↓
Kiosk displays: "✓ Clocked in at 08:15 AM"
↓
Return to search screen
```

### Offline Fallback
```
Network unavailable during clock-in
↓
POST /kiosk/clock-in → fails (connection timeout)
↓
Kiosk catches error, queues locally in IndexedDB:
{
  queue_id: uuid,
  private_user_id: 42,
  action: 'clock_in',
  location: {...},
  created_at: now(),
  synced: false
}
↓
Display yellow banner: "⚠ No signal. Will sync when online."
↓
[Later] Network returns
↓
Sync service loops through IndexedDB entries (synced=false)
↓
Retries POST /kiosk/clock-in for each
↓
On success: Update entry {synced: true, synced_at: now()}
↓
On failure: log error, retry next sync cycle
```

---

## 8. IMPLEMENTATION PHASES

### Phase 1: Backend Core (2-3 weeks)
- [ ] Create KioskDevice + schema in database
- [ ] Implement KioskService (register, validate, lookup, create TimeLog)
- [ ] Build API endpoints (/admin/kiosks/register, /kiosk/clock-in, etc.)
- [ ] Add token auth dependency
- [ ] Modify create_time_log() CRUD to handle kiosk source
- [ ] Unit tests: token validation, employee lookup, cross-company isolation
- [ ] Integration tests: full clock-in flow

### Phase 2: Admin Dashboard (1-2 weeks)
- [ ] Device management UI (list, register, rotate token)
- [ ] Fast-track approval UI (show pending kiosk logs, bulk approve)
- [ ] Sync status monitor + alerts
- [ ] QR code generation for tablet setup

### Phase 3: Kiosk Client (2-3 weeks)
- [ ] Build embedded kiosk route in web app (/app/kiosk/)
- [ ] Employee lookup UI + photo confirmation
- [ ] PIN confirmation flow (optional)
- [ ] Clock-in success display
- [ ] Offline queue + sync service (IndexedDB)
- [ ] Error handling + retry logic

### Phase 4: Database + Testing (1 week)
- [ ] Alembic migration for KioskDevice table
- [ ] Seed test devices in staging
- [ ] End-to-end tests (full clock-in, lookup, approval)
- [ ] Load testing (device sync under high load)

### Phase 5: Deployment (1 week)
- [ ] Monitoring: device sync status, token expiry alerts
- [ ] Deployment guide for tablets (setup instructions)
- [ ] Runbook for common issues (token expired, offline troubleshooting)

---

## 9. CRITICAL DECISIONS & TRADE-OFFS

### Decision 1: Fast-Track Approval vs Auto-Approval
| Approach | Pros | Cons |
|----------|------|------|
| **Auto-Approve** | Faster payroll | ❌ No approval gate; wage-theft risk |
| **Fast-Track** ⭐ | Maintains gate; bulk 1-click | Slightly more admin steps |

**Recommendation**: Fast-track. Maintains security + compliance.

---

### Decision 2: Clock-In Only vs Clock-In/Out
| Approach | Pros | Cons |
|----------|------|------|
| **Clock-In/Out** | Complete data | ❌ Forgot-to-clock-out; fraud risk; device SPF |
| **Clock-In Only** ⭐ | Simpler; less fraud | Requires app for clock-out |

**Recommendation**: Clock-in only (v1). Add clock-out in v2 after proving reliability.

---

### Decision 3: Real-Time vs Offline-First
| Approach | Pros | Cons |
|----------|------|------|
| **Real-Time Only** ⭐ | Simple; no sync bugs | Fails without WiFi |
| **Offline Buffer** | Resilient | ❌ Complex state; dupe risk |

**Recommendation**: Real-time only (most companies have WiFi). Add offline in v2 if field data justifies.

---

### Decision 4: Separate App vs Embedded
| Approach | Pros | Cons |
|----------|------|------|
| **Separate SPA** | Independent release | ❌ DevOps burden; version drift |
| **Embedded in Web** ⭐ | Single deployment; shared code | Slightly larger bundle |

**Recommendation**: Embed in web app. Easier maintenance.

---

### Decision 5: Kontokaz-Managed vs Self-Serve
| Approach | Pros | Cons |
|----------|------|------|
| **Kontokaz-Only** | Better security control | ❌ Scalability bottleneck; poor UX |
| **Self-Serve** ⭐ | Scales; better UX | Requires dashboard UI |

**Recommendation**: Self-serve with optional Kontokaz review. Better UX + scalability.

---

## 10. VERIFICATION CHECKLIST

### Unit Tests
- [ ] test_kiosk_token_generation() — generates valid token
- [ ] test_kiosk_token_expiry() — token expires after 30 days
- [ ] test_employee_lookup_by_email() — finds correct employee
- [ ] test_employee_lookup_cross_company_isolation() — can't find employee from other company
- [ ] test_pin_validation() — PIN required + validated
- [ ] test_timelog_created_with_kiosk_source() — created_source='kiosk' set correctly
- [ ] test_fast_track_approval_flag() — fast_track_approval=True for kiosk logs

### Integration Tests
- [ ] full_clock_in_flow() — employee lookup → confirm → PIN → clock-in → success
- [ ] offline_queue_persistence() — events saved to IndexedDB
- [ ] offline_sync_retry() — queued events sync when online
- [ ] cross_company_isolation() — device A can't clock employees from company B
- [ ] admin_bulk_approval() — admin approves 50 kiosk logs in 1 click

### Manual Testing
- [ ] Register device via admin dashboard
- [ ] Load kiosk on tablet, scan QR or paste token
- [ ] Lookup employee by email → see photo + name
- [ ] Enter PIN → clock in
- [ ] Verify TimeLog created with fast_track_approval=True
- [ ] Admin approves via fast-track UI
- [ ] Verify payroll includes approved kiosk logs
- [ ] Simulate offline → go online → verify sync

---

## 11. ROLLOUT PLAN

### Pilot (1 company)
- Deploy to 1 trusted company (2 weeks)
- Run parallel with existing system (employees can use app or kiosk)
- Collect feedback: email lookup UX, PIN confusion, sync issues
- Weekly check-ins with company admin

### Closed Beta (5-10 companies)
- Expand to cohort of companies requesting feature
- Monitor: device sync status, error rates, support tickets
- Iterate on feedback
- Document learnings

### General Availability (GA)
- Open to all companies
- Monitor: adoption rate, support burden, device sync health
- Plan v2 features based on usage patterns

---

## 12. RISKS & MITIGATIONS

| Risk | Impact | Mitigation |
|------|--------|-----------|
| Token leaked (stolen tablet) | ❌ Attacker impersonates device | 30-day expiry + auto-rotate; admin can revoke |
| Employee spoofing (wrong person clocks in) | ❌ Inaccurate time logs | Photo + name confirmation + PIN |
| Network failure (no WiFi) | ⚠️ Kiosk can't clock in | Real-time only (not offline); assume WiFi; add offline in v2 if needed |
| Device misbehavior (stuck on error screen) | ⚠️ Employees frustrated | Robust error handling; admin remote reboot via dashboard |
| High admin burden (many kiosks to manage) | ⚠️ Kontokaz overloaded | Self-serve registration reduces burden |
| Payroll includes wrong kiosk logs | ❌ Wage-theft / underpayment | Fast-track approval (admin reviews before payroll) |

---

## 13. SUCCESS METRICS

- ✅ Device registration: < 5 min per device
- ✅ Employee lookup: < 2 sec (end-to-end)
- ✅ Clock-in success rate: > 99% with WiFi
- ✅ Admin approval time: < 30 sec for 100 logs
- ✅ Support tickets: < 2 per company per month
- ✅ Adoption: > 50% of companies use kiosk within 6 months
- ✅ Data accuracy: 0 wage discrepancies traced to kiosk logs in payroll audit

---

## 14. OPEN QUESTIONS FOR CLAUDE

1. **Token Rotation**: Should expired tokens auto-issue new ones or require manual re-registration?
2. **Photo Source**: Where do employee photos come from? Company upload? Default avatar?
3. **PIN Storage**: Store in PrivateUser or separate KioskPIN table? Hashed or encrypted?
4. **Tablet Procurement**: Will Kontokaz provide tablets or companies BYOD?
5. **Support Model**: Should companies contact Kontokaz or have self-service troubleshooting?
6. **Geofencing**: Should kiosk verify location (e.g., must be at company HQ to register)?
7. **Accessibility**: Should kiosk support languages other than English (i18n)?
8. **Biometric Optional**: Should we reserve architecture for future face recognition / NFC?

---

## 15. ARCHITECTURE DIAGRAM

```
┌─────────────────────────────────────────────────────────────────┐
│                        KIOSK SYSTEM OVERVIEW                    │
└─────────────────────────────────────────────────────────────────┘

┌──────────────────┐
│  Tablet/Kiosk    │
│  (React SPA)     │
│                  │
│  - Lookup UI     │
│  - Photo confirm │
│  - PIN entry     │
│  - IndexedDB     │
│    (offline)     │
└────────┬─────────┘
         │
         │ X-Kiosk-Token
         │ (30-day JWT)
         │
         ▼
┌──────────────────────────────────────────────────────────────┐
│              BACKEND (FastAPI)                               │
│                                                              │
│  ┌────────────────────────────────────────────────────────┐ │
│  │ POST /kiosk/clock-in                                 │ │
│  │ - Validate token (KioskService.validate_kiosk_token) │ │
│  │ - Lookup employee (find_employee_by_email_or_phone)  │ │
│  │ - Create TimeLog (created_source='kiosk')            │ │
│  │ - Set fast_track_approval=True                       │ │
│  │ - Record AuditLog                                    │ │
│  └────────────────────────────────────────────────────────┘ │
│                                                              │
│  Database:                                                   │
│  - KioskDevice (device_id, company_id, token_hash, TTL)    │
│  - TimeLog (timelog_id, ..., created_source, fast_track)   │
│  - AuditLog (..., source='kiosk')                          │
└──────────────────────────────────────────────────────────────┘

         │
         │ Fast-track logs
         │
         ▼
┌──────────────────────────────────────────────────────────────┐
│         ADMIN DASHBOARD (Next.js)                            │
│                                                              │
│  ┌────────────────────────────────────────────────────────┐ │
│  │ Device Management                                      │ │
│  │ - Register device → get token                         │ │
│  │ - View sync status, rotate token                      │ │
│  └────────────────────────────────────────────────────────┘ │
│                                                              │
│  ┌────────────────────────────────────────────────────────┐ │
│  │ Fast-Track Approval UI                               │ │
│  │ - Show: "47 device entries ready to approve"         │ │
│  │ - Action: "Approve All" (1-click)                    │ │
│  │ - Option: Drill-down to review individual entries    │ │
│  └────────────────────────────────────────────────────────┘ │
└──────────────────────────────────────────────────────────────┘

         │
         │ Approved logs
         │
         ▼
┌──────────────────────────────────────────────────────────────┐
│               PAYROLL ENGINE                                 │
│                                                              │
│  - Fetches TimeLog where admin_approved=True                │
│  - Includes kiosk entries (fast-tracked + approved)         │
│  - Generates paychecks                                      │
└──────────────────────────────────────────────────────────────┘
```

---

## 16. FILES TO CREATE / MODIFY

### Backend

**Create:**
- `backend/services/kiosk_service.py` — Device registration, validation, employee lookup, time log creation
- `backend/api/v1/kiosk.py` — API endpoints for admin registration + kiosk operations
- `backend/alembic/versions/XXX_add_kiosk_device.py` — Migration for KioskDevice table

**Modify:**
- `backend/core/model.py` — Add KioskDevice model; extend TimeLog with created_source + fast_track_approval
- `backend/core/dependencies.py` — Add get_kiosk_context() for token auth
- `backend/db_models/crud/job.py` — Modify create_time_log() to handle kiosk source + fast-track
- `backend/api/v1/__init__.py` — Register new kiosk router

### Frontend

**Create:**
- `web/ivor-web/src/app/(platform)/admin/kiosks/page.tsx` — Device list + management
- `web/ivor-web/src/app/(platform)/admin/kiosks/register/page.tsx` — Device registration form
- `web/ivor-web/src/app/(platform)/admin/kiosks/approvals/page.tsx` — Fast-track approval UI
- `web/ivor-web/src/app/kiosk/page.tsx` — Main kiosk UI (lookup, confirm, clock-in)
- `web/ivor-web/src/services/kiosks.ts` — API client for kiosk endpoints
- `web/ivor-web/src/components/KioskLookup.tsx` — Employee search component
- `web/ivor-web/src/components/KioskConfirmation.tsx` — Photo + PIN confirmation

---

## 17. NEXT STEPS

1. **Clarify Open Questions** (Section 14) with stakeholders
2. **Finalize Approval Workflow** — exact UI for fast-track approval
3. **Design PIN/Photo Strategy** — flow + UX for employee verification
4. **Estimate Effort** — engineer capacity for 5-phase rollout
5. **Set Pilot Timeline** — when to launch with first company
6. **Define Monitoring** — alerts, dashboards, KPIs to track
7. **Create Runbook** — troubleshooting guide for support team
8. **Begin Phase 1 Backend Work** — start with models + service layer

---

**Document Version**: 1.0 (2026-05-29)  
**Status**: Ready for Implementation  
**Owner**: [Your Team]
