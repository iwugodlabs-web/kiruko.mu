"use client";

import { useState } from "react";
import { Download } from "lucide-react";
import { ComplianceEmployee } from "./types";

interface Props {
  employees: ComplianceEmployee[];
}

function escapeCSV(val: string | number | boolean | null | undefined): string {
  if (val == null) return "";
  const s = String(val);
  return s.includes(",") || s.includes('"') ? `"${s.replace(/"/g, '""')}"` : s;
}

export default function ComplianceExportButton({ employees }: Props) {
  const [exporting, setExporting] = useState(false);

  function handleExport() {
    setExporting(true);
    try {
      const headers = [
        "Employee", "Job Title", "Department", "Passport Number",
        "Permit Type", "Has Permission To Work", "Tourist Visa",
        "Expiry Date", "Days Until Expiry", "Permit Status",
        "Currency", "Total Monthly Pay", "Below Min Wage", "Compliance Score",
      ];
      const rows = employees.map((e) => [
        e.employee_name, e.job_title ?? "", e.department ?? "", e.passport_number ?? "",
        e.permit_type ?? "", e.has_permission_to_work, e.working_on_tourist_visa,
        e.expiry_date ?? "", e.days_until_expiry ?? "", e.permit_status,
        e.currency ?? "", e.total_monthly_pay ?? "", e.below_min_wage, e.compliance_score,
      ]);
      const csv = [headers, ...rows].map((r) => r.map(escapeCSV).join(",")).join("\n");
      const blob = new Blob([csv], { type: "text/csv;charset=utf-8;" });
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = `compliance_report_${new Date().toISOString().split("T")[0]}.csv`;
      a.click();
      URL.revokeObjectURL(url);
    } finally {
      setExporting(false);
    }
  }

  return (
    <button
      onClick={handleExport}
      disabled={exporting || employees.length === 0}
      className="flex items-center gap-2 px-4 py-2 text-sm font-medium rounded-xl border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-800 text-gray-700 dark:text-gray-300 hover:bg-gray-50 dark:hover:bg-gray-700 disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
    >
      <Download size={15} />
      {exporting ? "Exporting…" : "Export Report"}
    </button>
  );
}
