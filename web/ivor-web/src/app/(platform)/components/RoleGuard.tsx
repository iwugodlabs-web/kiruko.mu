"use client";

import { useAuth } from "@/contexts/AuthContext";
import { useRouter } from "next/navigation";
import { ReactNode, useEffect } from "react";

type Role = 'platform_admin' | 'company_admin' | 'all' | string;

interface RoleGuardProps {
    children: ReactNode;
    requiredRole?: Role | Role[]; // Can be a single role or list of allowed roles
    minCompanyRole?: 'company_admin' | string; // Relaxed type to allow custom sub-roles
    requiredPermissions?: string | string[]; // Platform permission(s); any match grants access
    companyPermissions?: string | string[]; // Company permission(s); any match grants access (owner/admin/superuser bypass)
    fallbackPath?: string;
}

export default function RoleGuard({
    children,
    requiredRole,
    minCompanyRole,
    requiredPermissions,
    companyPermissions,
    fallbackPath = "/dashboard"
}: RoleGuardProps) {
    const { user, loading } = useAuth();
    const router = useRouter();

    // The "no props" case used to mean "logged-in is enough", which let a
    // company-admin browse to /admin/employers and trigger the Initialize
    // Company modal. Every call site that omitted props was an /admin/*
    // page that meant `platform_admin`-only, so the safer default is to
    // require platform admin when no other constraint is given. Existing
    // callers that pass `requiredRole` / `minCompanyRole` / `requiredPermissions`
    // keep their behavior.
    const defaultsToPlatformAdmin = !requiredRole && !minCompanyRole && !requiredPermissions && !companyPermissions;

    useEffect(() => {
        if (loading) return;

        if (!user?.isAuthenticated) {
            router.replace("/");
            return;
        }

        // 1. Super Admins bypass all checks (DB-backed flag, hydrated by
        //    AuthContext from /user/me; we no longer trust JWT-only claims).
        if (user.isPlatformAdmin) return;

        // 2. Default-deny for /admin/* pages that didn't specify a role.
        if (defaultsToPlatformAdmin) {
            router.replace(fallbackPath);
            return;
        }

        // 3. Check Platform Role / Custom Roles
        if (requiredRole) {
            const req = Array.isArray(requiredRole) ? requiredRole : [requiredRole];
            if (!user.hasRole(req)) {
                router.replace(fallbackPath);
                return;
            }
        }

        // 4. Check Company Role (Legacy/Specific prop support)
        if (minCompanyRole) {
            if (minCompanyRole === 'company_admin') {
                if (!user.isCompanyAdmin) {
                    router.replace(fallbackPath);
                    return;
                }
            } else {
                if (!user.hasRole(minCompanyRole)) {
                    router.replace(fallbackPath);
                    return;
                }
            }
        }

        // 5. Check Platform Permissions (catalogue-based gating)
        if (requiredPermissions) {
            if (!user.hasPermission(requiredPermissions)) {
                router.replace(fallbackPath);
                return;
            }
        }

        // 6. Check Company Permissions (mirrors the sidebar's gating; owner /
        //    company-admin / superuser bypass inside hasCompanyPermission).
        if (companyPermissions) {
            if (!user.hasCompanyPermission(companyPermissions)) {
                router.replace(fallbackPath);
                return;
            }
        }
    }, [user, loading, router, requiredRole, minCompanyRole, requiredPermissions, companyPermissions, fallbackPath, defaultsToPlatformAdmin]);

    if (loading) {
        return (
            <div className="flex h-full w-full items-center justify-center p-12">
                <div className="h-8 w-8 animate-spin rounded-full border-4 border-red-500 border-t-transparent"></div>
            </div>
        );
    }

    // Final validation check before render. Mirrors the effect logic so
    // the unauthorized content never flashes between the effect's redirect
    // and the next render.
    if (!user?.isAuthenticated) return null;

    if (user.isPlatformAdmin) return <>{children}</>;

    // Default-deny — see commentary above the effect.
    if (defaultsToPlatformAdmin) return null;

    if (requiredRole) {
        const req = Array.isArray(requiredRole) ? requiredRole : [requiredRole];
        if (!user.hasRole(req)) return null;
    }

    if (minCompanyRole) {
        if (minCompanyRole === 'company_admin') {
            if (!user.isCompanyAdmin) return null;
        } else {
            if (!user.hasRole(minCompanyRole)) return null;
        }
    }

    if (requiredPermissions && !user.hasPermission(requiredPermissions)) return null;
    if (companyPermissions && !user.hasCompanyPermission(companyPermissions)) return null;

    return <>{children}</>;
}
