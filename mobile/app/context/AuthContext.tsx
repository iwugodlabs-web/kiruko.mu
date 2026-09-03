import { createContext } from "react";

interface IUser {
    email: string;
    user_id: string;
    token: string;
    isAuthenticated: boolean;
    onboard_complete: boolean;
    user_type: string;
    private_user_id: string;
    company: any;
    company_id?: number;
    company_onboarding_status?: string;
    verification_note?: string;
    // Employer-side role data (from CompanyUserRole) — drives the
    // private<->company "switch profile" affordance for role-holding employees.
    company_roles?: string[];
    is_company_admin?: boolean;
    company_permissions?: string[];
    // RBAC rollout flag from the backend. When false, company endpoints admit
    // only owners/admins (require_company_admin) and ignore granted perms — so
    // the client must gate the same way (see hasCompanyPermission).
    company_rbac_enabled?: boolean;
    // Add missing fields for compatibility
    user_name?: string;
    first_name?: string;
    private_user?: {
        private_user_id: number;
        first_name: string;
        last_name: string;
        gender?: string;
        date_of_birth?: string;
        phone?: string;
        pass_port_number?: string;
        company_id?: number;
        // Branch/site this employee is assigned to (shown on profile + payslips).
        home_geofence_id?: number;
        // Resolved site name (survives site deletion).
        home_site_name?: string;
        // Self-reported country — independent (no company_id) users only.
        country_code?: string;
        // Computed "what's actually in effect" (company's country for an
        // employee, else country_code, else phone-inferred, else 'MU').
        effective_country_code?: string;
    };
}

interface AuthContextType {
    user?: IUser;
    isLoading: boolean;
    changeUser: (user: IUser) => void;
    checkAuth: (opts?: { silent?: boolean }) => Promise<boolean>;
    logout: () => Promise<boolean>;
    login: (userData: IUser, token: string, refreshToken?: string) => Promise<void>;
}

const AuthContext = createContext<AuthContextType | undefined>(
    undefined
);

export default AuthContext;
export type { AuthContextType, IUser };
