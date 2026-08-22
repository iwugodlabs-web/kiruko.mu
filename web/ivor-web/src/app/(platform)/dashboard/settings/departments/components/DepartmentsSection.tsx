"use client";

import { useState, useEffect, useCallback } from "react";
import { useAuth } from "@/contexts/AuthContext";
import {
  getDepartments,
  createDepartment,
  updateDepartment,
  deleteDepartment,
  fetchCompanyUsers,
  patchJobDepartment,
  setUserDepartment,
} from "@/services/api";
import { toast } from "sonner";
import { Building2, Plus, RefreshCw, Pencil, Trash2, Users } from "lucide-react";
import { Department, DeptEmployee, DeptWithCount } from "./types";
import DepartmentFormModal from "./DepartmentFormModal";
import DepartmentMembersDrawer from "./DepartmentMembersDrawer";
import DepartmentDeleteModal from "./DepartmentDeleteModal";

interface RawCompanyUser {
  private_user?: {
    private_user_id: number;
    first_name?: string;
    last_name?: string;
    department_id?: number | null;
  };
  job?: {
    job_id?: number;
    job_title?: string;
    department_id?: number | null;
  };
  user_id?: number;
}

export default function DepartmentsSection() {
  const { user, companyId } = useAuth();
  // eslint-disable-next-line @typescript-eslint/no-explicit-any

  const [depts, setDepts] = useState<DeptWithCount[]>([]);
  const [employees, setEmployees] = useState<DeptEmployee[]>([]);
  const [loading, setLoading] = useState(true);
  const [spinning, setSpinning] = useState(false);

  // Modal state
  const [formTarget, setFormTarget] = useState<Department | null | undefined>(undefined); // undefined=closed, null=create, obj=edit
  const [deleteTarget, setDeleteTarget] = useState<DeptWithCount | null>(null);
  const [membersDrawer, setMembersDrawer] = useState<DeptWithCount | null>(null);

  const fetchAll = useCallback(
    async (silent = false) => {
      if (!companyId) return;
      if (!silent) setLoading(true);
      try {
        const [rawDepts, rawUsers] = await Promise.all([
          getDepartments(companyId),
          fetchCompanyUsers(companyId),
        ]);

        // Parse employees
        const empList: DeptEmployee[] = [];
        if (Array.isArray(rawUsers)) {
          for (const u of rawUsers as RawCompanyUser[]) {
            if (!u.private_user?.private_user_id) continue;
            empList.push({
              private_user_id: u.private_user.private_user_id,
              user_id: u.user_id ?? 0,
              first_name: u.private_user.first_name ?? "",
              last_name: u.private_user.last_name ?? "",
              job_id: u.job?.job_id ?? null,
              job_title: u.job?.job_title ?? null,
              department_id: u.job?.department_id ?? u.private_user.department_id ?? null,
            });
          }
        }
        setEmployees(empList);

        // Parse depts with member counts
        if (!Array.isArray(rawDepts)) {
          toast.error("Failed to load departments.");
          return;
        }
        const withCounts: DeptWithCount[] = (rawDepts as Department[]).map((d) => ({
          ...d,
          member_count: empList.filter((e) => e.department_id === d.department_id).length,
        }));
        setDepts(withCounts);
      } catch {
        if (!silent) toast.error("Failed to load departments.");
      } finally {
        if (!silent) setLoading(false);
      }
    },
    [companyId]
  );

  useEffect(() => {
    fetchAll();
  }, [fetchAll]);

  async function handleCreate(name: string) {
    if (!companyId) return;
    const res = await createDepartment(companyId, name);
    if ("error" in res) throw new Error(res.error);
    toast.success(`Department "${name}" created.`);
    await fetchAll(true);
  }

  async function handleRename(dept: Department, name: string) {
    if (!companyId) return;
    const res = await updateDepartment(companyId, dept.department_id, name);
    if ("error" in res) throw new Error(res.error);
    toast.success(`Renamed to "${name}".`);
    await fetchAll(true);
  }

  async function handleDelete(dept: DeptWithCount) {
    if (!companyId) return;
    const res = await deleteDepartment(companyId, dept.department_id);
    if ("error" in res) throw new Error(res.error);
    toast.success(`"${dept.name}" deleted.`);
    await fetchAll(true);
  }

  async function handleReassign(
    privateUserId: number,
    jobId: number | null,
    newDeptId: number | null
  ) {
    // Try job-level reassignment first, fall back to user-level
    if (jobId) {
      const res = await patchJobDepartment(jobId, newDeptId);
      if ("error" in res) throw new Error(res.error);
    } else {
      // PATCH /user/{user_id}/department takes the User row's PK, NOT
      // PrivateUser.private_user_id — those are different sequences.
      // Passing privateUserId here silently wrote the department onto
      // whichever unrelated user happened to share that numeric id.
      const emp = employees.find((e) => e.private_user_id === privateUserId);
      if (!emp) throw new Error("Employee not found");
      const res = await setUserDepartment(emp.user_id, newDeptId);
      if ("error" in res) throw new Error(res.error);
    }
    const label = newDeptId
      ? depts.find((d) => d.department_id === newDeptId)?.name ?? "new department"
      : "Unassigned";
    toast.success(`Employee moved to ${label}.`);
    // Optimistic local update
    setEmployees((prev) =>
      prev.map((e) =>
        e.private_user_id === privateUserId ? { ...e, department_id: newDeptId } : e
      )
    );
    setDepts((prev) =>
      prev.map((d) => ({
        ...d,
        member_count:
          d.department_id === newDeptId
            ? d.member_count + 1
            : d.department_id === employees.find((e) => e.private_user_id === privateUserId)?.department_id
            ? Math.max(0, d.member_count - 1)
            : d.member_count,
      }))
    );
    // Update the drawer dept count
    if (membersDrawer) {
      setMembersDrawer((prev) =>
        prev ? { ...prev, member_count: Math.max(0, prev.member_count - 1) } : null
      );
    }
  }

  const totalEmployees = employees.length;
  const unassignedCount = employees.filter((e) => !e.department_id).length;

  if (!companyId) {
    return (
      <div className="flex items-center justify-center h-64 text-gray-400 dark:text-gray-500">
        No company associated with your account.
      </div>
    );
  }

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div>
          <h2 className="text-lg font-bold text-gray-900 dark:text-gray-100 flex items-center gap-2">
            <Building2 size={18} className="text-gray-400" />
            Departments
          </h2>
          <p className="text-sm text-gray-500 dark:text-gray-400 mt-0.5">
            Organise your workforce into departments. Assign employees and set up scoped access.
          </p>
        </div>
        <div className="flex items-center gap-2">
          <button
            onClick={async () => { setSpinning(true); await fetchAll(true); setSpinning(false); }}
            disabled={spinning}
            className="p-2 rounded-xl border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-800 text-gray-500 hover:text-gray-900 dark:hover:text-gray-100 transition-colors"
          >
            <RefreshCw size={14} className={spinning ? "animate-spin" : ""} />
          </button>
          <button
            onClick={() => setFormTarget(null)}
            className="flex items-center gap-2 px-4 py-2 text-sm font-medium bg-blue-600 hover:bg-blue-700 text-white rounded-xl transition-colors"
          >
            <Plus size={14} />
            New Department
          </button>
        </div>
      </div>

      {/* Summary chips */}
      {!loading && (
        <div className="flex items-center gap-3 flex-wrap">
          <span className="inline-flex items-center gap-1.5 text-xs font-medium text-gray-500 dark:text-gray-400 bg-gray-100 dark:bg-gray-800 px-3 py-1.5 rounded-lg">
            <Building2 size={11} />
            {depts.length} department{depts.length !== 1 ? "s" : ""}
          </span>
          <span className="inline-flex items-center gap-1.5 text-xs font-medium text-gray-500 dark:text-gray-400 bg-gray-100 dark:bg-gray-800 px-3 py-1.5 rounded-lg">
            <Users size={11} />
            {totalEmployees} total employee{totalEmployees !== 1 ? "s" : ""}
          </span>
          {unassignedCount > 0 && (
            <span className="inline-flex items-center gap-1.5 text-xs font-medium text-amber-600 dark:text-amber-400 bg-amber-50 dark:bg-amber-900/20 px-3 py-1.5 rounded-lg">
              <Users size={11} />
              {unassignedCount} unassigned
            </span>
          )}
        </div>
      )}

      {/* Dept list */}
      {loading ? (
        <div className="space-y-2">
          {[...Array(4)].map((_, i) => (
            <div key={i} className="h-16 rounded-xl bg-gray-100 dark:bg-gray-800 animate-pulse" />
          ))}
        </div>
      ) : depts.length === 0 ? (
        <div className="flex flex-col items-center justify-center h-48 border-2 border-dashed border-gray-200 dark:border-gray-700 rounded-xl text-gray-400 dark:text-gray-500">
          <Building2 size={28} className="mb-2 opacity-40" />
          <p className="text-sm font-medium">No departments yet</p>
          <p className="text-xs mt-1">Create your first department to organise your team.</p>
          <button
            onClick={() => setFormTarget(null)}
            className="mt-4 flex items-center gap-2 px-4 py-2 text-sm font-medium bg-blue-600 hover:bg-blue-700 text-white rounded-xl transition-colors"
          >
            <Plus size={13} />
            Create Department
          </button>
        </div>
      ) : (
        <div className="space-y-2">
          {depts.map((dept) => (
            <div
              key={dept.department_id}
              className="flex items-center gap-4 px-4 py-3 bg-white dark:bg-gray-800 rounded-xl border border-gray-100 dark:border-gray-700 group"
            >
              {/* Icon */}
              <div className="w-9 h-9 rounded-lg bg-gray-100 dark:bg-gray-700 flex items-center justify-center shrink-0">
                <Building2 size={16} className="text-gray-400 dark:text-gray-500" />
              </div>

              {/* Name + count */}
              <div className="flex-1 min-w-0">
                <p className="text-sm font-semibold text-gray-900 dark:text-gray-100 truncate">
                  {dept.name}
                </p>
                <p className="text-xs text-gray-500 dark:text-gray-400">
                  {dept.member_count} member{dept.member_count !== 1 ? "s" : ""}
                  {dept.created_at && (
                    <span className="ml-2 text-gray-300 dark:text-gray-600">
                      · Created {new Date(dept.created_at).toLocaleDateString("en-GB", { day: "numeric", month: "short", year: "numeric" })}
                    </span>
                  )}
                </p>
              </div>

              {/* Actions */}
              <div className="flex items-center gap-1 opacity-0 group-hover:opacity-100 transition-opacity">
                <button
                  onClick={() => setMembersDrawer(dept)}
                  className="flex items-center gap-1.5 px-2.5 py-1.5 text-xs font-medium text-gray-600 dark:text-gray-400 hover:bg-gray-100 dark:hover:bg-gray-700 rounded-lg transition-colors"
                  title="View members"
                >
                  <Users size={12} />
                  Members
                </button>
                <button
                  onClick={() => setFormTarget(dept)}
                  className="p-2 rounded-lg text-gray-400 hover:bg-gray-100 dark:hover:bg-gray-700 hover:text-gray-700 dark:hover:text-gray-300 transition-colors"
                  title="Rename"
                >
                  <Pencil size={13} />
                </button>
                <button
                  onClick={() => setDeleteTarget(dept)}
                  className="p-2 rounded-lg text-gray-400 hover:bg-red-50 dark:hover:bg-red-900/20 hover:text-red-500 transition-colors"
                  title="Delete"
                >
                  <Trash2 size={13} />
                </button>
              </div>
            </div>
          ))}
        </div>
      )}

      {/* Modals */}
      {formTarget !== undefined && (
        <DepartmentFormModal
          dept={formTarget}
          onSave={(name) =>
            formTarget === null
              ? handleCreate(name)
              : handleRename(formTarget, name)
          }
          onClose={() => setFormTarget(undefined)}
        />
      )}

      {deleteTarget && (
        <DepartmentDeleteModal
          dept={deleteTarget}
          onConfirm={() => handleDelete(deleteTarget)}
          onClose={() => setDeleteTarget(null)}
        />
      )}

      {membersDrawer && (
        <DepartmentMembersDrawer
          dept={membersDrawer}
          employees={employees}
          allDepts={depts}
          onReassign={handleReassign}
          onClose={() => setMembersDrawer(null)}
        />
      )}
    </div>
  );
}
