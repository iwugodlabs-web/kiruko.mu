"use client";

import { useState, useEffect, useCallback } from "react";
import { useAuth } from "@/contexts/AuthContext";
import { api } from "@/services/apiClient";
import { toast } from "sonner";
import {
  DisputesResponse, InternalDispute, ExternalStats, DisputeStatus,
} from "./types";
import DisputeKanban from "./DisputeKanban";
import DisputeDetailModal from "./DisputeDetailModal";
import DisputeStatsCards from "./DisputeStatsCards";
import ExternalReportStats from "./ExternalReportStats";
import { RefreshCw, Scale } from "lucide-react";
import DashboardHeader from "@/components/ui/DashboardHeader";
import SearchInput from "@/components/ui/SearchInput";
import useDebouncedValue from "@/hooks/useDebouncedValue";

const EMPTY_EXTERNAL: ExternalStats = { total: 0, by_category: {}, by_month: {} };

export default function DisputesSection() {
  const { user, companyId } = useAuth();

  const [internalDisputes, setInternalDisputes] = useState<InternalDispute[]>([]);
  const [externalStats, setExternalStats] = useState<ExternalStats>(EMPTY_EXTERNAL);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [selectedDispute, setSelectedDispute] = useState<InternalDispute | null>(null);
  const [activeView, setActiveView] = useState<"kanban" | "external">("kanban");
  const [spinning, setSpinning] = useState(false);
  const [searchQuery, setSearchQuery] = useState("");
  const debouncedSearch = useDebouncedValue(searchQuery, 250);

  const filteredDisputes = (() => {
    const q = debouncedSearch.trim().toLowerCase();
    if (!q) return internalDisputes;
    return internalDisputes.filter((d) =>
      d.title?.toLowerCase().includes(q)
      || d.category?.toLowerCase().includes(q)
    );
  })();

  const fetchDisputes = useCallback(async (silent = false) => {
    if (!companyId) return;
    if (!silent) setLoading(true);
    setError(null);
    try {
      const res = await api.get<DisputesResponse>(
        `/user/disputes/company/${companyId}?channel=all`
      );
      setInternalDisputes(res.data.internal);
      setExternalStats(res.data.external_stats ?? EMPTY_EXTERNAL);
    } catch {
      setError("Failed to load disputes.");
    } finally {
      if (!silent) setLoading(false);
    }
  }, [companyId]);

  useEffect(() => { fetchDisputes(); }, [fetchDisputes]);

  async function handleStatusChange(rightId: number, newStatus: DisputeStatus) {
    // Optimistic update
    setInternalDisputes((prev) =>
      prev.map((d) => d.right_id === rightId ? { ...d, status: newStatus } : d)
    );
    try {
      await api.patch(`/user/disputes/${rightId}`, { status: newStatus });
      toast.success("Status updated.");
    } catch {
      toast.error("Could not update status.");
      fetchDisputes(true); // revert
    }
  }

  async function handleUpdate(rightId: number, updates: Partial<InternalDispute>) {
    try {
      await api.patch(`/user/disputes/${rightId}`, updates);
      toast.success("Dispute updated.");
      await fetchDisputes(true);
      // Re-sync selected dispute
      setSelectedDispute((prev) =>
        prev ? { ...prev, ...updates } : prev
      );
    } catch {
      toast.error("Could not update dispute. Please try again.");
      throw new Error("Dispute update failed");
    }
  }

  async function handleRefresh() {
    setSpinning(true);
    await fetchDisputes(true);
    setSpinning(false);
  }

  const openCount = internalDisputes.filter((d) => !d.closed_at).length;

  if (!companyId) return (
    <div className="flex items-center justify-center h-64 text-gray-400 dark:text-gray-500">
      No company associated with your account.
    </div>
  );

  return (
    <div className="w-full max-w-7xl mx-auto flex flex-col gap-6 p-6">
      <DashboardHeader
        title="Disputes & Worker Rights"
        subtitle="Internal complaint resolution workflow. External reports are anonymised."
        extra={
          <button
            onClick={handleRefresh}
            disabled={spinning}
            className="p-2 rounded-xl border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-800 text-gray-500 hover:text-gray-900 dark:hover:text-gray-100 hover:bg-gray-50 dark:hover:bg-gray-700 transition-colors"
          >
            <RefreshCw size={15} className={spinning ? "animate-spin" : ""} />
          </button>
        }
      />

      {error && (
        <div className="bg-red-50 dark:bg-red-900/20 border border-red-200 dark:border-red-800 rounded-xl px-4 py-3 text-sm text-red-700 dark:text-red-400">
          {error}
        </div>
      )}

      {/* Stats cards */}
      <DisputeStatsCards disputes={internalDisputes} loading={loading} />

      {/* View tabs */}
      <div className="bg-white dark:bg-gray-800 rounded-xl border border-gray-100 dark:border-gray-700">
        <div className="flex items-center justify-between gap-3 border-b border-gray-100 dark:border-gray-700 px-4 flex-wrap">
          <div className="flex">
            <button
              onClick={() => setActiveView("kanban")}
              className={`flex items-center gap-2 py-3 px-4 text-sm font-medium border-b-2 -mb-px transition-colors ${
                activeView === "kanban"
                  ? "border-blue-500 text-blue-600 dark:text-blue-400"
                  : "border-transparent text-gray-500 dark:text-gray-400 hover:text-gray-700 dark:hover:text-gray-200"
              }`}
            >
              <Scale size={14} />
              Internal Disputes
              {openCount > 0 && (
                <span className="bg-blue-100 dark:bg-blue-900/30 text-blue-700 dark:text-blue-400 text-xs font-bold px-1.5 py-0.5 rounded-full">
                  {openCount}
                </span>
              )}
            </button>
            <button
              onClick={() => setActiveView("external")}
              className={`flex items-center gap-2 py-3 px-4 text-sm font-medium border-b-2 -mb-px transition-colors ${
                activeView === "external"
                  ? "border-blue-500 text-blue-600 dark:text-blue-400"
                  : "border-transparent text-gray-500 dark:text-gray-400 hover:text-gray-700 dark:hover:text-gray-200"
              }`}
            >
              External Reports
              {externalStats.total > 0 && (
                <span className="bg-gray-100 dark:bg-gray-700 text-gray-600 dark:text-gray-400 text-xs font-bold px-1.5 py-0.5 rounded-full">
                  {externalStats.total}
                </span>
              )}
            </button>
          </div>
          {activeView === "kanban" && (
            <SearchInput
              value={searchQuery}
              onChange={setSearchQuery}
              placeholder="Search by title or category…"
              className="w-64 max-w-full my-2"
            />
          )}
        </div>

        <div className="p-4">
          {activeView === "kanban" ? (
            <DisputeKanban
              disputes={filteredDisputes}
              loading={loading}
              onCardClick={setSelectedDispute}
              onStatusChange={handleStatusChange}
            />
          ) : (
            <ExternalReportStats stats={externalStats} loading={loading} />
          )}
        </div>
      </div>

      {/* Detail modal */}
      <DisputeDetailModal
        dispute={selectedDispute}
        onClose={() => setSelectedDispute(null)}
        onUpdate={handleUpdate}
      />
    </div>
  );
}
