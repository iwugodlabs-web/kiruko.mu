"use client";

import { useState, useRef } from "react";
import { Upload, FileText, X, CheckCircle, Users } from "lucide-react";

interface Employee {
  private_user_id: number;
  first_name: string;
  last_name: string;
}

interface Props {
  employees: Employee[];
  onBulkUpload: (employeeIds: number[], file: File, name: string, docType: string) => Promise<void>;
  onClose: () => void;
}

const inputCls = "w-full rounded-xl border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-800 text-sm text-gray-900 dark:text-gray-100 px-3 py-2.5 focus:outline-none focus:ring-2 focus:ring-red-500";
const labelCls = "block text-xs font-semibold text-gray-500 dark:text-gray-400 uppercase tracking-wider mb-1.5";

export default function BulkPayslipUpload({ employees, onBulkUpload, onClose }: Props) {
  const [file, setFile] = useState<File | null>(null);
  const [name, setName] = useState("");
  const [docType, setDocType] = useState("pay_stub");
  const [selected, setSelected] = useState<Set<number>>(new Set());
  const [uploading, setUploading] = useState(false);
  const [progress, setProgress] = useState<number | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);

  function toggleAll() {
    if (selected.size === employees.length) {
      setSelected(new Set());
    } else {
      setSelected(new Set(employees.map((e) => e.private_user_id)));
    }
  }

  function toggleEmp(id: number) {
    setSelected((prev) => {
      const s = new Set(prev);
      s.has(id) ? s.delete(id) : s.add(id);
      return s;
    });
  }

  async function handleUpload() {
    if (!file || !name.trim() || selected.size === 0) return;
    setUploading(true);
    setProgress(0);
    try {
      await onBulkUpload(Array.from(selected), file, name.trim(), docType);
    } finally {
      setUploading(false);
      setProgress(null);
    }
  }

  return (
    <>
      <div className="fixed inset-0 bg-black/50 backdrop-blur-sm z-40" onClick={onClose} />
      <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
        <div className="bg-white dark:bg-gray-900 rounded-2xl shadow-2xl w-full max-w-lg max-h-[90vh] flex flex-col">
          <div className="flex items-center justify-between px-6 py-4 border-b border-gray-100 dark:border-gray-800">
            <div>
              <h2 className="font-semibold text-gray-900 dark:text-gray-100">Bulk Document Upload</h2>
              <p className="text-xs text-gray-500 dark:text-gray-400 mt-0.5">Send the same document to multiple employees</p>
            </div>
            <button onClick={onClose} className="p-2 rounded-lg hover:bg-gray-100 dark:hover:bg-gray-800 text-gray-400 transition-colors">
              <X size={18} />
            </button>
          </div>

          <div className="flex-1 overflow-y-auto px-6 py-5 space-y-4">
            {/* File picker */}
            <div
              onClick={() => fileInputRef.current?.click()}
              className={`border-2 border-dashed rounded-xl px-4 py-5 text-center cursor-pointer transition-colors ${
                file ? "border-green-400 bg-green-50 dark:bg-green-900/10" : "border-gray-200 dark:border-gray-700 hover:border-gray-400 dark:hover:border-gray-500"
              }`}
            >
              <input
                ref={fileInputRef}
                type="file"
                className="hidden"
                accept=".pdf,.jpg,.jpeg,.png"
                onChange={(e) => {
                  const f = e.target.files?.[0] ?? null;
                  setFile(f);
                  if (f && !name) setName(f.name.replace(/\.[^.]+$/, ""));
                }}
              />
              {file ? (
                <div className="flex items-center justify-center gap-2 text-green-700 dark:text-green-400">
                  <FileText size={16} /><span className="text-sm font-medium">{file.name}</span>
                </div>
              ) : (
                <>
                  <Upload size={20} className="mx-auto text-gray-300 dark:text-gray-600 mb-1.5" />
                  <p className="text-sm text-gray-500 dark:text-gray-400">Click to select file</p>
                </>
              )}
            </div>

            <div className="grid grid-cols-2 gap-3">
              <div>
                <label className={labelCls}>Document Name</label>
                <input type="text" value={name} onChange={(e) => setName(e.target.value)} placeholder="Payslip April 2026" className={inputCls} />
              </div>
              <div>
                <label className={labelCls}>Type</label>
                <select value={docType} onChange={(e) => setDocType(e.target.value)} className={inputCls}>
                  <option value="pay_stub">💰 Payslip</option>
                  <option value="contract">📄 Contract</option>
                  <option value="certificate">🏆 Certificate</option>
                  <option value="other">📎 Other</option>
                </select>
              </div>
            </div>

            {/* Employee selection */}
            <div>
              <div className="flex items-center justify-between mb-2">
                <label className={`${labelCls} mb-0`}>
                  <Users size={11} className="inline mr-1" />
                  Recipients ({selected.size}/{employees.length})
                </label>
                <button onClick={toggleAll} className="text-xs text-red-600 dark:text-red-400 hover:underline font-medium">
                  {selected.size === employees.length ? "Deselect all" : "Select all"}
                </button>
              </div>
              <div className="space-y-1 max-h-48 overflow-y-auto border border-gray-200 dark:border-gray-700 rounded-xl p-1">
                {employees.map((emp) => {
                  const isSelected = selected.has(emp.private_user_id);
                  return (
                    <label
                      key={emp.private_user_id}
                      className={`flex items-center gap-3 px-3 py-2 rounded-lg cursor-pointer transition-colors ${
                        isSelected ? "bg-red-50 dark:bg-red-900/20" : "hover:bg-gray-50 dark:hover:bg-gray-800"
                      }`}
                    >
                      <input
                        type="checkbox"
                        checked={isSelected}
                        onChange={() => toggleEmp(emp.private_user_id)}
                        className="accent-red-600"
                      />
                      <div className="w-7 h-7 rounded-full bg-gray-200 dark:bg-gray-700 flex items-center justify-center text-[10px] font-bold text-gray-600 dark:text-gray-300 uppercase shrink-0">
                        {emp.first_name?.[0]}{emp.last_name?.[0]}
                      </div>
                      <span className="text-sm text-gray-800 dark:text-gray-200">{emp.first_name} {emp.last_name}</span>
                      {isSelected && <CheckCircle size={13} className="text-red-500 ml-auto shrink-0" />}
                    </label>
                  );
                })}
              </div>
            </div>

            {uploading && progress !== null && (
              <div className="text-xs text-gray-500 dark:text-gray-400 text-center">
                Uploading to {selected.size} employee{selected.size !== 1 ? "s" : ""}…
              </div>
            )}
          </div>

          <div className="flex items-center justify-end gap-3 px-6 py-4 border-t border-gray-100 dark:border-gray-800">
            <button onClick={onClose} className="px-4 py-2 text-sm font-medium text-gray-700 dark:text-gray-300 rounded-xl hover:bg-gray-100 dark:hover:bg-gray-800 transition-colors">
              Cancel
            </button>
            <button
              onClick={handleUpload}
              disabled={uploading || !file || !name.trim() || selected.size === 0}
              className="flex items-center gap-2 px-5 py-2 text-sm font-medium bg-red-600 hover:bg-red-700 text-white rounded-xl disabled:opacity-50 transition-colors"
            >
              <Upload size={14} />
              {uploading ? "Uploading…" : `Upload to ${selected.size} employee${selected.size !== 1 ? "s" : ""}`}
            </button>
          </div>
        </div>
      </div>
    </>
  );
}
