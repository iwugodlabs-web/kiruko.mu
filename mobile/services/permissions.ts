// Company-side RBAC helper for the mobile app — mirrors the web's
// permission gating. The company owner (a `company` account) and any
// company-admin implicitly have every permission; delegated role-holders
// (HR Manager, Supervisor, …) are checked against the resolved
// `company_permissions` list the backend returns at login.
//
// Use this to gate data fetches, nav, and screens so a role doesn't hit 403s
// (e.g. an HR Manager without `view_attendance` shouldn't load time logs).
//
// Accepts a single permission or a list — a list passes if the user holds ANY
// of them, mirroring the web's hasCompanyPermission (e.g. the payroll section
// needs any of view_salary / view_payslip / manage_payroll).
export function hasCompanyPermission(user: any, permission: string | string[]): boolean {
  if (!user) return false;
  // Owner / company-admin bypass. Mirror the backend's is_company_admin rule
  // exactly (core/roles.py): the server computes is_company_admin and sends it,
  // so trust that first; fall back to (user_type 'company' AND an actual
  // company) for sessions that predate the flag. Requiring user.company — not
  // user_type alone — stops a half-onboarded company account from falsely
  // bypassing here and then 403-ing against the real backend gate.
  if (user.is_company_admin === true) return true;
  if (user.user_type === 'company' && user.company) return true;
  // Delegated permissions only take effect when company RBAC is enabled. While
  // the flag is off the backend admits owners/admins only (require_company_admin)
  // and IGNORES granted perms — so honor a delegated role's permissions here
  // only when the flag is confirmed on, otherwise we'd fire calls the server
  // 403s. Treat anything but an explicit true as off (safe, fewest surprises).
  if (user.company_rbac_enabled !== true) return false;
  const perms = user.company_permissions;
  if (!Array.isArray(perms)) return false;
  const required = Array.isArray(permission) ? permission : [permission];
  return required.some((p) => perms.includes(p));
}
