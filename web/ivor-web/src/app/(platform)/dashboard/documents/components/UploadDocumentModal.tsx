"use client";

import { useState, useEffect, useRef } from "react";
import { X, Upload, FileText, AlertTriangle } from "lucide-react";
import { DOC_TYPES } from "./types";

interface Employee {
  private_user_id: number;
  first_name: string;
  last_name: string;
}

interface Props {
  employees: Employee[];
  onUpload: (formData: FormData) => Promise<void>;
  onClose: () => void;
}

const inputCls = "w-full rounded-xl border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-800 text-sm text-gray-900 dark:text-gray-100 px-3 py-2.5 focus:outline-none focus:ring-2 focus:ring-red-500 placeholder:text-gray-400 dark:placeholder:text-gray-600";
const labelCls = "block text-xs font-semibold text-gray-500 dark:text-gray-400 uppercase tracking-wider mb-1.5";

export default function UploadDocumentModal({ employees, onUpload, onClose }: Props) {
  const [name, setName] = useState("");
  const [docType, setDocType] = useState("contract");
  const [employeeId, setEmployeeId] = useState<number | "">(employees[0]?.private_user_id ?? "");
  const [expiryDate, setExpiryDate] = useState("");
  const [notes, setNotes] = useState("");
  const [visibility, setVisibility] = useState("employer_only");
  const [file, setFile] = useState<File | null>(null);
  const [uploading, setUploading] = useState(false);
  const [dragOver, setDragOver] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    function onKey(e: KeyboardEvent) { if (e.key === "Escape") onClose(); }
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [onClose]);

  // Auto-fill name from file
  useEffect(() => {
    if (file && !name) setName(file.name.replace(/\.[^.]+$/, ""));
  }, [file, name]);

  function handleFileDrop(e: React.DragEvent) {
    e.preventDefault();
    setDragOver(false);
    const dropped = e.dataTransfer.files[0];
    if (dropped) setFile(dropped);
  }

  async function handleSubmit() {
    if (!name.trim() || !employeeId) return;
    setUploading(true);
    try {
      const fd = new FormData();
      fd.append("private_user_id", String(employeeId));
      fd.append("doc_type", docType);
      fd.append("name", name.trim());
      if (expiryDate) fd.append("expiry_date", expiryDate);
      if (notes.trim()) fd.append("notes", notes.trim());
      fd.append("visibility", visibility);
      if (file) fd.append("file", file);
      await onUpload(fd);
      onClose();
    } finally {
      setUploading(false);
    }
  }

  const showExpiryField = ["work_permit", "passport", "visa", "id_card", "certificate"].includes(docType);

  return (
    <>
      <div className="fixed inset-0 bg-black/50 backdrop-blur-sm z-40" onClick={onClose} />
      <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
        <div className="bg-white dark:bg-gray-900 rounded-2xl shadow-2xl w-full max-w-lg max-h-[90vh] flex flex-col">
          {/* Header */}
          <div className="flex items-center justify-between px-6 py-4 border-b border-gray-100 dark:border-gray-800">
            <h2 className="font-semibold text-gray-900 dark:text-gray-100">Upload Document</h2>
            <button onClick={onClose} className="p-2 rounded-lg hover:bg-gray-100 dark:hover:bg-gray-800 text-gray-400 transition-colors">
              <X size={18} />
            </button>
          </div>

          {/* Body */}
          <div className="flex-1 overflow-y-auto px-6 py-5 space-y-4">
            {/* File drop zone */}
            <div
              onDragOver={(e) => { e.preventDefault(); setDragOver(true); }}
              onDragLeave={() => setDragOver(false)}
              onDrop={handleFileDrop}
              onClick={() => fileInputRef.current?.click()}
              className={`border-2 border-dashed rounded-xl px-4 py-6 text-center cursor-pointer transition-colors ${
                dragOver
                  ? "border-red-400 bg-red-50 dark:bg-red-900/10"
                  : file
                  ? "border-green-400 bg-green-50 dark:bg-green-900/10"
                  : "border-gray-200 dark:border-gray-700 hover:border-gray-400 dark:hover:border-gray-500"
              }`}
            >
              <input
                ref={fileInputRef}
                type="file"
                className="hidden"
                accept=".pdf,.jpg,.jpeg,.png,.doc,.docx"
                onChange={(e) => setFile(e.target.files?.[0] ?? null)}
              />
              {file ? (
                <div className="flex items-center justify-center gap-2 text-green-700 dark:text-green-400">
                  <FileText size={18} />
                  <span className="text-sm font-medium truncate max-w-[280px]">{file.name}</span>
                  <button
                    onClick={(e) => { e.stopPropagation(); setFile(null); }}
                    className="text-gray-400 hover:text-red-500"
                  >
                    <X size={14} />
                  </button>
                </div>
              ) : (
                <>
                  <Upload size={24} className="mx-auto text-gray-300 dark:text-gray-600 mb-2" />
                  <p className="text-sm text-gray-500 dark:text-gray-400">
                    Drag & drop or <span className="text-red-600 dark:text-red-400 font-medium">browse</span>
                  </p>
                  <p className="text-xs text-gray-400 dark:text-gray-500 mt-1">PDF, JPG, PNG, DOC — max 10MB</p>
                </>
              )}
            </div>

            <div>
              <label className={labelCls}>Document Name <span className="text-red-500">*</span></label>
              <input type="text" value={name} onChange={(e) => setName(e.target.value)} placeholder="Employment Contract 2024" className={inputCls} />
            </div>

            <div className="grid grid-cols-2 gap-3">
              <div>
                <label className={labelCls}>Document Type <span className="text-red-500">*</span></label>
                <select value={docType} onChange={(e) => setDocType(e.target.value)} className={inputCls}>
                  {DOC_TYPES.map((t) => (
                    <option key={t.value} value={t.value}>{t.emoji} {t.label}</option>
                  ))}
                </select>
              </div>
              <div>
                <label className={labelCls}>Employee <span className="text-red-500">*</span></label>
                <select
                  value={employeeId}
                  onChange={(e) => setEmployeeId(e.target.value ? parseInt(e.target.value) : "")}
                  className={inputCls}
                >
                  <option value="">— Select —</option>
                  {employees.map((emp) => (
                    <option key={emp.private_user_id} value={emp.private_user_id}>
                      {emp.first_name} {emp.last_name}
                    </option>
                  ))}
                </select>
              </div>
            </div>

            <div>
              <label className={labelCls}>Visibility</label>
              <select value={visibility} onChange={(e) => setVisibility(e.target.value)} className={inputCls}>
                <option value="employer_only">Shared with employee (employee + admins)</option>
                <option value="company_admin">Admins only (HR)</option>
                <option value="private">Employee only (hidden from you)</option>
              </select>
              <p className="mt-1 text-[11px] text-gray-400 dark:text-gray-500">Who can see this document.</p>
            </div>

            {showExpiryField && (
              <div>
                <label className={labelCls}>Expiry Date</label>
                <input type="date" value={expiryDate} onChange={(e) => setExpiryDate(e.target.value)} className={inputCls} />
                <p className="mt-1.5 text-xs text-gray-400 dark:text-gray-500">
                  Kiruko will alert you 30 days before this expires.
                </p>
              </div>
            )}

            <div>
              <label className={labelCls}>Notes (internal)</label>
              <textarea
                value={notes}
                onChange={(e) => setNotes(e.target.value)}
                rows={2}
                placeholder="Any notes for HR use…"
                className={`${inputCls} resize-none`}
              />
            </div>

            {!file && (
              <div className="flex items-start gap-2 bg-gray-50 dark:bg-gray-800 rounded-xl px-3 py-2.5">
                <AlertTriangle size={13} className="text-gray-400 shrink-0 mt-0.5" />
                <p className="text-xs text-gray-500 dark:text-gray-400">
                  No file selected. A metadata record will be saved without an attachment — you can add a file later.
                </p>
              </div>
            )}
          </div>

          {/* Footer */}
          <div className="flex items-center justify-end gap-3 px-6 py-4 border-t border-gray-100 dark:border-gray-800">
            <button onClick={onClose} className="px-4 py-2 text-sm font-medium text-gray-700 dark:text-gray-300 rounded-xl hover:bg-gray-100 dark:hover:bg-gray-800 transition-colors">
              Cancel
            </button>
            <button
              onClick={handleSubmit}
              disabled={uploading || !name.trim() || !employeeId}
              className="flex items-center gap-2 px-5 py-2 text-sm font-medium bg-red-600 hover:bg-red-700 text-white rounded-xl disabled:opacity-50 transition-colors"
            >
              <Upload size={14} />
              {uploading ? "Uploading…" : "Upload Document"}
            </button>
          </div>
        </div>
      </div>
    </>
  );
}
