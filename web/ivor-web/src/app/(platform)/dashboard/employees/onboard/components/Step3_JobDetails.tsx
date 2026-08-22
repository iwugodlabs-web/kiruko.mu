"use client";

import { useState, useEffect } from "react";
import { useAuth } from "@/contexts/AuthContext";
import { getDepartments, createDepartment } from "@/services/api";
import { OnboardDraft } from "./types";
import { Plus } from "lucide-react";

interface Props {
  draft: OnboardDraft;
  onChange: (patch: Partial<OnboardDraft>) => void;
}

interface Dept { department_id: number; name: string }

const inputCls = "w-full rounded-xl border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-800 text-sm text-gray-900 dark:text-gray-100 px-3 py-2.5 focus:outline-none focus:ring-2 focus:ring-red-500 placeholder:text-gray-400 dark:placeholder:text-gray-600";
const labelCls = "block text-xs font-semibold text-gray-500 dark:text-gray-400 uppercase tracking-wider mb-1.5";

export default function Step3_JobDetails({ draft, onChange }: Props) {
  const { companyId } = useAuth();
  const [departments, setDepartments] = useState<Dept[]>([]);
  const [newDeptName, setNewDeptName] = useState("");
  const [creatingDept, setCreatingDept] = useState(false);
  const [showNewDept, setShowNewDept] = useState(false);

  useEffect(() => {
    if (!companyId) return;
    getDepartments(companyId).then((res) => {
      if (Array.isArray(res)) setDepartments(res as Dept[]);
    });
  }, [companyId]);

  async function handleCreateDept() {
    if (!companyId || !newDeptName.trim()) return;
    setCreatingDept(true);
    try {
      const res = await createDepartment(companyId, newDeptName.trim());
      if (res && !("error" in res)) {
        const dept = res as Dept;
        setDepartments((prev) => [...prev, dept]);
        onChange({ department_id: dept.department_id, department_name: dept.name });
        setNewDeptName("");
        setShowNewDept(false);
      }
    } finally {
      setCreatingDept(false);
    }
  }

  return (
    <div className="space-y-5">
      <div>
        <h2 className="text-lg font-semibold text-gray-900 dark:text-gray-100">Job Details</h2>
        <p className="text-sm text-gray-500 dark:text-gray-400 mt-0.5">Role, department, and contracted working hours.</p>
      </div>

      <div>
        <label className={labelCls}>Job Title <span className="text-red-500">*</span></label>
        <input
          type="text"
          value={draft.job_title}
          onChange={(e) => onChange({ job_title: e.target.value })}
          placeholder="Housekeeping Supervisor"
          className={inputCls}
        />
      </div>

      <div>
        <label className={labelCls}>Department</label>
        <div className="flex gap-2">
          <select
            value={draft.department_id ?? ""}
            onChange={(e) => {
              const id = e.target.value ? parseInt(e.target.value) : null;
              const dept = departments.find((d) => d.department_id === id);
              onChange({ department_id: id, department_name: dept?.name ?? "" });
            }}
            className={`${inputCls} flex-1`}
          >
            <option value="">— No department —</option>
            {departments.map((d) => (
              <option key={d.department_id} value={d.department_id}>{d.name}</option>
            ))}
          </select>
          <button
            type="button"
            onClick={() => setShowNewDept((v) => !v)}
            className="px-3 py-2 rounded-xl border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-800 text-gray-500 hover:text-gray-900 dark:hover:text-gray-100 hover:bg-gray-50 dark:hover:bg-gray-700 transition-colors"
            title="Create new department"
          >
            <Plus size={16} />
          </button>
        </div>
        {showNewDept && (
          <div className="flex gap-2 mt-2">
            <input
              type="text"
              value={newDeptName}
              onChange={(e) => setNewDeptName(e.target.value)}
              placeholder="New department name"
              className={`${inputCls} flex-1`}
              onKeyDown={(e) => e.key === "Enter" && handleCreateDept()}
            />
            <button
              onClick={handleCreateDept}
              disabled={creatingDept || !newDeptName.trim()}
              className="px-4 py-2 text-sm font-medium bg-red-600 hover:bg-red-700 text-white rounded-xl disabled:opacity-50 transition-colors"
            >
              {creatingDept ? "..." : "Create"}
            </button>
          </div>
        )}
      </div>

      <div>
        <label className={labelCls}>Start Date</label>
        <input
          type="date"
          value={draft.start_date}
          onChange={(e) => onChange({ start_date: e.target.value })}
          className={inputCls}
        />
      </div>

      <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
        <div>
          <label className={labelCls}>Contracted Hours / Week</label>
          <input
            type="number"
            min={1}
            max={84}
            value={draft.contracted_hours ?? ""}
            onChange={(e) => onChange({ contracted_hours: e.target.value ? parseFloat(e.target.value) : null })}
            placeholder="40"
            className={inputCls}
          />
          {draft.contracted_hours && draft.contracted_hours > 45 && (
            <p className="mt-1 text-xs text-amber-600 dark:text-amber-400">
              ⚠ Mauritius Employment Act limits standard hours to 45h/week.
            </p>
          )}
        </div>
        <div>
          <label className={labelCls}>Work Days / Week</label>
          <select
            value={draft.work_days_per_week ?? 5}
            onChange={(e) => onChange({ work_days_per_week: parseInt(e.target.value) })}
            className={inputCls}
          >
            {[1, 2, 3, 4, 5, 6, 7].map((d) => (
              <option key={d} value={d}>{d} day{d !== 1 ? "s" : ""}</option>
            ))}
          </select>
        </div>
      </div>
    </div>
  );
}
