"use client";

import { useState } from "react";
import { X, Users, ArrowRightLeft, UserPlus } from "lucide-react";
import { DeptEmployee, DeptWithCount } from "./types";

interface Props {
  dept: DeptWithCount;
  employees: DeptEmployee[];
  allDepts: DeptWithCount[];
  onReassign: (employeePrivateUserId: number, jobId: number | null, newDeptId: number | null) => Promise<void>;
  onClose: () => void;
}

export default function DepartmentMembersDrawer({
  dept,
  employees,
  allDepts,
  onReassign,
  onClose,
}: Props) {
  const members = employees.filter((e) => e.department_id === dept.department_id);
  // Everyone else — unassigned or in a different department — is a
  // candidate to add here. Reassignment already supports moving someone
  // between two real departments (from their CURRENT department's
  // drawer); this is the missing other direction: pulling someone in
  // while looking at the TARGET department, which is the only way an
  // Unassigned employee (no department drawer of their own) can ever be
  // added to one at all.
  const nonMembers = employees.filter((e) => e.department_id !== dept.department_id);
  const [reassigning, setReassigning] = useState<number | null>(null);
  const [targetDept, setTargetDept] = useState<Record<number, string>>({});
  const [addSelection, setAddSelection] = useState("");
  const [adding, setAdding] = useState(false);

  async function handleAdd() {
    if (!addSelection) return;
    const emp = nonMembers.find((e) => String(e.private_user_id) === addSelection);
    if (!emp) return;
    setAdding(true);
    try {
      await onReassign(emp.private_user_id, emp.job_id, dept.department_id);
      setAddSelection("");
    } finally {
      setAdding(false);
    }
  }

  async function handleReassign(emp: DeptEmployee) {
    const newDeptIdStr = targetDept[emp.private_user_id];
    if (!newDeptIdStr) return;
    const newDeptId = newDeptIdStr === "none" ? null : parseInt(newDeptIdStr);
    setReassigning(emp.private_user_id);
    try {
      await onReassign(emp.private_user_id, emp.job_id, newDeptId);
      setTargetDept((prev) => {
        const next = { ...prev };
        delete next[emp.private_user_id];
        return next;
      });
    } finally {
      setReassigning(null);
    }
  }

  const otherDepts = allDepts.filter((d) => d.department_id !== dept.department_id);

  return (
    <>
      <div className="fixed inset-0 bg-black/40 backdrop-blur-sm z-40" onClick={onClose} />
      <div className="fixed right-0 top-0 h-full w-full max-w-md bg-white dark:bg-gray-900 shadow-2xl z-50 flex flex-col">
        {/* Header */}
        <div className="flex items-center justify-between px-6 py-4 border-b border-gray-100 dark:border-gray-800">
          <div>
            <h2 className="font-semibold text-gray-900 dark:text-gray-100 flex items-center gap-2">
              <Users size={16} className="text-gray-400" />
              {dept.name}
            </h2>
            <p className="text-xs text-gray-500 dark:text-gray-400 mt-0.5">
              {members.length} member{members.length !== 1 ? "s" : ""}
            </p>
          </div>
          <button
            onClick={onClose}
            className="p-2 rounded-lg hover:bg-gray-100 dark:hover:bg-gray-800 text-gray-400 transition-colors"
          >
            <X size={18} />
          </button>
        </div>

        {/* Add member */}
        <div className="px-6 py-4 border-b border-gray-100 dark:border-gray-800 bg-gray-50/50 dark:bg-gray-800/30">
          <label className="block text-xs font-medium text-gray-500 dark:text-gray-400 mb-1.5">
            Add member
          </label>
          <div className="flex items-center gap-1.5">
            <select
              value={addSelection}
              onChange={(e) => setAddSelection(e.target.value)}
              className="flex-1 min-w-0 text-xs border border-gray-200 dark:border-gray-600 rounded-lg px-2 py-1.5 bg-white dark:bg-gray-700 text-gray-700 dark:text-gray-300 focus:outline-none focus:ring-1 focus:ring-blue-500"
            >
              <option value="">
                {nonMembers.length === 0 ? "No other employees" : "Select an employee…"}
              </option>
              {nonMembers.map((e) => (
                <option key={e.private_user_id} value={String(e.private_user_id)}>
                  {e.first_name} {e.last_name}
                  {e.department_id == null
                    ? " (Unassigned)"
                    : ` (${allDepts.find((d) => d.department_id === e.department_id)?.name ?? "other dept"})`}
                </option>
              ))}
            </select>
            <button
              onClick={handleAdd}
              disabled={!addSelection || adding}
              className="p-1.5 rounded-lg bg-blue-600 hover:bg-blue-700 text-white disabled:opacity-40 transition-colors shrink-0"
              title="Add to this department"
            >
              {adding ? (
                <div className="w-3.5 h-3.5 border-2 border-white/40 border-t-white rounded-full animate-spin" />
              ) : (
                <UserPlus size={13} />
              )}
            </button>
          </div>
        </div>

        {/* Body */}
        <div className="flex-1 overflow-y-auto px-6 py-4">
          {members.length === 0 ? (
            <div className="flex flex-col items-center justify-center h-40 text-gray-400">
              <Users size={28} className="mb-2 opacity-40" />
              <p className="text-sm">No members in this department.</p>
            </div>
          ) : (
            <div className="space-y-2">
              {members.map((emp) => {
                const isReassigning = reassigning === emp.private_user_id;
                const selectedTarget = targetDept[emp.private_user_id] ?? "";
                return (
                  <div
                    key={emp.private_user_id}
                    className="flex items-center gap-3 p-3 rounded-xl border border-gray-100 dark:border-gray-700 bg-gray-50 dark:bg-gray-800"
                  >
                    {/* Avatar */}
                    <div className="w-9 h-9 rounded-full bg-gray-200 dark:bg-gray-700 flex items-center justify-center text-[11px] font-bold text-gray-600 dark:text-gray-300 uppercase shrink-0">
                      {emp.first_name?.[0]}{emp.last_name?.[0]}
                    </div>

                    {/* Info */}
                    <div className="flex-1 min-w-0">
                      <p className="text-sm font-medium text-gray-900 dark:text-gray-100 truncate">
                        {emp.first_name} {emp.last_name}
                      </p>
                      {emp.job_title && (
                        <p className="text-xs text-gray-500 dark:text-gray-400 truncate">{emp.job_title}</p>
                      )}
                    </div>

                    {/* Reassign control */}
                    <div className="flex items-center gap-1.5 shrink-0">
                      <select
                        value={selectedTarget}
                        onChange={(e) =>
                          setTargetDept((prev) => ({
                            ...prev,
                            [emp.private_user_id]: e.target.value,
                          }))
                        }
                        className="text-xs border border-gray-200 dark:border-gray-600 rounded-lg px-2 py-1.5 bg-white dark:bg-gray-700 text-gray-700 dark:text-gray-300 focus:outline-none focus:ring-1 focus:ring-blue-500 max-w-[120px]"
                      >
                        <option value="">Move to…</option>
                        <option value="none">— No department</option>
                        {otherDepts.map((d) => (
                          <option key={d.department_id} value={String(d.department_id)}>
                            {d.name}
                          </option>
                        ))}
                      </select>
                      <button
                        onClick={() => handleReassign(emp)}
                        disabled={!selectedTarget || isReassigning}
                        className="p-1.5 rounded-lg bg-blue-600 hover:bg-blue-700 text-white disabled:opacity-40 transition-colors"
                        title="Move employee"
                      >
                        {isReassigning ? (
                          <div className="w-3.5 h-3.5 border-2 border-white/40 border-t-white rounded-full animate-spin" />
                        ) : (
                          <ArrowRightLeft size={13} />
                        )}
                      </button>
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </div>
      </div>
    </>
  );
}
