// Company RBAC role display helpers.
//
// An employee's assigned management/access role is stored as a slug in
// PrivateUser.role (e.g. "hr_manager") — that's how company_roles.py counts
// members and how the login payload resolves company_roles. The generic
// "everyone is an employee" defaults are NOT management roles and render as
// "no special role" (null) so we don't badge ordinary staff.

const GENERIC_ROLES = new Set(["employee", "staff", "worker", "member", "user", ""]);
const ROLE_ACRONYMS = new Set(["hr", "it", "ceo", "cfo", "coo", "qa"]);

/** Format a role slug into a display name. "hr_manager" → "HR Manager".
 * Returns null for empty/generic roles (ordinary employees). */
export function formatAccessRole(slug: string | null | undefined): string | null {
  if (!slug || GENERIC_ROLES.has(slug.toLowerCase())) return null;
  return slug
    .split("_")
    .map((w) => (ROLE_ACRONYMS.has(w.toLowerCase()) ? w.toUpperCase() : w.charAt(0).toUpperCase() + w.slice(1)))
    .join(" ");
}
