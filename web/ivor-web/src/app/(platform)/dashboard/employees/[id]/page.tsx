"use client";

import { useEffect, useState } from "react";
import { useParams, useRouter } from "next/navigation";
import { fetchCompanyUsers, getCompanyGeofences } from "@/services/api";
import { useAuth } from "@/contexts/AuthContext";
import EmployeesDetails from "../../components/EmployeesDetails";
import RoleGuard from "../../../components/RoleGuard";
import useDepartments from '@/hooks/useDepartments';
import { formatAccessRole } from '@/utils/roleFormat';

type Employee = {
    id: number;
    name: string;
    role: string | null;
    accessRole: string | null;
    department: string | null;
    home_site_id?: number | null;
    home_site_name?: string | null;
    status: string;
    avatar: string;
    email: string;
    phone: string;
    joinDate: string;
    user_id: number;
    private_user_id: number;
    employee_code: string | null;
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    job_details?: any;
    verified: boolean;
    passport_number?: string;
    date_of_birth?: string;
    gender?: string;
};

export default function EmployeeDetailPage() {
    const params = useParams();
    const router = useRouter();
    const { companyBrn, companyId, user: authUser } = useAuth();
    const { departmentsMap } = useDepartments(companyId ?? undefined);
    const [employee, setEmployee] = useState<Employee | null>(null);
    const [loading, setLoading] = useState(true);
    const [error, setError] = useState<string | null>(null);

    const employeeId = params.id as string;

    useEffect(() => {
        const fetchEmployee = async () => {
            if (!companyId || !employeeId || !authUser) return;

            setLoading(true);
            try {
                // Use the company-scoped endpoint (approved employees only) —
                // much cheaper than fetching all users and filtering client-side.
                const result = await fetchCompanyUsers(companyId, 'approved');

                if ('error' in result) {
                    setError("Failed to load employee");
                    return;
                }

                // eslint-disable-next-line @typescript-eslint/no-explicit-any
                const users = result as any[];
                // eslint-disable-next-line @typescript-eslint/no-explicit-any
                const user = users.find((u: any) => u.user_id === parseInt(employeeId));

                if (!user || !user.private_user) {
                    setError("Employee not found in this company");
                    return;
                }

                // Resolve the home site name from the company's geofences.
                const sitesRes = await getCompanyGeofences(companyId);
                // eslint-disable-next-line @typescript-eslint/no-explicit-any
                const sites = Array.isArray(sitesRes) ? sitesRes : [];
                const siteId: number | null = user.private_user?.home_geofence_id ?? null;
                const siteName = sites.find((s: any) => s.geofence_id === siteId)?.name ?? null;

                // Find the job associated with this company
                // eslint-disable-next-line @typescript-eslint/no-explicit-any
                const matchingJob = user.private_user.jobs?.find((j: any) =>
                    j.company_id === companyId || j.employer_brn === companyBrn
                ) || user.private_user.jobs?.[0] || null;

                // Resolve department: job-level first, then user-level, then map lookup
                const rawDeptId =
                    matchingJob?.department_id
                    ?? user.private_user?.department?.department_id
                    ?? user.private_user?.department_id
                    ?? null;

                const deptName: string | null =
                    matchingJob?.department?.department_name
                    || matchingJob?.department?.name
                    || user.private_user?.department?.department_name
                    || user.private_user?.department?.name
                    || (rawDeptId ? departmentsMap[rawDeptId] : null)
                    || null;

                setEmployee({
                    id: user.user_id,
                    name: `${user.private_user.first_name || ''} ${user.private_user.last_name || ''}`.trim() || user.email,
                    role: matchingJob?.job_title || 'Employee',
                    accessRole: formatAccessRole(user.company_roles?.[0] || user.private_user.role),
                    department: deptName,
                    home_site_id: siteId,
                    home_site_name: siteName,
                    status: user.user_enabled ? 'Active' : 'Inactive',
                    avatar: user.profile_image_url
                        || `https://ui-avatars.com/api/?name=${user.private_user.first_name || 'U'}+${user.private_user.last_name || 'U'}&background=random`,
                    email: user.email,
                    phone: user.private_user.phone || 'N/A',
                    joinDate: matchingJob?.first_date_of_employment || user.created_at || new Date().toISOString(),
                    user_id: user.user_id,
                    private_user_id: user.private_user.private_user_id,
                    employee_code: user.private_user.employee_code ?? null,
                    job_details: matchingJob,
                    verified: user.user_verified,
                    passport_number: user.private_user.pass_port_number,
                    date_of_birth: user.private_user.date_of_birth,
                    gender: user.private_user.gender,
                });
            } catch (err) {
                console.error("Error fetching employee:", err);
                setError("Failed to load employee details");
            } finally {
                setLoading(false);
            }
        };

        fetchEmployee();
    // Re-run when departmentsMap loads to patch department name
    // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [employeeId, companyId, authUser, companyBrn]);

    // Patch department name once departmentsMap becomes available
    useEffect(() => {
        if (!employee || employee.department || Object.keys(departmentsMap).length === 0) return;
        const rawJob = employee.job_details;
        const rawDeptId = rawJob?.department_id ?? null;
        if (!rawDeptId) return;
        const resolved = departmentsMap[rawDeptId];
        if (resolved) setEmployee(prev => prev ? { ...prev, department: resolved } : prev);
    }, [departmentsMap, employee]);

    const handleBack = () => router.push('/dashboard/employees');

    if (loading) {
        return (
            <div className="flex items-center justify-center h-full p-12">
                <div className="h-8 w-8 animate-spin rounded-full border-2 border-gray-200 border-t-gray-800" />
            </div>
        );
    }

    if (error || !employee) {
        return (
            <div className="flex flex-col items-center justify-center h-full p-12 gap-4">
                <p className="text-gray-500">{error || "Employee not found"}</p>
                <button
                    onClick={handleBack}
                    className="px-4 py-2 bg-gray-900 text-white rounded-lg hover:bg-gray-800 text-sm"
                >
                    Back to Employees
                </button>
            </div>
        );
    }

    return (
        <RoleGuard companyPermissions={["view_employee"]}>
            <EmployeesDetails employee={employee} onBack={handleBack} />
        </RoleGuard>
    );
}
