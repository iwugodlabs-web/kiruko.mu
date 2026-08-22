import AsyncStorage from '@react-native-async-storage/async-storage';

// Lets a user who is BOTH an employer-side actor (owner/admin/manager) AND has an
// employee identity choose which side of the app to enter. Persisted per device so
// they only pick once; cleared on logout so the next account chooses fresh.
const KEY = 'entry_mode';

export type EntryMode = 'employer' | 'employee';

export async function getEntryMode(): Promise<EntryMode | null> {
  try {
    const v = await AsyncStorage.getItem(KEY);
    return v === 'employer' || v === 'employee' ? v : null;
  } catch {
    return null;
  }
}

export async function setEntryMode(mode: EntryMode): Promise<void> {
  try {
    await AsyncStorage.setItem(KEY, mode);
  } catch {
    // non-fatal: routing still works, the user just re-picks next launch
  }
}

export async function clearEntryMode(): Promise<void> {
  try {
    await AsyncStorage.removeItem(KEY);
  } catch {
    /* no-op */
  }
}

// True when the user can meaningfully enter as EITHER an employer or an employee:
// an employer-side role (owner/admin/manager, or a company account) PLUS an employee
// identity (a private_user record — which company owners also have).
export function qualifiesForModeChoice(user: any): boolean {
  if (!user) return false;
  const role = user?.private_user?.role;
  // Roles are assigned via CompanyUserRole and surface as `company_roles`
  // (e.g. ["HR Manager"]). An employee can have one while their legacy scalar
  // `role` is still 'employee' — so this is the load-bearing signal for
  // delegated admins/managers, not just the legacy role or is_company_admin.
  const hasCompanyRole = Array.isArray(user.company_roles) && user.company_roles.length > 0;
  const canEmployer =
    user.user_type === 'company' ||
    user.is_company_admin === true ||
    hasCompanyRole ||
    role === 'owner' || role === 'admin' || role === 'manager';
  const canEmployee = !!user.private_user;
  return canEmployer && canEmployee;
}

export function dashboardRouteForMode(mode: EntryMode): string {
  return mode === 'employer' ? '/company_dashboard/home' : '/private_dashboard/home';
}
