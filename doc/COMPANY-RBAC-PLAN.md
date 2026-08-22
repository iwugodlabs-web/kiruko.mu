# Company RBAC — Delegated Management Roles on Web

**Goal:** Let an *employee* (`user_type=private`) who holds a company **management role**
(HR Manager, Supervisor, …) sign into the **web employer dashboard**, with access
**limited by their role's permissions**. Mirrors mobile (`qualifiesForModeChoice`),
which already admits owner/admin/manager. Web is employer-only; plain employees
(no management role) stay on mobile.

## Design principles (non-negotiable)
1. **API is the source of truth.** Sidebar gating is cosmetic; every company route
   enforces `require_company_permission`. Hiding nav ≠ protecting data.
2. **Fail-closed.** A permission not granted = blocked, UI *and* API.
3. **Safe by default.** Non-owner roles seed **empty**; owner/admin always full.
   Worst case = "manager sees nothing," never a leak.
4. **One authz source.** `CompanyRole.permissions` (via `CompanyUserRole`) decides
   everything. Legacy `PrivateUser.role` scalar = display-only, never authz.
5. **Sensitive surfaces deny-by-default.** Salary, payroll, and especially
   **compliance / disputes (whistleblower)** require an explicit grant.
6. **Reversible.** Everything behind a `COMPANY_RBAC_ENABLED` flag (off in prod
   until proven); staged rollout (own company first → watch audit log → open).

## Key facts (from the code map)
- Backend role plumbing already exists: `CompanyUserRole` (assignment),
  `CompanyRole.permissions` JSONB (catalogue), `_company_permissions_for_user`
  (`core/permission_guards.py:167`), `require_company_permission`/`assert_company_permission`.
  `require_company_scope` / `require_company_admin` already admit management-role
  private users — they just don't check *fine-grained* permissions.
- **In-product role-permission editor already exists** — backend `company_roles.py`
  + web `settings/permissions/` (`EditPermissionsModal`, `PermissionManagerSection`).
  So the PO configures roles in the product; no upfront matrix, no new UI.
- **Bug to fix:** `CompanyUserRole.role` stores `hr_manager`; `CompanyRole.name` is
  `HR Manager` — they don't match in `_company_permissions_for_user`, so custom roles
  resolve to ∅ (fails closed — safe but broken).

## Blockers to remove
- `web/.../AuthContext.tsx:isPrivateUserBlocked` — boots any non-platform-admin private user.
- `backend/api/v1/dashboard.py:22` + `job.py` `user_type=='company'` gates → 403.
- Login/`/me` payload omits company roles/permissions.

## Build order (each phase verified + committed)
- [ ] **P0 — Feature flag.** `COMPANY_RBAC_ENABLED` (off by default). All new gates +
  web unblock read it; off ⇒ exact current behavior.
- [ ] **P1 — Authz core (backend).** Fix `hr_manager`↔`HR Manager` name match;
  `CompanyRole.permissions` is sole authz source.
- [ ] **P2 — Surface to web.** Add `company_permissions` (+ company role names) to
  login + `/user/me` payload and `showUser` schema.
- [ ] **P3 — Enforcement.** Central `endpoint→permission` registry; apply
  `require_company_permission` to every company route (behind flag; off ⇒ old gate).
- [ ] **P4 — Proof tests.** (a) negative sweep: empty-perm user → 403 on every company
  route; (b) positive matrix: granting `view_payroll` opens payroll & only payroll;
  (c) owner-always-full on every route.
- [ ] **P5 — Web.** `company_permissions` in AuthContext User; sidebar **mirrors** it;
  clean empty state; relax `isPrivateUserBlocked` + `dashboard.py` gate (behind flag).
- [ ] **P6 — Defaults.** Seed non-owner roles empty; owner full. Compliance/disputes
  default-deny on every system role.

## Residual risk (accepted, managed)
- Mis-mapping a permission to the wrong route → caught by P4 positive tests, per-permission.
- Inherent risk of access-control change → flag + staged rollout.

## Out of scope (post-pilot)
- Employee self-service surface on web (managers use mobile for their own payslips).
- Retro-pay / other unrelated payroll features.
