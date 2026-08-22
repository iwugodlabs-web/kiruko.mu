"use client";

import { useState, useEffect, useCallback } from "react";
import { useAuth } from "@/contexts/AuthContext";
import { fetchCompanyUsers, getDepartments } from "@/services/api";
import { toast } from "sonner";
import { GitBranch, RefreshCw, Users, Building2, Shield } from "lucide-react";
import { OrgMember, OrgDepartment, getTier } from "./types";
import OrgChart from "./OrgChart";

interface RawUser {
  user_id?: number;
  user_verified?: boolean;
  private_user?: {
    private_user_id?: number;
    first_name?: string;
    last_name?: string;
    role?: string;
    department_id?: number | null;
  };
  job?: {
    job_title?: string;
    department_id?: number | null;
  };
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  [key: string]: any;
}

interface RawDept {
  department_id: number;
  name: string;
}

function Legend() {
  const items = [
    { color: "bg-violet-200 dark:bg-violet-800", label: "Owner" },
    { color: "bg-red-200 dark:bg-red-800", label: "Admin" },
    { color: "bg-amber-200 dark:bg-amber-800", label: "Manager" },
    { color: "bg-gray-200 dark:bg-gray-700", label: "Employee" },
  ];
  return (
    <div className="flex items-center gap-4 flex-wrap">
      {items.map((item) => (
        <div key={item.label} className="flex items-center gap-1.5">
          <div className={`w-4 h-4 rounded-full ${item.color}`} />
          <span className="text-xs text-gray-500 dark:text-gray-400">{item.label}</span>
        </div>
      ))}
    </div>
  );
}

export default function OrgChartSection() {
  const { user } = useAuth();
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const companyId = (user as any)?.company?.company_id as number | undefined;
  const companyName =
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    (user as any)?.company?.company_name ?? "Company";

  const [members, setMembers] = useState<OrgMember[]>([]);
  const [departments, setDepartments] = useState<OrgDepartment[]>([]);
  const [loading, setLoading] = useState(true);
  const [spinning, setSpinning] = useState(false);

  const fetchAll = useCallback(
    async (silent = false) => {
      if (!companyId) return;
      if (!silent) setLoading(true);
      try {
        const [usersRes, deptsRes] = await Promise.all([
          fetchCompanyUsers(companyId),
          getDepartments(companyId),
        ]);

        const deptList: RawDept[] = Array.isArray(deptsRes) ? (deptsRes as RawDept[]) : [];
        const deptMap = Object.fromEntries(deptList.map((d) => [d.department_id, d.name]));

        const memberList: OrgMember[] = [];
        if (Array.isArray(usersRes)) {
          for (const u of usersRes as RawUser[]) {
            if (!u.private_user?.private_user_id) continue;
            const deptId =
              u.job?.department_id ?? u.private_user.department_id ?? null;
            memberList.push({
              private_user_id: u.private_user.private_user_id,
              user_id: u.user_id ?? 0,
              first_name: u.private_user.first_name ?? "",
              last_name: u.private_user.last_name ?? "",
              role: u.private_user.role ?? "employee",
              job_title: u.job?.job_title ?? null,
              department_id: deptId,
              department_name: deptId ? (deptMap[deptId] ?? null) : null,
              verified: u.user_verified ?? false,
            });
          }
        }
        setMembers(memberList);

        // Build OrgDepartment list with members
        const orgDepts: OrgDepartment[] = deptList.map((d) => ({
          department_id: d.department_id,
          name: d.name,
          members: memberList.filter(
            (m) => m.department_id === d.department_id && getTier(m.role) !== "owner" && getTier(m.role) !== "admin"
          ),
        }));
        setDepartments(orgDepts);
      } catch {
        if (!silent) toast.error("Failed to load org chart.");
      } finally {
        if (!silent) setLoading(false);
      }
    },
    [companyId]
  );

  useEffect(() => {
    fetchAll();
  }, [fetchAll]);

  const owners = members.filter((m) => getTier(m.role) === "owner");
  const admins = members.filter((m) => getTier(m.role) === "admin");
  const unassigned = members.filter(
    (m) =>
      !m.department_id &&
      getTier(m.role) !== "owner" &&
      getTier(m.role) !== "admin"
  );

  if (!companyId) return null;

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div>
          <h2 className="text-lg font-bold text-gray-900 dark:text-gray-100 flex items-center gap-2">
            <GitBranch size={18} className="text-gray-400" />
            Organisation Chart
          </h2>
          <p className="text-sm text-gray-500 dark:text-gray-400 mt-0.5">
            Read-only view of your company hierarchy by role and department.
          </p>
        </div>
        <button
          onClick={async () => {
            setSpinning(true);
            await fetchAll(true);
            setSpinning(false);
          }}
          disabled={spinning}
          className="p-2 rounded-xl border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-800 text-gray-500 hover:text-gray-900 dark:hover:text-gray-100 transition-colors"
        >
          <RefreshCw size={14} className={spinning ? "animate-spin" : ""} />
        </button>
      </div>

      {/* Stats */}
      {!loading && (
        <div className="flex items-center gap-4 flex-wrap">
          <div className="flex items-center gap-2 text-xs text-gray-500 dark:text-gray-400">
            <Users size={13} />
            <span>{members.length} total members</span>
          </div>
          <div className="flex items-center gap-2 text-xs text-gray-500 dark:text-gray-400">
            <Building2 size={13} />
            <span>{departments.length} department{departments.length !== 1 ? "s" : ""}</span>
          </div>
          <div className="flex items-center gap-2 text-xs text-gray-500 dark:text-gray-400">
            <Shield size={13} />
            <span>{owners.length + admins.length} leadership</span>
          </div>
          {unassigned.length > 0 && (
            <div className="flex items-center gap-2 text-xs text-amber-600 dark:text-amber-400">
              <Users size={13} />
              <span>{unassigned.length} without a department</span>
            </div>
          )}
        </div>
      )}

      <Legend />

      {/* Chart */}
      <div className="bg-white dark:bg-gray-800 rounded-2xl border border-gray-100 dark:border-gray-700 p-6 min-h-[320px]">
        {loading ? (
          <div className="flex flex-col items-center justify-center h-64 gap-3">
            <div className="w-8 h-8 rounded-full border-4 border-gray-200 dark:border-gray-700 border-t-blue-500 animate-spin" />
            <p className="text-sm text-gray-400">Building chart…</p>
          </div>
        ) : (
          <OrgChart
            companyName={companyName}
            owners={owners}
            admins={admins}
            departments={departments}
          />
        )}
      </div>

      <p className="text-xs text-gray-400 dark:text-gray-500">
        Click any node to open the employee&apos;s full profile. Department assignment and roles are managed in{" "}
        <a href="/dashboard/settings/departments" className="text-blue-600 dark:text-blue-400 hover:underline">Departments</a>
        {" "}and{" "}
        <a href="/dashboard/settings/permissions" className="text-blue-600 dark:text-blue-400 hover:underline">Roles & Permissions</a>.
      </p>
    </div>
  );
}
