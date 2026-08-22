# Ivor — Sprint Plan (Dev Phase)

**Status:** Development Phase
**Updated:** 2026-04-03
**Reference files:**
- `ENGINEERING_AUDIT.md` — full audit checklist
- `web/DASHBOARD_ROADMAP.md` — full feature roadmap

---

## Rule of Thumb

Build features + pair the audit items that directly support that feature.
Every sprint has a feature goal and 2–4 audit items bundled in.
Tick off items as completed.

---

## This Week — Do Once, Never Revisit

These 4 items take **11 hours total** and must be done before any other work.
They protect everything built after them.

- [ ] **Rotate secrets + move to `.env` file** — 2h
  Even in dev, get into the habit. `JWT_SECRET`, `SMTP_USER`, `SMTP_PASS` out of `docker-compose.yml` now.

- [ ] **Rate limiting on auth endpoints** — 4h
  Add `slowapi`. Protect `/login`, `/forgot-password`, `/verify-otp` with `5/minute`.

- [ ] **HTTPS + Nginx** — 4h
  Set up locally with self-signed cert. No production surprises.

- [ ] **CORS from environment variable** — 1h
  `allow_origins=os.getenv("CORS_ORIGINS", "").split(",")` — stops breaking when dev IP changes.

---

## Sprint 1 — Attendance & Time Logs

**Feature goal:** Company-wide view of who worked when. Live sessions + full history table + export.
**Reference:** `web/DASHBOARD_ROADMAP.md` → Sprint 1

### Feature tasks
- [ ] `GET /job/time-logs/company/{company_id}` backend endpoint
- [ ] `attendance/page.tsx` — page scaffold
- [ ] `AttendanceDateFilter.tsx` — period presets
- [ ] `AttendanceSummaryCards.tsx` — live count cards
- [ ] `LiveSessionsTable.tsx` — auto-refresh every 60s
- [ ] `TimeLogTable.tsx` — full history, sortable, filterable
- [ ] `TimeLogDetailDrawer.tsx` — slide-in session detail
- [ ] `AttendanceExportButton.tsx` — CSV download
- [ ] Sidebar: add Attendance nav item

### Audit items (pair with this sprint)
- [ ] **DB indexes on all foreign keys** (audit #5) — 4h
  `Job.company_id`, `TimeLog.job_id`, `TimeLog.private_user_id`, `PrivateUser.company_id`

- [ ] **Fix `DateTime(timezone=True)` on all columns** (audit #6) — 4h
  Every clock-in recorded with wrong timezone = wrong payroll data permanently.

- [ ] **Resolve Alembic merge heads** (audit #7) — 2h
  Run `alembic merge heads` and validate on fresh DB before adding more migrations.

- [ ] **Add health check endpoint** (audit #8) — 30min
  `GET /health` returns `{"status": "ok", "db": "connected"}`.

---

## Sprint 2 — Salary Management

**Feature goal:** Company admins view and configure every employee's pay rate from web. No more mobile-only salary setup.
**Reference:** `web/DASHBOARD_ROADMAP.md` → Sprint 2

### Feature tasks
- [ ] `salaries/page.tsx` — page scaffold
- [ ] `SalaryListTable.tsx` — all employees with rate, currency, status
- [ ] `SalaryConfigModal.tsx` — create/edit salary form
- [ ] `MissingSalaryBanner.tsx` — alert for unconfigured employees
- [ ] `SalaryTab.tsx` — add to existing employee detail page
- [ ] Sidebar: add Salaries nav item

### Audit items (pair with this sprint)
- [ ] **Pagination on all list endpoints** (audit #11) — 3d
  `skip: int = 0, limit: int = 50` on every list endpoint. Salary list needs this.

- [ ] **Pin dependency versions** (audit #9) — 2h
  `pip freeze > requirements.txt` in clean venv.

---

## Sprint 3 — Compliance & Permit Manager

**Feature goal:** Company-wide permit expiry view, compliance score, minimum wage check, OT legal limit check.
**Reference:** `web/DASHBOARD_ROADMAP.md` → Sprint 3

### Feature tasks
- [ ] `compliance/page.tsx` — page scaffold
- [ ] `ComplianceScoreCard.tsx` — overall score X/100
- [ ] `PermitStatusTable.tsx` — employee, permit type, expiry, status, action
- [ ] `ExpiryTimeline.tsx` — 90-day visual timeline
- [ ] `ComplianceFlagBanner.tsx` — dismissable alert
- [ ] `PermitDetailDrawer.tsx` — click employee → detail + reminder button
- [ ] `ComplianceExportButton.tsx` — CSV export
- [ ] `OvertimeComplianceCard.tsx` — legal OT limit check (MU: 45h, MG: 40h)
- [ ] `MinimumWageCard.tsx` — flag employees below minimum wage
- [ ] Sidebar: add Compliance nav item with red badge

### Audit items (pair with this sprint)
- [ ] **Soft deletes on critical tables** (audit #12) — 1w
  Add `deleted_at`, `deleted_by` to: `PrivateUser`, `Job`, `TimeLog`, `Leave`, `UserRight`, `DocumentVault`, `Salary`.
  Compliance data can never be hard deleted.

- [ ] **Consistent audit trail** (audit #15) — 1w
  Create `audit_service.py`. Call on: salary change, leave approve/reject, OT decision, user deletion, role change.

---

## Sprint 4 — Worker Rights & Dispute Center

**Feature goal:** Two-channel rights system. Anonymized external stats + full internal dispute Kanban workflow.
**Reference:** `web/DASHBOARD_ROADMAP.md` → Sprint 4

### Feature tasks
- [ ] `disputes/page.tsx` — page scaffold with tabs (Internal / External Stats)
- [ ] `ExternalReportStats.tsx` — aggregate only, no names
- [ ] `ExternalReportBanner.tsx` — privacy explanation banner
- [ ] `DisputeKanban.tsx` — New → Under Review → Awaiting Worker → Resolved
- [ ] `DisputeCard.tsx` — card with urgency border, days open counter
- [ ] `DisputeDetailModal.tsx` — 4 tabs: Report, Investigation, Resolution, Audit Log
- [ ] `DisputeStatsCards.tsx` — total, open, avg resolution time
- [ ] `DisputeAssignModal.tsx` — assign to HR manager
- [ ] `EvidencePanel.tsx` — file attachments
- [ ] `ResolutionForm.tsx` — structured close with action taken
- [ ] `DisputeExportButton.tsx` — full PDF audit trail
- [ ] `AnonymousModeToggle.tsx`
- [ ] Backend: extend `UserRight` model with `assigned_to`, `resolution`, `closed_at`, `closed_by`
- [ ] Sidebar: add Disputes nav item with open count badge

### Audit items (pair with this sprint)
- [ ] **Background job queue — ARQ or Celery** (audit #13) — 1w
  PDF export will time out without async. Also needed for email sending and push notifications.

- [ ] **Structured JSON logging** (audit #17) — 4h
  Disputes need traceable logs. Add `pythonjsonlogger` with `user_id`, `company_id`, `request_id` fields.

---

## Sprint 5 — Overtime Management

**Feature goal:** Dedicated page to review, bulk approve/reject OT. Shows estimated cost using salary from Sprint 2.
**Reference:** `web/DASHBOARD_ROADMAP.md` → Sprint 5

### Feature tasks
- [ ] `GET /job/time-logs/company/{id}/overtime` backend endpoint
- [ ] Extend `PUT /job/time-log/{id}/overtime` with `action` field
- [ ] `overtime/page.tsx` — page scaffold
- [ ] `OvertimePendingTable.tsx` — employee, date, OT hrs, reason, estimated cost
- [ ] `OvertimeHistoryTable.tsx` — resolved OT with filter
- [ ] `OvertimeDetailModal.tsx` — full session + approve/reject form
- [ ] `BulkActionBar.tsx` — floating approve/reject all selected
- [ ] `OvertimeCostSummary.tsx` — pending OT cost cards
- [ ] Sidebar: add Overtime nav item with orange badge

### Audit items (pair with this sprint)
- [ ] **File upload validation** (audit #10) — 3h
  MIME type check, 10MB size limit, filename sanitization on all upload endpoints.

- [ ] **Move request logging to stdout** (audit #14) — 4h
  Remove `RequestLog` DB writes from `main.py`. Output JSON to stdout. Keep `AuditLog` for business events only.

---

## Sprint 6 — Smart Employee Onboarding Wizard

**Feature goal:** Compliance-first 6-step new hire flow. Tourist visa warning, minimum wage check, document upload, draft saving.
**Reference:** `web/DASHBOARD_ROADMAP.md` → Sprint 6

### Feature tasks
- [ ] `employees/onboard/page.tsx`
- [ ] `OnboardingStepper.tsx` — 6-step progress bar
- [ ] `Step1_PersonalInfo.tsx` — name, DOB, nationality, passport
- [ ] `Step2_WorkAuthorization.tsx` — permit type, number, expiry, upload
- [ ] `Step3_JobDetails.tsx` — title, department, start date, hours
- [ ] `Step4_SalaryConfig.tsx` — rate, currency, deductions + min wage check
- [ ] `Step5_DocumentUpload.tsx` — drag-drop to vault
- [ ] `Step6_InviteReview.tsx` — compliance summary + send invite
- [ ] `ComplianceCheckBanner.tsx` — green/amber/red per check
- [ ] `OnboardingProgressCard.tsx` — in-progress hires on employees list
- [ ] Backend: `POST /company/{id}/onboard` atomic endpoint
- [ ] Draft saving to localStorage

### Audit items (pair with this sprint)
- [ ] **Feature flags** (audit #18) — 3d
  `CompanyFeatureFlag(company_id, feature_name, enabled)` table. Use before rolling out compliance module to all companies.

- [ ] **ToS/DPA acceptance tracking** (audit #27) — 3d
  Add `tos_accepted_at`, `tos_version`, `dpa_accepted_at` to `Company` model. Show on first login.

---

## Sprint 7 — Schedule Planner

**Feature goal:** Weekly shift grid with drag-drop. Conflict detection (leave clash, permit expired). Publish → employee sees on mobile.
**Reference:** `web/DASHBOARD_ROADMAP.md` → Sprint 7

### Feature tasks
- [ ] `schedule/page.tsx` — page scaffold
- [ ] `WeeklyGrid.tsx` — 7-column × employee rows, drag-drop
- [ ] `ShiftCell.tsx` — time, location, color by type
- [ ] `ShiftModal.tsx` — create/edit shift
- [ ] `WeekNavigator.tsx` — prev/next week
- [ ] `PublishBar.tsx` — unpublished changes count + publish button
- [ ] `ConflictIndicator.tsx` — leave clash, permit expired, over hours
- [ ] Backend: `DELETE /job/schedules/{id}`
- [ ] Sidebar: add Schedule nav item

### Audit items (pair with this sprint)
- [ ] **Redis caching** (audit #16) — 1w
  Cache sector/reference data (1h TTL). Cache company stats (60s TTL). Add `redis` to `requirements.txt`.

- [ ] **N+1 query fixes** (audit #31) — 3d
  Audit all `db.query(X).all()` calls that access related objects in a loop. Add `joinedload()`.

---

## Sprint 8 — Notifications Center

**Feature goal:** Company notification inbox. Backend already wired — just needs web list view.
**Reference:** `web/DASHBOARD_ROADMAP.md` → Sprint 8

### Feature tasks
- [ ] `notifications/page.tsx`
- [ ] `NotificationList.tsx`
- [ ] `NotificationItem.tsx` — colored left border, bold unread, relative timestamp
- [ ] `NotificationFilterTabs.tsx` — All / Unread / Leave / Overtime / Compliance / Disputes
- [ ] `MarkAllReadButton.tsx`
- [ ] Backend: `GET /company/{id}/notifications` if not exists
- [ ] Sidebar bell icon: unread count badge, poll every 2min

### Audit items (pair with this sprint)
- [ ] **Expo push token refresh on app foreground** (audit #21) — 4h
  On every `AppState → active`: call `getExpoPushTokenAsync()`, PATCH to `/user/me/push-token`. Handle `DeviceNotRegistered`.

- [ ] **Mobile crash reporting — Sentry** (audit #24) — 4h
  Add `@sentry/react-native`. Initialize in `_layout.tsx`.

---

## Sprint 9 — Document Management (Company Push)

**Feature goal:** Company admins push contracts, payslips, permits to employee document vaults. Bulk payslip upload.
**Reference:** `web/DASHBOARD_ROADMAP.md` → Sprint 9

### Feature tasks
- [ ] Backend: `GET /vault/company/{company_id}`
- [ ] `documents/page.tsx`
- [ ] `DocumentListTable.tsx` — all company-uploaded docs with expiry status
- [ ] `UploadDocumentModal.tsx` — type, target employees, expiry, notes
- [ ] `BulkPayslipUpload.tsx` — same doc to multiple employees
- [ ] `ExpiryAlertBanner.tsx` — permits expiring soon
- [ ] Sidebar: add Documents nav item

### Audit items (pair with this sprint)
- [ ] **Worker permit verification** (audit #32) — 1w
  Require document upload + company admin sign-off before permit marked "Confirmed."

---

## Sprint 10 — Reports & Analytics

**Feature goal:** Charts for headcount, attendance rate, leave utilization, OT cost, compliance score trend, dispute resolution rate.
**Reference:** `web/DASHBOARD_ROADMAP.md` → Sprint 10

### Feature tasks
- [ ] `npm install recharts`
- [ ] `reports/page.tsx`
- [ ] `ReportFilters.tsx` — period picker, department filter
- [ ] `HeadcountTrendChart.tsx`
- [ ] `AttendanceRateChart.tsx`
- [ ] `LeaveUtilizationChart.tsx`
- [ ] `OvertimeCostChart.tsx`
- [ ] `ComplianceScoreTrend.tsx`
- [ ] `DisputeResolutionChart.tsx`
- [ ] `ExportReportButton.tsx` — CSV download
- [ ] Sidebar: add Reports nav item

### Audit items (pair with this sprint)
- [ ] **WebSockets for live attendance dashboard** (audit #29) — 1w
  Replace 60s polling with `ws://api/v1/company/{id}/live`. One persistent connection per session.

- [ ] **EAS Build + GitHub Actions CI/CD** (audit #23) — 4h
  Auto-build iOS + Android on merge to main. Submit to TestFlight + internal track.

---

## Permission Manager (Settings — runs across sprints 2–4)

**Feature goal:** Full permission management UI matching reference design.
**Reference:** `web/DASHBOARD_ROADMAP.md` → Company Access & Role Management

### Feature tasks
- [ ] Backend: `CompanyRole` model with `permissions` JSONB column
- [ ] Backend: `GET/POST/PUT/DELETE /company/{id}/roles`
- [ ] Backend: `GET/PUT /company/{id}/roles/{id}/permissions`
- [ ] Backend: `GET /company/{id}/permissions` — grouped permission definitions
- [ ] `settings/permissions/page.tsx`
- [ ] `PermissionManagerHeader.tsx` — 4 stat cards (Total Roles, Permissions, Users, Users with Roles)
- [ ] `RolesManagementTab.tsx` — role list with user count, system badge, Edit/Delete
- [ ] `PermissionsOverviewTab.tsx` — grouped by feature, "Used by X roles" label, search
- [ ] `UserManagementTab.tsx` — users with assigned role, change role button
- [ ] `CreateRoleModal.tsx` — name, description, grouped permission checkboxes
- [ ] `EditPermissionsModal.tsx` — feature groups with checkboxes, Update Permissions CTA
- [ ] `PermissionGroup.tsx` — reusable section header + permission cards
- [ ] `AssignRoleModal.tsx` — select users → assign role

### Department Management tasks
- [ ] Backend: add `head_user_id` to Department model
- [ ] `settings/departments/page.tsx`
- [ ] `DepartmentList.tsx` — name, head, member count
- [ ] `DepartmentFormModal.tsx` — create/edit with head selector
- [ ] `DepartmentMembersDrawer.tsx` — employees in dept, reassign button
- [ ] `DepartmentDeleteModal.tsx` — reassign members before delete

---

## Leave Until Pre-Launch

Do not start these until Sprints 1–10 are complete.

- [ ] **Billing / Stripe integration** (audit #19) — 2w
  Before signing company #2.

- [ ] **i18n — French + English** (audit #20) — 2w
  `i18next` on mobile, `next-intl` on web. French covers Madagascar.

- [ ] **Right to erasure endpoint** (audit #26) — 1w
  `POST /user/me/erasure-request` → admin confirms → PII nulled, record kept anonymized.

- [ ] **Webhook / integration system** (audit #30) — 2w
  Before enterprise sales conversations.

- [ ] **Data residency decision** (audit #25) — legal discussion
  AWS `af-south-1` vs Mauritius-based hosting vs data transfer agreements.

- [ ] **Automated DB backups + RTO documentation** (audit #28) — 4h
  When moving to production hosting.

- [ ] **Offline clock-in for mobile** (audit #22) — 1w
  Queue locally, sync on connectivity. Field workers in rural Madagascar.

- [ ] **Payroll module** — separate branch
  Needs Sprints 1 (time logs), 2 (salary), 5 (OT approval) complete first.

---

## Completed

<!-- Move items here with completion date as sprints are done -->
<!-- Example: -->
<!-- - [x] Rotate secrets — done 2026-04-05 -->
