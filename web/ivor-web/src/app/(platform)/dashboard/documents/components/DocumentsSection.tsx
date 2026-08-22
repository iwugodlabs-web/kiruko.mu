"use client";

import { useState, useEffect, useCallback } from "react";
import { useAuth } from "@/contexts/AuthContext";
import { api } from "@/services/apiClient";
import { fetchCompanyUsers } from "@/services/api";
import { toast } from "sonner";
import { VaultDoc, DOC_TYPES, docTypeConfig, expiryStatus } from "./types";
import DocumentListTable from "./DocumentListTable";
import ExpiryAlertBanner from "./ExpiryAlertBanner";
import UploadDocumentModal from "./UploadDocumentModal";
import BulkPayslipUpload from "./BulkPayslipUpload";
import { FolderOpen, Upload, Users, RefreshCw } from "lucide-react";
import SearchInput from "@/components/ui/SearchInput";
import useDebouncedValue from "@/hooks/useDebouncedValue";

interface CompanyUser {
  private_user?: { private_user_id: number; first_name?: string; last_name?: string };
}

interface Employee {
  private_user_id: number;
  first_name: string;
  last_name: string;
}

export default function DocumentsSection() {
  const { user, companyId } = useAuth();

  const [docs, setDocs] = useState<VaultDoc[]>([]);
  const [employees, setEmployees] = useState<Employee[]>([]);
  const [loading, setLoading] = useState(true);
  const [spinning, setSpinning] = useState(false);
  const [filterType, setFilterType] = useState("");
  const [showUpload, setShowUpload] = useState(false);
  const [showBulk, setShowBulk] = useState(false);
  const [searchQuery, setSearchQuery] = useState("");
  const debouncedSearch = useDebouncedValue(searchQuery, 250);

  const searchedDocs = (() => {
    const q = debouncedSearch.trim().toLowerCase();
    if (!q) return docs;
    return docs.filter((d) =>
      d.name?.toLowerCase().includes(q)
      || d.employee_name?.toLowerCase().includes(q)
      || d.notes?.toLowerCase().includes(q)
      || d.file_name?.toLowerCase().includes(q)
    );
  })();

  const fetchDocs = useCallback(async (silent = false) => {
    if (!companyId) return;
    if (!silent) setLoading(true);
    try {
      const res = await api.get(`/user/vault/company/${companyId}`);
      const data = res.data?.data ?? res.data;
      setDocs(Array.isArray(data) ? data : []);
    } catch {
      if (!silent) toast.error("Failed to load documents.");
    } finally {
      if (!silent) setLoading(false);
    }
  }, [companyId]);

  const fetchEmployees = useCallback(async () => {
    if (!companyId) return;
    try {
      const res = await fetchCompanyUsers(companyId) as CompanyUser[];
      if (Array.isArray(res)) {
        setEmployees(
          res
            .filter((u) => u.private_user?.private_user_id)
            .map((u) => ({
              private_user_id: u.private_user!.private_user_id,
              first_name: u.private_user!.first_name ?? "",
              last_name: u.private_user!.last_name ?? "",
            }))
        );
      }
    } catch { /* non-critical */ }
  }, [companyId]);

  useEffect(() => { fetchDocs(); fetchEmployees(); }, [fetchDocs, fetchEmployees]);

  async function handleUpload(formData: FormData) {
    try {
      // No Content-Type header — the apiClient interceptor lets the browser set
      // multipart/form-data WITH the boundary; setting it by hand breaks parsing.
      await api.post("/user/vault/upload", formData);
      toast.success("Document uploaded.");
      await fetchDocs(true);
    } catch (e: unknown) {
      const detail =
        (e as { response?: { data?: { detail?: string } } })?.response?.data?.detail;
      toast.error(detail ? `Upload failed: ${detail}` : "Upload failed. Please try again.");
      // Rethrow so the modal stays open and the user can retry.
      throw new Error("Document upload failed");
    }
  }

  async function handleBulkUpload(employeeIds: number[], file: File, name: string, docType: string) {
    let uploaded = 0;
    let failed = 0;
    for (const empId of employeeIds) {
      const fd = new FormData();
      fd.append("private_user_id", String(empId));
      fd.append("doc_type", docType);
      fd.append("name", name);
      fd.append("file", file);
      try {
        await api.post("/user/vault/upload", fd);
        uploaded++;
      } catch {
        failed++;
      }
    }

    if (uploaded > 0 && failed === 0) {
      toast.success(`Uploaded to ${uploaded} employee${uploaded !== 1 ? "s" : ""}.`);
    } else if (uploaded > 0 && failed > 0) {
      toast.message(`Uploaded to ${uploaded}; ${failed} failed.`);
    } else {
      toast.error(`Upload failed for all ${failed} employee${failed !== 1 ? "s" : ""}.`);
    }

    setShowBulk(false);
    await fetchDocs(true);
  }

  async function handleDelete(docId: number) {
    if (!confirm("Delete this document? This cannot be undone.")) return;
    try {
      await api.delete(`/user/vault/doc/${docId}`);
      setDocs((prev) => prev.filter((d) => d.doc_id !== docId));
      toast.success("Document deleted.");
    } catch {
      toast.error("Could not delete document.");
    }
  }

  async function handleRefresh() {
    setSpinning(true);
    await fetchDocs(true);
    setSpinning(false);
  }

  if (!companyId) return (
    <div className="flex items-center justify-center h-64 text-gray-400 dark:text-gray-500">
      No company associated with your account.
    </div>
  );

  // Summary counts
  const expiredCount = docs.filter((d) => expiryStatus(d.expiry_date) === "expired").length;
  const expiringCount = docs.filter((d) => expiryStatus(d.expiry_date) === "expiring").length;
  const byType = DOC_TYPES.map((t) => ({
    ...t,
    count: docs.filter((d) => d.doc_type === t.value).length,
  })).filter((t) => t.count > 0);

  return (
    <div className="w-full max-w-7xl mx-auto flex flex-col gap-6 p-6">
      {/* Header */}
      <div className="flex flex-wrap items-start justify-between gap-4 pb-5 border-b border-gray-200 dark:border-gray-800">
        <div>
          <h1 className="flex items-center gap-2 text-[2rem] font-display font-semibold text-gray-900 dark:text-white leading-tight tracking-tight">
            <FolderOpen size={22} className="text-gray-400" />
            Document Management
          </h1>
          <p className="text-sm text-gray-500 dark:text-gray-400 mt-0.5">
            Company-wide document vault. Upload contracts, permits, and payslips to employee profiles.
          </p>
        </div>
        <div className="flex items-center gap-2">
          <button
            onClick={handleRefresh}
            disabled={spinning}
            className="p-2 rounded-xl border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-800 text-gray-500 hover:text-gray-900 dark:hover:text-gray-100 hover:bg-gray-50 dark:hover:bg-gray-700 transition-colors"
          >
            <RefreshCw size={15} className={spinning ? "animate-spin" : ""} />
          </button>
          <button
            onClick={() => setShowBulk(true)}
            className="flex items-center gap-2 px-4 py-2 text-sm font-medium border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-800 text-gray-700 dark:text-gray-300 hover:bg-gray-50 dark:hover:bg-gray-700 rounded-xl transition-colors"
          >
            <Users size={14} />
            Bulk Upload
          </button>
          <button
            onClick={() => setShowUpload(true)}
            className="flex items-center gap-2 px-4 py-2 text-sm font-medium bg-blue-600 hover:bg-blue-700 text-white rounded-xl transition-colors"
          >
            <Upload size={14} />
            Upload Document
          </button>
        </div>
      </div>

      {/* Expiry alert */}
      <ExpiryAlertBanner docs={docs} />

      {/* Summary cards */}
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-4">
        {[
          { label: "Total Documents", value: docs.length, color: "text-blue-600 dark:text-blue-400" },
          { label: "Expired", value: expiredCount, color: expiredCount > 0 ? "text-red-600 dark:text-red-400" : "text-gray-400" },
          { label: "Expiring Soon", value: expiringCount, color: expiringCount > 0 ? "text-amber-600 dark:text-amber-400" : "text-gray-400" },
          { label: "Employees Covered", value: new Set(docs.map((d) => d.private_user_id)).size, color: "text-green-600 dark:text-green-400" },
        ].map((card) => (
          <div key={card.label} className="bg-white dark:bg-gray-800 rounded-xl border border-gray-100 dark:border-gray-700 p-4">
            <p className="text-xs text-gray-500 dark:text-gray-400">{card.label}</p>
            {loading ? (
              <div className="h-7 w-12 bg-gray-200 dark:bg-gray-700 rounded animate-pulse mt-1" />
            ) : (
              <p className={`text-2xl font-bold mt-1 ${card.color}`}>{card.value}</p>
            )}
          </div>
        ))}
      </div>

      {/* Filter chips + table */}
      <div className="bg-white dark:bg-gray-800 rounded-xl border border-gray-100 dark:border-gray-700">
        {/* Search + type filter pills */}
        <div className="flex flex-col gap-3 px-4 py-3 border-b border-gray-100 dark:border-gray-700">
          <div className="flex items-center justify-between gap-3 flex-wrap">
            <div className="flex items-center gap-2 flex-wrap">
              <button
                onClick={() => setFilterType("")}
                className={`px-3 py-1 rounded-lg text-xs font-medium transition-colors ${!filterType ? "bg-gray-900 dark:bg-gray-100 text-white dark:text-gray-900" : "text-gray-600 dark:text-gray-400 hover:bg-gray-100 dark:hover:bg-gray-700"}`}
              >
                All ({searchedDocs.length})
              </button>
              {byType.map((t) => {
                const count = searchedDocs.filter((d) => d.doc_type === t.value).length;
                return (
                  <button
                    key={t.value}
                    onClick={() => setFilterType(filterType === t.value ? "" : t.value)}
                    className={`px-3 py-1 rounded-lg text-xs font-medium transition-colors ${filterType === t.value ? "bg-gray-900 dark:bg-gray-100 text-white dark:text-gray-900" : "text-gray-600 dark:text-gray-400 hover:bg-gray-100 dark:hover:bg-gray-700"}`}
                  >
                    {t.emoji} {t.label} ({count})
                  </button>
                );
              })}
            </div>
            <SearchInput
              value={searchQuery}
              onChange={setSearchQuery}
              placeholder="Search by name, employee, or notes…"
              className="w-72 max-w-full"
            />
          </div>
        </div>

        <DocumentListTable
          docs={searchedDocs}
          loading={loading}
          filterType={filterType}
          onDelete={handleDelete}
        />
      </div>

      {/* Modals */}
      {showUpload && (
        <UploadDocumentModal
          employees={employees}
          onUpload={handleUpload}
          onClose={() => setShowUpload(false)}
        />
      )}
      {showBulk && (
        <BulkPayslipUpload
          employees={employees}
          onBulkUpload={handleBulkUpload}
          onClose={() => setShowBulk(false)}
        />
      )}
    </div>
  );
}
