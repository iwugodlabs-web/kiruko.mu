"use client";

import { useState } from "react";
import { AlertTriangle, X, Trash2 } from "lucide-react";
import { DeptWithCount } from "./types";

interface Props {
  dept: DeptWithCount;
  onConfirm: () => Promise<void>;
  onClose: () => void;
}

export default function DepartmentDeleteModal({ dept, onConfirm, onClose }: Props) {
  const [deleting, setDeleting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function handleDelete() {
    setDeleting(true);
    setError(null);
    try {
      await onConfirm();
      onClose();
    } catch (err: unknown) {
      const msg = (err as { response?: { data?: { detail?: string } } })?.response?.data?.detail;
      setError(msg ?? "Failed to delete department.");
      setDeleting(false);
    }
  }

  return (
    <>
      <div className="fixed inset-0 bg-black/50 backdrop-blur-sm z-40" onClick={onClose} />
      <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
        <div className="bg-white dark:bg-gray-900 rounded-2xl shadow-2xl w-full max-w-sm">
          <div className="flex items-center justify-between px-6 py-4 border-b border-gray-100 dark:border-gray-800">
            <h2 className="font-semibold text-gray-900 dark:text-gray-100 text-sm flex items-center gap-2">
              <Trash2 size={15} className="text-red-500" />
              Delete Department
            </h2>
            <button
              onClick={onClose}
              className="p-1.5 rounded-lg hover:bg-gray-100 dark:hover:bg-gray-800 text-gray-400 transition-colors"
            >
              <X size={16} />
            </button>
          </div>

          <div className="px-6 py-5 space-y-4">
            <div className="flex items-start gap-3 bg-red-50 dark:bg-red-900/20 rounded-xl p-3">
              <AlertTriangle size={16} className="text-red-500 shrink-0 mt-0.5" />
              <div>
                <p className="text-sm font-medium text-red-700 dark:text-red-400">
                  Delete &ldquo;{dept.name}&rdquo;?
                </p>
                <p className="text-xs text-red-600/80 dark:text-red-400/80 mt-1">
                  {dept.member_count > 0
                    ? `${dept.member_count} employee${dept.member_count !== 1 ? "s" : ""} will become unassigned. `
                    : ""}
                  This cannot be undone.
                </p>
              </div>
            </div>

            {error && (
              <p className="text-xs text-red-600 dark:text-red-400">{error}</p>
            )}

            <div className="flex items-center justify-end gap-3">
              <button
                onClick={onClose}
                className="px-4 py-2 text-sm font-medium text-gray-700 dark:text-gray-300 rounded-xl hover:bg-gray-100 dark:hover:bg-gray-800 transition-colors"
              >
                Cancel
              </button>
              <button
                onClick={handleDelete}
                disabled={deleting}
                className="flex items-center gap-2 px-5 py-2 text-sm font-medium bg-red-600 hover:bg-red-700 text-white rounded-xl disabled:opacity-50 transition-colors"
              >
                <Trash2 size={13} />
                {deleting ? "Deleting…" : "Delete"}
              </button>
            </div>
          </div>
        </div>
      </div>
    </>
  );
}
