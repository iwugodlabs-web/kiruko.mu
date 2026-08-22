# Ivor Web Dashboard — Competitive Roadmap

## Strategic Position

Every competitor (Deputy, BambooHR, Factorial, Deel, Gusto) treats all employees as interchangeable. None of them handle:

- Workers on tourist visas (illegal work risk for the company)
- Work permit expiry creating overnight legal exposure
- Migrant workers who can't read the interface in English
- Complaint systems that protect workers AND companies from labor tribunal

Ivor is already building this infrastructure in mobile (rights reporting, permit fields, document vault, multi-currency). The web dashboard must make it **operational at company scale**. That is the differentiation. Not payroll — every HRIS does payroll. The moat is compliance intelligence + worker protection, built for this region.

**Direct competitors have NONE of these:**
1. Immigration/permit compliance tracking at company level
2. Worker rights dispute resolution with audit trail
3. Automatic compliance scoring (% of workforce legally authorized)
4. GPS integrity for clock-in (fraud detection)
5. Employee onboarding that checks legal work authorization as Step 1

**Build order** (each sprint feeds the next, payroll is last / separate branch):

1. Attendance & Time Logs — data foundation
2. Salary Management — prerequisite for accurate payroll
3. **Compliance & Permit Manager** — differentiated, fast to build, uses existing data
4. **Worker Rights Dispute Center** — differentiated, extends existing complaint API
5. Overtime Management — feeds payroll accuracy
6. **Smart Employee Onboarding** — compliance-first new hire flow
7. Schedule Planner — operational scheduling
8. Notifications Center — backend already wired
9. Document Management (company push) — extends mobile vault
10. Reports & Analytics — aggregates everything
11. Payroll — last (separate branch)

---

## Sprint 1: Attendance & Time Logs

*Core data foundation. Mobile "Time Logs" screen equivalent on web.*

### Pages
```
src/app/(platform)/dashboard/attendance/page.tsx
src/app/(platform)/dashboard/attendance/components/
  AttendanceDateFilter.tsx       ← Period presets: Today / This Week / This Month / Custom
  AttendanceSummaryCards.tsx     ← Live: clocked-in count | Total hrs today | Absent | OT flagged
  LiveSessionsTable.tsx          ← Real-time: employee, job, clocked-in at, duration, break status
  TimeLogTable.tsx               ← History: employee, date, in, out, break mins, total hrs, OT, status
  TimeLogDetailDrawer.tsx        ← Slide-in: full session timeline, GPS location, breaks, OT flag
  AttendanceExportButton.tsx     ← CSV of current filtered view
```

### New backend endpoint
```python
GET /job/time-logs/company/{company_id}
  params: start_date, end_date, department_id, limit=50, offset=0
  joins: TimeLog → Job → PrivateUser → Department
  returns: employee_name, job_title, department, start_time, end_time, hours_worked,
           break_minutes, overtime_flagged, location, breaks[]
```

### TimeLogTable columns
```
Employee | Dept | Date | Clock In | Clock Out | Break | Total Hrs | OT | Status
```
- Status: Active (green pulse) | Complete | Incomplete (amber) | Overtime (orange)
- Live table auto-refreshes every 60s

### Sidebar
```typescript
{ label: 'Attendance', icon: Clock, href: '/dashboard/attendance' }
```

### Verification
- Today's logs load on open; filter to last 7 days works
- Live table refreshes without page reload
- Click row → drawer shows session detail + GPS string
- Export → CSV with correct columns

---

## Sprint 2: Salary Management

*Mobile "Salaries" screen equivalent. Required before OT cost calculation or payroll.*

### Pages
```
src/app/(platform)/dashboard/salaries/page.tsx
src/app/(platform)/dashboard/salaries/components/
  SalaryListTable.tsx            ← All employees: name, rate, currency, contracted hrs, deductions, status
  SalaryConfigModal.tsx          ← Create/edit: hourly rate, currency, monthly hrs, work days, break mins, deductions
  MissingSalaryBanner.tsx        ← "X employees have no salary configured" alert
```

### Also: Salary tab on existing employee detail page
```
src/app/(platform)/dashboard/employees/[id]/components/SalaryTab.tsx
```

### API reuse (all exist)
- `GET /job/salary/{job_id}` — load salary
- `POST /job/salary` — create
- `PUT /job/salary/{id}` — update
- `PUT /job/simple/{job_id}` — update job fields (hours, work days, deduction flags)

### SalaryListTable columns
```
Employee | Job Title | Dept | Rate | Currency | Contracted Hrs/Mo | Deductions | Status
```
- Status: Configured (green) | Missing (red) | Partial (amber)
- Missing salary rows highlighted red
- Inline "Edit" opens `SalaryConfigModal`

### Verification
- Employees without salary shown red with "Configure" CTA
- Save → table row updates; toast confirms
- Currency options include MUR and MGA

---

## Sprint 3: Compliance & Permit Manager ⭐ DIFFERENTIATOR

*No competitor in this region has this. Company-wide view of work authorization status for every employee. One expiring permit = legal exposure.*

### Problem it solves
A company with 50 migrant workers needs to know today: who has a valid permit, who is expiring in 30 days, who is working on a tourist visa (illegal). Currently no tool gives company admins this view. Ivor already captures `work_permit_type`, `has_permission_to_work`, `working_on_tourist_visa` on the `Job` model and document vault tracks permit expiry. This sprint surfaces it all in one command view.

### Pages
```
src/app/(platform)/dashboard/compliance/page.tsx
src/app/(platform)/dashboard/compliance/components/
  ComplianceScoreCard.tsx        ← Overall score: X/100 based on % compliant employees
  PermitStatusTable.tsx          ← All employees: name, permit type, expiry date, status, action
  ExpiryTimeline.tsx             ← Visual timeline: permits expiring in next 90 days
  ComplianceFlagBanner.tsx       ← "3 employees need action this week" dismissable alert
  PermitDetailDrawer.tsx         ← Click employee → permit info, document link, renewal reminder btn
  ComplianceExportButton.tsx     ← Export compliance report for HR/legal records
  OvertimeComplianceCard.tsx     ← Check if weekly OT exceeds legal max (MU: 45h, MG: 40h)
  MinimumWageCard.tsx            ← Flag if any employee rate < country minimum wage
```

### Compliance Score algorithm
```typescript
score = 0
each employee:
  +20 if has_permission_to_work == true
  +20 if work_permit_type not in ['tourist_visa', 'none']
  +20 if permit not expired (from document vault expiry_date)
  +20 if permit not expiring in 30 days
  +20 if salary >= country minimum wage (MU: MUR 11,275/mo; MG: MGA 258,960/mo)
companyScore = average(employeeScores)
```

### PermitStatusTable columns
```
Employee | Nationality | Permit Type | Expiry Date | Days Left | Status | Document | Action
```
- Status chips: Valid (green) | Expiring Soon (amber, ≤30d) | Expired (red) | Tourist Visa (red) | No Data (gray)
- "Tourist Visa" row highlighted red — employer at legal risk
- "Send Reminder" button → triggers email/push to employee to upload updated permit
- "View Document" → opens vault document URL in new tab

### ExpiryTimeline
- Horizontal timeline: next 90 days
- Dot per employee on their permit expiry date
- Hover tooltip: employee name, days left, permit type
- Red zone: <30d, amber: 30-60d, yellow: 60-90d

### OvertimeComplianceCard
- Reads weekly OT from time logs
- Mauritius: Employment Rights Act — max 45h/week
- Madagascar: Labour Code Art. 81 — max 40h/week + OT limits
- Shows "2 employees exceeded legal limit last week" → links to time log detail

### MinimumWageCard
- Reads salary hourly_rate × hours
- Compares to country minimum (auto-detected from company address)
- Shows "1 employee below minimum wage" → links to salary config

### Sidebar badge
```typescript
{ label: 'Compliance', icon: ShieldCheck, href: '/dashboard/compliance', badge: nonCompliantCount }
```
Red badge when compliance score < 80.

### Verification
- Compliance score updates when employee salary is set in Sprint 2
- Tourist visa employees always show red regardless of expiry
- Expiry timeline correct for 90-day window
- Export CSV has all permit data + status
- Send reminder → employee receives in-app notification

---

## Sprint 4: Worker Rights — Two-Channel System ⭐ DIFFERENTIATOR

*"Your Rights" has TWO separate channels with different visibility and privacy rules. The web builds the employer-facing side of both.*

### Two-channel architecture

**Channel A — External Reporting** (already on mobile, no employer visibility)
- Employee files complaint → labor authority, NGO, or embassy
- Employer is NOT notified — this protects vulnerable workers
- Ivor generates a structured PDF (with evidence attachments)
- Worker downloads/shares PDF independently
- Company admin web view: aggregate stats only ("X reports filed this month" — no names, no content)
- This channel is the worker's safety net against the employer

**Channel B — Internal Dispute** (new — employer side to build on web)
- Employee files complaint → employer through Ivor
- Employer sees it, can respond, assign to HR, resolve
- Has full workflow: received → reviewing → awaiting worker → resolved/rejected
- Audit trail kept for both sides (legal protection for employer too)

### Web: External Reporting Statistics Panel (read-only, anonymized)
```
src/app/(platform)/dashboard/disputes/components/
  ExternalReportStats.tsx        ← Aggregate only: count by category, by month (NO names/details)
  ExternalReportBanner.tsx       ← Informational: "These reports went to external mediators.
                                     You cannot view their content to protect worker privacy."
```

### Web: Internal Dispute Resolution Center (full workflow)

### Problem it solves
An employee files an internal complaint (payroll error, hostile manager, unsafe conditions). Company admin currently has no structured workflow — the complaint is visible in a basic list in `Complaints.tsx` but there's no resolution pipeline. Building this creates: documented resolution trails (legal protection for company), visible response times, accountability, and closure for workers.

### Pages
```
src/app/(platform)/dashboard/disputes/page.tsx
src/app/(platform)/dashboard/disputes/components/
  DisputeKanban.tsx              ← Kanban board: New → Under Review → Resolved / Rejected
  DisputeCard.tsx                ← Card: employee, category, urgency, days open, status
  DisputeDetailModal.tsx         ← Full dispute: description, timeline, attachments, response field
  DisputeStatsCards.tsx          ← Total | Open | Avg Resolution Time | Resolved This Month
  DisputeAssignModal.tsx         ← Assign dispute to specific HR manager
  EvidencePanel.tsx              ← View attached files + add employer evidence
  ResolutionForm.tsx             ← Structured resolution: action taken, compensation, date closed
  DisputeExportButton.tsx        ← Export full audit trail as PDF (for labor tribunal if needed)
  AnonymousModeToggle.tsx        ← View complaints without seeing employee identity (for sensitive cases)
```

### API reuse
- `GET /user/user-rights` — existing, returns all complaints
- `GET /user/user-right/{id}` — detail
- `PATCH /user/user-right/{id}` — update status (add `assigned_to`, `resolution`, `closed_at`)

### New backend fields (extend UserRight model)
```python
# backend/core/model.py — UserRight additions
assigned_to = Column(Integer, ForeignKey("users.user_id"), nullable=True)
resolution = Column(Text, nullable=True)
internal_notes = Column(Text, nullable=True)
closed_at = Column(DateTime, nullable=True)
closed_by = Column(Integer, ForeignKey("users.user_id"), nullable=True)
is_anonymous_view = Column(Boolean, default=False)  # hide worker identity from employer
```

### DisputeKanban columns
```
NEW         | UNDER REVIEW     | AWAITING WORKER  | RESOLVED  | REJECTED
[card]      | [card]           | [card]           | [card]    | [card]
```
- Drag card to move status → API update
- Urgency badge: high = red border, medium = amber, low = gray
- Days open counter turns red at >7 days

### DisputeDetailModal tabs
1. **Report** — original submission: description, category, urgency, expected outcome, attachments
2. **Investigation** — internal notes, assigned manager, evidence uploads
3. **Resolution** — action taken, date closed, worker notified, compensation if any
4. **Audit Log** — full status history with timestamps and who moved each state

### PDF Export
- Full audit trail: submission → assignments → responses → resolution
- Suitable for labor tribunal or legal review
- Stamped with Ivor logo and company name

### Sidebar badge
```typescript
{ label: 'Disputes', icon: Scale, href: '/dashboard/disputes', badge: openDisputeCount }
```

### Verification
- New complaint appears in "New" column within seconds (pull or websocket)
- Drag to "Under Review" → DB status updates → mobile employee sees status change
- Assign to HR manager → they see badge count increment
- Close with resolution → employee receives push notification
- Export PDF includes complete history

---

## Sprint 5: Overtime Management

*Dedicated page for reviewing and approving OT. Needs time logs (S1) and salaries (S2) to show accurate cost.*

### Pages
```
src/app/(platform)/dashboard/overtime/page.tsx
src/app/(platform)/dashboard/overtime/components/
  OvertimePendingTable.tsx       ← Employee, date, regular hrs, OT hrs, reason, estimated cost
  OvertimeHistoryTable.tsx       ← Resolved OT with filter
  OvertimeDetailModal.tsx        ← Full session + approve/reject + confirmed hrs
  BulkActionBar.tsx              ← Floating: Approve All / Reject All selected
  OvertimeCostSummary.tsx        ← Cards: pending OT hrs, estimated cost at 1.5×
```

### New backend endpoint
```python
GET /job/time-logs/company/{company_id}/overtime
  params: status=pending|approved|rejected, start_date, end_date

PUT /job/time-log/{timelog_id}/overtime
  body: { action: "approve"|"reject", reason?: str, confirmed_hours?: float }
  → NotificationService.notify_employee_overtime_confirmed/rejected (already exists)
```

### OvertimePendingTable columns
```
☐ | Employee | Dept | Date | Regular Hrs | OT Hrs | Reason | Estimated Cost (1.5×) | Actions
```

### Sidebar badge
- Show orange badge: `getDashboardStats().overview.activeOvertime`

### Verification
- Pending tab shows unresolved OT only
- Estimated cost = OT hrs × salary hourly_rate × 1.5
- Bulk approve → all update in single API call
- Employee push notification fires after approval

---

## Sprint 6: Smart Employee Onboarding Wizard ⭐ DIFFERENTIATOR

*End-to-end compliance-first new hire flow. Competitors have "add employee" forms. Ivor has a wizard that ensures every hire is legal before they start.*

### Problem it solves
Currently: invite employee → they set up their own job via mobile → admin verifies → admin separately configures salary → etc. This is fragmented. A company adding 20 employees at once is painful. This wizard handles it in one flow, compliance-first.

### Pages
```
src/app/(platform)/dashboard/employees/onboard/page.tsx
src/app/(platform)/dashboard/employees/onboard/components/
  OnboardingStepper.tsx          ← Progress bar: 6 steps
  Step1_PersonalInfo.tsx         ← Name, DOB, nationality, passport number
  Step2_WorkAuthorization.tsx    ← Permit type, permit number, expiry date, upload permit doc
  Step3_JobDetails.tsx           ← Job title, department, start date, work hours, work days
  Step4_SalaryConfig.tsx         ← Hourly rate, currency, contracted hours, deductions
  Step5_DocumentUpload.tsx       ← Upload contract, ID, any other required docs to vault
  Step6_InviteReview.tsx         ← Summary of all steps + "Send Invite" button
  ComplianceCheckBanner.tsx      ← Shows "✓ Work authorization valid" or "⚠ Tourist visa detected"
  OnboardingProgressCard.tsx     ← Card showing % complete for partially-onboarded employees
```

### Flow
1. Admin clicks "Onboard New Employee"
2. **Step 1 — Identity**: enter name, DOB, nationality, passport #
3. **Step 2 — Work Authorization**: select permit type → if tourist visa → red warning banner: "This employee may not be legally authorized to work. Please verify before proceeding."
4. **Step 3 — Job Details**: title, department, start date, hours
5. **Step 4 — Salary**: rate, currency, deductions. Auto-check: if rate < country minimum wage → amber warning
6. **Step 5 — Documents**: drag-drop contract + permit scan → uploaded to vault
7. **Step 6 — Review & Send**: compliance summary card → shows green/amber/red for each check → "Send Invite"

### Draft saving
- Each step auto-saves to localStorage
- Admin can close and resume
- In-progress onboarding shown in "Pending Onboarding" list on employees page

### Onboarding Progress Table (on `/dashboard/employees`)
```
Employee | Steps Complete | Missing | Last Updated | Actions
John S.  | 4/6           | Salary, Documents | 2h ago | Resume
```

### API reuse & new
- All existing: `inviteCompanyUser()`, `POST /job/salary`, `POST /vault/upload`, `createDepartment`
- New: `POST /company/{id}/onboard` (bundled endpoint for atomic multi-step creation)

### Verification
- Tourist visa at Step 2 shows red banner (no hard block, just warning)
- Salary below minimum wage at Step 4 shows amber warning
- Complete → employee appears in roster + documents in vault
- Draft visible in employees list with "Resume" CTA

---

## Sprint 7: Schedule Planner

*Weekly shift grid where managers publish schedules. Employees see shifts on mobile.*

### Pages
```
src/app/(platform)/dashboard/schedule/page.tsx
src/app/(platform)/dashboard/schedule/components/
  WeeklyGrid.tsx                 ← 7 columns × employee rows, drag-drop
  ShiftCell.tsx                  ← Cell: start-end time, location, color by shift type
  ShiftModal.tsx                 ← Create/edit: employee, start, end, location, notes
  WeekNavigator.tsx              ← Prev/next week arrows
  PublishBar.tsx                 ← "X changes" + Publish → mobile push to employees
  ConflictIndicator.tsx          ← Leave clash, permit expired, >contracted hours warning
```

### API reuse & new
- `GET /job/schedules/company/{id}` (exists)
- `POST /job/schedules` (exists)
- `PATCH /job/schedules/{id}` (exists)
- `DELETE /job/schedules/{id}` (add to backend)

### Key differentiator: conflict detection
- Pull approved leaves → gray out those cells
- Pull compliance data → if employee permit expired → shift cell shows amber warning "Permit expired"
- Sum weekly hours → if > contracted → show "Over contracted hours" warning on row

### Verification
- Grid shows 7 days with employee rows
- Drag-drop updates via API
- Leave conflict shows blocked cell
- Publish → check mobile app shows new shifts

---

## Sprint 8: Notifications Center

*Quick win — backend `NotificationService` already creates DB records for every event.*

### Pages
```
src/app/(platform)/dashboard/notifications/page.tsx
src/app/(platform)/dashboard/notifications/components/
  NotificationList.tsx
  NotificationItem.tsx           ← Colored left border by type, bold when unread, relative timestamp
  NotificationFilterTabs.tsx     ← All | Unread | Leave | Overtime | Compliance | Disputes
  MarkAllReadButton.tsx
```

### API
```python
GET /user/notifications?type=&unread_only=&limit=&offset=
PUT /notification/{id}/read
PUT /notifications/read-all
# Add company-scoped version if needed:
GET /company/{id}/notifications
```

### Sidebar
Bell icon with unread count badge (poll every 2 min).

---

## Sprint 9: Document Management (Company Push)

*Company admins push contracts, payslips, and permits to employee document vaults.*

### Pages
```
src/app/(platform)/dashboard/documents/page.tsx
src/app/(platform)/dashboard/documents/components/
  DocumentListTable.tsx          ← All company-uploaded docs: name, type, employee, expiry, status
  UploadDocumentModal.tsx        ← Upload + tag: type, target employee(s), expiry, notes
  BulkPayslipUpload.tsx          ← Upload same doc to multiple employees at once
  ExpiryAlertBanner.tsx          ← "3 permits expiring in 30 days"
```

### API reuse (all exist from mobile)
- `POST /vault/upload`
- `GET /vault/{private_user_id}`
- `DELETE /vault/doc/{doc_id}`

### New backend endpoint
```python
GET /vault/company/{company_id}
  → all documents across all employees in this company
```

---

## Sprint 10: Reports & Analytics

*Meaningful only after time logs, salaries, OT, and schedules are accurate.*

### Pages
```
src/app/(platform)/dashboard/reports/page.tsx
src/app/(platform)/dashboard/reports/components/
  HeadcountTrendChart.tsx        ← Line: employee count over time
  AttendanceRateChart.tsx        ← Bar: % present by dept by week
  LeaveUtilizationChart.tsx      ← Stacked bar: annual/sick/emergency used vs budget
  OvertimeCostChart.tsx          ← Line: OT hours & cost by month (MUR/MGA)
  ComplianceScoreTrend.tsx       ← Line: compliance score over past 6 months
  DisputeResolutionChart.tsx     ← Bar: disputes opened vs closed per month
  ExportReportButton.tsx         ← CSV download
```

**Add `recharts`** to package.json.

---

---

## Company Access, Roles & Department Management (Dedicated Module)

*This is not one sprint — it spans multiple sprints as a cross-cutting concern. Documenting it fully here because the user asked to expand on it.*

### Current state
- Platform-level roles exist (`/admin/roles` → `RolesManagementSection.tsx`) — managed by platform admin
- Company-level roles are basic: `company_admin`, `manager`, `member` — set via `PATCH /company/{id}/users/{user_id}/role`
- Department CRUD exists (`getDepartments`, `createDepartment`, `updateDepartment`, `deleteDepartment`) but has NO dedicated web page — only used as a filter in the employee list
- No department head assignment
- No granular permission matrix per role
- No org chart / structure view

### What to build

#### A. Department Management Page (Sprint 1 prerequisite)
```
src/app/(platform)/dashboard/settings/departments/page.tsx
src/app/(platform)/dashboard/settings/departments/components/
  DepartmentList.tsx             ← All departments: name, head, member count, created date
  DepartmentFormModal.tsx        ← Create/edit: name, department head (select employee)
  DepartmentMembersDrawer.tsx    ← Slide-in: all employees in dept, reassign button
  DepartmentDeleteModal.tsx      ← Confirm + reassign members before delete
```

**API reuse (all exist):**
- `GET /company/{id}/departments`
- `POST /company/{id}/departments`
- `PUT /company/{id}/departments/{id}`
- `DELETE /company/{id}/departments/{id}`
- `PATCH /job/{id}/department` — reassign employee to new dept

**Department head:** Add `head_user_id` field to Department model (backend), expose in create/edit. Department head gets automatic `manager` scope for that department.

**DepartmentList columns:**
```
Name | Head | Members | Created | Actions
```

#### B. Permission Manager Page (Company Level)

**Reference design:** Permission Manager at `/dashboard/settings/permissions`

**Visual layout (dark-compatible, matches Ivor's existing theme):**
```
Dashboard > Permission Manager

Permission Manager                    [+ Create Role]  [↻ Sync Permissions]
Manage roles, permissions, and user access across your company

┌──────────────┐ ┌──────────────┐ ┌──────────────┐ ┌──────────────┐
│ 5            │ │ 32           │ │ 47           │ │ 12           │
│ Total Roles  │ │ Permissions  │ │ Total Users  │ │ Users w/Role │
└──────────────┘ └──────────────┘ └──────────────┘ └──────────────┘

[Roles Management] [Permissions Overview ●] [User Management]

Search roles...

┌─ Employee Management (6 permissions) ──────────────────────────────────┐
│ [✓ view employee]  [✓ create employee]  [  delete employee]            │
│ [✓ edit employee]  [  export employee]  [  onboard employee]           │
└────────────────────────────────────────────────────────────────────────┘

┌─ Salary & Payroll (5 permissions) ─────────────────────────────────────┐
│ [  view salary]   [  edit salary]   [  export payroll]                 │
│ [  lock payroll]  [  approve deductions]                               │
└────────────────────────────────────────────────────────────────────────┘
... (more feature groups)
```

**Edit Permissions Modal (per role):**
```
Edit Permissions
Manage permissions for: HR Manager

┌─ Employee Management ──────────────────────────────────────────────────┐
│ [✓] view employee                                                       │
│ [✓] create employee                                                     │
│ [  ] delete employee                                                    │
│ [✓] edit employee                                                       │
│ [  ] export employee data                                               │
│ [  ] onboard employee                                                   │
└────────────────────────────────────────────────────────────────────────┘

┌─ Salary & Payroll ─────────────────────────────────────────────────────┐
│ [✓] view salary                                                         │
│ [✓] edit salary                                                         │
│ [  ] export payroll                                                     │
│ [  ] lock payroll run                                                   │
│ [  ] approve deductions                                                 │
└────────────────────────────────────────────────────────────────────────┘
                                         [Cancel]  [Update Permissions]
```

**Files:**
```
src/app/(platform)/dashboard/settings/permissions/page.tsx
src/app/(platform)/dashboard/settings/permissions/components/
  PermissionManagerHeader.tsx    ← Stats cards (Total Roles, Permissions, Users, Users with Roles)
  RolesManagementTab.tsx         ← List of roles: name, description, user count, system badge, Edit/Delete
  PermissionsOverviewTab.tsx     ← Grouped permissions by feature, search, "Used by X roles" label
  UserManagementTab.tsx          ← List of users with their assigned role, change role button
  CreateRoleModal.tsx            ← Name, description, permission checkboxes grouped by feature
  EditPermissionsModal.tsx       ← Feature groups with checkboxes, "Update Permissions" CTA
  PermissionGroup.tsx            ← Reusable: section header + permission chip/card grid
  AssignRoleModal.tsx            ← Select user(s) → assign role dropdown → confirm
```

**Permission groups (Ivor-specific):**
```
Employee Management       → view, create, edit, delete, export, onboard
Salary & Payroll          → view, edit, export, lock_run, approve_deductions
Attendance & Time Logs    → view, export, edit_hours
Compliance                → view, export, send_reminder
Disputes                  → view, assign, resolve, export_audit
Overtime                  → view, approve, reject, bulk_approve
Schedule                  → view, create, edit, delete, publish
Documents                 → view, upload, delete, bulk_upload
Reports                   → view, export
Department Management     → view, create, edit, delete
Role Management           → view, create, edit, delete (admin-only)
```

**Company role hierarchy (pre-built system roles, non-deletable):**
```
Owner          → all permissions (1 per company)
Company Admin  → all except role management of Owner
HR Manager     → employee, salary, compliance, disputes, onboarding, reports
Dept Manager   → attendance, OT, schedule (scoped to their dept only)
Supervisor     → view + OT approve (dept scoped)
```
Custom roles: company can create additional roles with any permission combination.

**"Sync Permissions" button:** Pulls the latest permission definitions from backend and reconciles any new features that have been added since the role was last edited. Shows diff: "3 new permissions available — click to review."

**API extensions needed:**
```python
GET  /company/{id}/roles                     ← list roles with permission counts
POST /company/{id}/roles                     ← create custom role + permissions
PUT  /company/{id}/roles/{role_id}           ← rename/describe role
GET  /company/{id}/roles/{role_id}/permissions  ← full permission list for role
PUT  /company/{id}/roles/{role_id}/permissions  ← replace permission set (array of permission keys)
GET  /company/{id}/permissions               ← all available permissions grouped by feature
DELETE /company/{id}/roles/{role_id}         ← delete (must reassign users first)
PATCH /company/{id}/users/{user_id}/role     ← (already exists) assign role to user
```

**Backend model additions:**
```python
class CompanyRole(Base):
    __tablename__ = "company_roles"
    role_id = Column(Integer, primary_key=True)
    company_id = Column(Integer, ForeignKey("companies.company_id"))
    name = Column(String(100))
    description = Column(String)
    is_system = Column(Boolean, default=False)  # system roles not deletable
    permissions = Column(JSONB)  # ["view_employee", "edit_salary", ...]
    created_at = Column(DateTime, server_default=func.now())
```

#### C. Team Members Management (extend existing `/dashboard/employees`)
```
src/app/(platform)/dashboard/employees/components/ (extend existing EmployeesSection.tsx)
  BulkDepartmentAssign.tsx       ← Select employees → assign to dept
  BulkRoleAssign.tsx             ← Select employees → set role
  InviteWithRoleModal.tsx        ← Invite + set role + set dept in one modal
  AccessHistoryDrawer.tsx        ← Per-employee: role history, last login, permissions
```

Current `InviteUserModal.tsx` only sets role. Extend to set department in same step.

#### D. Org Chart View (Settings → Organization)
```
src/app/(platform)/dashboard/settings/organization/page.tsx
src/app/(platform)/dashboard/settings/organization/components/
  OrgChart.tsx                   ← Tree view: Owner → Admins → Dept Heads → Members
  OrgNode.tsx                    ← Node: avatar, name, title, department, role badge
```

Simple tree built from: `fetchCompanyUsers()` + department data + role assignments. Not draggable in first version — read-only visual. `recharts` or custom SVG tree.

#### E. Settings Hub (reorganize existing `/dashboard/settings`)
Currently Settings has only: Company Profile, Leave Settings, Notifications. Expand to tabbed structure:

```
/dashboard/settings/
  tabs:
    Company Profile               ← (existing)
    Departments                   ← (NEW — link to /settings/departments)
    Roles & Permissions           ← (NEW — link to /settings/roles)
    Team Members                  ← (link to /dashboard/employees)
    Organization Chart            ← (NEW — /settings/organization)
    Leave Policies                ← (extend existing leave settings)
    Notifications                 ← (existing email preferences)
    Integrations                  ← (placeholder for webhooks/API keys)
```

### Department-scoped data isolation
Department Managers and Supervisors should only see their dept's data:
- Attendance → filter by dept
- OT table → filter by dept
- Disputes → filter by dept
- Schedule → show only their dept's employees

**Implementation:** `useAuth()` exposes `user.roles` + dept assignment. All API calls from dept-scoped users automatically append `?department_id=X` from a `useDeptScope()` hook.

### Verification
- Create department → appears in dept filter across all pages
- Assign employee to dept → they appear in dept manager's scoped views
- Role change logged in AccessHistoryDrawer with timestamp + who changed it
- Dept manager cannot see other dept's salaries or disputes
- Org chart renders correct hierarchy

---

## Competitive Summary

| Feature | Ivor | Deputy | BambooHR | Factorial | Deel |
|---|---|---|---|---|---|
| Permit/visa expiry tracking | ✅ | ❌ | ❌ | ❌ | ❌ |
| Compliance scoring | ✅ | ❌ | ❌ | ❌ | ❌ |
| Worker rights dispute workflow | ✅ | ❌ | ❌ | ❌ | ❌ |
| Compliance-first onboarding | ✅ | ❌ | partial | partial | ❌ |
| Tourist visa legal warning | ✅ | ❌ | ❌ | ❌ | ❌ |
| Minimum wage auto-check | ✅ | ❌ | ❌ | ❌ | ❌ |
| OT legal limit alerts (MU/MG) | ✅ | ❌ | ❌ | ❌ | ❌ |
| Multi-currency (MUR + MGA) | ✅ | partial | ❌ | partial | ✅ |
| Shift conflict (permit aware) | ✅ | ❌ | ❌ | ❌ | ❌ |

---

## Full Sidebar After All Sprints

```
Dashboard (home)
─────────────────
Teams
  └ Team Members
  └ Verify Employees
  └ Onboarding (NEW)
─────────────────
Attendance      ← S1
Salaries        ← S2
Compliance      ← S3 [badge: red if score < 80]
Disputes        ← S4 [badge: open count]
Overtime        ← S5 [badge: pending count]
Schedule        ← S7
─────────────────
Requests (leaves, complaints)
Notifications   ← S8 [badge: unread]
Documents       ← S9
─────────────────
Reports         ← S10
─────────────────
Settings
Documentation
─────────────────
[Payroll]       ← last (separate branch)
```

---

## Role & Permissions

| Action | company_admin | manager | viewer |
|---|---|---|---|
| View attendance | ✅ | ✅ | ✅ |
| View salary details | ✅ | ✅ | ❌ |
| Edit salary | ✅ | ❌ | ❌ |
| View compliance | ✅ | ✅ | ✅ |
| Resolve disputes | ✅ | ✅ | ❌ |
| Approve OT | ✅ | ✅ | ❌ |
| Create shifts / publish | ✅ | ✅ | ❌ |
| Onboard employee | ✅ | ✅ | ❌ |
| Upload documents | ✅ | ✅ | ❌ |
| View reports | ✅ | ✅ | ✅ |
| Export anything | ✅ | ✅ | ❌ |

Use existing `RoleGuard` at `src/app/(platform)/components/RoleGuard.tsx`.

---

## New Backend Endpoints Summary

| Sprint | Endpoint | Method |
|---|---|---|
| 1 | `/job/time-logs/company/{id}` | GET |
| 3 | (no new endpoints — uses Job fields + vault) | — |
| 4 | Extend UserRight with assigned_to, resolution, closed_at fields | PATCH |
| 5 | `/job/time-logs/company/{id}/overtime` | GET |
| 5 | `/job/time-log/{id}/overtime` (extend with action) | PUT |
| 6 | `/company/{id}/onboard` (atomic multi-step) | POST |
| 7 | `/job/schedules/{id}` | DELETE |
| 8 | `/company/{id}/notifications` | GET |
| 9 | `/vault/company/{company_id}` | GET |

---

## Scaling & Performance

- All tables: server-side pagination (`limit/offset`)
- `useApi` hook (at `src/hooks/useApi.ts`) with 60s stale-while-revalidate
- Live session table: 60s poll with cleanup `useEffect`
- Bulk OT approve: single batched API call (array of IDs)
- Reports charts: lazy-load with Suspense boundaries
- Large companies (500+ employees): `@tanstack/react-table` for virtual rows

---

## Key Files

**Primary working directory:** `/Users/iwugod/www/ivor-mobile/web/ivor-web/src/`

**Existing reusable:**
- `contexts/AuthContext.tsx` — company_id, roles, isCompanyAdmin
- `hooks/useApi.ts` — data fetching with caching
- `components/Modal.tsx` — Modal, ConfirmModal, FormModal
- `components/Toast.tsx` — toast notifications
- `app/(platform)/components/RoleGuard.tsx` — role-based rendering
- `services/api.tsx` — all existing API functions
- `services/apiClient.tsx` — axios instance

**Backend key files:**
- `backend/api/v1/job.py` — time log endpoints to extend
- `backend/api/v1/user.py` — rights/dispute endpoints to extend
- `backend/core/model.py` — UserRight model to extend
- `backend/services/notification_service.py` — already handles all push + in-app notifications
