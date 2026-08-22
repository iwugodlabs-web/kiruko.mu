/**
 * Delegated-role dashboard-load gating — smoke test for hasCompanyPermission.
 *
 * This is the pure decision function the company dashboard uses to decide which
 * tabs render, which data fetches fire, and which screens open. Every RBAC bug
 * shaken out before the internal-test build lived here:
 *   - honoring delegated permissions only when company RBAC is enabled
 *   - owner / company-admin implicit bypass (mirroring core/roles.py)
 *   - any-of a permission list (web parity)
 *   - fail-closed on missing data
 *
 * No RN/gluestack deps — hasCompanyPermission is a plain function, so this runs
 * fast and deterministically.
 */
import { hasCompanyPermission } from '../../services/permissions';

// An owner logs in as a company account (user.company set). core/roles.py treats
// (user_type === 'company' && user.company) OR is_company_admin as admin.
const OWNER = { user_type: 'company', company: { company_id: 1 }, is_company_admin: true };

// A delegated role-holder (e.g. Ben the HR Manager) is a private user with
// user.company = null and a resolved company_permissions list from the backend.
const hrManager = (perms: string[] | null, rbacEnabled: boolean | undefined) => ({
  user_type: 'private',
  company: null,
  is_company_admin: false,
  company_roles: ['HR Manager'],
  company_permissions: perms,
  company_rbac_enabled: rbacEnabled,
});

describe('hasCompanyPermission — delegated-role dashboard gating', () => {
  it('owner sees everything (all tabs + fetches load)', () => {
    expect(hasCompanyPermission(OWNER, 'view_attendance')).toBe(true);
    expect(hasCompanyPermission(OWNER, 'view_salary')).toBe(true);
    expect(hasCompanyPermission(OWNER, ['view_documents'])).toBe(true);
  });

  it('a company account with no company object does NOT get the owner bypass', () => {
    // Mirrors the backend rule exactly: user_type 'company' is not enough — a
    // half-onboarded account (company === null) must not bypass and then 403.
    const halfOnboarded = { user_type: 'company', company: null, is_company_admin: false };
    expect(hasCompanyPermission(halfOnboarded, 'view_attendance')).toBe(false);
  });

  it('company admin bypasses via is_company_admin', () => {
    const admin = { user_type: 'private', company: null, is_company_admin: true };
    expect(hasCompanyPermission(admin, 'view_salary')).toBe(true);
  });

  it('RBAC enabled: delegated role gets exactly its granted permissions', () => {
    const ben = hrManager(['view_attendance', 'view_employee'], true);
    // attendance fetch + employees tab load…
    expect(hasCompanyPermission(ben, 'view_attendance')).toBe(true);
    expect(hasCompanyPermission(ben, 'view_employee')).toBe(true);
    // …but the salaries tab/fetch stays hidden.
    expect(hasCompanyPermission(ben, 'view_salary')).toBe(false);
  });

  it('RBAC DISABLED: granted permissions are inert (admin-only) — the flag bug', () => {
    // The backend admits owners/admins only when the flag is off and ignores
    // granted perms; the client must match or it fires calls the server 403s.
    const ben = hrManager(['view_attendance'], false);
    expect(hasCompanyPermission(ben, 'view_attendance')).toBe(false);
  });

  it('flag unknown (undefined) is treated as off — anything but true denies', () => {
    const ben = hrManager(['view_attendance'], undefined);
    expect(hasCompanyPermission(ben, 'view_attendance')).toBe(false);
  });

  it('fail-closed: a role with no granted perms is denied', () => {
    const ben = hrManager([], true);
    expect(hasCompanyPermission(ben, 'view_attendance')).toBe(false);
  });

  it('any-of a permission list passes when any is granted (payroll gate)', () => {
    const payrollSet = ['view_salary', 'view_payslip', 'manage_payroll'];
    const onlyPayslip = hrManager(['view_payslip'], true);
    expect(hasCompanyPermission(onlyPayslip, payrollSet)).toBe(true);
    const none = hrManager(['view_leave'], true);
    expect(hasCompanyPermission(none, payrollSet)).toBe(false);
  });

  it('does not crash on missing/odd inputs', () => {
    expect(hasCompanyPermission(null, 'view_attendance')).toBe(false);
    expect(hasCompanyPermission(undefined, 'view_attendance')).toBe(false);
    // company_permissions not an array (RBAC on, nothing resolved yet)
    expect(hasCompanyPermission(hrManager(null, true), 'view_attendance')).toBe(false);
  });
});
