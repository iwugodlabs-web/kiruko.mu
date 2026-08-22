"use client";

import { useState, useEffect } from "react";
import { X, Shield, Building2, Clock, CheckCircle, ExternalLink } from "lucide-react";
import { api } from "@/services/apiClient";
import Link from "next/link";

interface Employee {
  user_id: number;
  private_user_id: number;
  name: string;
  email: string;
  role: string | null;
  department: string | null;
  verified: boolean;
  joinDate: string;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  job_details?: any;
}

interface CompanyRole {
  role_id: number;
  name: string;
  permissions: string[];
  is_system: boolean;
}

interface Props {
  employee: Employee;
  companyId: number;
  onClose: () => void;
}

function permLabel(key: string): string {
  return key.replace(/_/g, " ").replace(/\b\w/g, (c) => c.toUpperCase());
}

const PERMISSION_GROUP_MAP: Record<string, string> = {
  view_employee: "Employees", create_employee: "Employees", edit_employee: "Employees",
  delete_employee: "Employees", export_employee: "Employees", onboard_employee: "Employees",
  view_salary: "Salary", edit_salary: "Salary", export_payroll: "Salary",
  lock_payroll: "Salary", approve_deductions: "Salary",
  view_attendance: "Attendance", export_attendance: "Attendance", edit_hours: "Attendance",
  view_compliance: "Compliance", export_compliance: "Compliance", send_reminder: "Compliance",
  view_disputes: "Disputes", assign_dispute: "Disputes", resolve_dispute: "Disputes", export_audit: "Disputes",
  view_overtime: "Overtime", approve_overtime: "Overtime", reject_overtime: "Overtime", bulk_approve_overtime: "Overtime",
  view_schedule: "Schedule", create_schedule: "Schedule", edit_schedule: "Schedule",
  delete_schedule: "Schedule", publish_schedule: "Schedule",
  view_documents: "Documents", upload_documents: "Documents", delete_documents: "Documents", bulk_upload_documents: "Documents",
  view_reports: "Reports", export_reports: "Reports",
  view_departments: "Departments", create_department: "Departments", edit_department: "Departments", delete_department: "Departments",
  view_roles: "Roles", create_role: "Roles", edit_role: "Roles", delete_role: "Roles",
};

export default function AccessHistoryDrawer({ employee, companyId, onClose }: Props) {
  const [roles, setRoles] = useState<CompanyRole[]>([]);
  const [loadingRoles, setLoadingRoles] = useState(true);

  useEffect(() => {
    async function load() {
      try {
        const res = await api.get(`/company/${companyId}/roles`);
        setRoles(res.data ?? []);
      } catch {
        // non-critical
      } finally {
        setLoadingRoles(false);
      }
    }
    load();
  }, [companyId]);

  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if (e.key === "Escape") onClose();
    }
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [onClose]);

  // Find the matching role definition to get inherited permissions
  const employeeRoleName = (employee.role ?? "employee").toLowerCase();
  const matchedRole = roles.find(
    (r) => r.name.toLowerCase() === employeeRoleName ||
           r.name.toLowerCase().replace(/ /g, "_") === employeeRoleName
  );
  const permissions: string[] = matchedRole?.permissions ?? [];

  // Group permissions
  const grouped: Record<string, string[]> = {};
  for (const perm of permissions) {
    const group = PERMISSION_GROUP_MAP[perm] ?? "Other";
    if (!grouped[group]) grouped[group] = [];
    grouped[group].push(perm);
  }

  const joinFormatted = (() => {
    try {
      return new Date(employee.joinDate).toLocaleDateString("en-GB", {
        day: "numeric", month: "long", year: "numeric",
      });
    } catch {
      return "—";
    }
  })();

  return (
    <>
      <div className="fixed inset-0 bg-black/40 backdrop-blur-sm z-40" onClick={onClose} />
      <div className="fixed right-0 top-0 h-full w-full max-w-md bg-white dark:bg-gray-900 shadow-2xl z-50 flex flex-col">
        {/* Header */}
        <div className="flex items-start justify-between px-6 py-5 border-b border-gray-100 dark:border-gray-800">
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 rounded-xl bg-gray-100 dark:bg-gray-800 flex items-center justify-center text-sm font-bold text-gray-600 dark:text-gray-300 uppercase shrink-0">
              {employee.name.split(" ").map((n) => n[0]).join("").slice(0, 2)}
            </div>
            <div>
              <p className="font-semibold text-gray-900 dark:text-gray-100">{employee.name}</p>
              <p className="text-xs text-gray-500 dark:text-gray-400">{employee.email}</p>
            </div>
          </div>
          <button onClick={onClose} className="p-2 rounded-lg hover:bg-gray-100 dark:hover:bg-gray-800 text-gray-400 transition-colors">
            <X size={18} />
          </button>
        </div>

        {/* Body */}
        <div className="flex-1 overflow-y-auto px-6 py-5 space-y-5">
          {/* Access summary */}
          <div className="grid grid-cols-2 gap-3">
            <div className="bg-gray-50 dark:bg-gray-800 rounded-xl p-3">
              <div className="flex items-center gap-1.5 mb-1">
                <Shield size={12} className="text-gray-400" />
                <span className="text-[10px] font-semibold text-gray-400 dark:text-gray-500 uppercase tracking-wider">Role</span>
              </div>
              <p className="text-sm font-semibold text-gray-900 dark:text-gray-100 capitalize">
                {employee.role ?? "Employee"}
              </p>
              {matchedRole?.is_system && (
                <span className="text-[9px] text-violet-500 font-medium">System role</span>
              )}
            </div>
            <div className="bg-gray-50 dark:bg-gray-800 rounded-xl p-3">
              <div className="flex items-center gap-1.5 mb-1">
                <Building2 size={12} className="text-gray-400" />
                <span className="text-[10px] font-semibold text-gray-400 dark:text-gray-500 uppercase tracking-wider">Department</span>
              </div>
              <p className="text-sm font-semibold text-gray-900 dark:text-gray-100">
                {employee.department ?? "Unassigned"}
              </p>
            </div>
            <div className="bg-gray-50 dark:bg-gray-800 rounded-xl p-3">
              <div className="flex items-center gap-1.5 mb-1">
                <Clock size={12} className="text-gray-400" />
                <span className="text-[10px] font-semibold text-gray-400 dark:text-gray-500 uppercase tracking-wider">Joined</span>
              </div>
              <p className="text-sm font-semibold text-gray-900 dark:text-gray-100">{joinFormatted}</p>
            </div>
            <div className="bg-gray-50 dark:bg-gray-800 rounded-xl p-3">
              <div className="flex items-center gap-1.5 mb-1">
                <CheckCircle size={12} className="text-gray-400" />
                <span className="text-[10px] font-semibold text-gray-400 dark:text-gray-500 uppercase tracking-wider">Status</span>
              </div>
              <span className={`text-xs font-semibold ${employee.verified ? "text-green-600 dark:text-green-400" : "text-amber-600 dark:text-amber-400"}`}>
                {employee.verified ? "✓ Verified" : "⚠ Unverified"}
              </span>
            </div>
          </div>

          {/* Inherited permissions */}
          <div>
            <p className="text-xs font-semibold text-gray-500 dark:text-gray-400 uppercase tracking-wider mb-3">
              Inherited Permissions
              {permissions.length > 0 && (
                <span className="ml-2 font-normal text-gray-400">({permissions.length} total)</span>
              )}
            </p>

            {loadingRoles ? (
              <div className="space-y-2">
                {[...Array(3)].map((_, i) => (
                  <div key={i} className="h-8 bg-gray-100 dark:bg-gray-800 rounded-lg animate-pulse" />
                ))}
              </div>
            ) : permissions.length === 0 ? (
              <div className="text-xs text-gray-400 dark:text-gray-500 bg-gray-50 dark:bg-gray-800 rounded-xl px-4 py-3">
                No permissions found for role &ldquo;{employee.role ?? "employee"}&rdquo;.
                {!matchedRole && (
                  <span className="block mt-1">
                    Configure this role in{" "}
                    <Link href="/dashboard/settings/permissions" className="text-red-600 dark:text-red-400 hover:underline" onClick={onClose}>
                      Roles & Permissions
                    </Link>.
                  </span>
                )}
              </div>
            ) : (
              <div className="space-y-2">
                {Object.entries(grouped).map(([group, perms]) => (
                  <div key={group} className="border border-gray-100 dark:border-gray-700 rounded-xl overflow-hidden">
                    <div className="px-3 py-2 bg-gray-50 dark:bg-gray-800/60 flex items-center justify-between">
                      <span className="text-xs font-semibold text-gray-600 dark:text-gray-400">{group}</span>
                      <span className="text-[10px] text-gray-400">{perms.length}</span>
                    </div>
                    <div className="flex flex-wrap gap-1.5 px-3 py-2.5">
                      {perms.map((p) => (
                        <span key={p} className="text-[10px] bg-green-50 dark:bg-green-900/20 text-green-700 dark:text-green-400 border border-green-100 dark:border-green-800 px-2 py-0.5 rounded-md font-medium">
                          {permLabel(p)}
                        </span>
                      ))}
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>

          {/* Job details if present */}
          {employee.job_details && (
            <div>
              <p className="text-xs font-semibold text-gray-500 dark:text-gray-400 uppercase tracking-wider mb-2">
                Current Job
              </p>
              <div className="bg-gray-50 dark:bg-gray-800 rounded-xl px-4 py-3 space-y-1">
                {employee.job_details.job_title && (
                  <p className="text-sm text-gray-900 dark:text-gray-100 font-medium">{employee.job_details.job_title}</p>
                )}
                {employee.job_details.first_date_of_employment && (
                  <p className="text-xs text-gray-500">
                    Since {new Date(employee.job_details.first_date_of_employment).toLocaleDateString("en-GB", { month: "short", year: "numeric" })}
                  </p>
                )}
              </div>
            </div>
          )}
        </div>

        {/* Footer */}
        <div className="shrink-0 px-6 py-4 border-t border-gray-100 dark:border-gray-800">
          <Link
            href={`/dashboard/employees/${employee.user_id}`}
            onClick={onClose}
            className="flex items-center justify-center gap-2 w-full py-2.5 text-sm font-medium bg-gray-900 dark:bg-white hover:bg-gray-800 dark:hover:bg-gray-100 text-white dark:text-gray-900 rounded-xl transition-colors"
          >
            <ExternalLink size={13} />
            Open Full Profile
          </Link>
        </div>
      </div>
    </>
  );
}
