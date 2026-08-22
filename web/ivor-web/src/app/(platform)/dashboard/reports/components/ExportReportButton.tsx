"use client";

import { useState } from "react";
import { Download } from "lucide-react";
import { ReportsData, LEAVE_TYPE_LABELS } from "./types";

interface Props {
  data: ReportsData;
  months: number;
}

function escapeCSV(v: string | number | null | undefined): string {
  if (v === null || v === undefined) return "";
  const s = String(v);
  if (s.includes(",") || s.includes('"') || s.includes("\n")) {
    return `"${s.replace(/"/g, '""')}"`;
  }
  return s;
}

function buildCSV(data: ReportsData): string {
  const rows: string[][] = [];

  // === Headcount ===
  rows.push(["HEADCOUNT TREND"]);
  rows.push(["Month", "Total Employees", "New Hires"]);
  data.headcount_trend.forEach((r) => rows.push([r.label, String(r.total), String(r.new_hires)]));
  rows.push([]);

  // === Attendance ===
  rows.push(["HOURS WORKED"]);
  rows.push(["Month", "Total Hours", "Sessions"]);
  data.attendance_by_month.forEach((r) =>
    rows.push([r.label, String(r.hours), String(r.sessions)])
  );
  rows.push([]);

  // === Leave ===
  rows.push(["LEAVE UTILIZATION"]);
  rows.push(["Type", "Total", "Approved", "Pending", "Rejected"]);
  data.leave_utilization.forEach((r) =>
    rows.push([
      LEAVE_TYPE_LABELS[r.type] ?? r.type,
      String(r.total),
      String(r.approved),
      String(r.pending),
      String(r.rejected),
    ])
  );
  rows.push([]);

  // === OT Cost ===
  rows.push(["OVERTIME COST"]);
  rows.push(["Month", "OT Hours", "Estimated Cost"]);
  data.ot_cost_by_month.forEach((r) =>
    rows.push([r.label, String(r.ot_hours), String(r.ot_cost)])
  );
  rows.push([]);

  // === Disputes ===
  rows.push(["DISPUTE RESOLUTION"]);
  rows.push(["Month", "Opened", "Resolved"]);
  data.dispute_resolution.forEach((r) =>
    rows.push([r.label, String(r.opened), String(r.closed)])
  );
  rows.push([]);

  // === Summary ===
  rows.push(["SUMMARY"]);
  rows.push(["Total Employees", String(data.summary.total_employees)]);
  rows.push(["Total Hours (Period)", String(data.summary.total_hours_period)]);
  rows.push(["Total OT Cost (Period)", String(data.summary.total_ot_cost_period)]);
  rows.push(["Leave Approved (Period)", String(data.summary.total_leave_approved_period)]);
  rows.push(["Open Disputes", String(data.summary.open_disputes)]);

  return rows.map((r) => r.map(escapeCSV).join(",")).join("\n");
}

export default function ExportReportButton({ data, months }: Props) {
  const [exporting, setExporting] = useState(false);

  function handleExport() {
    setExporting(true);
    try {
      const csv = buildCSV(data);
      const blob = new Blob([csv], { type: "text/csv;charset=utf-8;" });
      const url = URL.createObjectURL(blob);
      const link = document.createElement("a");
      const now = new Date().toISOString().slice(0, 10);
      link.href = url;
      link.download = `ivor-report-${months}mo-${now}.csv`;
      link.click();
      URL.revokeObjectURL(url);
    } finally {
      setExporting(false);
    }
  }

  return (
    <button
      onClick={handleExport}
      disabled={exporting}
      className="flex items-center gap-2 px-4 py-2 text-sm font-medium border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-800 text-gray-700 dark:text-gray-300 hover:bg-gray-50 dark:hover:bg-gray-700 rounded-xl transition-colors disabled:opacity-50"
    >
      <Download size={14} />
      {exporting ? "Exporting…" : "Export CSV"}
    </button>
  );
}
