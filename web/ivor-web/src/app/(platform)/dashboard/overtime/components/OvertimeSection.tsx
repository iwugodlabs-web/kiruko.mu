"use client";

import { useState, useEffect, useCallback } from "react";
import { useAuth } from "@/contexts/AuthContext";
import { api } from "@/services/apiClient";
import { toast } from "sonner";
import { OvertimeRow, OvertimeResponse } from "./types";
import OvertimeSummaryCards from "./OvertimeSummaryCards";
import OvertimePendingTable from "./OvertimePendingTable";
import OvertimeHistoryTable from "./OvertimeHistoryTable";
import OvertimeDetailModal from "./OvertimeDetailModal";
import BulkActionBar from "./BulkActionBar";
import { Zap, RefreshCw, ClipboardCheck, ArrowRight, ChevronLeft, ChevronRight, CalendarDays } from "lucide-react";
import Link from "next/link";
import DashboardHeader from "@/components/ui/DashboardHeader";
import SearchInput from "@/components/ui/SearchInput";
import useDebouncedValue from "@/hooks/useDebouncedValue";

export default function OvertimeSection() {
  const { user, companyId } = useAuth();

  const [review, setReview] = useState<OvertimeRow[]>([]);   // off-hours, awaiting employer decision (#6)
  const [pending, setPending] = useState<OvertimeRow[]>([]);
  const [approved, setApproved] = useState<OvertimeRow[]>([]);
  const [rejected, setRejected] = useState<OvertimeRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [activeTab, setActiveTab] = useState<"review" | "pending" | "history">("review");
  const [selected, setSelected] = useState<Set<number>>(new Set());
  const [selectedRow, setSelectedRow] = useState<OvertimeRow | null>(null);
  const [acting, setActing] = useState(false);
  const [spinning, setSpinning] = useState(false);
  const [searchQuery, setSearchQuery] = useState("");
  const debouncedSearch = useDebouncedValue(searchQuery, 250);

  // Period navigator — scope the whole view to one month so you can step
  // back/forward (including future months) instead of seeing everything at once.
  const [monthAnchor, setMonthAnchor] = useState(() => {
    const d = new Date();
    return new Date(d.getFullYear(), d.getMonth(), 1);
  });
  const ymd = (d: Date) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
  const periodStart = ymd(monthAnchor);
  const periodEnd = ymd(new Date(monthAnchor.getFullYear(), monthAnchor.getMonth() + 1, 0)); // last day of month
  const periodLabel = monthAnchor.toLocaleDateString(undefined, { month: "long", year: "numeric" });
  const now = new Date();
  const isCurrentMonth = now.getFullYear() === monthAnchor.getFullYear() && now.getMonth() === monthAnchor.getMonth();
  const shiftMonth = (delta: number) => setMonthAnchor((m) => new Date(m.getFullYear(), m.getMonth() + delta, 1));
  const goToCurrentMonth = () => { const d = new Date(); setMonthAnchor(new Date(d.getFullYear(), d.getMonth(), 1)); };

  const matchesSearch = (row: OvertimeRow) => {
    const q = debouncedSearch.trim().toLowerCase();
    if (!q) return true;
    return row.employee_name?.toLowerCase().includes(q) ?? false;
  };

  const fetchAll = useCallback(async (silent = false) => {
    if (!companyId) return;
    if (!silent) setLoading(true);
    try {
      const range = `&start_date=${periodStart}&end_date=${periodEnd}`;
      const [revRes, pendRes, appRes, rejRes] = await Promise.all([
        api.get<OvertimeResponse>(`/job/time-logs/company/${companyId}/overtime?ot_status=review&limit=200${range}`),
        api.get<OvertimeResponse>(`/job/time-logs/company/${companyId}/overtime?ot_status=pending&limit=200${range}`),
        api.get<OvertimeResponse>(`/job/time-logs/company/${companyId}/overtime?ot_status=approved&limit=200${range}`),
        api.get<OvertimeResponse>(`/job/time-logs/company/${companyId}/overtime?ot_status=rejected&limit=200${range}`),
      ]);
      setReview(revRes.data.records);
      setPending(pendRes.data.records);
      setApproved(appRes.data.records);
      setRejected(rejRes.data.records);
    } catch {
      toast.error("Failed to load overtime data.");
    } finally {
      if (!silent) setLoading(false);
    }
  }, [companyId, periodStart, periodEnd]);

  useEffect(() => { fetchAll(); }, [fetchAll]);

  async function handleApprove(id: number) {
    setActing(true);
    try {
      await api.put(`/job/time-log/${id}/overtime/confirm`);
      toast.success("Overtime approved.");
      setSelectedRow(null);
      setSelected((prev) => { const s = new Set(prev); s.delete(id); return s; });
      await fetchAll(true);
    } catch {
      toast.error("Could not approve overtime.");
    } finally {
      setActing(false);
    }
  }

  async function handleReject(id: number) {
    setActing(true);
    try {
      await api.put(`/job/time-log/${id}/overtime/reject`);
      toast.success("Overtime rejected.");
      setSelectedRow(null);
      setSelected((prev) => { const s = new Set(prev); s.delete(id); return s; });
      await fetchAll(true);
    } catch {
      toast.error("Could not reject overtime.");
    } finally {
      setActing(false);
    }
  }

  async function handleBulk(action: "approve" | "reject") {
    if (selected.size === 0) return;
    setActing(true);
    try {
      await api.put(`/job/time-logs/company/${companyId}/overtime/bulk`, {
        timelog_ids: Array.from(selected),
        action,
      });
      toast.success(`${selected.size} session(s) ${action === "approve" ? "approved" : "rejected"}.`);
      setSelected(new Set());
      await fetchAll(true);
    } catch {
      toast.error("Bulk action failed.");
    } finally {
      setActing(false);
    }
  }

  function toggleRow(id: number) {
    setSelected((prev) => {
      const s = new Set(prev);
      s.has(id) ? s.delete(id) : s.add(id);
      return s;
    });
  }

  function toggleAll() {
    const allIds = (activeTab === "review" ? review : pending).map((r) => r.timelog_id);
    const allSelected = allIds.every((id) => selected.has(id));
    if (allSelected) {
      setSelected(new Set());
    } else {
      setSelected(new Set(allIds));
    }
  }

  async function handleRefresh() {
    setSpinning(true);
    await fetchAll(true);
    setSpinning(false);
  }

  if (!companyId) return (
    <div className="flex items-center justify-center h-64 text-gray-400 dark:text-gray-500">
      No company associated with your account.
    </div>
  );

  const historyRows = [...approved, ...rejected].sort((a, b) =>
    (b.date ?? "").localeCompare(a.date ?? "")
  );

  const filteredReview = review.filter(matchesSearch);
  const filteredPending = pending.filter(matchesSearch);
  const filteredHistory = historyRows.filter(matchesSearch);

  return (
    <div className="w-full max-w-7xl mx-auto flex flex-col gap-6 p-6">
      <DashboardHeader
        title="Overtime Management"
        subtitle="Review, approve, or reject employee overtime sessions. Cost calculated at 1.5× hourly rate."
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

      {/* Relationship to Clock-in Review — same data, two views. */}
      <div className="-mt-3 flex items-start gap-2 rounded-lg border border-gray-100 dark:border-gray-800 bg-gray-50/60 dark:bg-gray-800/40 px-4 py-2.5 text-xs text-gray-500 dark:text-gray-400">
        <Zap size={14} className="text-violet-500 shrink-0 mt-0.5" />
        <p className="flex-1">
          This is the <strong className="text-gray-700 dark:text-gray-200">focused overtime view</strong> — only OT, across everyone, with the estimated cost and bulk confirm/reject. You can also confirm overtime per session while reviewing a day in{" "}
          <Link href="/dashboard/time-logs" className="inline-flex items-center gap-0.5 font-medium text-violet-600 dark:text-violet-400 hover:underline">
            Clock-in Review <ClipboardCheck size={12} />
          </Link>
          . It&apos;s the same data — confirming in either place updates both.
        </p>
      </div>

      {/* Month navigator — scopes the cards + tables to one period. */}
      <div className="flex items-center justify-between gap-3 rounded-xl border border-gray-100 dark:border-gray-700 bg-white dark:bg-gray-800 px-3 py-2">
        <div className="flex items-center gap-2">
          <button
            onClick={() => shiftMonth(-1)}
            aria-label="Previous month"
            className="p-1.5 rounded-lg border border-gray-200 dark:border-gray-700 text-gray-500 hover:text-gray-900 dark:hover:text-gray-100 hover:bg-gray-50 dark:hover:bg-gray-700 transition-colors"
          >
            <ChevronLeft size={16} />
          </button>
          <div className="flex items-center gap-1.5 min-w-[150px] justify-center text-sm font-semibold text-gray-900 dark:text-white">
            <CalendarDays size={14} className="text-gray-400" />
            {periodLabel}
          </div>
          <button
            onClick={() => shiftMonth(1)}
            aria-label="Next month"
            className="p-1.5 rounded-lg border border-gray-200 dark:border-gray-700 text-gray-500 hover:text-gray-900 dark:hover:text-gray-100 hover:bg-gray-50 dark:hover:bg-gray-700 transition-colors"
          >
            <ChevronRight size={16} />
          </button>
        </div>
        {!isCurrentMonth && (
          <button
            onClick={goToCurrentMonth}
            className="text-xs font-medium text-violet-600 dark:text-violet-400 hover:underline px-2 py-1"
          >
            This month
          </button>
        )}
      </div>

      {/* Summary cards */}
      <OvertimeSummaryCards
        pending={pending}
        approved={approved}
        rejected={rejected}
        loading={loading}
      />

      {/* Tabs */}
      <div className="bg-white dark:bg-gray-800 rounded-xl border border-gray-100 dark:border-gray-700">
        <div className="flex items-center justify-between gap-3 border-b border-gray-100 dark:border-gray-700 px-4 flex-wrap">
          <div className="flex">
            <button
              onClick={() => { setActiveTab("review"); setSelected(new Set()); }}
              className={`flex items-center gap-2 py-3 px-4 text-sm font-medium border-b-2 -mb-px transition-colors ${
                activeTab === "review"
                  ? "border-amber-500 text-amber-600 dark:text-amber-400"
                  : "border-transparent text-gray-500 dark:text-gray-400 hover:text-gray-700 dark:hover:text-gray-200"
              }`}
            >
              <Zap size={14} />
              Needs Review
              {review.length > 0 && (
                <span className="bg-amber-100 dark:bg-amber-900/30 text-amber-700 dark:text-amber-400 text-xs font-bold px-1.5 py-0.5 rounded-full">
                  {review.length}
                </span>
              )}
            </button>
            <button
              onClick={() => { setActiveTab("pending"); setSelected(new Set()); }}
              className={`flex items-center gap-2 py-3 px-4 text-sm font-medium border-b-2 -mb-px transition-colors ${
                activeTab === "pending"
                  ? "border-amber-500 text-amber-600 dark:text-amber-400"
                  : "border-transparent text-gray-500 dark:text-gray-400 hover:text-gray-700 dark:hover:text-gray-200"
              }`}
            >
              <Zap size={14} />
              Pending Approval
              {pending.length > 0 && (
                <span className="bg-amber-100 dark:bg-amber-900/30 text-amber-700 dark:text-amber-400 text-xs font-bold px-1.5 py-0.5 rounded-full">
                  {pending.length}
                </span>
              )}
            </button>
            <button
              onClick={() => { setActiveTab("history"); setSelected(new Set()); }}
              className={`flex items-center gap-2 py-3 px-4 text-sm font-medium border-b-2 -mb-px transition-colors ${
                activeTab === "history"
                  ? "border-amber-500 text-amber-600 dark:text-amber-400"
                  : "border-transparent text-gray-500 dark:text-gray-400 hover:text-gray-700 dark:hover:text-gray-200"
              }`}
            >
              History
              {historyRows.length > 0 && (
                <span className="bg-gray-100 dark:bg-gray-700 text-gray-600 dark:text-gray-400 text-xs font-bold px-1.5 py-0.5 rounded-full">
                  {historyRows.length}
                </span>
              )}
            </button>
          </div>
          <SearchInput
            value={searchQuery}
            onChange={setSearchQuery}
            placeholder="Search by employee…"
            className="w-64 max-w-full my-2"
          />
        </div>

        <div className="p-2">
          {activeTab === "review" || activeTab === "pending" ? (
            <OvertimePendingTable
              rows={activeTab === "review" ? filteredReview : filteredPending}
              loading={loading}
              selected={selected}
              onToggle={toggleRow}
              onToggleAll={toggleAll}
              onApprove={handleApprove}
              onReject={handleReject}
              onRowClick={setSelectedRow}
            />
          ) : (
            <OvertimeHistoryTable
              rows={filteredHistory}
              loading={loading}
              onRowClick={setSelectedRow}
            />
          )}
        </div>
      </div>

      {/* Detail modal */}
      <OvertimeDetailModal
        row={selectedRow}
        onClose={() => setSelectedRow(null)}
        onApprove={handleApprove}
        onReject={handleReject}
        acting={acting}
      />

      {/* Bulk action bar */}
      <BulkActionBar
        count={selected.size}
        onApprove={() => handleBulk("approve")}
        onReject={() => handleBulk("reject")}
        onClear={() => setSelected(new Set())}
        loading={acting}
      />
    </div>
  );
}
