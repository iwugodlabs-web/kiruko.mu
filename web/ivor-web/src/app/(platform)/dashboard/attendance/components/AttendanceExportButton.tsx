"use client";

import { useState } from "react";
import { Download } from "lucide-react";
import { api } from "@/services/apiClient";
import { DashboardTimeLogs, TimeLogRow } from "./types";

interface Props {
  companyId: number;
  dateRange: { start: string; end: string };
}

// Backend caps a single page at 200 rows; page through until the full range is collected.
const PAGE_SIZE = 200;

function escapeCSV(val: string | number | null | undefined): string {
  if (val == null) return "";
  const str = String(val);
  if (str.includes(",") || str.includes('"') || str.includes("\n")) {
    return `"${str.replace(/"/g, '""')}"`;
  }
  return str;
}

function formatDatetime(iso: string | null): string {
  if (!iso) return "";
  return new Date(iso).toLocaleString([], { dateStyle: "short", timeStyle: "short" });
}

export default function AttendanceExportButton({ companyId, dateRange }: Props) {
  const [exporting, setExporting] = useState(false);
  const [error, setError] = useState(false);

  // Fetch every row in the selected date range, not just the page currently on screen.
  async function fetchAllLogs(): Promise<TimeLogRow[]> {
    const all: TimeLogRow[] = [];
    let offset = 0;
    // Loop until we've collected `total` rows (or the page comes back short).
    for (;;) {
      const params = new URLSearchParams({
        start_date: dateRange.start,
        end_date: dateRange.end,
        limit: String(PAGE_SIZE),
        offset: String(offset),
      });
      const res = await api.get<DashboardTimeLogs>(
        `/job/time-logs/company/${companyId}/dashboard?${params}`
      );
      all.push(...res.data.data);
      offset += res.data.data.length;
      if (res.data.data.length < PAGE_SIZE || offset >= res.data.total) break;
    }
    return all;
  }

  async function handleExport() {
    setExporting(true);
    setError(false);
    try {
      const logs = await fetchAllLogs();

      const headers = [
        "Employee", "Job Title", "Department", "Date",
        "Clock In", "Clock Out", "Hours Worked", "Break (min)",
        "Overtime", "OT Approved", "Status",
      ];

      const rows = logs.map((l) => [
        l.employee_name,
        l.job_title ?? "",
        l.department ?? "",
        l.date ?? "",
        formatDatetime(l.start_time),
        formatDatetime(l.end_time),
        l.hours_worked?.toFixed(2) ?? "",
        l.break_minutes,
        l.is_overtime ? "Yes" : "No",
        l.overtime_confirmed_by_employer ? "Yes" : "No",
        l.status,
      ]);

      const csv =
        headers.map(escapeCSV).join(",") +
        "\n" +
        rows.map((r) => r.map(escapeCSV).join(",")).join("\n");

      const blob = new Blob([csv], { type: "text/csv;charset=utf-8;" });
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = `attendance_${dateRange.start}_to_${dateRange.end}.csv`;
      a.click();
      URL.revokeObjectURL(url);
    } catch {
      setError(true);
    } finally {
      setExporting(false);
    }
  }

  return (
    <button
      onClick={handleExport}
      disabled={exporting}
      title={error ? "Export failed — click to retry" : "Export all rows in the selected date range"}
      className="flex items-center gap-2 px-4 py-2 text-sm font-medium rounded-xl border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-800 text-gray-700 dark:text-gray-300 hover:bg-gray-50 dark:hover:bg-gray-700 disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
    >
      <Download size={15} />
      {exporting ? "Exporting…" : error ? "Retry Export" : "Export CSV"}
    </button>
  );
}
