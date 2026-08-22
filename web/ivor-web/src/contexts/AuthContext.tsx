"use client";

import { createContext, useContext, ReactNode, useState, useEffect, useRef } from 'react';
import { api } from '@/services/apiClient';

interface Company {
  company_id: number;
  company_name: string;
  brn: string;
  email: string;
  phone: string;
  address: string;
  // Operating currency, derived server-side from the company's country
  // (ShowCompanyBasic.currency). The single source of truth for "what currency
  // are these payroll figures in" — never hardcode "Rs"/MUR on the dashboard.
  currency?: string;
  country_code?: string;
}

interface User {
  user_id: number;
  email: string;
  user_type: 'company' | 'private';
  user_name?: string;
  company?: Company;
  // Present for employee (private) users, including delegated management roles.
  // Their company context lives here, not on `company` (which is the owner row).
  private_user?: {
    private_user_id?: number;
    company_id?: number;
    company?: Company;
    role?: string;
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    [key: string]: any;
  };
  isAuthenticated: boolean;
  roles?: string[];
  // Phase 2 — union of all platform permissions across the user's
  // PlatformRole assignments. Empty for non-platform users. Used by
  // Sidebar.tsx requiredPermissions gating.
  platform_permissions?: string[];
  // Company RBAC — fine-grained permissions resolved from the user's company
  // roles (delegated management roles). Drives company nav/access gating.
  company_permissions?: string[];
  company_roles?: string[];
  company_rbac_enabled?: boolean;
  is_superuser?: boolean;
  // Standardized Flags
  isPlatformAdmin?: boolean;
  isCompanyAdmin?: boolean;
  hasRole: (role: string | string[]) => boolean;
  // True if the user holds any of the given platform permissions (superuser
  // always passes). Mirrors hasRole but checks platform_permissions.
  hasPermission: (permission: string | string[]) => boolean;
  // True if the user holds any of the given COMPANY permissions. Owner (and
  // superuser) always pass; a management-role employee is checked strictly
  // against their resolved company_permissions.
  hasCompanyPermission: (permission: string | string[]) => boolean;
}

interface AuthContextType {
  user: User | null;
  login: (identifier: string, password: string) => Promise<boolean | { isPlatformAdmin: boolean }>;
  // Phase 2 — OTP login. The server has already verified the code and set
  // the HttpOnly cookie before this is called; we just rebuild user state.
  loginWithOtpResult: (response: { data: any }) => boolean | { isPlatformAdmin: boolean };
  logout: () => void;
  loading: boolean;
  companyBrn: string | null;
  // The company the user is acting on, resolved for BOTH an owner (user.company)
  // and a delegated management employee (user.private_user.company_id). Company-
  // scoped pages must use this, not user.company.company_id, or they show nothing
  // for HR/manager role-holders.
  companyId: number | null;
  // Re-fetch /user/me into context. Call after mutating company/user data
  // (e.g. saving company settings) so the cached snapshot doesn't go stale —
  // otherwise edited fields appear to "revert" on the next render.
  refreshUser: () => Promise<void>;
}

const AuthContext = createContext<AuthContextType | undefined>(undefined);

// Platform admins are stored with user_type='private' (super-admin seeder uses
// the same User row + PrivateUser pattern). Without this carve-out the web
// dashboard boots them out as employees.
function isPrivateUserBlocked(userData: any): boolean {
  if (userData?.user_type !== 'private') return false;
  const roles: string[] = userData.roles || [];
  const isPlatformAdmin = userData.is_superuser === true || roles.includes('platform_admin');
  if (isPlatformAdmin) return false;
  // Company RBAC: when enabled, a private user who holds ANY company management
  // role may use the employer dashboard with role-limited access — mirrors
  // mobile's qualifiesForModeChoice. We admit on is_company_admin OR a non-empty
  // company_roles set, so a delegated role (HR, Supervisor, a custom role) gets
  // in even if it isn't an "admin" tier; the Sidebar + API permission gates then
  // scope what they can see/do (an empty-permission role lands on a bare
  // dashboard, never a leak). Flag off ⇒ owner-only.
  if (userData.company_rbac_enabled === true) {
    if (userData.is_company_admin === true) return false;
    if (Array.isArray(userData.company_roles) && userData.company_roles.length > 0) return false;
  }
  return true;
}

export function AuthProvider({ children }: { children: ReactNode }) {
  const [user, setUser] = useState<User | null>(null);
  const [loading, setLoading] = useState(true);
  const checkingRef = useRef(false);

  // Get company BRN from authenticated user (owner row, or the employee's
  // company relation when present).
  const companyBrn = user?.company?.brn || user?.private_user?.company?.brn || null;

  // Unified company id: resolve the SAME way the backend login token / RLS does
  // (services/user_service.py) — an employee/role-holder's private_user.company_id
  // FIRST, then the owner's own Company. This keeps company-scoped pages bound to
  // the same tenant the API serves. Preferring the owned company here made a user
  // who owns one (possibly empty) company but works as a role-holder in another
  // land on their own empty company instead of the one they were invited to.
  const companyId =
    user?.private_user?.company_id ??
    user?.private_user?.company?.company_id ??
    user?.company?.company_id ??
    null;

  useEffect(() => {
    // Only hit /user/me if there's a session hint — avoids noisy 401s for
    // unauthenticated visitors. The hint is a plain flag (not the token).
    if (typeof window !== 'undefined' && localStorage.getItem('auth_hint') === '1') {
      checkAuthStatus();
    } else {
      setLoading(false);
    }
  }, []);

  // Helper to derive flags
  const deriveFlags = (userData: any): User => {
    const roles: string[] = userData.roles || [];
    const isSuper = userData.is_superuser === true;

    // Helper to check if user has one of the required roles
    const hasRole = (requiredRole: string | string[]): boolean => {
      if (isSuper) return true;
      const req = Array.isArray(requiredRole) ? requiredRole : [requiredRole];
      return req.some(r => roles.includes(r));
    };

    // Use is_company_admin from backend (based on company ownership or PrivateUser.role)
    const isCompanyAdmin = userData.is_company_admin === true;

    // isPlatformAdmin: only superuser OR explicitly holds the platform_admin role
    const isPlatformAdmin = isSuper || roles.includes('platform_admin');

    const perms: string[] = userData.platform_permissions || [];
    const hasPermission = (required: string | string[]): boolean => {
      if (isSuper) return true;
      const req = Array.isArray(required) ? required : [required];
      return req.some(p => perms.includes(p));
    };

    // Company permissions — owner (user_type='company') and superuser always
    // pass; a management-role employee is checked strictly against their
    // resolved company_permissions (a "Company Admin" role grants them all via
    // its permission set, so no special-casing needed for it).
    //
    // isOwner is true only when the user owns the company they are CURRENTLY
    // scoped to. A user who owns one company but is acting as a delegated
    // role-holder in ANOTHER (their private_user is in a different company) must
    // be permission-scoped there, not treated as its owner — otherwise they'd
    // get owner-level access to a company they merely work in. Owners with no
    // employee membership (the common case) are unaffected.
    const cperms: string[] = userData.company_permissions || [];
    const ownedCompanyId = userData.company?.company_id ?? null;
    const employeeCompanyId = userData.private_user?.company_id ?? null;
    const isOwner = userData.user_type === 'company'
      && (!employeeCompanyId || employeeCompanyId === ownedCompanyId);
    const hasCompanyPermission = (required: string | string[]): boolean => {
      if (isSuper || isOwner) return true;
      const req = Array.isArray(required) ? required : [required];
      return req.some(p => cperms.includes(p));
    };

    return {
      ...userData,
      isAuthenticated: true,
      isPlatformAdmin,
      isCompanyAdmin,
      hasRole,
      hasPermission,
      hasCompanyPermission
    };
  };

  // Check auth status
  const checkAuthStatus = async () => {
    if (checkingRef.current) return;
    checkingRef.current = true;

    try {
      // Just try to fetch user. The browser will auto-send the cookie.
      const response = await api.get('/user/me');
      if (response.data) {
        // If an employee somehow has a valid session cookie, boot them out.
        // Platform admins are exempt — see isPrivateUserBlocked.
        if (isPrivateUserBlocked(response.data)) {
          try { await api.post('/user/logout'); } catch { /* best-effort */ }
          localStorage.removeItem('auth_hint');
          setUser(null);
          return;
        }
        setUser(deriveFlags(response.data));
      }
    } catch (error: any) {
      // 401 = cookie expired / invalid — clear the hint so we don't retry
      if (error?.response?.status === 401 || error?.response?.status === 403) {
        localStorage.removeItem('auth_hint');
      }
      setUser(null);
    } finally {
      setLoading(false);
      checkingRef.current = false;
    }
  };

  // `identifier` accepts either an email or a phone number. The backend
  // routes by checking for '@'; arg name stays generic so callers don't
  // have to think about which one they're passing.
  const login = async (identifier: string, password: string): Promise<boolean | { isPlatformAdmin: boolean }> => {
    try {
      setLoading(true);
      const response = await api.post('/user/login', { identifier, password });

      if (response.data && response.data.status === 'success') {
        const { data: userData } = response.data;

        // Block employee (private) users — web dashboard is for employers only.
        // Platform admins are exempt — see isPrivateUserBlocked.
        if (isPrivateUserBlocked(userData)) {
          // Clear the session cookie the backend just set
          try { await api.post('/user/logout'); } catch { /* best-effort */ }
          const err = new Error('Web dashboard is for employers only. Please use the Kiruko mobile app.');
          (err as any).isEmployeeBlock = true;
          throw err;
        }

        // Set a lightweight hint so checkAuthStatus knows to call /user/me on next load.
        // This is NOT the token — just a flag that a session cookie likely exists.
        localStorage.setItem('auth_hint', '1');
        const derived = deriveFlags(userData);
        setUser(derived);

        return { isPlatformAdmin: derived.isPlatformAdmin ?? false };
      }
      return false;
    } catch (error: any) {
      // Re-throw deliberate access denials so the login page can display the right message
      if (error?.isEmployeeBlock) throw error;
      console.error('Login failed:', error);
      return false;
    } finally {
      setLoading(false);
    }
  };

  // Push user state from an /auth/otp/verify response. Mirrors the
  // post-login plumbing inside `login()` so the dashboard sees identical
  // state regardless of which credential channel got us here. Returns
  // the same shape as `login()` so the caller can branch on platform
  // admin status to route /admin vs /dashboard.
  const loginWithOtpResult = (response: { data: any }): boolean | { isPlatformAdmin: boolean } => {
    const userData = response?.data;
    if (!userData) return false;
    if (isPrivateUserBlocked(userData)) {
      // Same employer-only block as password login. Don't hold session.
      api.post('/user/logout').catch(() => undefined);
      const err = new Error('Web dashboard is for employers only. Please use the Ivor mobile app.');
      (err as any).isEmployeeBlock = true;
      throw err;
    }
    localStorage.setItem('auth_hint', '1');
    const derived = deriveFlags(userData);
    setUser(derived);
    return { isPlatformAdmin: derived.isPlatformAdmin ?? false };
  };

  const logout = async () => {
    try {
      await api.post('/user/logout');
    } catch (e) {
      console.warn('Logout API failed', e);
    }
    localStorage.removeItem('auth_hint');
    setUser(null);
    window.location.href = '/';
  };

  return (
    <AuthContext.Provider value={{
      user,
      login,
      loginWithOtpResult,
      logout,
      loading,
      companyBrn,
      companyId,
      refreshUser: checkAuthStatus
    }}>
      {children}
    </AuthContext.Provider>
  );
}

export function useAuth() {
  const context = useContext(AuthContext);
  if (context === undefined) {
    throw new Error('useAuth must be used within an AuthProvider');
  }
  return context;
}